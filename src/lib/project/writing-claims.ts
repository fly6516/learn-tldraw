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
const referenceChoice = location.extend({ column: z.string().min(1).max(300).optional() })
const evidence = location.extend({
  text: z.string().max(500),
  kind: z.enum(['data', 'table', 'bibliography']),
  anchor: z.object({ quote: z.string().max(500), before: z.string().max(48), after: z.string().max(48),
    wholeLine: z.boolean().optional(), requireContext: z.boolean().optional() }).optional(),
  csvHeader: z.array(z.string().max(300)).max(32).optional(),
  column: referenceChoice.shape.column,
})
export const claimSuggestionSchema = z.array(z.object({
  path, quote: z.string().trim().min(1).max(500), references: z.array(referenceChoice).max(6),
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
const causal = /\b(?:caus(?:e|es|ed|ing|al|ality)|led to|leads to|result(?:s|ed) in|attribut(?:able|ed) to|due to)\b|导致|造成|引起|归因于|因果/i

const csvUnits: Readonly<Record<string, RegExp>> = {
  c: /(?<![a-z])(?:(?:°|\\textdegree(?:\{\})?)\s*c|degrees?\s+c(?:elsius)?|celsius|摄氏度|℃)(?![a-z])/i,
  f: /(?<![a-z])(?:(?:°|\\textdegree(?:\{\})?)\s*f|degrees?\s+f(?:ahrenheit)?|fahrenheit|华氏度|℉)(?![a-z])/i,
  kg: /(?:\d\s*kg\b|kilograms?\b|千克|公斤)/i,
  g: /(?:\d\s*g\b|(?<!kilo)\bgrams?\b|(?<!千)克)/i,
  percent: /%|percent\b|百分之/i,
}
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
const groupAliases = [
  { headers: /\b(?:control|placebo)\b|对照|安慰剂/i, text: /\b(?:control|placebo)\b|对照组|安慰剂组/i },
  { headers: /\b(?:treatment|treated|intervention|experimental)\b|干预|实验/i, text: /\b(?:treatment|treated|intervention|experimental)\b|干预组|实验组/i },
  { headers: /\b(?:shaded|shade)\b|阴影|遮阴/i, text: /\b(?:shaded|shade)\b|阴影|遮阴|阴凉/i },
  { headers: /\b(?:exposed|unshaded)\b|暴晒|裸露/i, text: /\b(?:exposed|unshaded)\b|暴晒|暴露|未遮阴/i },
]

function csvSupports(quote: string, value: string, ref: ClaimReference) {
  if (!ref.csvHeader) return numbers(ref.text).includes(value) // older receipts
  let cells: unknown
  try { cells = JSON.parse(ref.text) } catch { return false }
  if (!Array.isArray(cells) || cells.length !== ref.csvHeader.length) return false
  const units = Object.entries(csvUnits).filter(([, pattern]) => pattern.test(quote)).map(([unit]) => unit)
  const mentionedGroups = groupAliases.filter(group => group.text.test(quote))
  const claimWords = new Set(words(quote))
  const headers = ref.csvHeader.map((name, index) => {
    const tokens = words(name)
    const unit = tokens.at(-1)
    const unitKnown = !!unit && Object.hasOwn(csvUnits, unit)
    const key = new Set(unitKnown ? tokens.slice(0, -1) : tokens)
    const mentions = [...key].filter(word => claimWords.has(word)).length
    return { name, index, unit: unitKnown ? unit : undefined, mentions }
  })
  const candidates = headers.filter(column => numbers(String(cells[column.index])).includes(value))
  const bestMatch = Math.max(0, ...headers.map(column => column.mentions))
  return candidates.some(column => {
    if (ref.column && (column.name !== ref.column || headers.filter(item => item.name === ref.column).length !== 1)) return false
    const explicitGroup = mentionedGroups.length === 1 ? mentionedGroups[0] : undefined
    const relevantHeader = column.name.replace(/[_-]/g, ' ')
    if (explicitGroup && headers.some(item => explicitGroup.headers.test(item.name.replace(/[_-]/g, ' ')))
      && groupAliases.some(group => group.headers.test(relevantHeader)) && !explicitGroup.headers.test(relevantHeader)) return false
    if (column.mentions < bestMatch || (bestMatch === 0 && !ref.column)) return false
    return !units.length || (units.length === 1 && units.includes(column.unit ?? ''))
  })
}

export function claimEvidenceFor(quote: string, references: z.infer<typeof referenceChoice>[], observed: ClaimReference[],
  oldText = '', calculationIds?: readonly string[], calculations: readonly CsvCalculation[] = []) {
  const linked = references.flatMap(ref => {
    const item = observed.find(item => item.path === ref.path && item.line === ref.line)
    return item ? [{ ...item, ...(ref.column ? { column: ref.column } : {}) }] : []
  })
  const recorded = new Set([...numbers(oldText), ...linked.filter(ref => ref.kind === 'table').flatMap(ref => numbers(ref.text))])
  const derived = calculations.filter(item => calculationIds?.includes(item.id))
  const recognized = (value: string) => derived.some(item => {
    const percent = value.endsWith('%')
    return percent === (item.operation === 'percent_change') && Number(value.replace(/\\?%$/, '')) === item.result
  })
  const data = linked.filter(ref => ref.kind === 'data')
  return { references: linked, needsConfirmation: causal.test(quote) || numbers(quote).some(value =>
    !recognized(value) && !data.some(ref => csvSupports(quote, value, ref))
    && (!recorded.has(value) || data.some(ref => ref.csvHeader && numbers(ref.text).includes(value)))),
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
      const row = readCsvRange(source, 1, 1, false, location.line).rows[0]
      return row && JSON.stringify(row.cells)
    })() : reference.kind === 'bibliography' ? (() => {
      const entry = parseBibliography(location.path, source).find(entry => entry.line === location.line)
      return entry && [entry.title, entry.author, entry.year].filter(Boolean).join(' · ')
    })() : source.split(/\r\n|\r|\n/)[location.line - 1]
    const actual = text?.slice(0, 500) ?? null
    const header = reference.csvHeader ? readCsvRange(source, 1, 1, false).rows[0]?.cells : undefined
    const sameHeader = !reference.csvHeader || JSON.stringify(header) === JSON.stringify(reference.csvHeader)
    return { location: actual === reference.text && sameHeader ? location : undefined, text: reference.csvHeader ? [actual, header] : actual }
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
  const normalizedClaims = suggested.map(item => {
    const matches = [...new Set(edits.filter(edit => edit.after.includes(item.quote) && !edit.before.includes(item.quote)).map(edit => edit.path))]
    // A model can put the cited source in path. Recover only a uniquely located replacement.
    return !matches.includes(item.path) && matches.length === 1 && item.references.some(ref => ref.path === item.path)
      ? { ...item, path: matches[0] } : item
  })
  for (const edit of edits) {
    const priorNumbers = new Set(numbers(edit.before))
    for (const item of normalizedClaims) {
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
      if ((!prose || !numbers(prose).some(value => !priorNumbers.has(value))) && !observation.test(prose) && !causal.test(prose)) continue
      const quote = line.slice(0, 500)
      const existing = result.find(item => item.path === edit.path && item.kind === 'claim' && line.includes(item.quote))
      if (existing && !causal.test(prose)) continue
      if (existing && causal.test(prose)) {
        existing.needsConfirmation = true
        continue
      }
      add({ path: edit.path, quote, kind: 'claim', references: [], ...(causal.test(prose) ? { needsConfirmation: true } : {}),
        exclusion: reversibleChange(edit, quote) })
    }
  }
  return result
}
