import { expect, test } from 'bun:test'
import { splitReviewLetter } from './review-letter'

test('groups a review letter without dropping unassigned text or nested notes', () => {
  expect(splitReviewLetter(`Dear authors, please reply online.
Editor decision: Explain the scope.
Reviewer #1:
1. Describe sampling.
   1. Give the date range.
2) Give sample sizes.
## Reviewer 2
- Check the units.`)).toEqual([
    { reviewer: '', text: 'Dear authors, please reply online.' },
    { reviewer: 'Editor', text: 'Explain the scope.' },
    { reviewer: 'Reviewer 1', text: 'Describe sampling.\n   1. Give the date range.' },
    { reviewer: 'Reviewer 1', text: 'Give sample sizes.' },
    { reviewer: 'Reviewer 2', text: 'Check the units.' },
  ])
})

test('supports Chinese headings, CRLF mail and prose without a recognized heading', () => {
  expect(splitReviewLetter('**主编意见：** 请补充说明。\r\n审稿人二：\r\n（1）交代样本范围。\r\n2、核对单位。')).toEqual([
    { reviewer: '主编', text: '请补充说明。' },
    { reviewer: '审稿人 二', text: '交代样本范围。' },
    { reviewer: '审稿人 二', text: '核对单位。' },
  ])
  expect(splitReviewLetter('Literal prose: a sentence.\n\nAnother paragraph.')).toEqual([
    { reviewer: '', text: 'Literal prose: a sentence.\n\nAnother paragraph.' },
  ])
  expect(splitReviewLetter('Reviewer 1:\n\n')).toEqual([])
  expect(() => splitReviewLetter(Array.from({ length: 101 }, (_, i) => `${i + 1}. Point`).join('\n'))).toThrow('100 comments')
})
