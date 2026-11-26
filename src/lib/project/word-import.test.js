import { expect, test } from 'bun:test'
import { normalizeWordUnderlines } from './word-import'
import { formatCustomWord } from './custom-word-tex'
import { defaultLayout } from './word-layout'

test('keeps Chinese rich-text underlining usable under XeLaTeX', () => {
  const unaffected = '\\ul{普通中文} \\ul{\\textbf{English}} \\verb|\\ul{\\textbf{示例}}|'
  const content = '\\ul {\\textbf{（加粗）}\\emph{中文}} \\ul{\\textbf{浙江大学}}'
  expect(normalizeWordUnderlines(unaffected + '\n' + content)).toBe(unaffected + '\n'
    + '\\underline {\\textbf{（加粗）}\\emph{中文}} \\underline{\\textbf{浙江大学}}')
})

test('updates a running paragraph that starts with a renumbered table reference', () => {
  const str = c => ({ t: 'Str', c })
  const para = c => ({ t: 'Para', c: [str(c)] })
  const document = { blocks: [
    { t: 'Header', c: [1, ['', [], []], [str('Results')]] },
    para('表 2.3 汇总读数。另见表 2.3。'),
    para('表 2.3 模拟记录表'),
    { t: 'Table', c: [['', [], []], [null, []], [], [], [], []] },
  ] }
  expect(formatCustomWord(document, defaultLayout).unresolvedReferences).toBe(0)
  const paragraph = document.blocks.find(block => block.t === 'Para')
  expect(paragraph.c.map(node => node.c ?? ' ').join('')).toBe('表 1-1 汇总读数。另见表 1-1。')
})
