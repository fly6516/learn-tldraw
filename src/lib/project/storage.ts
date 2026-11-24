import { legacyProjectId, legacyStorageKey, libraryStorageKey, type LibraryProject, type LibraryProjectState, type LibraryView, type RecoveryReceipt } from './project-library'
import type { BackupHistorySelection, PortableProjectHistory } from './backup-history'
import type { SourceMove } from './writing-ai-evidence'
import { verificationBaseline, verificationPatch, type ChatVerification, type ManuscriptBuild } from './writing-chat-validation'
import { buildManuscriptSnapshot } from './manuscript-review'
import { chatActionPaths, nextChatCheckpoint, type ChatAction } from './writing-chat-actions'
import type { ChatCheckpoint, ChatHistory, ChatReplyTarget, ChatSource, ChatTaskStep } from './writing-chat'
import { updateFileContent } from './file-system'
import type { ProjectFileSystem } from './types'
import type { ProjectSnapshot, ProjectSnapshotInfo } from './snapshots'
import { restoreSnapshotFiles } from './snapshots'
import type { SubmissionVersion, SubmissionVersionInfo } from './submission'
import { submissionEvidenceLedger } from './submission-evidence'
import type { RevisionComment, RevisionResponse, RevisionRound } from './revision-rounds'
import type { RevisionPackageInput } from './revision-package'
import { applyWritingDrafts, draftConflicts, editableSource, sameDraft, type PortableWritingState, type WritingDraft, type WritingDrafts, type WritingKey, type WritingView } from './writing-drafts'

const storeName = 'projects'

export class ProjectStorageConflict extends Error {
    constructor() { super('Another tab saved a newer project version. Your drafts were kept. Review the saved version before continuing.') }
}

function sameStoredProject(current: ProjectFileSystem | undefined, expected: ProjectFileSystem | null) {
    return current?.metadata.createdAt === expected?.metadata.createdAt && current?.storageRevision === expected?.storageRevision
}

function putProject(store: IDBObjectStore, key: string, project: ProjectFileSystem) {
    const saved = { ...project, storageRevision: crypto.randomUUID() }
    store.put(saved, key)
    return saved
}

export function openProjectStorage(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('research-canvas-projects', 1)
        request.onupgradeneeded = () => request.result.createObjectStore(storeName)
        request.onsuccess = () => {
            request.result.onversionchange = () => request.result.close()
            resolve(request.result)
        }
        request.onerror = () => reject(request.error)
    })
}

function complete(transaction: IDBTransaction) {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new Error('Local storage transaction was cancelled.'))
    })
}

function draftRange(key: WritingKey) {
    // Projects use string keys. Compound keys let drafts and project saves share a transaction.
    return IDBKeyRange.bound(['draft', ...key], ['draft', ...key, []], false, true)
}

function readDraftRecords(store: IDBObjectStore, key: WritingKey) {
    const keys = store.getAllKeys(draftRange(key))
    const values = store.getAll(draftRange(key))
    return { keys, values, match: (expected: WritingDrafts) => keys.result.length === Object.keys(expected).length && keys.result.every((entry, index) =>
        sameDraft(values.result[index], expected[(entry as [string, ...WritingKey, string])[3]])) }
}

function snapshotEntry(key: WritingKey, id: string) {
    return ['snapshot', ...key, id]
}

function snapshotList(key: WritingKey) {
    return ['snapshots', ...key]
}

export async function listSubmissionVersions(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const prefix = ['submission-info', ...key]
    const request = transaction.objectStore(storeName).getAll(IDBKeyRange.bound(prefix, [...prefix, []], true, true))
    await complete(transaction)
    return (request.result as SubmissionVersionInfo[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function saveSubmissionVersion(database: IDBDatabase, key: WritingKey, version: SubmissionVersion, chatRun?: string) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const { pdf, zip, ...info } = version
  const entry = ['submission-info', ...key, version.id]
  const previous = store.get(entry)
  previous.onsuccess = () => {
      if (previous.result) return
      store.add({ pdf, zip }, ['submission-files', ...key, version.id])
      store.add(info, entry)
      if (chatRun) {
          appendTaskStep(store, key, chatRun, { kind: 'archived', at: Date.now(), detail: version.name })
          store.delete(['ai-manuscript-build', ...key, chatRun])
      }
  }
    await complete(transaction)
  return (previous.result as SubmissionVersionInfo | undefined) ?? info
}

export async function readSubmissionFiles(database: IDBDatabase, key: WritingKey, id: string) {
    const transaction = database.transaction(storeName)
    const request = transaction.objectStore(storeName).get(['submission-files', ...key, id])
    await complete(transaction)
    return request.result as Pick<SubmissionVersion, 'pdf' | 'zip'> | undefined
}

export async function readRevisionPackage(database: IDBDatabase, key: WritingKey, reviewed: RevisionRound): Promise<RevisionPackageInput> {
    const { id, submissionId, revisedSubmissionId } = reviewed
    if (!revisedSubmissionId || revisedSubmissionId === submissionId) throw new Error('Choose an archived revised submission.')
    const transaction = database.transaction(storeName)
    const store = transaction.objectStore(storeName)
    const round = store.get(['revision-round', ...key, id])
    const info = (version: string) => store.get(['submission-info', ...key, version])
    const files = (version: string) => store.get(['submission-files', ...key, version])
    const before = info(submissionId)
    const after = info(revisedSubmissionId)
    const beforeFiles = files(submissionId)
    const afterFiles = files(revisedSubmissionId)
    await complete(transaction)
    if (JSON.stringify(round.result) !== JSON.stringify(reviewed)) {
        throw new Error('The revision round changed. Reopen it and review the current responses before exporting.')
    }
    if (!before.result || !after.result || !(beforeFiles.result?.zip instanceof Blob)
        || !(afterFiles.result?.zip instanceof Blob) || !(afterFiles.result?.pdf instanceof Blob)) {
        throw new Error('The archived original ZIP, revised ZIP, or revised PDF is unavailable.')
    }
    return { round: round.result, original: { ...before.result, zip: beforeFiles.result.zip },
        revised: { ...after.result, zip: afterFiles.result.zip, pdf: afterFiles.result.pdf } }
}

export async function readSubmissionEvidence(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const store = transaction.objectStore(storeName)
    const history = store.get(['ai-history', ...key])
    const moves = store.get(['source-moves', ...key])
    function records<T>(prefix: string) {
        const entries: Record<string, T> = Object.create(null)
        const range = IDBKeyRange.bound([prefix, ...key], [prefix, ...key, []], true, true)
        const request = store.openCursor(range)
        request.onsuccess = () => {
            const cursor = request.result
            if (!cursor) return
            entries[(cursor.key as [string, ...WritingKey, string])[3]] = cursor.value
            cursor.continue()
        }
        return entries
    }
    const checkpoints = records<ChatCheckpoint>('ai-change')
    const tasks = records<ChatTaskStep[]>('ai-task')
    await complete(transaction)
    return submissionEvidenceLedger(history.result, checkpoints, tasks, moves.result ?? [])
}

export async function listRevisionRounds(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const prefix = ['revision-round', ...key]
    const request = transaction.objectStore(storeName).getAll(IDBKeyRange.bound(prefix, [...prefix, []], true, true))
    await complete(transaction)
    return (request.result as RevisionRound[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function createRevisionRound(database: IDBDatabase, key: WritingKey, round: RevisionRound, chatRun?: string) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const baseline = store.getKey(['submission-files', ...key, round.submissionId])
    baseline.onsuccess = () => {
        if (baseline.result) {
            store.add(round, ['revision-round', ...key, round.id])
            if (chatRun) appendTaskStep(store, key, chatRun, { kind: 'revision-created', at: Date.now(), detail: round.name })
        }
    }
    await complete(transaction)
    if (!baseline.result) throw new Error('The archived source ZIP is unavailable.')
}

export async function addRevisionComment(database: IDBDatabase, key: WritingKey, roundId: string, comment: RevisionComment, chatRun?: string) {
    return updateRevisionRound(database, key, roundId, round => {
        if (round.comments.some(item => item.id === comment.id)) throw new Error('The reviewer comment is already in this round.')
        if (comment.kind === 'canvas' && round.comments.some(item => item.kind === 'canvas' && item.nodeId === comment.nodeId)) {
            throw new Error('This Canvas card is already in the round.')
        }
        return { ...round, comments: [...round.comments, comment] }
    }, undefined, chatRun ? { run: chatRun, step: { kind: 'comment-added', at: Date.now() } } : undefined)
}

export async function saveRevisionResponse(database: IDBDatabase, key: WritingKey, roundId: string, commentId: string, response?: RevisionResponse) {
    return updateRevisionRound(database, key, roundId, round => {
        if (!round.comments.some(item => item.id === commentId)) throw new Error('The reviewer comment is unavailable.')
        return { ...round, comments: round.comments.map(item => item.id === commentId ? { ...item, response } : item) }
    })
}

export async function confirmChatReply(database: IDBDatabase, key: WritingKey, target: ChatReplyTarget, text: string, chatRun: string) {
    return updateRevisionRound(database, key, target.round, round => {
        const comment = round.comments.find(item => item.id === target.comment)
        if (!comment || comment.text !== target.commentText || JSON.stringify(comment.response) !== JSON.stringify(target.previous)
            || round.submissionId !== target.originalId || round.revisedSubmissionId !== target.previousRevisedId) {
            throw new Error('The reviewer comment, response, or archive changed. Request a new draft.')
        }
        const response = { kind: target.kind, text, paths: target.paths }
        return { ...round, revisedSubmissionId: target.revisedId,
            comments: round.comments.map(item => item.id === comment.id ? { ...item, response } : item) }
    }, target.revisedId, { run: chatRun, step: { kind: 'reply-saved', at: Date.now(), detail: target.roundName } })
}

export async function linkRevisedSubmission(database: IDBDatabase, key: WritingKey, roundId: string, submissionId?: string) {
    return updateRevisionRound(database, key, roundId, round => {
        if (submissionId === round.submissionId) throw new Error('Choose a separate revised submission.')
        return { ...round, revisedSubmissionId: submissionId }
    }, submissionId)
}

async function updateRevisionRound(database: IDBDatabase, key: WritingKey, roundId: string,
    update: (round: RevisionRound) => RevisionRound, submissionId?: string, task?: { run: string; step: ChatTaskStep }) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const entry = ['revision-round', ...key, roundId]
    const version = submissionId ? store.getKey(['submission-files', ...key, submissionId]) : undefined
    const request = store.get(entry)
    let updated: RevisionRound | undefined
    let failure: unknown
    request.onsuccess = () => {
        const round = request.result as RevisionRound | undefined
        if (!round) return
        try {
            if (version && !version.result) throw new Error('The revised source ZIP is unavailable.')
            updated = update(round)
            store.put(updated, entry)
            if (task) appendTaskStep(store, key, task.run, task.step)
        } catch (cause) { failure = cause }
    }
    await complete(transaction)
    if (failure) throw failure
    if (!updated) throw new Error('The revision round is unavailable.')
    return updated
}

export async function listProjectSnapshots(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const request = transaction.objectStore(storeName).get(snapshotList(key))
    await complete(transaction)
    return (request.result ?? []) as ProjectSnapshotInfo[]
}

export async function readProjectSnapshot(database: IDBDatabase, key: WritingKey, id: string) {
    const transaction = database.transaction(storeName)
    const request = transaction.objectStore(storeName).get(snapshotEntry(key, id))
    await complete(transaction)
    return request.result as ProjectFileSystem | undefined
}

function storeSnapshot(store: IDBObjectStore, key: WritingKey, snapshots: ProjectSnapshotInfo[], snapshot: ProjectSnapshot) {
    const { project, ...info } = snapshot
    store.add(project, snapshotEntry(key, info.id))
    store.put([info, ...snapshots], snapshotList(key))
}

export async function createProjectSnapshot(database: IDBDatabase, key: WritingKey, snapshot: ProjectSnapshot) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const list = store.get(snapshotList(key))
    list.onsuccess = () => storeSnapshot(store, key, list.result ?? [], snapshot)
    await complete(transaction)
}

export async function restoreProjectSnapshot(database: IDBDatabase, key: WritingKey, id: string, checkpoint: ProjectSnapshot) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const current = store.get(key[0])
    const saved = store.get(snapshotEntry(key, id))
    const list = store.get(snapshotList(key))
    const drafts = store.count(draftRange(key))
    let restored: ProjectFileSystem | undefined
    let error = 'The selected snapshot is unavailable.'
    drafts.onsuccess = () => {
        if (drafts.result) {
            error = 'Save or discard the local drafts in Writing before restoring a snapshot.'
            return
        }
        if (!sameStoredProject(current.result, checkpoint.project)) {
            error = new ProjectStorageConflict().message
            return
        }
        const project = saved.result as ProjectFileSystem | undefined
        if (!project || project.metadata.createdAt !== key[1]) return
        const previous = current.result as ProjectFileSystem
        storeSnapshot(store, key, list.result ?? [], {
            ...checkpoint, project: { ...previous, canvas: previous.canvas ?? checkpoint.project.canvas },
        })
        restored = putProject(store, key[0], { ...project, metadata: { ...project.metadata, aiReadExclusions: previous.metadata.aiReadExclusions } })
    }
    await complete(transaction)
    if (!restored) throw new Error(error)
    return restored
}

export async function restoreSelectedSnapshotFiles(database: IDBDatabase, key: WritingKey, id: string,
    checkpoint: ProjectSnapshot, paths: readonly string[]) {
    if (!paths.length) throw new Error('Select at least one file to restore.')
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const current = store.get(key[0])
    const saved = store.get(snapshotEntry(key, id))
    const list = store.get(snapshotList(key))
    const drafts = store.getAllKeys(draftRange(key))
    let restored: ProjectFileSystem | undefined
    let error = 'The selected snapshot is unavailable.'
    drafts.onsuccess = () => {
        const before = current.result as ProjectFileSystem | undefined
        const snapshot = saved.result as ProjectFileSystem | undefined
        if (!before || !sameStoredProject(before, checkpoint.project)) {
            error = new ProjectStorageConflict().message
            return
        }
        if (!snapshot || snapshot.metadata.createdAt !== key[1]) return
        const selected = new Set(paths)
        if (drafts.result.some(entry => selected.has((entry as [string, ...WritingKey, string])[3]))) {
            error = 'Save or discard local drafts for the selected files before restoring them.'
            return
        }
        try {
            restored = restoreSnapshotFiles(before, snapshot, paths)
        } catch (cause) {
            error = cause instanceof Error ? cause.message : 'Could not restore the selected files.'
            return
        }
        storeSnapshot(store, key, list.result ?? [], { ...checkpoint, project: before })
        restored = putProject(store, key[0], restored)
    }
    await complete(transaction)
    if (!restored) throw new Error(error)
    return restored
}

export async function readWritingState(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const store = transaction.objectStore(storeName)
    const drafts: WritingDrafts = Object.create(null)
    const cursor = store.openCursor(draftRange(key))
    cursor.onsuccess = () => {
        const item = cursor.result
        if (!item) return
        const path = (item.key as [string, ...WritingKey, string])[3]
        drafts[path] = item.value
        item.continue()
    }
    const view = store.get(['view', ...key])
    await complete(transaction)
    return { drafts, view: view.result as WritingView | undefined }
}

export async function writeWritingDraft(database: IDBDatabase, key: WritingKey, path: string,
    draft: WritingDraft | undefined, expected: WritingDraft | undefined) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const entry = ['draft', ...key, path]
    const read = store.get(entry)
    let accepted = false
    read.onsuccess = () => {
        if (!sameDraft(read.result, expected)) return
        accepted = true
        if (draft) store.put(draft, entry)
        else store.delete(entry)
    }
    await complete(transaction)
    if (!accepted) throw new Error('A different local draft exists for this file.')
}

export async function writeWritingView(database: IDBDatabase, key: WritingKey, view: WritingView) {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(view, ['view', ...key])
    await complete(transaction)
}

export async function writeWritingDraftBatch(database: IDBDatabase, key: WritingKey, edits: WritingDrafts, expected: WritingDrafts,
    expectedMain: string | undefined) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const project = store.get(key[0])
    const requests = Object.entries(edits).map(([path, draft]) => {
        const entry = ['draft', ...key, path]
        return { path, draft, entry, request: store.get(entry) }
    })
    let accepted = false
    const last = requests.at(-1)
    if (last) last.request.onsuccess = () => {
        const saved = project.result as ProjectFileSystem | undefined
        if (!saved || saved.metadata.createdAt !== key[1] || saved.metadata.mainFile !== expectedMain
            || requests.some(({ path, draft, request }) => editableSource(saved, path) !== draft.base
                || !sameDraft(request.result, Object.hasOwn(expected, path) ? expected[path] : undefined))) return
        for (const { draft, entry } of requests) {
            if (draft.base === draft.text) store.delete(entry)
            else store.put(draft, entry)
        }
        accepted = true
    }
    await complete(transaction)
    if (!accepted) throw new Error('The project or its local drafts changed. Request a new proposal.')
}

export async function commitWritingDrafts(database: IDBDatabase, key: WritingKey, expected: ProjectFileSystem,
    drafts: WritingDrafts, storedDrafts: WritingDrafts) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const projects = transaction.objectStore(storeName)
    const read = projects.get(key[0])
    let result: { project: ProjectFileSystem; conflicts: string[] } | undefined
    const entries = Object.keys(drafts).map(path => {
        const keyPath = ['draft', ...key, path]
        return { path, keyPath, value: projects.get(keyPath) }
    })
    let draftChanged = false
    function save() {
        const current = read.result as ProjectFileSystem | undefined
        if (!current || !sameStoredProject(current, expected)) return
        if (entries.some(item => !sameDraft(item.value.result, storedDrafts[item.path]))) { draftChanged = true; return }
        const conflicts = draftConflicts(current, drafts)
        const project = conflicts.length ? current : putProject(projects, key[0], applyWritingDrafts(current, drafts))
        result = { project, conflicts }
        if (!conflicts.length) for (const item of entries) projects.delete(item.keyPath)
    }
    const last = entries.at(-1)
    if (last) last.value.onsuccess = save
    else read.onsuccess = save
    await complete(transaction)
    if (draftChanged) throw new Error('Another tab changed a draft for this file. Your version is still open in this tab.')
    if (!result) throw new ProjectStorageConflict()
    return result
}

function historyRange(bucket: string, key: WritingKey) {
    const prefix = [bucket, ...key]
    return IDBKeyRange.bound(prefix, [...prefix, []], true, true)
}

export async function readBackupHistory(database: IDBDatabase, key: WritingKey, selection: BackupHistorySelection): Promise<PortableProjectHistory> {
    const transaction = database.transaction(storeName)
    const store = transaction.objectStore(storeName)
    const readRecord = <T>(bucket: string) => {
        const range = historyRange(bucket, key)
        const keys = store.getAllKeys(range)
        const values = store.getAll(range)
        return () => Object.fromEntries(keys.result.map((entry, index) => [(entry as [string, ...WritingKey, string])[3], values.result[index] as T]))
    }
    const publication = selection.publication ? {
        submissions: store.getAll(historyRange('submission-info', key)),
        files: readRecord<Pick<SubmissionVersion, 'pdf' | 'zip'>>('submission-files'),
        rounds: store.getAll(historyRange('revision-round', key)),
    } : undefined
    const snapshots = selection.snapshots ? { list: store.get(snapshotList(key)), projects: readRecord<ProjectFileSystem>('snapshot') } : undefined
    const ai = selection.ai ? {
        history: store.get(['ai-history', ...key]), moves: store.get(['source-moves', ...key]),
        tasks: readRecord<ChatTaskStep[]>('ai-task'), checkpoints: readRecord<ChatCheckpoint>('ai-change'),
        verifications: readRecord<ChatVerification>('ai-verify'), builds: readRecord<ManuscriptBuild>('ai-manuscript-build'),
    } : undefined
    await complete(transaction)

    const backup: PortableProjectHistory = {}
    if (publication) {
        const files = publication.files()
        const submissions = (publication.submissions.result as SubmissionVersionInfo[]).map(info => {
            const pair = files[info.id]
            if (!(pair?.pdf instanceof Blob) || !(pair?.zip instanceof Blob)) throw new Error(`Archived PDF or ZIP is unavailable for ${info.name}.`)
            return { ...info, ...pair }
        })
        backup.publication = { submissions, rounds: publication.rounds.result as RevisionRound[] }
    }
    if (snapshots) {
        const projects = snapshots.projects()
        backup.snapshots = ((snapshots.list.result ?? []) as ProjectSnapshotInfo[]).map(info => {
            if (!projects[info.id]) throw new Error(`The snapshot ${info.name} is unavailable.`)
            return { ...info, project: projects[info.id] }
        })
    }
    if (ai) {
        const history = ai.history.result as ChatHistory | undefined
        const verifications = ai.verifications()
        const taskIds = new Set(history?.conversations.map(item => item.manuscript?.id))
        const builds = Object.fromEntries(Object.entries(ai.builds()).filter(([run, build]) =>
            taskIds.has(run) && verifications[run]?.status === 'passed' && verifications[run]?.manuscript
            && verifications[run].compiledBaseline === build.compiledBaseline))
        backup.ai = { history, moves: ai.moves.result ?? [], tasks: ai.tasks(), checkpoints: ai.checkpoints(), verifications, builds }
    }
    return backup
}

function restoreBackupHistory(store: IDBObjectStore, key: WritingKey, history: PortableProjectHistory) {
    if (history.publication) {
        for (const bucket of ['submission-files', 'submission-info', 'revision-round']) store.delete(historyRange(bucket, key))
        for (const { pdf, zip, ...info } of history.publication.submissions) {
            store.put({ pdf, zip }, ['submission-files', ...key, info.id])
            store.put(info, ['submission-info', ...key, info.id])
        }
        for (const round of history.publication.rounds) store.put(round, ['revision-round', ...key, round.id])
    }
    if (history.snapshots) {
        store.delete(historyRange('snapshot', key))
        const list = history.snapshots.map(({ project, ...info }) => {
            store.put(project, snapshotEntry(key, info.id))
            return info
        })
        store.put(list, snapshotList(key))
    }
    if (history.ai) {
        const { ai } = history
        if (ai.history) store.put(ai.history, ['ai-history', ...key])
        else store.delete(['ai-history', ...key])
        store.put(ai.moves, ['source-moves', ...key])
        for (const [bucket, records] of [['ai-task', ai.tasks], ['ai-change', ai.checkpoints], ['ai-verify', ai.verifications],
            ['ai-manuscript-build', ai.builds ?? {}]] as const) {
            store.delete(historyRange(bucket, key))
            for (const [run, value] of Object.entries(records)) store.put(value, [bucket, ...key, run])
        }
    }
}

function storeImportedProject(store: IDBObjectStore, key: WritingKey, project: ProjectFileSystem,
    writing?: PortableWritingState, history?: PortableProjectHistory) {
    const saved = putProject(store, key[0], project)
    if (history) restoreBackupHistory(store, key, history)
    if (writing) {
        for (const [path, draft] of Object.entries(writing.drafts)) store.put(draft, ['draft', ...key, path])
        if (writing.view) store.put(writing.view, ['view', ...key])
    }
    return saved
}

type LibraryEntry = Omit<LibraryProject, 'name'>
const libraryRange = () => IDBKeyRange.bound(['project-library'], ['project-library', []], true, true)
const libraryEntry = (id: string) => ['project-library', id]

export async function readRecoveryBaseline(database: IDBDatabase, workspace: string) {
    const transaction = database.transaction(storeName)
    const store = transaction.objectStore(storeName)
    const request = store.get(workspace)
    let readState: (() => { version: string; drafts: WritingDrafts; history: unknown }) | undefined
    request.onsuccess = () => {
        const project = request.result as ProjectFileSystem | undefined
        if (!project) return
        const key: WritingKey = [workspace, project.metadata.createdAt]
        const drafts = readDraftRecords(store, key)
        const submissions = store.getAll(historyRange('submission-info', key))
        const rounds = store.getAll(historyRange('revision-round', key))
        const snapshots = store.get(snapshotList(key))
        readState = () => ({
            version: project.storageRevision ?? project.metadata.updatedAt,
            drafts: Object.fromEntries(drafts.keys.result.map((entry, index) => [(entry as [string, ...WritingKey, string])[3], drafts.values.result[index]])),
            history: [submissions.result, rounds.result, snapshots.result],
        })
    }
    const receipt = store.get(['recovery-receipt', workspace])
    await complete(transaction)
    const state = readState?.()
    const digest = state && await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)))
    const baseline = digest ? Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') : undefined
    return { baseline, version: state?.version, drafts: state?.drafts ?? {}, receipt: receipt.result as RecoveryReceipt | undefined }
}

export async function recordProjectBackup(database: IDBDatabase, workspace: string, receipt: RecoveryReceipt) {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(receipt, ['recovery-receipt', workspace])
    await complete(transaction)
}

export async function listLibraryProjects(database: IDBDatabase): Promise<LibraryProject[]> {
    const transaction = database.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const legacy = store.get(legacyStorageKey)
    const entries = store.getAll(libraryRange())
    const projects: LibraryProject[] = []
    entries.onsuccess = () => {
        const catalog = entries.result as LibraryEntry[]
        if (legacy.result && !catalog.some(item => item.id === legacyProjectId)) {
            const migrated: LibraryEntry = { id: legacyProjectId, state: 'active', view: 'canvas',
                lastOpenedAt: legacy.result.metadata.updatedAt }
            store.add(migrated, libraryEntry(legacyProjectId))
            catalog.push(migrated)
        }
        for (const entry of catalog) {
            const request = store.get(libraryStorageKey(entry.id))
            request.onsuccess = () => {
                const project = request.result as ProjectFileSystem | undefined
                if (project) projects.push({ ...entry, name: project.metadata.projectName })
            }
        }
    }
    await complete(transaction)
    return projects.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.name.localeCompare(b.name))
}

export async function addLibraryProject(database: IDBDatabase, project: ProjectFileSystem, view: LibraryView,
    writing?: PortableWritingState, history?: PortableProjectHistory): Promise<LibraryProject> {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const entry: LibraryEntry = { id: crypto.randomUUID(), state: 'active', view, lastOpenedAt: new Date().toISOString() }
    store.add(entry, libraryEntry(entry.id))
    storeImportedProject(store, [libraryStorageKey(entry.id), project.metadata.createdAt], project, writing, history)
    await complete(transaction)
    return { ...entry, name: project.metadata.projectName }
}

export async function updateLibraryProject(database: IDBDatabase, id: string,
    change: { state: LibraryProjectState } | { name: string } | { view: LibraryView }) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const entry = libraryEntry(id)
    const key = libraryStorageKey(id)
    const existing = store.get(entry)
    const source = store.get(key)
    let updated = false
    source.onsuccess = () => {
        const record = existing.result as LibraryEntry | undefined
        const project = source.result as ProjectFileSystem | undefined
        if (!record || !project) return
        if ('view' in change) {
            if (record.state !== 'active') return
            store.put({ ...record, view: change.view, lastOpenedAt: new Date().toISOString() }, entry)
        } else if ('state' in change) {
            store.put({ ...record, state: change.state }, entry)
        } else {
            const name = change.name.trim()
            if (!name) return
            putProject(store, key, { ...project, metadata: { ...project.metadata, projectName: name, updatedAt: new Date().toISOString() } })
        }
        updated = true
    }
    await complete(transaction)
    if (!updated) throw new Error('This project is no longer available.')
}

export async function restoreProjectBackup(database: IDBDatabase, current: WritingKey, project: ProjectFileSystem,
    expected: ProjectFileSystem, expectedDrafts: WritingDrafts, writing?: PortableWritingState, history?: PortableProjectHistory) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const saved = store.get(current[0])
    const drafts = readDraftRecords(store, current)
    const destination: WritingKey = [current[0], project.metadata.createdAt]
    let replaced: ProjectFileSystem | undefined
    drafts.values.onsuccess = () => {
        if (!sameStoredProject(saved.result, expected) || !drafts.match(expectedDrafts)) return
        for (const key of current[1] === destination[1] ? [current] : [current, destination]) {
            store.delete(draftRange(key))
            store.delete(['view', ...key])
        }
        replaced = storeImportedProject(store, destination, project, writing, history)
    }
    await complete(transaction)
    if (!replaced) throw new ProjectStorageConflict()
    return replaced
}

export async function commitFileOperation(database: IDBDatabase, key: WritingKey,
    before: ProjectFileSystem, expectedDrafts: WritingDrafts, after: ProjectFileSystem, writing: PortableWritingState, move?: SourceMove) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const project = store.get(key[0])
    const values = store.getAll(draftRange(key))
    const keys = store.getAllKeys(draftRange(key))
    const moves = store.get(['source-moves', ...key])
    let committedMoves: SourceMove[] | undefined
    let applied: ProjectFileSystem | undefined
    moves.onsuccess = () => {
        const current = project.result as ProjectFileSystem | undefined
        if (!current || !sameStoredProject(current, before)) return
        if (keys.result.length !== Object.keys(expectedDrafts).length || keys.result.some((entry, index) =>
            !sameDraft(values.result[index], expectedDrafts[(entry as [string, ...WritingKey, string])[3]]))) return
        applied = putProject(store, key[0], after)
        if (move) {
            committedMoves = [...(moves.result ?? []), move]
            store.put(committedMoves, ['source-moves', ...key])
        }
        store.delete(draftRange(key))
        for (const [path, draft] of Object.entries(writing.drafts)) store.put(draft, ['draft', ...key, path])
        if (writing.view) store.put(writing.view, ['view', ...key])
        else store.delete(['view', ...key])
    }
    await complete(transaction)
    if (!applied) throw new Error('The saved project or local drafts changed. Reopen the preview and try again.')
    return { project: applied, moves: committedMoves }
}

export function readProject(database: IDBDatabase, key: string): Promise<ProjectFileSystem | undefined> {
    return new Promise((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export async function writeProject(database: IDBDatabase, key: string, project: ProjectFileSystem, expected: ProjectFileSystem | null) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const current = store.get(key)
    let saved: ProjectFileSystem | undefined
    current.onsuccess = () => {
        if (sameStoredProject(current.result, expected)) saved = putProject(store, key, project)
    }
    await complete(transaction)
    if (!saved) throw new ProjectStorageConflict()
    return saved
}

export async function readSourceMoves(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const request = transaction.objectStore(storeName).get(['source-moves', ...key])
    await complete(transaction)
    return (request.result ?? []) as SourceMove[]
}

function taskKey(key: WritingKey, run: string) {
    return ['ai-task', ...key, run]
}

function appendTaskStep(store: IDBObjectStore, key: WritingKey, run: string, step: ChatTaskStep) {
    const entry = taskKey(key, run)
    const current = store.get(entry)
    current.onsuccess = () => store.put([...(current.result ?? []), step], entry)
}

export async function recordChatTaskStep(database: IDBDatabase, key: WritingKey, run: string, step: ChatTaskStep) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    appendTaskStep(transaction.objectStore(storeName), key, run, step)
    await complete(transaction)
}

export async function readChatTaskSteps(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const range = IDBKeyRange.bound(['ai-task', ...key], ['ai-task', ...key, []], false, true)
    const tasks: Record<string, ChatTaskStep[]> = Object.create(null)
    const request = transaction.objectStore(storeName).openCursor(range)
    request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        tasks[(cursor.key as [string, ...WritingKey, string])[3]] = cursor.value
        cursor.continue()
    }
    await complete(transaction)
    return tasks
}

export async function readChatHistory(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const read = transaction.objectStore(storeName).get(['ai-history', ...key])
    await complete(transaction)
    return read.result as ChatHistory | undefined
}

export async function writeChatHistory(database: IDBDatabase, key: WritingKey, history: ChatHistory) {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(history, ['ai-history', ...key])
    await complete(transaction)
}

export async function readChatCheckpoints(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const range = IDBKeyRange.bound(['ai-change', ...key], ['ai-change', ...key, []], false, true)
    const checkpoints: Record<string, ChatCheckpoint['state']> = Object.create(null)
    const request = transaction.objectStore(storeName).openCursor(range)
    request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        checkpoints[(cursor.key as [string, ...WritingKey, string])[3]] = (cursor.value as ChatCheckpoint).state
        cursor.continue()
    }
    await complete(transaction)
    return checkpoints
}

export async function readManuscriptBatches(database: IDBDatabase, key: WritingKey, runs: readonly string[]) {
    const transaction = database.transaction(storeName)
    const store = transaction.objectStore(storeName)
    const requests = runs.map(run => store.get(['ai-change', ...key, run]))
    await complete(transaction)
    return requests.map(request => request.result as ChatCheckpoint | undefined)
        .filter((checkpoint): checkpoint is ChatCheckpoint => Boolean(checkpoint))
}

export async function readChatVerifications(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName)
    const range = IDBKeyRange.bound(['ai-verify', ...key], ['ai-verify', ...key, []], false, true)
    const verifications: Record<string, ChatVerification> = Object.create(null)
    const request = transaction.objectStore(storeName).openCursor(range)
    request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        verifications[(cursor.key as [string, ...WritingKey, string])[3]] = cursor.value
        cursor.continue()
    }
    await complete(transaction)
    return verifications
}

export async function writeChatVerification(database: IDBDatabase, key: WritingKey, run: string, result: ChatVerification, record = false,
    build?: ManuscriptBuild) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    store.put(result, ['ai-verify', ...key, run])
    if (build) store.put(build, ['ai-manuscript-build', ...key, run])
    else if (result.manuscript) store.delete(['ai-manuscript-build', ...key, run])
    if (record) appendTaskStep(store, key, run, { kind: result.status, at: Date.now(), selected: result.selected.length, selection: result.selected, detail: result.message })
    await complete(transaction)
}

export async function readManuscriptBuild(database: IDBDatabase, key: WritingKey, run: string) {
    const transaction = database.transaction(storeName)
    const read = transaction.objectStore(storeName).get(['ai-manuscript-build', ...key, run])
    await complete(transaction)
    return read.result as ManuscriptBuild | undefined
}

export async function commitChatAction(database: IDBDatabase, key: WritingKey, runId: string, action: ChatAction, expected: ProjectFileSystem) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const entry = ['ai-change', ...key, runId]
    const projectRead = store.get(key[0])
    const checkpointRead = store.get(entry)
    let result: { project: ProjectFileSystem; checkpoint: ChatCheckpoint; changed: boolean } | undefined
    let failure: unknown
    checkpointRead.onsuccess = () => {
        const original = projectRead.result as ProjectFileSystem | undefined
        if (!original || original.metadata.createdAt !== key[1]) return
        if (!sameStoredProject(original, expected)) { failure = new ProjectStorageConflict(); return }
        const previous = checkpointRead.result as ChatCheckpoint | undefined
        const paths = chatActionPaths(action, previous)
        const requests = paths.map(path => ({ path, request: store.get(['draft', ...key, path]) }))
        function mutate(project: ProjectFileSystem) {
            if ((action.kind === 'apply' || action.kind === 'apply-save' || action.kind === 'save') && action.signal?.aborted) {
                failure = new Error('Edit authorization was cancelled.')
                return
            }
            const current: Record<string, ChatSource> = Object.create(null)
            for (const { path, request } of requests) {
                const saved = editableSource(project, path)
                if (saved !== undefined) current[path] = { saved, draft: request.result }
            }
            let checkpoint
            try { checkpoint = nextChatCheckpoint(action, current, project.metadata.mainFile, previous) }
            catch (cause) { failure = cause; return }
            if (!checkpoint) {
                if (previous) result = { project, checkpoint: previous, changed: false }
                return
            }
            const original = project
            for (const [path, source] of Object.entries(checkpoint.after)) {
                if (source.saved !== current[path].saved) project = updateFileContent(project, path, source.saved)
                const keyPath = ['draft', ...key, path]
                if (source.draft) store.put(source.draft, keyPath)
                else store.delete(keyPath)
            }
            if (project !== original) project = putProject(store, key[0], project)
            store.put(checkpoint, entry)
            appendTaskStep(store, key, runId, { kind: checkpoint.state, at: Date.now(),
                selected: action.kind === 'apply' || action.kind === 'apply-save' ? action.edits.length : undefined,
                selection: action.kind === 'apply' ? action.selection : undefined,
                paths: Object.keys(checkpoint.after),
                detail: action.kind === 'apply-save' || action.kind === 'save' ? 'Saved after passing verification.'
                    : action.kind === 'apply' ? action.automatic ? 'Session approval used.' : 'Author approved the selected changes.' : undefined })
            result = { project, checkpoint, changed: true }
        }
        const last = requests.at(-1)
        if ((action.kind === 'apply-save' && !previous) || (action.kind === 'save' && previous?.state === 'draft')) {
            const saveWorking = action.kind === 'save'
            const { signal } = action
            const drafts = store.getAll(draftRange(key))
            const keys = store.getAllKeys(draftRange(key))
            const report = store.get(['ai-verify', ...key, runId])
            report.onsuccess = () => {
                const verified = report.result as ChatVerification | undefined
                if (verified?.status !== 'passed' || Boolean(verified.working) !== saveWorking || signal?.aborted
                    || action.kind === 'apply-save' && action.selection && action.selection.join(',') !== verified.selected.join(',')
                    || verified.currentSelection && verified.currentSelection.join(',') !== verified.selected.join(',')) {
                    failure = new Error('This turn needs a passing verification before saving.')
                    return
                }
                const currentDrafts = Object.fromEntries(keys.result.map((key, index) =>
                    [(key as [string, ...WritingKey, string])[3], drafts.result[index]]))
                let outcome: { current: boolean } | undefined
                void Promise.all([verificationBaseline(original, currentDrafts),
                    action.kind === 'apply-save' ? verificationPatch(action.edits) : undefined])
                    .then(([baseline, patch]) => { outcome = { current: baseline === verified.baseline && (saveWorking || patch === verified.patch) } })
                    .catch(() => { outcome = { current: false } })
                // Keep this transaction open during hashing so another tab cannot change the verified inputs before the write.
                function validate() {
                    if (signal?.aborted) {
                        failure = new Error('Save authorization was cancelled.')
                    } else if (!outcome) {
                        store.getKey(entry).onsuccess = validate
                    } else if (!outcome.current) {
                        failure = new Error('The verification is out of date. Verify the selected changes again.')
                    } else {
                        mutate(original!)
                    }
                }
                validate()
            }
        } else if (last) last.request.onsuccess = () => mutate(original)
        else mutate(original)
    }
    await complete(transaction)
    if (failure) throw failure
    if (!result) throw new Error('The project or proposal is unavailable.')
    return result
}

export async function commitManuscriptSave(database: IDBDatabase, key: WritingKey, taskId: string, runs: readonly string[],
    report: ChatVerification, expected: ProjectFileSystem) {
    const selection = report.manuscript
    if (report.status !== 'passed' || !selection || !runs.length) throw new Error('Verify the selected manuscript files before saving.')
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const entry = ['ai-change', ...key, taskId]
    const projectRead = store.get(key[0])
    const drafts = store.getAll(draftRange(key))
    const keys = store.getAllKeys(draftRange(key))
    const savedTask = store.get(entry)
    const verified = store.get(['ai-verify', ...key, taskId])
    const history = store.get(['ai-history', ...key])
    let result: ReturnType<typeof buildManuscriptSnapshot> | undefined
    let failure: unknown
    history.onsuccess = () => {
        const original = projectRead.result as ProjectFileSystem | undefined
        if (!sameStoredProject(original, expected)) { failure = new ProjectStorageConflict(); return }
        const task = (history.result as ChatHistory | undefined)?.conversations.find(item => item.manuscript?.id === taskId)?.manuscript
        const stored = verified.result as ChatVerification | undefined
        if (!original || original.metadata.createdAt !== key[1] || original.metadata.mainFile !== report.main || !task
            || savedTask.result?.state === 'saved' || stored?.status !== 'passed' || stored.baseline !== report.baseline
            || stored.compiledBaseline !== report.compiledBaseline || JSON.stringify(stored.manuscript) !== JSON.stringify(selection)) {
            failure = new Error('The manuscript task or its passing verification changed. Verify the current selection again.')
            return
        }
        const batches = task.batches.map(batch => ({ run: batch.run, request: store.get(['ai-change', ...key, batch.run]) }))
        const last = batches.at(-1)
        if (!last) return
        last.request.onsuccess = () => {
            const active = batches.filter(({ request }) => request.result?.state === 'draft' || request.result?.state === 'saved')
            if (active.length !== runs.length || active.some(batch => !runs.includes(batch.run))) {
                failure = new Error('The task batches changed. Review the current manuscript files.')
                return
            }
            const byRun = new Map(active.map(batch => [batch.run, batch.request.result as ChatCheckpoint]))
            const currentDrafts = Object.fromEntries(keys.result.map((item, index) =>
                [(item as [string, ...WritingKey, string])[3], drafts.result[index] as WritingDraft]))
            try {
                const snapshot = buildManuscriptSnapshot(original, currentDrafts, runs.map(run => byRun.get(run)!),
                    selection.paths, selection.accepted)
                let matches: boolean | undefined
                void Promise.all([verificationBaseline(original, currentDrafts), verificationBaseline(snapshot.candidate, {})])
                    .then(([baseline, compiled]) => { matches = baseline === report.baseline && compiled === report.compiledBaseline })
                    .catch(() => { matches = false })
                function saveVerified() {
                    if (matches === undefined) { store.getKey(entry).onsuccess = saveVerified; return }
                    if (!matches) { failure = new Error('The verification is out of date. Verify the selected manuscript files again.'); return }
                    snapshot.candidate = putProject(store, key[0], snapshot.candidate)
                    for (const path of selection!.paths) store.delete(['draft', ...key, path])
                    store.put(snapshot.checkpoint, entry)
                    appendTaskStep(store, key, taskId, { kind: 'saved', at: Date.now(), paths: selection!.paths, detail: 'Saved the reviewed manuscript files together.' })
                    result = snapshot
                }
                saveVerified()
            } catch (cause) { failure = cause }
        }
    }
    await complete(transaction)
    if (failure) throw failure
    if (!result) throw new Error('The manuscript task or its verification is unavailable.')
    return result
}

export async function undoChatBatches(database: IDBDatabase, key: WritingKey, runIds: readonly string[], expected: ProjectFileSystem) {
    const runs = [...new Set(runIds)].reverse()
    if (!runs.length || runs.length > 120) throw new Error('No valid task batches to undo.')
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const store = transaction.objectStore(storeName)
    const projectRead = store.get(key[0])
    const drafts = store.getAll(draftRange(key))
    const keys = store.getAllKeys(draftRange(key))
    const reads = runs.map(id => store.get(['ai-change', ...key, id]))
    let result: { project: ProjectFileSystem; sources: Record<string, ChatSource>; undone: string[] } | undefined
    let failure: unknown
    reads.at(-1)!.onsuccess = () => {
        const original = projectRead.result as ProjectFileSystem | undefined
        if (!original || original.metadata.createdAt !== key[1]) return
        if (!sameStoredProject(original, expected)) { failure = new ProjectStorageConflict(); return }
        const current: Record<string, ChatSource> = Object.create(null)
        const changed: Record<string, ChatSource> = Object.create(null)
        const local = new Map(keys.result.map((entry, index) => [(entry as [string, ...WritingKey, string])[3], drafts.result[index] as WritingDraft]))
        const checkpoints: { id: string; value: ChatCheckpoint }[] = []
        try {
            for (const [index, request] of reads.entries()) {
                const previous = request.result as ChatCheckpoint | undefined
                if (!previous || (previous.state !== 'draft' && previous.state !== 'saved')) {
                    throw new Error('A batch changed before undo. Review the task and try again.')
                }
                for (const path of Object.keys(previous.after)) {
                    const saved = editableSource(original, path)
                    if (!Object.hasOwn(current, path) && saved !== undefined) current[path] = { saved, draft: local.get(path) }
                }
                const undone = nextChatCheckpoint({ kind: 'undo' }, current, original.metadata.mainFile, previous)!
                Object.assign(current, undone.after)
                Object.assign(changed, undone.after)
                checkpoints.push({ id: runs[index], value: undone })
            }
        } catch (cause) { failure = cause; return }

        let project = original
        for (const [path, source] of Object.entries(changed)) {
            if (source.saved !== editableSource(project, path)) project = updateFileContent(project, path, source.saved)
            const entry = ['draft', ...key, path]
            if (source.draft) store.put(source.draft, entry)
            else store.delete(entry)
        }
        if (project !== original) project = putProject(store, key[0], project)
        for (const { id, value } of checkpoints) {
            store.put(value, ['ai-change', ...key, id])
            appendTaskStep(store, key, id, { kind: 'undone', at: Date.now(), paths: Object.keys(value.after), detail: 'Undone with manuscript task.' })
        }
        result = { project, sources: changed, undone: runs }
    }
    await complete(transaction)
    if (failure) throw failure
    if (!result) throw new Error('The writing task is unavailable.')
    return result
}
