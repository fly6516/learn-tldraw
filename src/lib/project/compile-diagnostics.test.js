import { expect, test } from 'bun:test'
import { compileFailureMessage, compileLog, parseCompileDiagnostics } from './compile-diagnostics'

test('maps compiler diagnostics to the nested main directory and deduplicates repeated reports', () => {
  const project = ['paper/paper.tex', 'paper/chapters/results.tex', 'elsewhere/chapters/results.tex']
  const error = 'error: ./chapters/results.tex:3: Undefined control sequence'
  const output = [error, error, 'warning: paper.tex:8: Missing character', 'error: generated.aux:4: Unknown error'].join('\n')
  expect(parseCompileDiagnostics(output, 'paper/paper.tex', project)).toEqual([
    { path: 'paper/chapters/results.tex', line: 3, severity: 'error', message: 'Undefined control sequence' },
    { path: 'paper/paper.tex', line: 8, severity: 'warning', message: 'Missing character' },
  ])
  expect(parseCompileDiagnostics('./chapters/results.tex:5: Undefined control sequence.', 'paper/paper.tex', project))
    .toMatchObject([{ path: 'paper/chapters/results.tex', line: 5, severity: 'error' }])
})

test('reports a missing math font independently of line diagnostics', () => {
  const output = [
    'Fontconfig error: Cannot load default config file: No such file: (null)',
    'warning: >> This font is mapped to a physical font "cmsy7.pfb".',
    'error: the xdvipdfmx engine had an unrecoverable error',
    'caused by: Cannot proceed without .vf or "physical" font for PDF output...',
  ].join('\n')
  expect(parseCompileDiagnostics(output, 'main.tex', ['main.tex'])).toEqual([])
  expect(compileFailureMessage(output, true)).toContain('cmsy7.pfb')
  expect(compileFailureMessage(output, true)).toContain('download missing bundle resources')
  expect(compileFailureMessage(output, false)).toContain('font configuration')
  expect(compileLog(output, 'ordinary log\n'.repeat(5000), 8000)).toContain('Cannot proceed without .vf')
})
