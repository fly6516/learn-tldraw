import { expect, test } from 'bun:test'
import { indexCrossReferences } from './cross-references'
import { buildProjectOutline } from './outline'

test('indexes labels across the main document and draft chapters with exact diagnostic offsets', () => {
  const main = String.raw`\documentclass{article}
\begin{document}
\ref{sec:results}
\input{sections/results}
\cref{fig:temp, missing:first}
\Cpagerefrange{missing:second}{fig:temp}
\hyperref[sec:results]{results}
% \ref{ignored}
\verb|\ref{also-ignored}|
\ref{\dynamickey}
\end{document}`
  const draft = String.raw`\section{Results}\label{sec:results}
\begin{figure}\caption{Temperature}\label{fig:temp}\end{figure}
\label{fig:temp}`
  const project = { files: new Map([
    ['main.tex', { path: 'main.tex', content: main }],
    ['sections/results.tex', { path: 'sections/results.tex', content: 'Saved Results' }],
    ['unused.tex', { path: 'unused.tex', content: String.raw`\label{missing:first}` }],
  ]) }
  const sources = new Map()
  buildProjectOutline(project, 'main.tex', { path: 'sections/results.tex', source: draft }, (path, text) => sources.set(path, text))
  const index = indexCrossReferences(sources)
  expect([...index.labels.keys()]).toEqual(['sec:results', 'fig:temp'])
  expect(index.uses.get('sec:results').map(use => use.command)).toEqual(['ref', 'hyperref'])
  expect(index.issues.map(issue => [issue.kind, issue.key, issue.line])).toEqual([
    ['missing', 'missing:first', 5], ['missing', 'missing:second', 6], ['duplicate', 'fig:temp', 2], ['duplicate', 'fig:temp', 3],
  ])
  for (const issue of index.issues) expect(sources.get(issue.path).slice(issue.start, issue.end)).toBe(issue.key)
})
