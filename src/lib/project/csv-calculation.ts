import { z } from 'zod'
import { readCsvRange } from './ai-attachments'
import { isProjectPath } from './source-archive'
import type { ProjectFileSystem } from './types'
import { captureEvidenceQuote, locateEvidence, type SourceMove } from './writing-ai-evidence'

const operation = z.enum(['mean', 'difference', 'percent_change'])
const path = z.string().max(500).refine(isProjectPath)
const column = z.string().min(1).max(240)
const cell = z.object({ row: z.number().int().min(2).max(24_000), column })
export const csvCalculationRequest = z.object({
  path, operation, cells: z.array(cell).min(1).max(12), decimals: z.number().int().min(0).max(8).default(4),
})
export const csvCalculationSchema = csvCalculationRequest.omit({ cells: true }).extend({
  id: z.string().regex(/^calc-[1-9]\d*$/), result: z.number().finite(),
  inputs: z.array(cell.extend({
    line: z.number().int().positive(), raw: z.string().max(300), value: z.number().finite(),
    key: z.object({ column, value: z.string().max(300) }).optional(),
    anchor: z.object({ quote: z.string().max(500), before: z.string().max(48), after: z.string().max(48),
      requireContext: z.boolean().optional(), wholeLine: z.boolean().optional() }).optional(),
  })).min(1).max(12),
})
export type CsvCalculation = z.infer<typeof csvCalculationSchema>

function calculate(operation: CsvCalculation['operation'], values: number[], decimals: number) {
  if (operation !== 'mean' && values.length !== 2) throw new Error('This calculation requires exactly two cells.')
  if (operation === 'percent_change' && values[0] === 0) throw new Error('Percent change requires a nonzero first value.')
  const value = operation === 'mean' ? values.reduce((sum, current) => sum + current / values.length, 0)
    : operation === 'difference' ? values[0] - values[1] : (values[1] - values[0]) / values[0] * 100
  if (!Number.isFinite(value)) throw new Error('The calculated result is outside the supported numeric range.')
  return Number(value.toFixed(decimals))
}

function numericCell(raw: string | undefined) {
  const value = raw?.trim()
  if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) {
    throw new Error('Select cells containing finite decimal numbers.')
  }
  return Number(value)
}

function uniqueColumn(values: string[], column: string) {
  const index = values.indexOf(column)
  return index >= 0 && index === values.lastIndexOf(column) ? index : -1
}

function records(source: string, truncated: boolean) {
  return readCsvRange(source.slice(0, 24_000), 1, 24_000, truncated || source.length > 24_000).rows
}

export function calculateCsv(id: string, request: z.infer<typeof csvCalculationRequest>, source: string, truncated: boolean): CsvCalculation {
  const [header, ...rows] = records(source, truncated)
  if (!header || header.clipped) throw new Error('A complete CSV header is required.')
  const inputs = request.cells.map(cell => {
    const row = rows.find(row => row.row === cell.row)
    const column = uniqueColumn(header.cells, cell.column)
    if (!row || row.clipped || column < 0) throw new Error('Use an available row and an unambiguous column name.')
    const raw = row.cells[column]
    const value = numericCell(raw)
    const keyColumn = header.cells[0]
    const key = !truncated && source.length <= 24_000 && keyColumn && keyColumn.length <= 240 && uniqueColumn(header.cells, keyColumn) === 0 && row.cells[0]
      && rows.filter(item => item.cells[0] === row.cells[0]).length === 1 ? { column: keyColumn, value: row.cells[0] } : undefined
    return { ...cell, line: row.line, raw, value, key, anchor: captureEvidenceQuote(request.path, source, row.line) }
  })
  return { id, path: request.path, operation: request.operation, decimals: request.decimals, inputs,
    result: calculate(request.operation, inputs.map(input => input.value), request.decimals) }
}

export function assessCsvCalculation(item: CsvCalculation, project: ProjectFileSystem, moves: readonly SourceMove[], revision?: number) {
  const from = revision ?? (moves.length ? undefined : 0)
  const path = from === undefined || from > moves.length ? undefined
    : moves.slice(from).reduce((path, move) => path === move.from ? move.to : path, item.path)
  const file = path ? project.files.get(path) : undefined
  const source = file && 'content' in file ? file.content : undefined
  const [header, ...rows] = source ? records(source, false) : []
  const inputs = item.inputs.map(input => {
    if (!header || header.clipped || !path) return {}
    const column = uniqueColumn(header.cells, input.column)
    const keyColumn = input.key ? uniqueColumn(header.cells, input.key.column) : -1
    const anchor = !input.key ? locateEvidence(project, { path: item.path, anchor: input.anchor }, moves, from) : undefined
    const matches = input.key && keyColumn >= 0 && source && source.length <= 24_000
      ? rows.filter(row => row.cells[keyColumn] === input.key?.value) : rows.filter(row => row.line === anchor?.line)
    const row = matches.length === 1 && !matches[0].clipped ? matches[0] : undefined
    const value = column >= 0 ? row?.cells[column] : undefined
    return { value, location: value !== undefined && row ? { path, line: row.line } : undefined }
  })
  let result: number | undefined
  try { result = calculate(item.operation, inputs.map(input => numericCell(input.value)), item.decimals) } catch { /* Unavailable inputs. */ }
  return { inputs, result, current: result === item.result && inputs.every((input, i) => input.value === item.inputs[i].raw) }
}
