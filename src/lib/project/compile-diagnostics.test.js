import { expect, test } from 'bun:test'
import { parseCompileDiagnostics } from './compile-diagnostics'

test('maps compiler diagnostics to the nested main directory and deduplicates repeated reports', () => {
  const project = ['paper/paper.tex', 'paper/chapters/results.tex', 'elsewhere/chapters/results.tex']
  const error = 'error: ./chapters/results.tex:3: Undefined control sequence'
  const output = [error, error, 'warning: paper.tex:8: Missing character', 'error: generated.aux:4: Unknown error'].join('\n')
  expect(parseCompileDiagnostics(output, 'paper/paper.tex', project)).toEqual([
    { path: 'paper/chapters/results.tex', line: 3, severity: 'error', message: 'Undefined control sequence' },
    { path: 'paper/paper.tex', line: 8, severity: 'warning', message: 'Missing character' },
  ])
})
