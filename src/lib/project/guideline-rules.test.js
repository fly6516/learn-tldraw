import { expect, test } from 'bun:test'
import { guidelineClauses } from './guideline-rules'
import { hasLayoutConflict, isRuleChecked, matchesStandard } from './word-layout'

test('stores the PDF page, wrapped source and semantics of lower bounds', () => {
  const text = '纸张留足空白，左侧和上方分别留 25mm\n以上间隙，下方和右侧留 2 cm 以上间隙。'
  const rules = guidelineClauses([{ page: 10, text }])
  expect(rules.left).toMatchObject({ value: 25, constraint: { kind: 'minimum' }, excerpt: { page: 10, text } })
  expect(rules.bottom).toMatchObject({ value: 20, constraint: { kind: 'minimum' } })
  expect(matchesStandard(rules.left, 31.8)).toBe(true)
  expect(matchesStandard(rules.left, 24.9)).toBe(false)
  const sample = { value: 31.8, origin: 'file', source: 'Word' }
  expect(hasLayoutConflict({ sample, chosen: sample, standard: rules.left })).toBe(false)
  expect(isRuleChecked({ chosen: sample, standard: rules.left })).toBe(true)
  const exact = { ...rules.left, constraint: undefined }
  expect(matchesStandard(exact, 31.8)).toBe(false)
})

test('records explicit alternatives from one clause without merging separate examples', () => {
  const text = '文献标注应遵照学校规定，\n可采用顺序编码制，也可采用著者－出版年制，但全文必须统一。'
  const { references, captionSeparator } = guidelineClauses([
    { page: 8, text }, { page: 9, text: '图、表一律分章编号。\n如图 x.y 和表 3.2。' },
  ])
  expect(references).toMatchObject({ constraint: { kind: 'one-of', values: ['numbered', 'author-year'] }, excerpt: { page: 8 } })
  expect(matchesStandard(references, 'author-year')).toBe(true)
  expect(matchesStandard(references, 'as-written')).toBe(false)
  expect(captionSeparator).toMatchObject({ value: 'dot', excerpt: { page: 9 } })
  expect(guidelineClauses([{ page: 2, text: '可采用顺序编码制。\n著者-出版年制参考文献表示例。' }]).references).toBeUndefined()
})
