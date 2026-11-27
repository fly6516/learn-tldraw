import { importSourceArchive, sourceArchiveEntry } from './source-archive'
import type { ProjectFileSystem } from './types'
import type { ReviewTarget } from './review-links'
import { revisionChangeKey, revisionChangeLocation, sameRevisionEvidenceBinding, type RevisionChange, type RevisionEvidence, type RevisionEvidenceBinding } from './revision-evidence'

export type RevisionResponse = { kind: 'changed' | 'retained'; text: string; paths: string[]; evidence?: RevisionEvidence; reviewRequired?: true }
export type RevisionCommentTarget = ReviewTarget | { type: 'file'; path: string } | { type: 'manuscript' }

export type RevisionComment = { id: string; reviewer: string; text: string; editId?: string; response?: RevisionResponse } & (
  | { kind: 'comment'; target: RevisionCommentTarget }
  | { kind: 'canvas'; nodeId: string })

export type RevisionRound = { id: string; name: string; submissionId: string; revisedSubmissionId?: string; createdAt: string; comments: RevisionComment[] }
export type RevisionFile = { path: string; status: 'Added' | 'Removed' | 'Modified' | 'Unchanged'; baseline?: string | Blob; current?: string | Blob }

export type RevisionDestination = { kind: 'comment'; target: RevisionCommentTarget } | { kind: 'canvas'; nodeId: string }
export type RevisionCommentEdit =
  | { kind: 'move'; direction: -1 | 1 }
  | { kind: 'edit'; reviewer: string; text: string; destination: RevisionDestination; editId: string }
  | { kind: 'split'; first: string; second: string; editId: string; secondId: string }

export const revisionResponseLabels = {
  awaiting: 'Awaiting response', review: 'Needs review', ready: 'Ready to export',
} as const

export function revisionResponseStatus(comment: RevisionComment, verified = false): keyof typeof revisionResponseLabels {
  if (!comment.response) return 'awaiting'
  if (comment.response.reviewRequired || comment.response.kind === 'changed' && !verified) return 'review'
  return 'ready'
}

function commentText(text: string) {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 12000) throw new Error('Enter a comment between 1 and 12,000 characters.')
  return trimmed
}

function reviewDraft(response?: RevisionResponse): RevisionResponse | undefined {
  return response && { ...response, evidence: undefined, reviewRequired: true }
}

export function editRevisionComment(round: RevisionRound, expected: RevisionComment, edit: RevisionCommentEdit): RevisionRound {
  const index = round.comments.findIndex(comment => comment.id === expected.id)
  const current = round.comments[index]
  if (!current || JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error('This reviewer comment changed. Reopen the revision round and review the latest version.')
  }
  const comments = [...round.comments]
  if (edit.kind === 'move') {
    const destination = index + edit.direction
    if (destination < 0 || destination >= comments.length) return round
    comments.splice(index, 1)
    comments.splice(destination, 0, current)
  } else if (edit.kind === 'edit') {
    const { destination, editId } = edit
    const reviewer = edit.reviewer.trim()
    const text = commentText(edit.text)
    if (reviewer.length > 100) throw new Error('Reviewer or editor names are limited to 100 characters.')
    if (destination.kind === 'canvas' && comments.some(item =>
      item.id !== current.id && item.kind === 'canvas' && item.nodeId === destination.nodeId)) {
      throw new Error('This Canvas card is already in the round.')
    }
    const previous = current.kind === 'canvas' ? { kind: current.kind, nodeId: current.nodeId } : { kind: current.kind, target: current.target }
    if (reviewer === current.reviewer && text === current.text && JSON.stringify(destination) === JSON.stringify(previous)) return round
    comments[index] = { ...destination, id: current.id, reviewer, text, editId, response: reviewDraft(current.response) }
  } else {
    if (comments.some(item => item.id === edit.secondId)) throw new Error('The new comment is already in the round.')
    const first = { ...current, text: commentText(edit.first), editId: edit.editId, response: reviewDraft(current.response) }
    const second: RevisionComment = { id: edit.secondId, kind: 'comment',
      target: current.kind === 'comment' ? current.target : { type: 'manuscript' },
      reviewer: current.reviewer, text: commentText(edit.second) }
    comments.splice(index, 1, first, second)
  }
  return { ...round, comments }
}

export async function readRevisionBaseline(zip: Blob) {
  return importSourceArchive(new File([zip], 'archived-submission.zip'))
}

async function equalBytes(a: string | Blob, b: string | Blob) {
  if (a === b) return true
  if (typeof a === 'string' && typeof b === 'string') return a === b
  const first = typeof a === 'string' ? new Blob([a]) : a
  const second = typeof b === 'string' ? new Blob([b]) : b
  if (first.size !== second.size) return false
  const [left, right] = await Promise.all([first.arrayBuffer(), second.arrayBuffer()])
  const bytes = new Uint8Array(right)
  return new Uint8Array(left).every((byte, index) => byte === bytes[index])
}

export async function compareRevisionFiles(baseline: ProjectFileSystem, current: ProjectFileSystem): Promise<RevisionFile[]> {
  const paths = [...new Set([...baseline.files.keys(), ...current.files.keys()])].sort()
  const files: RevisionFile[] = []
  for (const path of paths) {
    const before = baseline.files.get(path)
    const after = current.files.get(path)
    const original = before && sourceArchiveEntry(before)
    const modified = after && sourceArchiveEntry(after)
    if (original === undefined && modified === undefined) continue
    const status = original === undefined ? 'Added' : modified === undefined ? 'Removed'
      : await equalBytes(original, modified) ? 'Unchanged' : 'Modified'
    files.push({ path, status, baseline: original, current: modified })
  }
  return files
}

function markdownText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_\[\]#|~]/g, '\\$&').replace(/\r\n?|\n/g, '\n')
    .replace(/^([+-]|\d+[.)])(?=\s)/gm, value => value.replace(/[+\-.)]/g, '\\$&'))
}

export function buildRevisionLetter(round: RevisionRound, baseline: string, revised: string, files: RevisionFile[],
  binding: RevisionEvidenceBinding, changes: RevisionChange[]) {
  const byPath = new Map(files.map(file => [file.path, file.status]))
  const byChange = new Map(changes.map(change => [revisionChangeKey(change), change]))
  const unresolved: number[] = []
  const lines = [`# ${markdownText(round.name.replace(/\s+/g, ' '))}`, '',
    `Original submission: ${markdownText(baseline.replace(/\s+/g, ' '))}`,
    `Revised submission: ${markdownText(revised.replace(/\s+/g, ' '))}`, '']
  for (const [index, comment] of round.comments.entries()) {
    const number = index + 1
    lines.push(`## Comment ${number} · ${markdownText((comment.reviewer || 'Reviewer').replace(/\s+/g, ' '))}`, '',
      ...markdownText(comment.text).split('\n').map(line => `> ${line}`), '')
    const response = comment.response
    if (!response) {
      unresolved.push(number)
      lines.push('**Awaiting response.**', '')
      continue
    }
    lines.push(response.kind === 'retained' ? '**Response · text retained**' : '**Response · manuscript revised**', '', markdownText(response.text), '')
    if (response.reviewRequired) {
      unresolved.push(number)
      lines.push('**Response needs review after the reviewer comment was edited.**', '')
      continue
    }
    if (response.kind === 'retained') continue
    const evidence = response.evidence
    const references = evidence && sameRevisionEvidenceBinding(evidence, binding) ? evidence.changes : []
    const verified = references.flatMap(item => byChange.get(revisionChangeKey(item)) ?? [])
    if (!verified.length || verified.length !== references.length) {
      unresolved.push(number)
      lines.push('**Evidence needs review against the selected original and revised ZIPs.**', '')
      continue
    }
    lines.push('Changes verified against the revised source ZIP:', '', ...verified.map(change =>
      `- ${byPath.get(change.path)} · ${markdownText(change.path)} (${revisionChangeLocation(change)})`), '')
  }
  return { markdown: lines.join('\n'), unresolved }
}
