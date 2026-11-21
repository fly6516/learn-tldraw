import { expect, test } from 'bun:test'
import { buildProjectOutline } from './outline'

const path = 'paper/chapters/results.tex'

function project(entries) {
  return { files: new Map(Object.entries(entries).map(([path, content]) => [path, { path, content }])) }
}

test('follows nested includes from the selected main directory and nests headings across files', () => {
  const main = 'paper/paper.tex'
  const extra = 'paper/chapters/detail.tex'
  const data = project({
    [main]: String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
\input{chapters/results}
\section{Conclusion}
\end{document}`,
    [path]: String.raw`\subsection[Short title]{Results for \emph{A and B}}
\include{chapters/detail}`,
    [extra]: String.raw`\subsubsection*{Detail}`,
    'paper/alternate.tex': String.raw`\section{Independent}`,
  })
  const outline = buildProjectOutline(data, main, { path: '', source: '' })
  expect(outline).toMatchObject([
    { title: 'Introduction', path: main, line: 3, children: [{
      title: 'Results for A and B', path, line: 1, children: [{ title: 'Detail', path: extra, line: 1 }],
    }] },
    { title: 'Conclusion', path: main, line: 5, children: [] },
  ])
  expect(data.files.get(path).content.slice(outline[0].children[0].start, outline[0].children[0].end))
    .toBe(String.raw`Results for \emph{A and B}`)
  expect(buildProjectOutline(data, 'paper/alternate.tex', { path: '', source: '' }).map(node => node.title))
    .toEqual(['Independent'])
})

test('uses the active draft and ignores commented, literal, missing and cyclic source', () => {
  const main = 'paper/paper.tex'
  const data = project({
    [main]: String.raw`\section{Start}
\input chapters/results.tex
\input{missing}
% \section{Hidden}
\verb|\section{Literal}|`,
    [path]: String.raw`\subsection{Stale title}`,
  })
  const draft = '% note\r\n' + String.raw`\subsection{Live title}\input{paper}`
  const [first] = buildProjectOutline(data, main, { path, source: draft })
  expect(first.children).toMatchObject([{ title: 'Live title', path, line: 2, children: [] }])
  const [child] = first.children
  expect(draft.slice(child.start, child.end)).toBe('Live title')
})
