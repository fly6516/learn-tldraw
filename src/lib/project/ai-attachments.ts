import { z } from 'zod'
import { isProjectPath } from './source-archive'
import type { ProjectFileSystem } from './types'
import { captureEvidenceQuote } from './writing-ai-evidence'

const csvPrefix = 24_000
const path = z.string().max(500).refine(isProjectPath)
const csvRowSchema = z.object({
  row: z.number().int().positive(), line: z.number().int().positive(), endLine: z.number().int().positive(),
  cells: z.array(z.string().max(300)).max(32), clipped: z.boolean(),
})
const csvWindowSchema = z.object({
  path, header: csvRowSchema, rows: z.array(csvRowSchema.extend({
    anchor: z.object({ quote: z.string().max(500), before: z.string().max(48), after: z.string().max(48),
      requireContext: z.boolean().optional(), wholeLine: z.boolean().optional() }).optional(),
  })).min(1).max(12),
})
export type CsvWindow = z.infer<typeof csvWindowSchema>
export const attachmentContextSchema = z.object({
  entries: z.array(z.object({ path, size: z.number().int().nonnegative().optional(), csv: z.boolean() })).max(256),
  csv: z.array(z.object({ path, text: z.string().max(csvPrefix), truncated: z.boolean() })).max(6),
  csvWindows: z.array(csvWindowSchema).max(6).optional(),
  truncated: z.boolean(),
})
export type AttachmentContext = z.infer<typeof attachmentContextSchema>

export function buildAttachmentContext(project: ProjectFileSystem, request: string,
  planned: readonly { path: string; startRow: number; rowCount: number }[] = []): AttachmentContext {
  const files = [...project.files.values()].filter(file => file.type !== 'directory' && isProjectPath(file.path)
    && file.path.length <= 500 && (file.type === 'asset' || /\.(csv|tsv|txt|md|jsonl?|toml)$/i.test(file.path)))
    .sort((left, right) => Number(request.includes(right.path)) - Number(request.includes(left.path))
      || Number(/\.csv$/i.test(right.path)) - Number(/\.csv$/i.test(left.path)) || left.path.localeCompare(right.path))
  const selected = files.slice(0, 256)
  const csv = selected.filter(file => /\.csv$/i.test(file.path) && 'content' in file && typeof file.content === 'string').slice(0, 6)
  const requested = /(?:\brows?\s+|第\s*)([1-9]\d{0,5})(?:\s*(?:through|to|–|-|到|至)\s*([1-9]\d{0,5}))?/i.exec(request)
  const requestedWindows = new Set<string>()
  const csvWindows = csv.flatMap(file => {
    if (!('content' in file) || !file.content || file.content.length <= csvPrefix) return []
    const range = planned.find(item => item.path === file.path)
    if (!range && (!requested || !request.includes(file.path))) return []
    requestedWindows.add(file.path)
    const start = range?.startRow ?? Number(requested?.[1])
    const count = Math.max(1, Math.min(12, range?.rowCount ?? (Number(requested?.[2] ?? start) - start + 1)))
    const source = file.content.slice(0, 8_000_000)
    const truncated = source.length < file.content.length
    const header = readCsvRange(source, 1, 1, truncated).rows[0]
    const rows = readCsvRange(source, start, count, truncated).rows.map(row => {
      const anchor = captureEvidenceQuote(file.path, source, row.line)
      return { ...row, anchor: anchor && !anchor.requireContext ? { ...anchor, before: '', after: '' } : undefined }
    })
    return header && !header.clipped && rows.length ? [{ path: file.path, header, rows }] : []
  })
  return {
    entries: selected.map(file => ({ path: file.path, size: 'blob' in file ? file.blob?.size ?? file.size : undefined,
      csv: csv.some(source => source.path === file.path && !requestedWindows.has(source.path)) || csvWindows.some(window => window.path === file.path) })),
    csv: csv.flatMap(file => 'content' in file && typeof file.content === 'string' && !requestedWindows.has(file.path)
      ? [{ path: file.path, text: file.content.slice(0, csvPrefix), truncated: file.content.length > csvPrefix }] : []),
    ...(csvWindows.length ? { csvWindows } : {}),
    truncated: files.length > selected.length,
  }
}

export function readCsvRange(source: string, startRow: number, count: number, truncated: boolean, physicalLine?: number) {
  const rows: z.infer<typeof csvRowSchema>[] = []
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
    if (physicalLine === undefined ? row >= startRow && row < startRow + count : start === physicalLine) {
      rows.push({ row, line: start, endLine: line, cells: fields, clipped })
    }
    fields = []
    used = 0
    clipped = false
    row++
  }
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let i = 0
  const withinRange = () => physicalLine === undefined ? row < startRow + count : start <= physicalLine && !rows.length
  for (; i < text.length && withinRange(); i++) {
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
  if (withinRange() && !truncated && !quoted && (field.length > 0 || fields.length > 0 || (text.length && !text.endsWith('\n')))) pushRow()
  return { rows, more: i < text.length || truncated, truncated: truncated || quoted }
}
