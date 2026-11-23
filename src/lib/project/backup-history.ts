import type JSZip from 'jszip'
import { z } from 'zod'
import { chapterAnswerSchema } from './ai-edit'
import { figureAnchorSchema, sectionAnchorSchema, selectionAnchorSchema } from './research-graph'
import type { RevisionRound } from './revision-rounds'
import type { ProjectSnapshot } from './snapshots'
import { isProjectPath } from './source-archive'
import type { SubmissionVersion } from './submission'
import type { SourceMove } from './writing-ai-evidence'
import { chatWorkflowSchema, compileFeedbackSchema, revisionSetupSchema, submissionChatSchema, type ChatCheckpoint, type ChatHistory, type ChatTaskStep, type WritingChatMessage } from './writing-chat'
import type { ChatVerification } from './writing-chat-validation'
import { manuscriptTaskSchema } from './manuscript-task'

export type PortableProjectHistory = {
  publication?: { submissions: SubmissionVersion[]; rounds: RevisionRound[] }
  snapshots?: ProjectSnapshot[]
  ai?: { history?: ChatHistory; moves: SourceMove[]; tasks: Record<string, ChatTaskStep[]>
    checkpoints: Record<string, ChatCheckpoint>; verifications: Record<string, ChatVerification> }
}
export type BackupHistorySelection = { publication: boolean; snapshots: boolean; ai: boolean }

const id = z.string().min(1).max(500).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value))
const text = z.string()
const path = text.refine(isProjectPath)
const date = text.refine(value => Number.isFinite(Date.parse(value)))
const hash = text.regex(/^[a-f0-9]{64}$/)
const identity = z.object({ id, name: text, createdAt: date })
const positive = z.number().int().positive()
const selection = z.array(z.number().int().min(0).max(19)).max(20)
const location = z.object({ path, line: positive, start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
const issue = z.object({ severity: z.enum(['error', 'warning']), message: text, location: location.optional() })
const storedBlob = z.object({ sha256: hash, bytes: z.number().int().positive() })
const submission = identity.extend({
  main: path, paths: z.array(path), excluded: z.array(path), drafts: z.array(path), issues: z.array(issue),
  warnings: z.boolean(), diagnostics: z.array(issue), externalEngine: z.enum(['pdflatex', 'xelatex', 'lualatex']).optional(),
  sourceChecksum: hash.optional(), pdf: storedBlob, zip: storedBlob,
})
const target = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path }),
  z.object({ type: z.literal('section'), anchor: sectionAnchorSchema }),
  z.object({ type: z.literal('formula'), anchor: figureAnchorSchema }),
  z.object({ type: z.literal('selection'), anchor: selectionAnchorSchema }),
])
const response = z.object({ kind: z.enum(['changed', 'retained']), text, paths: z.array(path) })
const comment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('comment'), target }),
  z.object({ kind: z.literal('canvas'), nodeId: id }),
]).and(z.object({ id, reviewer: text, text, response: response.optional() }))
const round = identity.extend({ submissionId: id, revisedSubmissionId: id.optional(), comments: z.array(comment) })
const sources = z.record(path, z.object({ saved: text, draft: z.object({ base: text, text }).optional() }))
const evidence = chapterAnswerSchema.shape.evidence.element.extend({
  anchor: z.object({ quote: text.max(500), before: text.max(48), after: text.max(48),
    requireContext: z.boolean().optional(), wholeLine: z.boolean().optional() }).optional(),
})
const message = z.object({ id, role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.object({ type: text, text: text.optional() }).passthrough()
    .refine(part => part.type !== 'text' || typeof part.text === 'string')).max(1000),
  metadata: z.object({ run: id, complete: z.boolean().optional(), workflow: chatWorkflowSchema.optional(),
    feedback: compileFeedbackSchema.optional(), local: z.boolean().optional(), submission: submissionChatSchema.optional(), letter: text.max(100).optional(),
    revisionSetup: revisionSetupSchema.optional(), actionError: text.max(1000).optional(),
    selection: z.object({ path, start: positive, end: positive }).optional(), evidence: z.array(evidence).max(40).optional(),
    missing: z.array(text).max(20).optional(), readPaths: z.array(path).max(49).optional() }).optional(),
}).transform(value => value as WritingChatMessage)
const unique = (values: { id: string }[]) => new Set(values.map(value => value.id)).size === values.length
const ai = z.object({
  history: z.object({ selected: id, conversations: z.array(z.object({
    id, title: text, messages: z.array(message).max(30).refine(unique), manuscript: manuscriptTaskSchema.optional(),
    runs: z.record(id, z.object({ main: path.optional(), pathRevision: z.number().int().nonnegative().optional(), sources, revisionOf: id.optional(),
      manuscriptId: id.optional(), replacesBatch: id.optional(), verifyRepair: z.boolean().optional(),
      reply: z.object({ round: id, roundName: text, comment: id, commentText: text, originalId: id, revisedId: id,
        previousRevisedId: id.optional(), previous: response.optional(), paths: z.array(path), kind: z.enum(['changed', 'retained']) }).optional() })),
  })).max(12) }).refine(value => unique(value.conversations) && value.conversations.some(item => item.id === value.selected)).optional(),
  moves: z.array(z.object({ from: path, to: path })),
  tasks: z.record(id, z.array(z.object({ kind: z.enum(['verify', 'authorize-save', 'passed', 'failed', 'cancelled', 'blocked', 'draft', 'saved', 'undone', 'rejected',
    'preview-compile', 'archived', 'reply-saved', 'revision-created', 'comment-added', 'permission-granted', 'permission-denied']),
    at: z.number().int().min(0).max(8.64e15), selected: z.number().int().nonnegative().optional(), selection: selection.optional(),
    paths: z.array(path).optional(), detail: text.optional() }))),
  checkpoints: z.record(id, z.object({ state: z.enum(['draft', 'saved', 'undone', 'rejected']),
    main: path.optional(), before: sources, after: sources }).refine(value =>
    Object.keys(value.before).length === Object.keys(value.after).length && Object.keys(value.before).every(key => Object.hasOwn(value.after, key)))),
  verifications: z.record(id, z.object({ baseline: hash, patch: hash, compiledBaseline: hash,
    selected: selection, currentSelection: selection.optional(), working: z.boolean().optional(),
    manuscript: z.object({ paths: z.array(path).min(1).max(49), accepted: z.array(path).max(49) }).optional(),
    main: path, status: z.enum(['passed', 'failed']),
    diagnostics: z.array(z.object({ path, line: positive, severity: z.enum(['error', 'warning']), message: text, sourceLine: positive.optional() })),
    message: text, log: text })),
})
export const backupHistorySchema = z.object({
  publication: z.object({ submissions: z.array(submission), rounds: z.array(round) }).refine(({ submissions, rounds }) => {
    const ids = new Set(submissions.map(value => value.id))
    return unique(submissions) && unique(rounds) && rounds.every(value => ids.has(value.submissionId) && unique(value.comments)
      && (!value.revisedSubmissionId || value.revisedSubmissionId !== value.submissionId && ids.has(value.revisedSubmissionId)))
  }).optional(),
  snapshots: z.array(identity.extend({ archive: storedBlob, hasCanvas: z.boolean() })).refine(unique).optional(),
  ai: ai.optional(),
}).refine(value => Boolean(value.publication || value.snapshots || value.ai))

export const maxHistoryBytes = 512 * 1024 * 1024

async function checksum(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function encodeBackupHistory(archive: JSZip, history: PortableProjectHistory,
  encodeSnapshot: (snapshot: ProjectSnapshot) => Promise<Blob>) {
  let total = 0
  async function write(entry: string, blob: Blob) {
    total += blob.size
    if (!blob.size || total > maxHistoryBytes) throw new Error('Project history exceeds the backup size limit or contains an empty archive.')
    const bytes = await blob.arrayBuffer()
    archive.file(entry, bytes, { compression: 'STORE' })
    return { bytes: bytes.byteLength, sha256: await checksum(bytes) }
  }
  const submissions = []
  for (const [index, version] of (history.publication?.submissions ?? []).entries()) {
    const { pdf, zip, ...info } = version
    submissions.push({ ...info, pdf: await write(`history/submissions/${index}.pdf`, pdf),
      zip: await write(`history/submissions/${index}.zip`, zip) })
  }
  const snapshots = []
  for (const [index, snapshot] of (history.snapshots ?? []).entries()) {
    const { project, ...info } = snapshot
    snapshots.push({ ...info, hasCanvas: Boolean(project.canvas),
      archive: await write(`history/snapshots/${index}.zip`, await encodeSnapshot(snapshot)) })
  }
  return backupHistorySchema.parse({
    publication: history.publication && { submissions, rounds: history.publication.rounds }, snapshots: history.snapshots && snapshots, ai: history.ai,
  })
}

export async function decodeBackupHistory(archive: JSZip, manifest: z.infer<typeof backupHistorySchema>,
  decodeSnapshot: (blob: Blob, hasCanvas: boolean) => Promise<ProjectSnapshot['project']>): Promise<PortableProjectHistory> {
  let total = 0
  async function read(entry: string, expected: z.infer<typeof storedBlob>, type: string) {
    total += expected.bytes
    if (total > maxHistoryBytes) throw new Error('Project history exceeds the backup size limit.')
    const file = archive.file(entry)
    if (!file) throw new Error(`Missing project history file: ${entry}`)
    const bytes = await file.async('arraybuffer')
    if (bytes.byteLength !== expected.bytes || await checksum(bytes) !== expected.sha256) {
      throw new Error(`Project history checksum does not match: ${entry}`)
    }
    return new Blob([bytes], { type })
  }
  const submissions = []
  for (const [index, version] of (manifest.publication?.submissions ?? []).entries()) {
    const { pdf, zip, ...info } = version
    if (info.sourceChecksum && info.sourceChecksum !== zip.sha256) throw new Error('Archived source ZIP checksum does not match.')
    submissions.push({ ...info, pdf: await read(`history/submissions/${index}.pdf`, pdf, 'application/pdf'),
      zip: await read(`history/submissions/${index}.zip`, zip, 'application/zip') })
  }
  const snapshots = []
  for (const [index, snapshot] of (manifest.snapshots ?? []).entries()) {
    const { archive: entry, hasCanvas, ...info } = snapshot
    snapshots.push({ ...info, project: await decodeSnapshot(await read(`history/snapshots/${index}.zip`, entry, 'application/zip'), hasCanvas) })
  }
  return { publication: manifest.publication && { submissions, rounds: manifest.publication.rounds },
    snapshots: manifest.snapshots && snapshots, ai: manifest.ai }
}
