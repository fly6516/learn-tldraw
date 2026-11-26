import { expect, test } from 'bun:test'
import { captureManuscript } from './template-export'
import { joinMappedTex, manuscriptRegions } from './template-source-map'

const main = String.raw`\documentclass{article}
\title{Calibration}
\author{Casey Lin}
\begin{document}
\begin{abstract}An independent abstract.\end{abstract}
\input{sections/result}
\bibliography{references}
\end{document}`

function project(section, image = true) {
  const files = new Map([
    ['paper/main.tex', { type: 'editable', content: main }],
    ['paper/sections/result.tex', { type: 'editable', content: section }],
    ['paper/references.bib', { type: 'editable', content: '@article{test, author={A. Last}, year={2026}}' }],
  ])
  if (image) files.set('paper/figures/one.png', { type: 'asset', blob: new Blob(['image']) })
  return files
}

test('keeps included section order, table text, assets, references and bibliography in a read-only export snapshot', () => {
  const section = String.raw`\section{Result}\label{sec:result}
\subsection{Protocol}
\begin{figure}
\includegraphics[width=.5\linewidth]{figures/one}
\caption{Raw response.}\label{fig:response}
\end{figure}
\begin{table}\caption{Counts.}\begin{tabular}{lr} A & 1 \\ \end{tabular}\end{table}
See Section~\ref{sec:result} and Figure~\ref{fig:response} for \citet{test}.`
  const files = project(section)
  const snapshot = captureManuscript(files, 'paper/main.tex')
  expect(snapshot.body).toBe(section)
  expect(snapshot.title).toBe('Calibration')
  expect(snapshot.abstract).toBe('An independent abstract.')
  expect(snapshot.sections.map(item => [item.title, item.level])).toEqual([['Result', 1], ['Protocol', 2]])
  expect(snapshot.floats.map(item => item.kind)).toEqual(['figure', 'table'])
  expect(snapshot.assets[0].path).toBe('figures/one.png')
  expect(snapshot.references.map(item => item.key)).toEqual(['sec:result', 'fig:response', 'test'])
  expect(snapshot.bibliography[0].path).toBe('references.bib')
  expect(files.get('paper/sections/result.tex').content).toBe(section)
})

test('reports the original file and line for unsupported commands, missing images, missing citations and missing inputs', () => {
  const scan = (section, images) => captureManuscript(project(section, images), 'paper/main.tex')
  expect(() => scan('First line.\n\\privatePrint{value}')).toThrow('paper/sections/result.tex:2 · 命令')
  expect(() => scan('First line.\n\\includegraphics{figures/one}', false)).toThrow('paper/sections/result.tex:2 · 找不到图片')
  expect(() => scan('First line.\nSee \\cite{wrong}.')).toThrow('paper/sections/result.tex:2 · 找不到参考文献键 wrong')
  expect(() => scan('First line.\n\\input{unavailable}')).toThrow('paper/sections/result.tex:2 · 找不到源文件')
})

test('tracks trimmed abstract and body lines from expanded files with mixed line endings', () => {
  const files = project('  \r\n\\section{Result}\r\n\\input{sections/details}\r\n\\maketitle\r\nEnd of result.')
  files.set('paper/sections/details.tex', { type: 'editable', content: '\r\nFirst detail.\rSecond detail.\r\n' })
  const snapshot = captureManuscript(files, 'paper/main.tex')
  const resultLines = snapshot.body.split(/\r\n|\r|\n/)
  const mapped = text => snapshot.lineSources.body.get(resultLines.indexOf(text) + 1)
  expect(mapped('\\section{Result}')).toEqual({ path: 'paper/sections/result.tex', line: 2 })
  expect(mapped('First detail.')).toEqual({ path: 'paper/sections/details.tex', line: 2 })
  expect(mapped('Second detail.')).toEqual({ path: 'paper/sections/details.tex', line: 3 })
  expect(mapped('End of result.')).toEqual({ path: 'paper/sections/result.tex', line: 5 })
  expect(snapshot.lineSources.abstract.get(1)).toEqual({ path: 'paper/main.tex', line: 5 })
})

test('preserves PDF geometry while filtering generated lines, including a main file with the same name', () => {
  const result = joinMappedTex([
    '\\includepdf{cover.pdf}',
    { text: 'An original paragraph.', lines: new Map([[1, { path: 'sections/body.tex', line: 4 }]]) },
    '\\end{document}',
  ])
  const geometry = { page: 6, x: 25, y: 41, width: 12, height: 10 }
  expect(manuscriptRegions([
    { ...geometry, path: 'main.tex', line: 1, page: 1 },
    { ...geometry, path: 'word-layout.tex', line: 2 },
    { ...geometry, path: 'main.tex', line: 2 },
    { ...geometry, path: 'main.tex', line: 3 },
  ], 'main.tex', result.lines)).toEqual([{ ...geometry, path: 'sections/body.tex', line: 4 }])
})
