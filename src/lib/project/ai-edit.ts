import { z } from 'zod'
import type { ProjectFileSystem } from './types'

export const maxChapterLength = 24_000
const maxContextFiles = 48
const maxContextFileLength = 32_000
const maxContextLength = 240_000
const contextExtensions = /\.(tex|bib|cls|sty|bst|ltx|tikz|def|cfg)$/i

export const editRequestSchema = z.object({
  mode: z.enum(['review', 'rewrite', 'project-review', 'project-rewrite']),
  path: z.string().max(500),
  main: z.string().max(500),
  source: z.string().min(1).max(maxChapterLength),
  instruction: z.string().max(1000),
  projectPaths: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
  compiler: z.object({
    state: z.enum(['unavailable', 'current', 'stale']),
    main: z.string().max(500).optional(),
    diagnostics: z.array(z.object({ path: z.string().max(500), line: z.number().int().positive(),
      severity: z.enum(['error', 'warning']), message: z.string().max(500) })).max(40),
    log: z.string().max(4000),
  }),
  context: z.array(z.object({
    path: z.string().max(500),
    source: z.string().max(maxContextFileLength),
    truncated: z.boolean(),
  })).max(maxContextFiles),
}).refine(request => request.context.reduce((size, file) => size + file.source.length, 0) <= maxContextLength)

export const suggestionSchema = z.object({
  summary: z.string().min(1).max(4000),
  edits: z.array(z.object({
    before: z.string().min(1).max(maxChapterLength),
    after: z.string().max(maxChapterLength),
  })).max(20),
})

export type ChapterEditRequest = z.infer<typeof editRequestSchema>
export type ChapterSuggestion = z.infer<typeof suggestionSchema>
export const chapterTools = ['search_source', 'read_source', 'query_references', 'compile_diagnostics', 'read_csv_rows'] as const
export const chapterAnswerSchema = suggestionSchema.extend({
  tools: z.array(z.enum(chapterTools)).max(80),
  evidence: z.array(z.object({ path: z.string().max(500), line: z.number().int().positive(),
    text: z.string().max(500), kind: z.enum(chapterTools) })).max(40),
})

export const projectSuggestionSchema = z.object({
  summary: suggestionSchema.shape.summary,
  findings: z.array(z.object({ message: z.string().min(1).max(1000),
    locations: z.array(z.object({ path: z.string().max(500), line: z.number().int().positive() })).min(1).max(4) })).max(12),
  edits: z.array(suggestionSchema.shape.edits.element.extend({ path: z.string().min(1).max(500) })).max(20),
})

export const projectAnswerSchema = projectSuggestionSchema.extend({ tools: chapterAnswerSchema.shape.tools, evidence: chapterAnswerSchema.shape.evidence })
export type ProjectSuggestion = z.infer<typeof projectSuggestionSchema>

export function applyProjectEdits(sources: ReadonlyMap<string, string>, edits: ProjectSuggestion['edits']) {
  const grouped = new Map<string, ProjectSuggestion['edits']>()
  for (const edit of edits) {
    if (!sources.has(edit.path)) throw new Error(`This file is outside the selected edit scope: ${edit.path}`)
    const group = grouped.get(edit.path) ?? []
    group.push(edit)
    grouped.set(edit.path, group)
  }
  return new Map([...grouped].map(([path, edits]) => [path, applyChapterEdits(sources.get(path)!, edits)]))
}

export function buildChapterContext(project: ProjectFileSystem, selected: string, main: string, priority: readonly string[] = []) {
  const context: ChapterEditRequest['context'] = []
  const paths = new Set<string>([selected])
  let remaining = maxContextLength
  const directory = selected.slice(0, selected.lastIndexOf('/') + 1)
  const entries = [...project.files.values()].sort((a, b) => a.path.localeCompare(b.path))
  const candidates = [
    ...priority.map(path => project.files.get(path)),
    project.files.get(main),
    ...entries.filter(file => /\.(bib|cls|sty)$/i.test(file.path) || /(?:^|\/)(preamble|macros)\.tex$/i.test(file.path)),
    ...entries.filter(file => file.path.startsWith(directory) && /\.tex$/i.test(file.path)),
    ...entries,
  ]
  for (const file of candidates) {
    if (!file || !('content' in file) || !file.content || paths.has(file.path)
      || file.path.length > 500 || !contextExtensions.test(file.path)) continue
    paths.add(file.path)
    const source = file.content.slice(0, Math.min(maxContextFileLength, remaining))
    remaining -= source.length
    context.push({
      path: file.path, source,
      truncated: source.length < file.content.length,
    })
    if (context.length === maxContextFiles || !remaining) break
  }
  return context
}

export function applyChapterEdits(source: string, edits: ChapterSuggestion['edits']): string {
  const ranges = edits.map(edit => {
    const start = source.indexOf(edit.before)
    if (start < 0 || source.indexOf(edit.before, start + 1) >= 0) {
      throw new Error('A proposed edit does not match a unique part of the current chapter.')
    }
    return { ...edit, start, end: start + edit.before.length }
  }).sort((a, b) => a.start - b.start)

  let result = ''
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) throw new Error('The proposed edits overlap.')
    result += source.slice(cursor, range.start) + range.after
    cursor = range.end
  }
  return result + source.slice(cursor)
}
