import { sourceOffsetAtPosition } from './latex-source'
import { makeSelectionAnchor, resolveSelectionAnchor } from './review-links'
import type { ProjectFileSystem } from './types'

export type SourceMove = { from: string; to: string }
export type EvidenceQuote = { quote: string; before: string; after: string; requireContext?: boolean; wholeLine?: boolean }
export type InlineEvidenceTarget = { path: string; location?: { path: string; line: number } }

export function inlineEvidenceTargets(project: ProjectFileSystem, evidence: readonly {
  path: string; line: number; text: string; kind: string; anchor?: EvidenceQuote
}[], moves: readonly SourceMove[], revision: number | undefined, bibliography: ReadonlyMap<string, { path: string; line: number } | undefined>) {
  const targets = new Map<string, InlineEvidenceTarget>()
  function add(label: string, target: InlineEvidenceTarget) {
    const previous = targets.get(label)
    if (!previous) targets.set(label, target)
    else if (previous.location?.path !== target.location?.path || previous.location?.line !== target.location?.line) {
      targets.set(label, { path: target.path })
    }
  }
  for (const item of evidence) {
    if (item.kind === 'compile_diagnostics') continue
    const location = locateEvidence(project, item, moves, revision ?? (moves.length === 0 ? 0 : undefined))
    add(`${item.path}:${item.line}`, { path: item.path, location })
    if (item.kind === 'query_references' && /\.bib$/i.test(item.path)) {
      const key = item.text.split(' · ')[0]
      if (!/^[\w.:+/\-]+$/.test(key)) continue
      const definition = bibliography.get(key)
      const target = { path: item.path, location: location && definition?.path === location.path && definition?.line === location.line ? location : undefined }
      add('@' + key, target)
      add(key, target)
    }
  }
  return targets
}

export function captureEvidenceQuote(path: string, source: string, line: number): EvidenceQuote | undefined {
  const lines = source.split(/\r\n|\r|\n/)
  const text = lines[line - 1]
  if (!text?.trim()) return
  const start = sourceOffsetAtPosition(source, { lineNumber: line, column: 1 })
  const anchor = makeSelectionAnchor(path, path, source, start, start + Math.min(text.length, 500))
  if (anchor) return { quote: anchor.quote, before: anchor.before, after: anchor.after,
    requireContext: source.indexOf(anchor.quote) !== source.lastIndexOf(anchor.quote), wholeLine: text.length <= 500 }
}

export function locateEvidence(project: ProjectFileSystem, evidence: { path: string; anchor?: EvidenceQuote },
  moves: readonly SourceMove[], revision?: number) {
  if (!evidence.anchor || revision === undefined || revision > moves.length) return
  const path = moves.slice(revision).reduce((path, move) => path === move.from ? move.to : path, evidence.path)
  const file = project.files.get(path)
  if (!file || !('content' in file) || typeof file.content !== 'string') return
  const { anchor } = evidence
  const location = resolveSelectionAnchor(path, file.content, { ...anchor, path, project: path })
  if (location && anchor.wholeLine &&
    (location.start > 0 && !/[\r\n]/.test(file.content[location.start - 1])
      || location.end < file.content.length && !/[\r\n]/.test(file.content[location.end]))) return
  if (location && anchor.requireContext && (
    file.content.slice(Math.max(0, location.start - anchor.before.length), location.start) !== anchor.before
    || file.content.slice(location.end, location.end + anchor.after.length) !== anchor.after
  )) return
  return location
}
