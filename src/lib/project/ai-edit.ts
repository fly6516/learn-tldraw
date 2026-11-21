import { z } from 'zod'
import type { ProjectFileSystem } from './types'

export const maxChapterLength = 24_000
const maxContextFiles = 12
const maxContextFileLength = 6_000
const contextExtensions = /\.(tex|bib|cls|sty|bst|ltx|tikz|def|cfg)$/i

export const editRequestSchema = z.object({
  mode: z.enum(['review', 'rewrite']),
  path: z.string().max(500),
  main: z.string().max(500),
  source: z.string().min(1).max(maxChapterLength),
  instruction: z.string().max(1000),
  log: z.string().max(4000),
  context: z.array(z.object({
    path: z.string().max(500),
    source: z.string().max(maxContextFileLength),
    truncated: z.boolean(),
  })).max(maxContextFiles),
})

export const suggestionSchema = z.object({
  summary: z.string().min(1).max(4000),
  edits: z.array(z.object({
    before: z.string().min(1).max(maxChapterLength),
    after: z.string().max(maxChapterLength),
  })).max(20),
})

export type ChapterEditRequest = z.infer<typeof editRequestSchema>
export type ChapterSuggestion = z.infer<typeof suggestionSchema>

export function buildChapterContext(project: ProjectFileSystem, selected: string, main: string) {
  const context: ChapterEditRequest['context'] = []
  const paths = new Set<string>([selected])
  const directory = selected.slice(0, selected.lastIndexOf('/') + 1)
  const entries = [...project.files.values()].sort((a, b) => a.path.localeCompare(b.path))
  const candidates = [
    project.files.get(main),
    ...entries.filter(file => /\.(bib|cls|sty)$/i.test(file.path) || /(?:^|\/)(preamble|macros)\.tex$/i.test(file.path)),
    ...entries.filter(file => file.path.startsWith(directory) && /\.tex$/i.test(file.path)),
    ...entries,
  ]
  for (const file of candidates) {
    if (!file || !('content' in file) || !file.content || paths.has(file.path)
      || file.path.length > 500 || !contextExtensions.test(file.path)) continue
    paths.add(file.path)
    context.push({
      path: file.path, source: file.content.slice(0, maxContextFileLength),
      truncated: file.content.length > maxContextFileLength,
    })
    if (context.length === maxContextFiles) break
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
