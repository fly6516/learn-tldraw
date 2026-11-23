import { tool } from 'ai'
import { z } from 'zod'
import type { ChapterEditRequest, chapterAnswerSchema } from './ai-edit'
import { indexLatexLabels } from './latex-source'
import { parseBibliography } from './references'
import { searchProjectSources } from './source-search'
import type { ProjectFileSystem } from './types'
import { captureEvidenceQuote, type EvidenceQuote } from './writing-ai-evidence'

type Answer = z.infer<typeof chapterAnswerSchema>
const query = z.string().trim().min(1).max(100)
const pathName = z.string().min(1).max(500)

export function createChapterTools(input: ChapterEditRequest) {
  const sources = new Map([...input.context.map(file => [file.path, file] as const),
    [input.path, { path: input.path, source: input.source, truncated: false }]])
  const files: ProjectFileSystem['files'] = new Map([...sources].map(([path, file]) => [path,
    { path, name: path.split('/').at(-1) ?? path, type: 'editable', content: file.source }]))
  const evidence: (Answer['evidence'][number] & { anchor?: EvidenceQuote })[] = []
  const calls: Answer['tools'] = []
  const observed = new Set<string>()
  const readFiles = new Set<string>()
  function record(kind: Answer['tools'][number], items: { path: string; line: number; text: string }[]) {
    if (calls.length === 80) return { error: 'Tool call limit reached.' }
    calls.push(kind)
    const output = items.map(item => ({ ...item, text: item.text.slice(0, 500) }))
    for (const item of output) {
      observed.add(`${item.path}:${item.line}`)
      if (evidence.length < 40 && !evidence.some(found => found.path === item.path && found.line === item.line && found.kind === kind)) {
        const source = sources.get(item.path)?.source
        evidence.push({ ...item, kind, anchor: source === undefined ? undefined : captureEvidenceQuote(item.path, source, item.line) })
      }
    }
    return { items: output }
  }

  return { calls, evidence, observed, readFiles, tools: {
    search_source: tool({
      description: 'Find literal text across the allowed .tex and .bib files. Read the relevant lines with read_source after searching.',
      inputSchema: z.object({ query }),
      execute: async args => {
        const result = searchProjectSources(files, args.query)
        return { ...record('search_source', result.matches.slice(0, 8).map(hit => ({ path: hit.path, line: hit.line, text: hit.before + hit.match + hit.after }))),
          limited: result.limited || result.matches.length > 8 }
      },
    }),
    read_source: tool({
      description: 'Read a bounded line range in an allowed project source file. Paths must match the supplied inventory.',
      inputSchema: z.object({ path: pathName, startLine: z.number().int().min(1).max(40_000), lineCount: z.number().int().min(1).max(16) }),
      execute: async args => {
        const source = sources.get(args.path)
        const start = args.startLine - 1
        const lines = source?.source.split(/\r\n|\r|\n/)
        const excerpt = lines?.slice(start, start + args.lineCount) ?? []
        const items = excerpt.map((text, index) => ({ path: args.path, line: args.startLine + index, text }))
        if (items.length) readFiles.add(args.path)
        return { ...record('read_source', items), truncated: Boolean(source?.truncated || excerpt.some(line => line.length > 500)),
          ...(source ? {} : { unavailable: 'Path not in the allowed project snapshot.' }) }
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
          : [...indexLatexLabels([...sources.values()].filter(file => /\.tex$/i.test(file.path)).map(file => [file.path, file.source]))]
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
        const items = compiler.diagnostics.filter(issue => sources.has(issue.path)).slice(0, 12).map(issue => ({
          path: issue.path, line: issue.line, text: `${issue.severity}: ${issue.message}`,
        }))
        return { ...record('compile_diagnostics', compiler.state === 'current' ? items : []), state: compiler.state, main: compiler.main,
          ...(compiler.state === 'current' ? { log: compiler.log, limited: compiler.diagnostics.length > items.length } : {}) }
      },
    }),
  } }
}
