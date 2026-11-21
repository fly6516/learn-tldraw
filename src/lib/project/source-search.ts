import type { SourceLocation } from './latex-source'
import type { ProjectFileSystem } from './types'
import { literalSearchPattern } from './text-search'

export type SourceMatch = SourceLocation & {
  name: string
  before: string
  match: string
  after: string
}

export const sourceSearchLimit = 200

export function searchProjectSources(files: ProjectFileSystem['files'], query: string) {
  const matches: SourceMatch[] = []
  if (!query.trim() || /[\r\n]/.test(query)) return { matches, limited: false }

  const pattern = literalSearchPattern(query, 'giu')
  const sources = [...files.values()].filter(file => /\.(tex|bib)$/i.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path))

  for (const file of sources) {
    if (!('content' in file) || typeof file.content !== 'string') continue
    const { path, name, content } = file
    const lineBreak = /\r\n|\r|\n/g
    let nextBreak: RegExpExecArray | null | undefined
    let line = 1
    let lineStart = content.charCodeAt(0) === 0xfeff ? 1 : 0

    for (const hit of content.matchAll(pattern)) {
      const start = hit.index
      if (start < lineStart) continue
      if (matches.length === sourceSearchLimit) return { matches, limited: true }
      if (nextBreak === undefined) nextBreak = lineBreak.exec(content)
      while (nextBreak && nextBreak.index < start) {
        line++
        lineStart = lineBreak.lastIndex
        nextBreak = lineBreak.exec(content)
      }
      const end = start + hit[0].length
      const lineEnd = nextBreak?.index ?? content.length
      const beforeStart = Math.max(lineStart, start - 32)
      const afterEnd = Math.min(lineEnd, end + 48)
      matches.push({
        path, name, line, start, end,
        before: (beforeStart > lineStart ? '…' : '') + content.slice(beforeStart, start),
        match: hit[0],
        after: content.slice(end, afterEnd) + (afterEnd < lineEnd ? '…' : ''),
      })
    }
  }

  return { matches, limited: false }
}
