import { z } from 'zod'
import { isProjectPath } from './source-archive'
import type { ProjectFileSystem } from './types'

const csvPrefix = 24_000
const path = z.string().max(500).refine(isProjectPath)
export const attachmentContextSchema = z.object({
  entries: z.array(z.object({ path, size: z.number().int().nonnegative().optional(), csv: z.boolean() })).max(256),
  csv: z.array(z.object({ path, text: z.string().max(csvPrefix), truncated: z.boolean() })).max(6),
  truncated: z.boolean(),
})
export type AttachmentContext = z.infer<typeof attachmentContextSchema>

export function buildAttachmentContext(project: ProjectFileSystem, request: string): AttachmentContext {
  const files = [...project.files.values()].filter(file => file.type !== 'directory' && isProjectPath(file.path)
    && file.path.length <= 500 && (file.type === 'asset' || /\.(csv|tsv|txt|md|jsonl?|toml)$/i.test(file.path)))
    .sort((left, right) => Number(request.includes(right.path)) - Number(request.includes(left.path))
      || Number(/\.csv$/i.test(right.path)) - Number(/\.csv$/i.test(left.path)) || left.path.localeCompare(right.path))
  const selected = files.slice(0, 256)
  const csv = selected.filter(file => /\.csv$/i.test(file.path) && 'content' in file && typeof file.content === 'string').slice(0, 6)
  return {
    entries: selected.map(file => ({ path: file.path, size: 'blob' in file ? file.blob?.size ?? file.size : undefined,
      csv: csv.some(source => source.path === file.path) })),
    csv: csv.flatMap(file => 'content' in file && typeof file.content === 'string'
      ? [{ path: file.path, text: file.content.slice(0, csvPrefix), truncated: file.content.length > csvPrefix }] : []),
    truncated: files.length > selected.length,
  }
}

export function readCsvRange(source: string, startRow: number, count: number, truncated: boolean) {
  const rows: { row: number; line: number; endLine: number; cells: string[]; clipped: boolean }[] = []
  let row = 1, line = 1, start = 1, field = ''
  let fields: string[] = [], quoted = false, clipped = false, used = 0
  function pushField() {
    const limit = Math.min(300, 1200 - used)
    if (fields.length >= 32 || limit <= 0) clipped = true
    else {
      const value = field.slice(0, limit)
      fields.push(value)
      used += value.length
      if (value.length < field.length) clipped = true
    }
    field = ''
  }
  function pushRow() {
    pushField()
    if (row >= startRow && row < startRow + count) rows.push({ row, line: start, endLine: line, cells: fields, clipped })
    fields = []
    used = 0
    clipped = false
    row++
  }
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let i = 0
  for (; i < text.length && row < startRow + count; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ }
      else if (quoted || !field) quoted = !quoted
      else field += char
    } else if (char === '\n') {
      if (quoted) field += char
      else pushRow()
      line++
      if (!quoted) start = line
    } else if (char === ',' && !quoted) pushField()
    else field += char
  }
  if (row < startRow + count && !truncated && !quoted && (field.length > 0 || fields.length > 0 || (text.length && !text.endsWith('\n')))) pushRow()
  return { rows, more: i < text.length || truncated, truncated: truncated || quoted }
}
