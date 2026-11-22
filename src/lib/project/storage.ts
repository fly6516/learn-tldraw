import type { ProjectFileSystem } from './types'
import type { ProjectSnapshot, ProjectSnapshotInfo } from './snapshots'
import { applyWritingDrafts, draftConflicts, sameDraft, type WritingDraft, type WritingDrafts, type WritingKey, type WritingView } from './writing-drafts'

const storeName = 'projects'

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

function snapshotEntry(key: WritingKey, id: string) {
    return ['snapshot', ...key, id]
}

function snapshotList(key: WritingKey) {
    return ['snapshots', ...key]
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
        if (current.result?.metadata.createdAt !== key[1]) {
            error = 'This project changed in another tab. Reload it before restoring.'
            return
        }
        const project = saved.result as ProjectFileSystem | undefined
        if (!project || project.metadata.createdAt !== key[1]) return
        const previous = current.result as ProjectFileSystem
        storeSnapshot(store, key, list.result ?? [], {
            ...checkpoint, project: { ...previous, canvas: previous.canvas ?? checkpoint.project.canvas },
        })
        restored = project
        store.put(project, key[0])
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

export async function commitWritingDrafts(database: IDBDatabase, key: WritingKey, fallback: ProjectFileSystem,
    drafts: WritingDrafts, storedDrafts: WritingDrafts) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    const projects = transaction.objectStore(storeName)
    const read = projects.get(key[0])
    let result: { project: ProjectFileSystem; conflicts: string[] } | undefined
    read.onsuccess = () => {
        const current: ProjectFileSystem = read.result ?? fallback
        if (current.metadata.createdAt !== key[1]) return
        const conflicts = draftConflicts(current, drafts)
        result = { project: conflicts.length ? current : applyWritingDrafts(current, drafts), conflicts }
        if (conflicts.length) return
        projects.put(result.project, key[0])
        for (const path of Object.keys(drafts)) {
            const entry = ['draft', ...key, path]
            const pending = projects.get(entry)
            pending.onsuccess = () => {
                if (sameDraft(pending.result, storedDrafts[path])) projects.delete(entry)
            }
        }
    }
    await complete(transaction)
    if (!result) throw new Error('This project was replaced in another tab. Your local drafts were kept.')
    return result
}

export async function clearWritingState(database: IDBDatabase, key: WritingKey) {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' })
    transaction.objectStore(storeName).delete(draftRange(key))
    transaction.objectStore(storeName).delete(['view', ...key])
    await complete(transaction)
}

export function readProject(database: IDBDatabase, key: string): Promise<ProjectFileSystem | undefined> {
    return new Promise((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

export function writeProject(database: IDBDatabase, key: string, project: ProjectFileSystem): Promise<void> {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
        transaction.objectStore(storeName).put(project, key)
    })
}
