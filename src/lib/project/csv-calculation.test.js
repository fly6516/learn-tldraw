import { expect, test } from 'bun:test'
import { assessCsvCalculation, calculateCsv } from './csv-calculation'
import { collectWritingClaims } from './writing-claims'

const path = 'data/sessions.csv'
const source = 'session,shaded_c,note\n1,10,clear\n2,12,cloudy\n3,20,rain'
const cells = [2, 3].map(row => ({ row, column: 'shaded_c' }))
const request = operation => ({ path, operation, decimals: 4, cells })

test('calculates from named columns and reports exact input lines and values', () => {
  const mean = calculateCsv('calc-1', request('mean'), source, false)
  expect(mean.result).toBe(11)
  expect(mean.inputs.map(({ line, value }) => [line, value])).toEqual([[2, 10], [3, 12]])
  expect(calculateCsv('calc-2', request('difference'), source, false).result).toBe(-2)
  expect(calculateCsv('calc-3', request('percent_change'), source, false).result).toBe(20)
  expect(() => calculateCsv('calc-4', request('percent_change'), source.replace(',10,', ',0,'), false)).toThrow('nonzero')
  expect(() => calculateCsv('calc-4', request('mean'), source.replace(',10,', ',,').replace(',12,', ',NaN,'), false)).toThrow('finite')
  expect(() => calculateCsv('calc-4', request('mean'), source.replace('note', 'shaded_c'), false)).toThrow('unambiguous')
})

test('moves with its keyed rows and invalidates only changed calculation inputs', () => {
  const mean = calculateCsv('calc-1', request('mean'), source, false)
  const project = (content, path = mean.path) => ({ files: new Map([[path, { path, content }]]) })
  const reordered = 'session,shaded_c,note\n3,200,storm\n2,12,rain\n1,10,fog'
  const followed = assessCsvCalculation(mean, project(reordered, 'data/moved.csv'), [{ from: path, to: 'data/moved.csv' }], 0)
  expect(followed.current).toBe(true)
  expect(followed.inputs.map(item => item.location.line)).toEqual([4, 3])
  expect(assessCsvCalculation(mean, project(source.replace(',10,', ',14,')), [], 0)).toMatchObject({ current: false, result: 13 })
  expect(assessCsvCalculation(mean, project(source + '\n1,11,new'), [], 0)).toMatchObject({ current: false, result: undefined })
})

test('binds a proposed result only to calculations returned by tools in the same turn', () => {
  const wording = 'The reported mean was 11 degrees.'
  const path = 'results.tex'
  const edits = [{ path, before: 'Results.', after: wording }]
  const claim = { path, quote: wording, references: [] }
  const mean = calculateCsv('calc-1', request('mean'), source, false)
  expect(collectWritingClaims(edits, [{ ...claim, calculationIds: ['calc-1'] }], [], [], [mean])[0])
    .toMatchObject({ needsConfirmation: false, calculations: [mean] })
  expect(collectWritingClaims(edits, [{ ...claim, calculationIds: ['calc-2'] }], [], [], [mean])[0].needsConfirmation).toBe(true)
})
