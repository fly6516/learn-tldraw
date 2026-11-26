import type { ProjectFileSystem } from './types'
import { groupEnd, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'

export type ReferenceLocation = SourceLocation

export interface BibliographyEntry extends ReferenceLocation {
  key: string
  title: string
  author: string
  year: string
}

export interface CitationIssue extends ReferenceLocation {
  kind: 'missing' | 'duplicate'
  key: string
}

function blank(match: string) {
  return match.replace(/[^\r\n]/g, ' ')
}

function withoutComments(source: string) {
  return source.replace(/\\[\s\S]|%[^\r\n]*/g, match => match[0] === '%' ? blank(match) : match)
}

function bibliographyFields(body: string) {
  const metadata: Record<string, string> = { title: '', author: '', year: '' }
  const fields = /(?:^|,)\s*([a-z]+)\s*=\s*/gi
  for (const field of body.matchAll(fields)) {
    const name = field[1].toLowerCase()
    if (name !== 'title' && name !== 'author' && name !== 'year' && name !== 'date') continue
    const start = field.index + field[0].length
    const delimiter = body[start]
    const end = delimiter === '{' ? groupEnd(body, start, '{', '}')
      : delimiter === '"' ? body.indexOf('"', start + 1) : -1
    const value = end === -1 ? body.slice(start).split(',', 1)[0] : body.slice(start + 1, end)
    const key = name === 'date' ? 'year' : name
    metadata[key] ||= value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
  }
  return { title: metadata.title, author: metadata.author, year: metadata.year }
}

export function bibliographyRecords(path: string, source: string) {
  const text = withoutComments(source)
  const header = /@([a-z]+)\s*([({])/gi
  const entries: { entry: BibliographyEntry; type: string; start: number; end: number; fields: string; fieldsStart: number }[] = []
  for (let match = header.exec(text); match; match = header.exec(text)) {
    const bodyStart = header.lastIndex
    const open = match[2]
    const end = groupEnd(text, bodyStart - 1, open, open === '{' ? '}' : ')')
    if (end < 0) continue
    header.lastIndex = end + 1
    if (/^(?:comment|string|preamble)$/i.test(match[1])) continue
    const body = text.slice(bodyStart, end)
    const keyMatch = /^\s*([^\s,{}()\\%]+)\s*,/.exec(body)
    if (!keyMatch) continue
    const key = keyMatch[1]
    const start = bodyStart + keyMatch[0].indexOf(key)
    const fields = body.slice(keyMatch[0].length)
    const entry = { path, start, end: start + key.length, line: lineNumber(source, start), key, ...bibliographyFields(fields) }
    entries.push({ entry, type: match[1], start: match.index, end: end + 1, fields, fieldsStart: bodyStart + keyMatch[0].length })
  }
  return entries
}

export function parseBibliography(path: string, source: string): BibliographyEntry[] {
  return bibliographyRecords(path, source).map(record => record.entry)
}

export function bibliographyKeyUses(path: string, source: string) {
  const uses: (SourceLocation & { key: string })[] = []
  const field = /^\s*([a-z]+)\s*=\s*/i
  const keyFields = new Set(['crossref', 'xref', 'xdata', 'related', 'entryset'])
  for (const record of bibliographyRecords(path, source)) {
    const text = record.fields
    for (let cursor = 0; cursor < text.length;) {
      const match = field.exec(text.slice(cursor))
      if (!match) break
      const start = cursor + match[0].length
      let braces = 0
      let quoted = false
      let end = start
      for (; end < text.length; end++) {
        const token = text[end]
        if (token === '\\') { end++; continue }
        if (token === ',' && !braces && !quoted) break
        if (token === '"' && !braces) quoted = !quoted
        if (token === '{') braces++
        if (token === '}') braces--
      }
      cursor = end + 1
      if (!keyFields.has(match[1].toLowerCase())) continue
      const value = text.slice(start, end).trimEnd()
      const delimited = /^(\{([^{}"]*)\}|"([^{}"]*)")$/.exec(value)
      if (!delimited) continue
      const body = delimited[2] ?? delimited[3]
      if (!/^\s*[^\s,{}\\#]+\s*(?:,\s*[^\s,{}\\#]+\s*)*$/.test(body)) continue
      for (const item of body.matchAll(/[^\s,]+/g)) {
        const offset = record.fieldsStart + start + 1 + item.index
        uses.push({ path, start: offset, end: offset + item[0].length, line: lineNumber(source, offset), key: item[0] })
      }
    }
  }
  return uses
}

export function findCitations(path: string, source: string): (ReferenceLocation & { key: string })[] {
  const text = maskLatexCode(source)
  const commands = /\\(?:\\|((?:[a-z]*cite[a-z]*|nocite))\*?(?![a-zA-Z@]))/gi
  const citations: (ReferenceLocation & { key: string })[] = []
  for (let match = commands.exec(text); match; match = commands.exec(text)) {
    if (!match[1] || /^(?:setcitestyle|citestyle|citepunct|citereset|citename|citefield|citelist)$/i.test(match[1])) continue
    const multiple = /cites$/i.test(match[1])
    let cursor = commands.lastIndex
    do {
      while (/\s/.test(text[cursor] ?? '')) cursor++
      if (text[cursor] === '[' || (multiple && text[cursor] === '(')) {
        const open = text[cursor]
        cursor = groupEnd(text, cursor, open, open === '[' ? ']' : ')') + 1
        if (!cursor) break
        continue
      }
      if (text[cursor] !== '{') break
      const end = groupEnd(text, cursor, '{', '}')
      if (end < 0) break
      const body = text.slice(cursor + 1, end)
      if (!/^\s*[^\s,{}\\%]+(?:\s*,\s*[^\s,{}\\%]+)*\s*$/.test(body)) break
      for (const item of body.matchAll(/[^\s,]+/g)) {
        const key = item[0]
        if (key === '*' && match[1].toLowerCase() === 'nocite') continue
        const start = cursor + 1 + item.index
        citations.push({ path, start, end: start + key.length, line: lineNumber(source, start), key })
      }
      cursor = end + 1
      commands.lastIndex = cursor
      if (!multiple) break
    } while (cursor < text.length)
  }
  return citations
}

export function collectBibliography(project: ProjectFileSystem, active?: { path: string; source: string }) {
  return [...project.files.values()].flatMap(file =>
    'content' in file && /\.bib$/i.test(file.path)
      ? parseBibliography(file.path, file.path === active?.path ? active.source : file.content ?? '')
      : [],
  )
}

export function indexCanvasReferences(project: ProjectFileSystem, entries: BibliographyEntry[]) {
  const definitions = new Map<string, BibliographyEntry | undefined>()
  const entriesByKey = new Map<string, BibliographyEntry[]>()
  const uses = new Map<string, ReferenceLocation[]>()
  for (const entry of entries) {
    const matches = entriesByKey.get(entry.key) ?? []
    matches.push(entry)
    entriesByKey.set(entry.key, matches)
    definitions.set(entry.key, matches.length === 1 ? entry : undefined)
  }
  for (const file of project.files.values()) {
    if (!('content' in file) || !/\.tex$/i.test(file.path)) continue
    for (const citation of findCitations(file.path, file.content ?? '')) {
      const locations = uses.get(citation.key) ?? []
      locations.push(citation)
      uses.set(citation.key, locations)
    }
  }
  return { definitions, entriesByKey, uses }
}

export function checkCitations(
  project: ProjectFileSystem, entries: BibliographyEntry[], active?: { path: string; source: string },
): CitationIssue[] {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1)
  const duplicates = entries.filter(entry => (counts.get(entry.key) ?? 0) > 1)
    .map(entry => ({ ...entry, kind: 'duplicate' as const }))
  const missing = [...project.files.values()].flatMap(file => {
    if (!('content' in file) || !/\.tex$/i.test(file.path)) return []
    const source = file.path === active?.path ? active.source : file.content ?? ''
    return findCitations(file.path, source).filter(citation => !counts.has(citation.key))
      .map(citation => ({ ...citation, kind: 'missing' as const }))
  })
  return [...missing, ...duplicates]
}

export function findNewUnknownCitations(path: string, before: string, after: string, entries: BibliographyEntry[]) {
  const known = new Set(entries.map(entry => entry.key))
  const previous = new Map<string, number>()
  for (const { key } of findCitations(path, before)) previous.set(key, (previous.get(key) ?? 0) + 1)
  return findCitations(path, after).filter(({ key }) => {
    const remaining = previous.get(key) ?? 0
    if (remaining) previous.set(key, remaining - 1)
    return !known.has(key) && remaining === 0
  })
}

export function insertCitation(source: string, key: string, start: number, end: number) {
  const command = `\\cite{${key}}`
  return { source: source.slice(0, start) + command + source.slice(end), caret: start + command.length }
}

export function editorOffset(source: string, offset: number) {
  return source.slice(0, offset).replace(/\r\n/g, '\n').length
}

export function sourceOffset(source: string, offset: number) {
  for (const newline of source.matchAll(/\r\n/g)) {
    if (newline.index >= offset) break
    offset++
  }
  return offset
}
