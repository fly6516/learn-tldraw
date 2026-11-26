import { expect, test } from 'bun:test'
import { assessLayout } from './layout-preflight'
import { defaultLayout, layoutKeys } from './word-layout'

const rules = Object.fromEntries(layoutKeys.map(key => [key, { chosen: {
  value: defaultLayout[key], origin: 'file', source: 'test layout',
} }]))
const files = new Map([
  ['layout.json', { content: JSON.stringify({ version: 1, sampleName: 'sample.docx', rules }) }],
  ['word-layout.tex', { content: '' }],
  ['main.tex', { content: '\\documentclass{ctexart}\n\\input{manuscript}' }],
  ['manuscript.tex', { content: '\\CustomWordBody\n\\section{样例章节}\n见 图 2-1。' }],
])
const a4 = { width: 595.28, height: 841.89 }

test('reports only observed issues with source and PDF locations', () => {
  const result = assessLayout(files, 'main.tex', [
    { ...a4, text: '目录', toc: true, links: [{ target: 2, printed: '1' }] },
    { ...a4, text: '样例章节', footer: '2' },
  ], [{ path: 'manuscript.tex', line: 3, page: 2, x: 50, y: 90, width: 100, height: 10 }], {
    hasWarnings: true, log: '', diagnostics: [{
      severity: 'warning', path: 'word-layout.tex', line: 3, message: 'warning: SimSun unavailable; substituting.',
    }],
  })
  expect(result).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '字体替代', status: 'issue', path: 'word-layout.tex', line: 3 }),
    expect.objectContaining({ label: '目录页码', status: 'issue', page: 1 }),
    expect.objectContaining({ label: '正文起始页码', status: 'issue', page: 2 }),
    expect.objectContaining({ label: '图表题注与引用', status: 'issue', path: 'manuscript.tex', line: 3, page: 2 }),
    expect.objectContaining({ label: '纸张尺寸', status: 'pass' }),
  ]))
})

test('requires review when the PDF or font evidence is unavailable', () => {
  const result = assessLayout(files, 'main.tex', [], [])
  for (const label of ['纸张尺寸', '目录页码', '正文起始页码', '字体替代']) {
    expect(result.find(item => item.label === label)?.status).toBe('manual')
  }
  expect(assessLayout(new Map(), 'main.tex', [], [])).toEqual([])
})

test('checks the physical first chapter page and every preceding Roman footer', () => {
  const current = new Map(files)
  const chosen = value => ({ chosen: { value, origin: 'sample', source: 'Word instructions' } })
  current.set('layout.json', { content: JSON.stringify({ version: 1, sampleName: 'sample.docx',
    rules: { ...rules, bodyOpening: chosen('odd'), frontPages: chosen('Roman') } }) })
  const pages = [
    { ...a4, text: '摘要', footer: 'I' },
    { ...a4, text: 'Abstract', footer: 'II' },
    { ...a4, text: '目录', toc: true, footer: 'III' },
    { ...a4, text: '', footer: 'IV' },
    { ...a4, text: '样例章节', footer: '1' },
  ]
  expect(assessLayout(current, 'main.tex', pages, [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '正文奇数页起排', status: 'pass', page: 5 }),
    expect.objectContaining({ label: '前置连续页码', status: 'pass', observed: 'I、II、III、IV' }),
  ]))
  pages[3].footer = 'V'
  expect(assessLayout(current, 'main.tex', pages, [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '前置连续页码', status: 'issue', page: 4 }),
  ]))
  pages.splice(3, 1)
  expect(assessLayout(current, 'main.tex', pages, [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '正文奇数页起排', status: 'issue', page: 4 }),
  ]))
})

test('recognizes the MNRAS class and checks PDF evidence separately from the input options', () => {
  const journal = new Map([['paper.tex', { content: '\\documentclass{mnras}' }]])
  const find = (pages = []) => assessLayout(journal, 'paper.tex', pages, [], undefined, 'mnras')
  expect(find()[0]).toMatchObject({ label: 'MNRAS 正文双栏', status: 'manual' })
  const pages = [{ ...a4, text: 'Paper', bodyInTwoColumns: true, figureCaption: true, tableCaption: true }]
  expect(find(pages).slice(0, 2)).toEqual([
    expect.objectContaining({ label: 'MNRAS 正文双栏', status: 'pass', page: 1 }),
    expect.objectContaining({ label: 'MNRAS 图表显示', status: 'pass', page: 1 }),
  ])
  journal.set('paper.tex', { content: '\\documentclass[onecolumn]{mnras}' })
  expect(find(pages)[0]).toMatchObject({ status: 'issue', observed: 'onecolumn', path: 'paper.tex', line: 1 })
})

test('reports a lost included declaration and distinguishes the fixed running head from the body title', () => {
  const current = new Map(files)
  const custom = { ...rules, fixedHeader: { chosen: { value: '上海交通大学硕士学位论文', origin: 'file', source: 'Word' } },
    header: { chosen: { value: 'left', origin: 'file', source: 'Word' } } }
  current.set('layout.json', { content: JSON.stringify({ version: 1, sampleName: 'sample.docx', rules: custom }) })
  current.set('front/declaration.pdf', { blob: new Blob(['mock attachment']) })
  const pages = [
    { ...a4, text: '上海交通大学 硕士学位论文' },
    { ...a4, text: '摘要 中文', footer: 'I', header: '' },
    { ...a4, text: '样例章节 上海交通大学硕士学位论文', footer: '1', header: '' },
  ]
  const result = assessLayout(current, 'main.tex', pages, [], undefined, 'sjtu-graduate-word')
  expect(result).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '上交大封面', status: 'pass', page: 1 }),
    expect.objectContaining({ label: '原创性声明', status: 'issue' }),
    expect.objectContaining({ label: '正文固定页眉', status: 'issue', page: 3 }),
    expect.objectContaining({ label: '摘要页页眉', status: 'manual', page: 2 }),
  ]))
  current.set('main.tex', { content: '\\includepdf[pages=-]{front/declaration.pdf}' })
  pages.splice(1, 0, { ...a4, text: '学位论文原创性声明 及 学位论文使用授权书' })
  pages[3].header = '上海交通大学硕士学位论文'
  expect(assessLayout(current, 'main.tex', pages, [], undefined, 'sjtu-graduate-word')).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '原创性声明', status: 'pass', page: 2 }),
    expect.objectContaining({ label: '使用授权书', status: 'pass', page: 2 }),
    expect.objectContaining({ label: '正文固定页眉', status: 'pass', page: 4 }),
  ]))
})

test('checks compiler margins against the saved rules, anchoring differences to the TeX and PDF', () => {
  const current = new Map(files)
  current.set('main.tex', { path: 'main.tex', content: '\\usepackage[left=15mm]{geometry}\n\\input{manuscript}' })
  const pages = [{ ...a4, text: '样例章节', footer: '1' }]
  const log = `*geometry* verbose mode - [ preamble ] result:
* bindingoffset: 8.536pt
* h-part:(L,W,R)=(42.679pt, 474.84pt, 71.132pt)
* v-part:(T,H,B)=(71.132pt, 702.78pt, 71.132pt)
`
  const bad = assessLayout(current, 'main.tex', pages, [], { log, diagnostics: [], hasWarnings: false })
    .find(item => item.label === '正文页边距')
  expect(bad).toMatchObject({ status: 'issue', observed: expect.stringContaining('左 15 mm'), line: 1, page: 1 })
  const fixed = assessLayout(current, 'main.tex', pages, [], {
    log: '', diagnostics: [], hasWarnings: false,
    geometry: [{ left: 25, right: 25, top: 25, bottom: 25, binding: 0, width: 210, height: 297 }],
  }).find(item => item.label === '正文页边距')
  expect(fixed).toMatchObject({ status: 'pass', expected: expect.stringContaining('左 25.4 mm') })
})

test('checks cited fields in the active bibliography and recognizes inline Word numbers', () => {
  const journal = new Map([
    ['paper.tex', { path: 'paper.tex', content: '\\documentclass[twoside,11pt]{article}\n\\usepackage{jmlr2e}\n\\begin{document}\nSee \\citep{missing,known}.\n\\bibliography{selected}\n\\end{document}' }],
    ['selected.bib', { path: 'selected.bib', content: '@Article{known,title={Example},author={A. Writer}}' }],
    ['unused.bib', { path: 'unused.bib', content: '@Article{missing,title={Irrelevant file},author={A. Writer},year={2000}}' }],
  ])
  expect(assessLayout(journal, 'paper.tex', [], [], undefined, 'jmlr')).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: '参考文献缺项', status: 'issue', detail: '条目 known 缺少年份。', path: 'selected.bib', line: 1 }),
    expect.objectContaining({ label: '参考文献缺项', status: 'issue', detail: '引文 missing 没有对应的参考文献条目。', path: 'paper.tex', line: 4 }),
  ]))
  const paper = journal.get('paper.tex')
  journal.set('paper.tex', { ...paper, content: paper.content.replace('\\begin{document}', '\\setcitestyle{authoryear}\n\\begin{document}') })
  expect(assessLayout(journal, 'paper.tex', [], [], undefined, 'jmlr').filter(item => item.label === '参考文献缺项')).toHaveLength(2)
  const word = new Map(files)
  word.set('manuscript.tex', { path: 'manuscript.tex', content: '\\CustomWordBody\n\\section{章节}\n甲 {[}1{]}，乙 {[}7{]}。\n\\section{参考文献}\n\\CustomWordReference{}{{[}1{]} A. Writer.}' })
  const findings = assessLayout(word, 'main.tex', [], []).filter(item => item.label === '参考文献缺项')
  expect(findings).toHaveLength(1)
  expect(findings[0]).toMatchObject({ status: 'issue', detail: expect.stringContaining('引文 7'), line: 3 })
})
