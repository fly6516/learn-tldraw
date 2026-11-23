import { z } from 'zod'
import { isProjectPath, importSourceArchive } from './source-archive'
import type { ProjectFileSystem } from './types'
import type { SourceMove } from './writing-ai-evidence'
import type { ChatCheckpoint, ChatHistory, ChatTaskStep } from './writing-chat'
import { assessClaim, claimPresent, claimSourceLine, type ClaimReview, type WritingClaims } from './writing-claims'

const path = z.string().max(500).refine(isProjectPath)
const status = z.enum(['wording_changed', 'wording_ambiguous', 'file_missing', 'evidence_changed', 'evidence_missing', 'unconfirmed'])
const finding = z.object({ path, quote: z.string().max(500), kind: z.enum(['claim', 'citation']), line: z.number().int().positive().optional(),
  reasons: z.array(status).min(1).max(5), dependencies: z.array(path).max(10) })
export const submissionEvidenceSchema = z.object({
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), checked: z.number().int().positive(),
  findings: z.array(finding), exceptionAccepted: z.boolean(),
}).refine(value => value.findings.length <= value.checked && value.exceptionAccepted === Boolean(value.findings.length))
export type SubmissionEvidence = z.infer<typeof submissionEvidenceSchema>
export type SubmissionEvidenceFinding = z.infer<typeof finding>

type Entry = { claim: WritingClaims[number]; reviewedPath: string; review?: ClaimReview; revision?: number }
export type SubmissionEvidenceLedger = { entries: Entry[]; moves: readonly SourceMove[] }

function currentPath(path: string, moves: readonly SourceMove[], revision?: number) {
  return revision === undefined || revision > moves.length ? path
    : moves.slice(revision).reduce((current, move) => current === move.from ? move.to : current, path)
}

export function submissionEvidenceLedger(history: ChatHistory | undefined, checkpoints: Record<string, ChatCheckpoint>,
  receipts: Record<string, ChatTaskStep[]>, moves: readonly SourceMove[]): SubmissionEvidenceLedger {
  const tasks = (history?.conversations ?? []).flatMap(({ manuscript }) => {
    const saved = manuscript && checkpoints[manuscript.id]
    return manuscript && saved?.state === 'saved' ? [{ manuscript, saved,
      at: receipts[manuscript.id]?.findLast(step => step.kind === 'saved')?.at ?? 0 }] : []
  }).sort((a, b) => a.at - b.at)
  const entries = new Map<string, Entry>()
  for (const { manuscript, saved } of tasks) {
    for (const batch of manuscript.batches) {
      const applied = checkpoints[batch.run]
      if (applied?.state !== 'draft' && applied?.state !== 'saved') continue
      batch.claims?.forEach((original, index) => {
        if (!Object.hasOwn(applied.after, original.path) || !Object.hasOwn(saved.after, original.path)) return
        const appliedSource = applied.after[original.path]
        if (!claimPresent(original, appliedSource.draft?.text ?? appliedSource.saved)) return
        const review = manuscript.claimReviews?.[`${batch.run}:${index}`]
        const revision = review?.revision ?? batch.sourceRevision ?? (moves.length ? undefined : 0)
        const claim = review?.evidence ? { ...original, references: review.evidence.references,
          calculations: review.evidence.calculations, needsConfirmation: review.evidence.needsConfirmation } : { ...original }
        claim.path = currentPath(original.path, moves, batch.sourceRevision ?? (moves.length ? undefined : 0))
        const key = JSON.stringify([claim.path, claim.kind, claim.quote])
        if (review?.decision === 'excluded') entries.delete(key)
        else entries.set(key, { claim, review, revision, reviewedPath: original.path })
      })
    }
  }
  return { entries: [...entries.values()], moves }
}

export function assessSubmissionEvidence(project: ProjectFileSystem, ledger: SubmissionEvidenceLedger) {
  const findings = ledger.entries.flatMap(({ claim, review, revision, reviewedPath }): SubmissionEvidenceFinding[] => {
    const assessment = assessClaim(claim, project, ledger.moves, revision, review, reviewedPath)
    const line = claimSourceLine(claim, project)
    const reasons = new Set<z.infer<typeof status>>()
    const dependencies = new Set<string>()
    if (!project.files.has(claim.path)) reasons.add('file_missing')
    else if (!assessment.present) reasons.add('wording_changed')
    else if (!line && claim.kind === 'claim') reasons.add('wording_ambiguous')
    function evidenceProblem(originalPath: string) {
      const resolved = currentPath(originalPath, ledger.moves, revision)
      dependencies.add(resolved)
      reasons.add(project.files.has(resolved) ? 'evidence_changed' : 'evidence_missing')
    }
    claim.references.forEach((ref, i) => { if (!assessment.locations[i]) evidenceProblem(ref.path) })
    claim.calculations?.forEach((calculation, i) => {
      if (!assessment.calculations[i].current) evidenceProblem(calculation.path)
    })
    if (!reasons.size && assessment.needsReview) reasons.add('unconfirmed')
    return reasons.size ? [{ path: claim.path, quote: claim.quote, kind: claim.kind, line,
      reasons: [...reasons], dependencies: [...dependencies] }] : []
  })
  return { checked: ledger.entries.length, findings }
}

export async function assessSubmissionZip(zip: Blob, sourceChecksum: string | undefined, ledger: SubmissionEvidenceLedger) {
  const digest = await crypto.subtle.digest('SHA-256', await zip.arrayBuffer())
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (sourceChecksum !== actual) throw new Error('The final source ZIP changed. Build it again before archiving.')
  const project = await importSourceArchive(new File([zip], 'submission.zip'))
  return { ...assessSubmissionEvidence(project, ledger), sourceChecksum: actual }
}
