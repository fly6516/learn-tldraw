import { tool } from 'ai'
import { z } from 'zod'
import type { ChapterEditRequest, chapterAnswerSchema } from './ai-edit'
import { indexLatexLabels } from './latex-source'
import { parseBibliography } from './references'
import { searchProjectSources } from './source-search'
import type { ProjectFileSystem } from './types'
import { captureEvidenceQuote, type EvidenceQuote } from './writing-ai-evidence'
import { readCsvRange, type AttachmentContext, type CsvWindow } from './ai-attachments'
import type { ClaimReference } from './writing-claims'
import { calculateCsv, calculateCsvWindow, csvCalculationRequest, type CsvCalculation } from './csv-calculation'
import { excerptEnd, type SourceExcerpt } from './ai-source-ranges'

type Answer = z.infer<typeof chapterAnswerSchema>
const query = z.string().trim().min(1).max(100)
const pathName = z.string().min(1).max(500)

export function createChapterTools(input: ChapterEditRequest, attachments?: AttachmentContext, excerpts: SourceExcerpt[] = []) {
  const excerptPaths = new Set(excerpts.map(excerpt => excerpt.path))
  const sources = new Map(input.context.filter(file => !excerptPaths.has(file.path)).map(file => [file.path, file] as const))
  if (!excerptPaths.has(input.path)) sources.set(input.path, { path: input.path, source: input.source, truncated: false })
  const files: ProjectFileSystem['files'] = new Map([...sources].map(([path, file]) => [path,
    { path, name: path.split('/').at(-1) ?? path, type: 'editable', content: file.source }]))
  const evidence: (Answer['evidence'][number] & { anchor?: EvidenceQuote })[] = []
  const claimEvidence: ClaimReference[] = []
  const calls: Answer['tools'] = []
  const observed = new Set<string>()
  const readFiles = new Set<string>()
  const calculations: CsvCalculation[] = []
  const csv = new Map(attachments?.csv.map(file => [file.path, file]))
  const windows = new Map(attachments?.csvWindows?.map(window => [window.path, window]))
  function sourceLabels() {
    const full = [...sources.values()].filter(file => /\.tex$/i.test(file.path)).map(file => ({ ...file, start: 1 }))
    const labels = [...full, ...excerpts].flatMap(file => [...indexLatexLabels([[file.path, file.source]])].flatMap(([key, locations]) =>
      locations.map(({ path, line }) => ({ key, path, line: line + file.start - 1 }))))
    return Map.groupBy(labels, item => item.key)
  }
  function record(kind: Answer['tools'][number], items: { path: string; line: number; text: string; anchor?: EvidenceQuote }[], linkClaim = true, csvHeader?: string[]) {
    if (calls.length === 80) return { error: 'Tool call limit reached.' }
    calls.push(kind)
    const output = items.map(({ path, line, text }) => ({ path, line, text: text.slice(0, 500) }))
    for (const item of output) {
      observed.add(`${item.path}:${item.line}`)
      const referenceKind = kind === 'read_csv_rows' ? 'data'
        : kind === 'query_references' && /\.bib$/i.test(item.path) ? 'bibliography'
          : kind === 'read_source' && /(?<!\\)&|\\(?:caption|begin\{tabular)/.test(item.text) ? 'table' : undefined
      const excerpt = excerpts.find(entry => entry.path === item.path && item.line >= entry.start && item.line <= excerptEnd(entry))
      const source = excerpt?.source ?? sources.get(item.path)?.source ?? csv.get(item.path)?.text
      const anchor = windows.get(item.path)?.rows.find(row => row.line === item.line)?.anchor
        ?? (source === undefined ? undefined : captureEvidenceQuote(item.path, source, item.line - (excerpt ? excerpt.start - 1 : 0)))
      if (evidence.length < 40 && !evidence.some(found => found.path === item.path && found.line === item.line && found.kind === kind)) evidence.push({ ...item, kind, anchor })
      if (linkClaim && referenceKind && claimEvidence.length < 72 && !claimEvidence.some(found => found.path === item.path && found.line === item.line)) {
        claimEvidence.push({ ...item, kind: referenceKind, anchor, ...(referenceKind === 'data' && csvHeader ? { csvHeader } : {}) })
      }
    }
    return { items: output }
  }

  function readAttachmentRows(path: string, startRow: number, rowCount: number) {
    const source = csv.get(path)
    const window = windows.get(path)
    if (window) return readWindow(window, startRow, rowCount)
    if (!source) return { unavailable: 'This CSV is outside the readable attachment snapshot.' }
    const result = readCsvRange(source.text, startRow, rowCount, source.truncated)
    const header = readCsvRange(source.text, 1, 1, source.truncated).rows[0]
    const citations = record('read_csv_rows', result.rows.map(row => ({ path, line: row.line, text: JSON.stringify(row.cells) })),
      true, header && !header.clipped ? header.cells : undefined)
    return { path, header, ...result, ...citations }
  }

  function readWindow(window: CsvWindow, startRow: number, rowCount: number) {
    const { path, header } = window
    const rows = (startRow === 1 ? [header, ...window.rows.filter(row => row.row !== 1)] : window.rows)
      .filter(row => row.row >= startRow && row.row < startRow + rowCount)
      .map(({ row, line, endLine, cells, clipped }) => ({ row, line, endLine, cells, clipped }))
    const citations = record('read_csv_rows', rows.map(row => ({ path, line: row.line, text: JSON.stringify(row.cells) })),
      true, header.cells)
    return { path, header, rows, truncated: true, more: true, ...citations,
      ...(rows.length ? {} : { unavailable: 'Those rows are outside the approved CSV excerpt.' }) }
  }

  function readSharedExcerpts() {
    return excerpts.map(excerpt => {
      const lines = excerpt.source.split(/\r\n|\r|\n/)
      const items = lines.slice(0, 8).map((text, index) => ({
        path: excerpt.path, line: excerpt.start + index, text,
      }))
      readFiles.add(excerpt.path)
      return { path: excerpt.path, start: excerpt.start, end: excerptEnd(excerpt), ...record('read_source', items) }
    })
  }

  return { calls, evidence, claimEvidence, calculations, observed, readFiles, readAttachmentRows, readSharedExcerpts, tools: {
    ...(attachments ? {
      list_attachments: tool({
        description: 'List local project attachments by path, including figures and datasets. Only CSV files marked csv are readable. This does not inspect image contents.',
        inputSchema: z.object({ query: z.string().max(100).optional() }),
        execute: async ({ query }) => {
          const found = attachments.entries.filter(entry => !query || entry.path.toLowerCase().includes(query.toLowerCase()))
          return { files: found.slice(0, 40), truncated: attachments.truncated || found.length > 40 }
        },
      }),
      read_csv_rows: tool({
        description: 'Read CSV records by one-based row number, including row 1 for headers. Cite the returned project path and physical line numbers. Truncated data do not support whole-file claims.',
        inputSchema: z.object({ path: pathName, startRow: z.number().int().min(1).max(999_999), rowCount: z.number().int().min(1).max(12) }),
        execute: async ({ path, startRow, rowCount }) => readAttachmentRows(path, startRow, rowCount),
      }),
      calculate_csv: tool({
        description: 'Calculate a mean, a difference (first minus second), or percent change ((second minus first) divided by first times 100) from named columns in explicit CSV records. Row numbering includes the header as row 1. Return the calculation ID with a proposed claim using the result.',
        inputSchema: csvCalculationRequest,
        execute: async request => {
          const source = csv.get(request.path)
          const window = windows.get(request.path)
          if ((!source && !window) || calculations.length >= 8) return { error: 'The CSV or calculation capacity is unavailable.' }
          try {
            const id = 'calc-' + (calculations.length + 1)
            const result = window ? calculateCsvWindow(id, request, window) : calculateCsv(id, request, source!.text, source!.truncated)
            calculations.push(result)
            record('read_csv_rows', result.inputs.map(input => ({ path: request.path, line: input.line, text: `${input.column} = ${input.raw}` })), false)
            return result
          } catch (cause) { return { error: cause instanceof Error ? cause.message : 'Could not read the selected cells.' } }
        },
      }),
    } : {}),
    search_source: tool({
      description: 'Find literal text across the allowed .tex and .bib files. Read the relevant lines with read_source after searching.',
      inputSchema: z.object({ query }),
      execute: async args => {
        const result = searchProjectSources(files, args.query)
        const partial = excerpts.flatMap(excerpt => searchProjectSources(new Map([[excerpt.path,
          { path: excerpt.path, name: excerpt.path, type: 'editable', content: excerpt.source }]]), args.query).matches
          .map(hit => ({ ...hit, line: hit.line + excerpt.start - 1 })))
        const matches = [...partial, ...result.matches]
        return { ...record('search_source', matches.slice(0, 8).map(hit => ({ path: hit.path, line: hit.line, text: hit.before + hit.match + hit.after }))),
          limited: result.limited || matches.length > 8 }
      },
    }),
    read_source: tool({
      description: 'Read a bounded line range in an allowed project source file. Use original file line numbers from sourceRanges. To continue reading a long line in a shared range, set lineCount to 1 and specify the next startColumn.',
      inputSchema: z.object({ path: pathName, startLine: z.number().int().min(1).max(1_000_000), lineCount: z.number().int().min(1).max(16),
        startColumn: z.number().int().min(1).max(24_000).optional() }),
      execute: async args => {
        const source = sources.get(args.path)
        const shared = excerpts.find(entry => entry.path === args.path && args.startLine >= entry.start && args.startLine <= excerptEnd(entry))
        const start = args.startLine - (shared?.start ?? 1)
        const lines = (shared?.source ?? source?.source)?.split(/\r\n|\r|\n/)
        const excerpt = lines?.slice(start, start + args.lineCount) ?? []
        const items = excerpt.map((text, index) => ({ path: args.path, line: args.startLine + index, text }))
        if (items.length) readFiles.add(args.path)
        const recorded = record('read_source', items)
        const column = (args.startColumn ?? 1) - 1
        return { ...recorded, ...(shared && !('error' in recorded) ? { items: items.map(item => ({
          ...item, text: item.text.slice(column, column + 1500),
          ...(item.text.length > column + 1500 ? { nextColumn: column + 1501 } : {}),
        })) } : {}),
          truncated: Boolean(shared || source?.truncated || excerpt.some(line => line.length > 500)),
          ...(source || shared ? {} : { unavailable: 'Line range not in the shared project snapshot.' }) }
      },
    }),
    query_references: tool({
      description: 'Find project bibliography entries or LaTeX labels by a key, title, or author. Use existing keys only.',
      inputSchema: z.object({ query, kind: z.enum(['bibliography', 'labels']) }),
      execute: async args => {
        const value = args.query.toLowerCase()
        const matches = args.kind === 'bibliography'
          ? [...sources.values()].flatMap(file => /\.bib$/i.test(file.path) ? parseBibliography(file.path, file.source) : [])
            .filter(entry => [entry.key, entry.title, entry.author, entry.year].join(' ').toLowerCase().includes(value))
            .map(entry => ({ path: entry.path, line: entry.line, text: [entry.key, entry.title, entry.author, entry.year].filter(Boolean).join(' · ') }))
          : [...sourceLabels()]
            .filter(([key]) => key.toLowerCase().includes(value)).flatMap(([key, found]) => found.map(location => ({
              path: location.path, line: location.line, text: found.length > 1 ? `${key} · duplicate label` : key,
            })))
        return { ...record('query_references', matches.slice(0, 8)), limited: matches.length > 8 }
      },
    }),
    compile_diagnostics: tool({
      description: 'Read recorded compile diagnostics. A stale report is previous-build evidence only.',
      inputSchema: z.object({}),
      execute: async () => {
        const compiler = input.compiler
        const items = compiler.diagnostics.filter(issue => sources.has(issue.path) || excerptPaths.has(issue.path)).slice(0, 12).map(issue => ({
          path: issue.path, line: issue.line, text: `${issue.severity}: ${issue.message}`,
        }))
        return { ...record('compile_diagnostics', compiler.state === 'current' ? items : []), state: compiler.state, main: compiler.main,
          ...(compiler.state === 'current' ? { log: compiler.log, limited: compiler.diagnostics.length > items.length } : {}) }
      },
    }),
  } }
}
