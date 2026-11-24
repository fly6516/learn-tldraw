import { z } from 'zod'
import { applyChapterEdits, maxChapterLength, type ProjectSuggestion } from './ai-edit'
import { lineNumber } from './latex-source'
import type { ProjectFileSystem } from './types'

export type SourceRange = { path: string; start: number; end: number }
export const maxSourceRanges = 6
export const sourceRangeSchema = z.object({
  path: z.string().min(1).max(500),
  start: z.number().int().min(1).max(1_000_000),
  source: z.string().min(1).max(maxChapterLength),
})
export type SourceExcerpt = z.infer<typeof sourceRangeSchema>

const lineBreak = /\r\n|\r|\n/
export function excerptEnd(excerpt: SourceExcerpt) {
  return excerpt.start + excerpt.source.split(lineBreak).length - 1
}

export function sourceExcerpt(source: string, range: SourceRange): SourceExcerpt | undefined {
  const lines: string[] = source.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? []
  if (/[\r\n]$/.test(source)) lines.push('')
  if (range.start < 1 || range.end < range.start || range.end > lines.length) return
  const selected = lines.slice(range.start - 1, range.end)
  const joined = selected.join('')
  const text = selected.at(-1) === '' ? joined : joined.replace(/(?:\r\n|\r|\n)$/, '')
  if (text.trim() && text.length <= maxChapterLength) return { path: range.path, start: range.start, source: text }
}

export function locateExactReplacement(source: string, path: string, before: string): SourceRange | undefined {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + 1) >= 0) return
  const end = first + before.length - (/[\r\n]$/.test(before) ? 0 : 1)
  return { path, start: lineNumber(source, first), end: lineNumber(source, end) }
}

export function validateExcerptEdits(excerpts: readonly SourceExcerpt[], edits: ProjectSuggestion['edits']) {
  const grouped = new Map<SourceExcerpt, ProjectSuggestion['edits']>()
  for (const edit of edits) {
    const matches = excerpts.filter(excerpt => excerpt.path === edit.path && excerpt.source.includes(edit.before))
    const [excerpt] = matches
    if (!excerpt || matches.length !== 1) throw new Error('A proposed edit must match one shared source range.')
    const group = grouped.get(excerpt) ?? []
    group.push(edit)
    grouped.set(excerpt, group)
  }
  for (const [excerpt, group] of grouped) applyChapterEdits(excerpt.source, group)
}

const heading = /\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/
const label = /\\label\s*\{([^{}]+)\}/
const researchTerms = [
  ['sampling bias', 'selection bias', 'nonrepresentative', 'sample representativeness', 'sample frame', 'sampling frame', '采样偏差', '抽样偏差', '选择偏倚', '样本代表性'],
  ['confounding', 'confounder', '混杂因素', '混杂变量'],
  ['missing data', 'missing records', 'imputation', '数据缺失', '缺失值', '插补'],
  ['sensitivity analysis', 'robustness check', '敏感性分析', '稳健性检验'],
  ['uncertainty', 'confidence interval', '不确定性', '置信区间'],
  ['limitation', 'limitations', '局限', '局限性'],
] as const
const normalize = (text: string) => text.toLowerCase().trim().replace(/\s+/g, ' ')
const containsTerm = (request: string, term: string) => /^[\w -]+$/.test(term)
  ? (' ' + request.replace(/[^\w -]+/g, ' ') + ' ').includes(' ' + term + ' ')
  : request.includes(term)

export function namedSourcePaths(paths: readonly string[], request: string) {
  const query = normalize(request)
  const fullPaths = paths.filter(path => path.includes('/') && containsTerm(query, normalize(path)))
  const namedBasenames = new Set(fullPaths.map(path => path.split('/').at(-1)))
  return [...fullPaths, ...paths.filter(path => {
    const basename = path.split('/').at(-1)!
    return !namedBasenames.has(basename) && containsTerm(query, normalize(basename))
  })]
}

export function locateSourceRanges(project: ProjectFileSystem, paths: readonly string[], request: string, current: string) {
  const query = normalize(request)
  const quotes = [...new Set([...request.matchAll(/["“「『\x60]([^"”」』\x60\n]{3,160})["”」』\x60]/g)].map(match => normalize(match[1])))]
  const explicitlyNamed = namedSourcePaths(paths, request)
  const matches: { range: SourceRange; clue: string; title: string }[] = []
  const topics = researchTerms.filter(group => group.some(term => containsTerm(query, term)))
  const related: typeof matches = []
  for (const path of explicitlyNamed.length ? explicitlyNamed : paths) {
    const file = project.files.get(path)
    if (!file || !('content' in file) || !file.content) continue
    const lines = file.content.split(lineBreak)
    const headings = lines.flatMap((line, index) => {
      const title = !line.trimStart().startsWith('%') && heading.exec(line)?.[1]
      return title ? [{ line: index + 1, title }] : []
    })
    let nextHeading = 0
    lines.forEach((raw, index) => {
      const line = index + 1
      while (headings[nextHeading]?.line <= line) nextHeading++
      if (!raw.trim() || raw.trimStart().startsWith('%')) return
      const section = headings[nextHeading - 1]
      const next = headings[nextHeading]
      const title = section?.title ?? raw.trim().slice(0, 80)
      const exact = [heading.exec(raw)?.[1], label.exec(raw)?.[1]].filter((term): term is string => Boolean(term))
      const literal = raw.trimStart().startsWith('\\') ? ''
        : normalize(raw).replace(/\\[a-z]+[{}]?/g, '').replace(/[{}]/g, '').trim()
      const clues = [...exact.map(normalize).filter(term => term.length >= 2 && containsTerm(query, term)),
        ...quotes.filter(term => normalize(raw).includes(term)),
        ...(literal.length >= 8 && containsTerm(query, literal) ? [literal] : [])]
      for (const clue of new Set(clues)) {
        const isHeading = heading.test(raw) && exact.some(term => normalize(term) === clue)
        const start = isHeading ? line : Math.max(section?.line ?? 1, line - 5)
        const end = isHeading ? (next?.line ?? lines.length + 1) - 1
          : Math.min(next ? next.line - 1 : lines.length, line + 8)
        matches.push({ range: { path, start, end }, clue, title })
      }
      if (!clues.length && raw.trim().length >= 8 && !label.test(raw)) {
        for (const group of topics.filter(group => group.some(term => containsTerm(normalize(raw), term)))) {
          related.push({ range: { path, start: Math.max(section?.line ?? 1, line - 3),
            end: Math.min(next ? next.line - 1 : lines.length, line + 5) }, clue: group[0], title })
        }
      }
    })
  }
  // A quoted heading and its LaTeX declaration often identify the same range.
  const candidates = matches.length ? matches : related
  const unique = [...new Map(candidates.map(match => [JSON.stringify([match.clue, match.range]), match])).values()]
  const namedGroups = Map.groupBy(explicitlyNamed, path => path.split('/').at(-1))
  const groups = Map.groupBy(unique, match => {
    const path = match.range.path
    const hasDistinctName = namedGroups.get(path.split('/').at(-1))?.length === 1
      || (path.includes('/') && containsTerm(query, normalize(path)))
    return JSON.stringify([match.clue, hasDistinctName ? path : null])
  })
  const chosen = [...groups.values()].flatMap(group => {
    const inCurrent = explicitlyNamed.length ? [] : group.filter(match => match.range.path === current)
    return [inCurrent.length === 1 ? inCurrent : group]
  })
  const dedupe = (items: typeof matches) => [...new Map(items.map(item => [JSON.stringify(item.range), item])).values()]
  const ambiguous = chosen.filter(group => group.length > 1).map(dedupe).filter(group => group.length > 1)
  return { matches: dedupe(chosen.flat()), ambiguous: dedupe(ambiguous.flat()), ambiguousClues: ambiguous.length }
}

export function mergeSourceRanges(ranges: readonly SourceRange[]) {
  const ordered = [...ranges].sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start)
  const merged: SourceRange[] = []
  for (const range of ordered) {
    const last = merged.at(-1)
    if (last?.path === range.path && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}
