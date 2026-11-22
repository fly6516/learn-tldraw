import { expect, test } from 'bun:test'
import { applyChapterEdits, applyProjectEdits, buildChapterContext } from './ai-edit'

test('keeps the main file, local macros and bibliography in chapter context', () => {
  const content = new Map([
    ['paper/chapters/results.tex', 'Selected text.'],
    ['paper/paper.tex', '\\input{chapters/results}'],
    ['paper/local.sty', '\\newcommand{\\method}{Example}'],
    ['paper/refs/library.bib', 'x'.repeat(33000)],
    ['paper/figures/plot.png', undefined],
  ])
  const files = new Map([...content].map(([path, source]) => [path, { path, content: source }]))
  const context = buildChapterContext({ files }, 'paper/chapters/results.tex', 'paper/paper.tex')
  expect(context.map(entry => entry.path)).toEqual(['paper/paper.tex', 'paper/local.sty', 'paper/refs/library.bib'])
  expect(context.at(-1)).toMatchObject({ source: 'x'.repeat(32000), truncated: true })
})

test('groups selected edits across files and rejects edits outside the proposal scope', () => {
  const sources = new Map([['methods.tex', 'Method statement.'], ['results.tex', 'Result statement.']])
  expect([...applyProjectEdits(sources, [
    { path: 'methods.tex', before: 'Method', after: 'Sampling' },
    { path: 'results.tex', before: 'Result', after: 'Findings' },
  ])]).toEqual([['methods.tex', 'Sampling statement.'], ['results.tex', 'Findings statement.']])
  expect(() => applyProjectEdits(sources, [{ path: 'main.tex', before: 'Title', after: 'New title' }])).toThrow('outside')
  expect(() => applyProjectEdits(sources, [{ path: 'results.tex', before: 'Stale', after: 'New' }])).toThrow('unique')
})

test('applies only uniquely anchored edits against the original chapter', () => {
  const original = '\\section{Results}\r\nAlpha. \\cite{analysis}\r\nBeta.\r\n'
  expect(applyChapterEdits(original, [
    { before: 'Beta.', after: 'Second result.' },
    { before: 'Alpha.', after: 'First result.' },
  ])).toBe('\\section{Results}\r\nFirst result. \\cite{analysis}\r\nSecond result.\r\n')
  expect(() => applyChapterEdits('repeated repeated', [{ before: 'repeated', after: 'new' }])).toThrow('unique')
  expect(() => applyChapterEdits(original, [{ before: 'stale source', after: 'new' }])).toThrow('unique')
  expect(() => applyChapterEdits('unique passage', [
    { before: 'unique', after: 'new' }, { before: 'unique passage', after: 'another' },
  ])).toThrow('overlap')
})
