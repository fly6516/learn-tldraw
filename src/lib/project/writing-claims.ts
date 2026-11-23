import { z } from 'zod'
import type { ProjectSuggestion } from './ai-edit'
import { findCitations, parseBibliography } from './references'
import { captureEvidenceQuote, locateEvidence, type SourceMove } from './writing-ai-evidence'
import type { ProjectFileSystem } from './types'
import { readCsvRange } from './ai-attachments'
import { assessCsvCalculation, csvCalculationSchema, type CsvCalculation } from './csv-calculation'
import { lineNumber } from './latex-source'

const path = z.string().min(1).max(500)
const location = z.object({ path, line: z.number().int().positive() })
const evidence = location.extend({
  text: z.string().max(500),
  kind: z.enum(['data', 'table', 'bibliography']),
  anchor: z.object({ quote: z.string().max(500), before: z.string().max(48), after: z.string().max(48),
    wholeLine: z.boolean().optional(), requireContext: z.boolean().optional() }).optional(),
})
export const claimSuggestionSchema = z.array(z.object({
  path, quote: z.string().trim().min(1).max(500), references: z.array(location).max(6),
  calculationIds: z.array(csvCalculationSchema.shape.id).max(4).optional(),
})).max(16)
export const writingClaimsSchema = z.array(z.object({
  path, quote: z.string().min(1).max(500), kind: z.enum(['claim', 'citation']), references: z.array(evidence).max(6),
  needsConfirmation: z.boolean().optional(),
  calculations: z.array(csvCalculationSchema).max(4).optional(),
  exclusion: z.object({ before: z.string().min(1).max(4000), after: z.string().max(4000) }).optional(),
})).max(24)
export const claimReviewSchema = z.object({
  decision: z.enum(['confirmed', 'requested', 'excluded']).optional(),
  fingerprint: z.string().max(9000).optional(),
  evidence: writingClaimsSchema.element.optional(),
  revision: z.number().int().nonnegative().optional(),
})
export type WritingClaims = z.infer<typeof writingClaimsSchema>
export type ClaimReference = z.infer<typeof evidence>
export type ClaimReview = z.infer<typeof claimReviewSchema>

export function claimPresent(claim: WritingClaims[number], source: string | undefined) {
  return Boolean(source && (claim.kind === 'citation'
    ? findCitations(claim.path, source).some(item => item.key === claim.quote) : source.includes(claim.quote)))
}

export function claimSourceLine(claim: Pick<WritingClaims[number], 'path' | 'kind' | 'quote'>, project: ProjectFileSystem) {
  const file = project.files.get(claim.path)
  const source = file && 'content' in file ? file.content : undefined
  if (!source) return
  if (claim.kind === 'citation') {
    const matches = findCitations(claim.path, source).filter(item => item.key === claim.quote)
    return matches.length === 1 ? matches[0].line : undefined
  }
  const start = source.indexOf(claim.quote)
  return start >= 0 && start === source.lastIndexOf(claim.quote) ? lineNumber(source, start) : undefined
}

const numbers = (text: string) => [...text.matchAll(/(?:^|[^\p{L}\p{N}_])([+-]?\d+(?:[.,]\d+)*(?:\\?%)?)(?![\p{L}\p{N}_])/gu)].map(match => match[1])
const observation = /\b(?:measured|observed|increased|decreased|outperformed|statistically significant|significantly|correlat\w*|associated with)\b|显著|实测|观测到|相关性|提高了|下降了/i

export function claimEvidenceFor(quote: string, references: { path: string; line: number }[], observed: ClaimReference[],
  oldText = '', calculationIds?: readonly string[], calculations: readonly CsvCalculation[] = []) {
  const linked = references.flatMap(ref => observed.find(item => item.path === ref.path && item.line === ref.line) ?? [])
  const recorded = new Set([...numbers(oldText), ...linked.filter(ref => ref.kind !== 'bibliography').flatMap(ref => numbers(ref.text))])
  const derived = calculations.filter(item => calculationIds?.includes(item.id))
  const recognized = (value: string) => derived.some(item => {
    const percent = value.endsWith('%')
    return percent === (item.operation === 'percent_change') && Number(value.replace(/\\?%$/, '')) === item.result
  })
  return { references: linked, needsConfirmation: numbers(quote).some(value => !recorded.has(value) && !recognized(value)),
    ...(derived.length ? { calculations: derived } : {}) }
}

export function assessClaim(claim: WritingClaims[number], project: ProjectFileSystem, moves: readonly SourceMove[],
  revision: number | undefined, review?: ClaimReview, reviewedPath = claim.path) {
  const file = project.files.get(claim.path)
  const source = file && 'content' in file ? file.content : undefined
  const present = claimPresent(claim, source)
  const refs = claim.references.map(reference => {
    const location = locateEvidence(project, reference, moves, revision)
    if (!location) return { location: undefined, text: null }
    const file = project.files.get(location.path)
    const source = file && 'content' in file ? file.content : undefined
    if (source === undefined) return { location: undefined, text: null }
    const text = reference.kind === 'data' ? (() => {
      const row = readCsvRange(source.slice(0, 24_000), 1, location.line, source.length > 24_000).rows.find(row => row.line === location.line)
      return row && JSON.stringify(row.cells)
    })() : reference.kind === 'bibliography' ? (() => {
      const entry = parseBibliography(location.path, source).find(entry => entry.line === location.line)
      return entry && [entry.title, entry.author, entry.year].filter(Boolean).join(' · ')
    })() : source.split(/\r\n|\r|\n/)[location.line - 1]
    const actual = text?.slice(0, 500) ?? null
    return { location: actual === reference.text ? location : undefined, text: actual }
  })
  const calculated = claim.calculations?.map(item => assessCsvCalculation(item, project, moves, revision)) ?? []
  const fingerprint = JSON.stringify([reviewedPath, claim.quote, present, refs.map(item => item.text),
    ...(calculated.length ? [calculated.map(item => item.inputs.map(input => input.value ?? null))] : [])])
  const confirmed = present && review?.decision === 'confirmed' && review.fingerprint === fingerprint
  const excluded = !present && review?.decision === 'excluded'
  const needsReview = !excluded && !confirmed && (!present || claim.needsConfirmation || calculated.some(item => !item.current)
    || !refs.some(ref => ref.location) && !calculated.some(item => item.current)
    || review?.decision === 'requested' || review?.decision === 'confirmed' || review?.decision === 'excluded')
  return { fingerprint, present, confirmed, excluded, needsReview, locations: refs.map(ref => ref.location), calculations: calculated }
}

function reversibleChange(edit: ProjectSuggestion['edits'][number], quote: string) {
  // A standalone added line can be excluded without undoing another claim in the same proposal.
  for (const match of edit.after.matchAll(/[^\r\n]+(?:\r\n|\r|\n|$)/g)) {
    if (match[0].trim() !== quote || edit.before.includes(quote) || match.index === 0) continue
    if (/[\r\n]$/.test(match[0])) return { before: match[0], after: '' }
    const newline = /(?:\r\n|\r|\n)$/.exec(edit.after.slice(0, match.index))?.[0]
    if (newline) return { before: newline + match[0], after: '' }
  }
  return edit.after.length <= 4000 && edit.before.length <= 4000 ? { before: edit.after, after: edit.before } : undefined
}

export function collectWritingClaims(edits: ProjectSuggestion['edits'], suggested: z.infer<typeof claimSuggestionSchema>,
  observed: z.infer<typeof evidence>[], sources: readonly { path: string; source: string }[], calculations: readonly CsvCalculation[] = []): WritingClaims {
  const result: WritingClaims = []
  const bibliography = sources.flatMap(file => /\.bib$/i.test(file.path)
    ? parseBibliography(file.path, file.source).map(entry => ({ file, entry })) : [])
  const add = (item: WritingClaims[number]) => {
    if (result.length < 24 && !result.some(existing => existing.path === item.path && existing.quote === item.quote && existing.kind === item.kind)) result.push(item)
  }
  for (const edit of edits) {
    const priorNumbers = new Set(numbers(edit.before))
    for (const item of suggested) {
      if (item.path !== edit.path || !edit.after.includes(item.quote) || edit.before.includes(item.quote)) continue
      add({ path: edit.path, quote: item.quote, kind: 'claim',
        ...claimEvidenceFor(item.quote, item.references, observed, edit.before, item.calculationIds, calculations),
        exclusion: reversibleChange(edit, item.quote) })
    }
    const earlierKeys = new Set(findCitations(edit.path, edit.before).map(item => item.key))
    for (const citation of findCitations(edit.path, edit.after)) {
      if (earlierKeys.has(citation.key)) continue
      const matches = bibliography.filter(item => item.entry.key === citation.key)
      const references = matches.length === 1 ? matches.map(({ entry, file }) => ({
        path: entry.path, line: entry.line, text: [entry.title, entry.author, entry.year].filter(Boolean).join(' · ').slice(0, 500),
        kind: 'bibliography' as const, anchor: captureEvidenceQuote(file.path, file.source, entry.line),
      })) : []
      add({ path: edit.path, quote: citation.key, kind: 'citation', references, exclusion: reversibleChange(edit, citation.key) })
    }
    for (const raw of edit.after.split(/\r\n|\r|\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('%') || edit.before.includes(line)) continue
      const prose = line.replace(/\\(?:[\w]*cite[\w]*|label|\w*ref|input|include)\*?(?:\[[^\]]*\])*\{[^}]*\}/gi, '')
      if ((!prose || !numbers(prose).some(value => !priorNumbers.has(value))) && !observation.test(prose)) continue
      const quote = line.slice(0, 500)
      if (result.some(item => item.path === edit.path && item.kind === 'claim' && line.includes(item.quote))) continue
      add({ path: edit.path, quote, kind: 'claim', references: [], exclusion: reversibleChange(edit, quote) })
    }
  }
  return result
}
