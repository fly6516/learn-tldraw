import type JSZip from 'jszip'
import { z } from 'zod'
import { aguDeliveryInfoSchema, verifyAguDelivery, type AguDelivery } from './agu-revision-delivery'
import { revisionEvidenceSchema } from './revision-evidence'
import { compileProfileSchema } from './compile-profile'
import { chapterAnswerSchema } from './ai-edit'
import { figureAnchorSchema, sectionAnchorSchema, selectionAnchorSchema } from './research-graph'
import type { RevisionRound } from './revision-rounds'
import type { ProjectSnapshot } from './snapshots'
import { isProjectPath } from './source-archive'
import type { SubmissionVersion } from './submission'
import { submissionDocxDeliveryInfo, submissionDocxMime, verifyDocxDelivery, type SubmissionDocxDelivery } from './submission-docx-delivery'
import { submissionLayoutSchema, templateOriginSchema } from './submission-layout'
import { exportRelease, importRelease } from './release-transfer'
import { sameTemplateOrigin, type OfficialTemplateRelease } from './template-release'
import { catalogReleaseSource, templateCatalog } from './template-catalog'
import type { SourceMove } from './writing-ai-evidence'
import { chatWorkflowSchema, compileFeedbackSchema, revisionSetupSchema, submissionChatSchema, type ChatCheckpoint, type ChatHistory, type ChatTaskStep, type WritingChatMessage } from './writing-chat'
import type { ChatVerification, ManuscriptBuild } from './writing-chat-validation'
import { manuscriptTaskSchema } from './manuscript-task'
import { submissionEvidenceSchema } from './submission-evidence'
import { aiContextReceiptSchema } from './ai-read-scope'

export type PortableProjectHistory = {
  templateReleases?: OfficialTemplateRelease[]
  publication?: { submissions: SubmissionVersion[]; rounds: RevisionRound[]; docx?: SubmissionDocxDelivery[]; agu?: AguDelivery[] }
  snapshots?: ProjectSnapshot[]
  ai?: { history?: ChatHistory; moves: SourceMove[]; tasks: Record<string, ChatTaskStep[]>
    checkpoints: Record<string, ChatCheckpoint>; verifications: Record<string, ChatVerification>; builds?: Record<string, ManuscriptBuild> }
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
const docxSubmission = submissionDocxDeliveryInfo
const submission = identity.extend({
  main: path, paths: z.array(path), excluded: z.array(path), drafts: z.array(path), issues: z.array(issue),
  warnings: z.boolean(), diagnostics: z.array(issue), externalEngine: z.enum(['pdflatex', 'xelatex', 'lualatex']).optional(),
  sourceChecksum: hash.optional(), pdf: storedBlob, zip: storedBlob, evidence: submissionEvidenceSchema.optional(), compileProfile: compileProfileSchema.optional(),
  layoutReport: submissionLayoutSchema.optional(), materials: z.array(storedBlob).max(24).optional(),
}).refine(value => !value.evidence || value.evidence.sourceChecksum === value.sourceChecksum && value.sourceChecksum === value.zip.sha256)
  .refine(value => !value.layoutReport || value.layoutReport.sourceChecksum === value.zip.sha256 && value.layoutReport.pdfChecksum === value.pdf.sha256)
  .refine(value => (value.layoutReport?.materials?.length ?? 0) === (value.materials?.length ?? 0)
    && (value.materials ?? []).every((blob, index) => {
      const item = value.layoutReport?.materials?.[index]
      return item?.sha256 === blob.sha256 && item.bytes === blob.bytes
    }))
const target = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manuscript') }),
  z.object({ type: z.literal('file'), path }),
  z.object({ type: z.literal('section'), anchor: sectionAnchorSchema }),
  z.object({ type: z.literal('formula'), anchor: figureAnchorSchema }),
  z.object({ type: z.literal('selection'), anchor: selectionAnchorSchema }),
])
const response = z.object({ kind: z.enum(['changed', 'retained']), text, paths: z.array(path), evidence: revisionEvidenceSchema.optional(), reviewRequired: z.literal(true).optional() })
const comment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('comment'), target }),
  z.object({ kind: z.literal('canvas'), nodeId: id }),
]).and(z.object({ id, reviewer: text, text, editId: id.optional(), response: response.optional() }))
const round = identity.extend({ submissionId: id, revisedSubmissionId: id.optional(), archiveReviewId: z.uuid().optional(), comments: z.array(comment) })
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
    missing: z.array(text).max(20).optional(), readPaths: z.array(path).max(49).optional(),
    modelRecipient: text.max(300).optional(), historyCount: z.number().int().min(0).max(23).optional() }).optional(),
}).transform(value => value as WritingChatMessage)
const unique = (values: { id: string }[]) => new Set(values.map(value => value.id)).size === values.length
const ai = z.object({
  history: z.object({ selected: id, conversations: z.array(z.object({
    id, title: text, messages: z.array(message).max(30).refine(unique), manuscript: manuscriptTaskSchema.optional(),
    runs: z.record(id, z.object({ main: path.optional(), pathRevision: z.number().int().nonnegative().optional(), sources, revisionOf: id.optional(),
      context: aiContextReceiptSchema.optional(),
      manuscriptId: id.optional(), replacesBatch: id.optional(), verifyRepair: z.boolean().optional(),
      reply: z.object({ round: id, roundName: text, comment: id, commentText: text, commentEditId: id.optional(), originalId: id, revisedId: id,
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
  builds: z.array(z.object({ id, pdf: storedBlob, sourceChecksum: hash, compiledBaseline: hash,
    externalEngine: z.enum(['pdflatex', 'xelatex', 'lualatex']).optional(), compileProfile: compileProfileSchema.optional() })).max(12).refine(unique).optional(),
})
export const backupHistorySchema = z.object({
  templateReleases: z.array(templateOriginSchema.extend({ manifestSha256: hash, archive: storedBlob })).min(1).max(2).optional(),
  publication: z.object({ submissions: z.array(submission), rounds: z.array(round), docx: z.array(docxSubmission).refine(unique).optional(), agu: z.array(aguDeliveryInfoSchema).refine(unique).optional() }).refine(({ submissions, rounds }) => {
    const ids = new Set(submissions.map(value => value.id))
    return unique(submissions) && unique(rounds) && rounds.every(value => ids.has(value.submissionId) && unique(value.comments)
      && (!value.revisedSubmissionId || value.revisedSubmissionId !== value.submissionId && ids.has(value.revisedSubmissionId)))
  }).optional(),
  snapshots: z.array(identity.extend({ archive: storedBlob, hasCanvas: z.boolean() })).refine(unique).optional(),
  ai: ai.optional(),
}).refine(value => Boolean(value.publication || value.snapshots || value.ai || value.templateReleases))

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
    const { pdf, zip, materials, ...info } = version
    submissions.push({ ...info, pdf: await write(`history/submissions/${index}.pdf`, pdf),
      zip: await write(`history/submissions/${index}.zip`, zip),
      materials: materials && await Promise.all(materials.map((blob, number) => write(`history/submissions/${index}/${number}`, blob))) })
  }
  const docx = []
  for (const [index, delivery] of (history.publication?.docx ?? []).entries()) {
    if (!(await verifyDocxDelivery(delivery))) throw new Error('Archived DOCX delivery checksums do not match.')
    const { sourceZip, generatedDocx, finalDocx, ...info } = delivery
    const folder = `history/docx/${index}/`
    await write(folder + 'source.zip', sourceZip)
    await write(folder + 'generated.docx', generatedDocx)
    if (finalDocx) await write(folder + 'final.docx', finalDocx)
    docx.push(info)
  }
  const agu = []
  for (const [index, delivery] of (history.publication?.agu ?? []).entries()) {
    if (!await verifyAguDelivery(delivery)) throw new Error('Archived AGU delivery checksum does not match.')
    const { archive: zip, ...info } = delivery
    await write(`history/agu/${index}.zip`, zip)
    agu.push(info)
  }
  const snapshots = []
  for (const [index, snapshot] of (history.snapshots ?? []).entries()) {
    const { project, ...info } = snapshot
    snapshots.push({ ...info, hasCanvas: Boolean(project.canvas),
      archive: await write(`history/snapshots/${index}.zip`, await encodeSnapshot(snapshot)) })
  }
  const { builds, ...aiHistory } = history.ai ?? {}
  const encodedBuilds = []
  for (const [index, [id, { pdf, ...build }]] of Object.entries(builds ?? {}).entries()) {
    encodedBuilds.push({ id, ...build, pdf: await write(`history/manuscript-builds/${index}.pdf`, pdf) })
  }
  const templateReleases = []
  for (const [index, release] of (history.templateReleases ?? []).entries()) {
    templateReleases.push({ id: release.id, version: release.version, sha256: release.sha256, manifestSha256: release.manifestSha256,
      archive: await write(`history/template-releases/${index}.zip`, await exportRelease(release)) })
  }
  return backupHistorySchema.parse({
    templateReleases: templateReleases.length ? templateReleases : undefined,
    publication: history.publication && { submissions, rounds: history.publication.rounds, docx: docx.length ? docx : undefined, agu: agu.length ? agu : undefined }, snapshots: history.snapshots && snapshots,
    ai: history.ai && { ...aiHistory, builds: encodedBuilds.length ? encodedBuilds : undefined },
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
    const { pdf, zip, materials, ...info } = version
    if (info.sourceChecksum && info.sourceChecksum !== zip.sha256) throw new Error('Archived source ZIP checksum does not match.')
    submissions.push({ ...info, pdf: await read(`history/submissions/${index}.pdf`, pdf, 'application/pdf'),
      zip: await read(`history/submissions/${index}.zip`, zip, 'application/zip'),
      materials: materials && await Promise.all(materials.map((blob, number) =>
        read(`history/submissions/${index}/${number}`, blob, info.layoutReport?.materials?.[number]?.mime ?? ''))) })
  }
  const docx = []
  for (const [index, delivery] of (manifest.publication?.docx ?? []).entries()) {
    const folder = `history/docx/${index}/`
    docx.push({ ...delivery, sourceZip: await read(folder + 'source.zip', delivery.source, 'application/zip'),
      generatedDocx: await read(folder + 'generated.docx', delivery.generated, submissionDocxMime),
      finalDocx: delivery.final && await read(folder + 'final.docx', delivery.final, submissionDocxMime) })
  }
  const agu = []
  for (const [index, delivery] of (manifest.publication?.agu ?? []).entries()) {
    agu.push({ ...delivery, archive: await read(`history/agu/${index}.zip`, delivery, 'application/zip') })
  }
  const snapshots = []
  for (const [index, snapshot] of (manifest.snapshots ?? []).entries()) {
    const { archive: entry, hasCanvas, ...info } = snapshot
    snapshots.push({ ...info, project: await decodeSnapshot(await read(`history/snapshots/${index}.zip`, entry, 'application/zip'), hasCanvas) })
  }
  const builds = manifest.ai?.builds
  const decodedBuilds: Record<string, ManuscriptBuild> = Object.create(null)
  for (const [index, { id, pdf, ...build }] of (builds ?? []).entries()) {
    const report = manifest.ai?.verifications[id]
    if (report?.status !== 'passed' || !report.manuscript || report.compiledBaseline !== build.compiledBaseline
      || !manifest.ai?.history?.conversations.some(item => item.manuscript?.id === id)) {
      throw new Error('The pending manuscript PDF does not have a matching verification.')
    }
    const blob = await read(`history/manuscript-builds/${index}.pdf`, pdf, 'application/pdf')
    if (await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The pending manuscript artifact is not a PDF.')
    decodedBuilds[id] = { ...build, pdf: blob }
  }
  const templateReleases: OfficialTemplateRelease[] = []
  for (const [index, { archive: member, ...origin }] of (manifest.templateReleases ?? []).entries()) {
    const entry = templateCatalog.find(item => item.id === origin.id)
    const source = entry && catalogReleaseSource(entry)
    if (!source) throw new Error('Project backup references an unknown official template: ' + origin.id)
    const bytes = await read(`history/template-releases/${index}.zip`, member, 'application/zip')
    const release = await importRelease(new File([bytes], 'release.zip'), source)
    if (!sameTemplateOrigin(release, origin) || templateReleases.some(existing => sameTemplateOrigin(existing, origin))) {
      throw new Error('Official template version in the project backup does not match its binding.')
    }
    templateReleases.push(release)
  }
  return { ...(templateReleases.length && { templateReleases }), publication: manifest.publication && { submissions, rounds: manifest.publication.rounds, docx: docx.length ? docx : undefined, agu: agu.length ? agu : undefined },
    snapshots: manifest.snapshots && snapshots,
    ai: manifest.ai && { ...manifest.ai, builds: Object.keys(decodedBuilds).length ? decodedBuilds : undefined } }
}
