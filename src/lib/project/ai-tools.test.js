import { expect, test } from 'bun:test'
import { createChapterTools } from './ai-tools'
import { buildChapterContext, editRequestSchema } from './ai-edit'

test('tool responses are bounded to allowed project paths and current diagnostic evidence', async () => {
  const input = { path: 'results.tex', source: '\\section{Results}', main: 'main.tex',
    context: [{ path: 'methods.tex', source: '\\section{Methods}\r\nFour paired sessions.\r\n\\label{sec:methods}', truncated: false },
      { path: 'refs.bib', source: '@book{key, title={A useful source}}', truncated: false }],
    compiler: { state: 'stale', diagnostics: [{ path: 'methods.tex', line: 2, severity: 'warning', message: 'stale value' }], log: 'old log' } }
  const { tools, calls, evidence } = createChapterTools(input)
  expect(await tools.search_source.execute({ query: 'paired' })).toMatchObject({ items: [{ path: 'methods.tex', line: 2 }] })
  expect(await tools.read_source.execute({ path: 'methods.tex', startLine: 2, lineCount: 1 })).toMatchObject({ items: [{ text: 'Four paired sessions.' }] })
  expect(await tools.read_source.execute({ path: '../../secret.tex', startLine: 1, lineCount: 1 })).toMatchObject({ items: [], unavailable: expect.any(String) })
  expect(await tools.query_references.execute({ query: 'useful', kind: 'bibliography' })).toMatchObject({ items: [{ path: 'refs.bib', line: 1 }] })
  expect(await tools.query_references.execute({ query: 'methods', kind: 'labels' })).toMatchObject({ items: [{ path: 'methods.tex', line: 3 }] })
  const diagnostics = await tools.compile_diagnostics.execute({})
  expect(diagnostics).toMatchObject({ state: 'stale', items: [] })
  expect(diagnostics).not.toHaveProperty('log')
  expect(calls).toHaveLength(6)
  expect(evidence).toHaveLength(4)
})

test('enforces the shared context character budget after clipping individual files', () => {
  const files = new Map(Array.from({ length: 12 }, (_, i) => [`section${i}.tex`, { path: `section${i}.tex`, content: 'x'.repeat(40_000) }]))
  const context = buildChapterContext({ files }, 'target.tex', 'section0.tex')
  expect(context.reduce((count, item) => count + item.source.length, 0)).toBe(240_000)
  expect(context.every(item => item.truncated)).toBe(true)
  expect(editRequestSchema.safeParse({ mode: 'review', path: 'target.tex', main: 'section0.tex', source: 'target', instruction: '',
    compiler: { state: 'unavailable', diagnostics: [], log: '' }, context }).success).toBe(true)
})
