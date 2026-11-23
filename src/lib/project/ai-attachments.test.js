import { expect, test } from 'bun:test'
import { readCsvRange } from './ai-attachments'

test('reads CSV records with quoted delimiters and locates their physical source lines', () => {
  const result = readCsvRange('\uFEFFname,value\r\n"A, B","line one\r\nline ""two"""\r\nC,3\r\n', 2, 2, false)
  expect(result.rows).toEqual([
    { row: 2, line: 2, endLine: 3, cells: ['A, B', 'line one\nline "two"'], clipped: false },
    { row: 3, line: 4, endLine: 4, cells: ['C', '3'], clipped: false },
  ])
  expect(result.more).toBe(false)
  expect(readCsvRange('a,b\n1,2\n3,4', 2, 4, true).rows.map(row => row.cells)).toEqual([['1', '2']])
})
