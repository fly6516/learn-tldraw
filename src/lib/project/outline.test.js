import { expect, test } from 'bun:test'
import { buildProjectOutline } from './outline'
import { anchorHeading, indexOutline, resolveSectionAnchor } from './section-links'

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

test('resolves a bound label against draft headings after inserting lines and renaming the title', () => {
  const main = 'paper/main.tex'
  const root = String.raw`\input{chapters/results}`
  const source = String.raw`\section{Results} % keep this comment
\label{sec:results}
\begin{figure}\label{fig:results}\end{figure}`
  const [heading] = buildProjectOutline(project({ [main]: root, [path]: source }), main)
  const anchor = anchorHeading(indexOutline([heading]), 'example', heading)
  expect(anchor).toEqual({ kind: 'label', project: 'example', label: 'sec:results' })

  const draft = '\n% added before heading\n' + source.replace('{Results}', '{Revised results}')
  const changed = indexOutline(buildProjectOutline(project({ [main]: root, [path]: draft }), main))
  expect(resolveSectionAnchor(changed, 'example', anchor)).toMatchObject({ path, line: 3, title: 'Revised results' })
  expect(resolveSectionAnchor(changed, 'different project', anchor)).toBeUndefined()
  expect(changed.labels.has('fig:results')).toBe(false)
  const duplicate = indexOutline(buildProjectOutline(project({ [main]: root, [path]: draft + '\n' + source }), main))
  expect(resolveSectionAnchor(duplicate, 'example', anchor)).toBeUndefined()
})

test('unlabeled anchors stay within their original file and refuse ambiguous headings', () => {
  const main = 'paper/main.tex'
  const root = String.raw`\input{chapters/results}\section{Results}`
  const body = String.raw`\section{Results}`
  const make = source => buildProjectOutline(project({ [main]: root, [path]: source }), main)
  const headings = make(body)
  const anchor = anchorHeading(indexOutline(headings), 'example', headings[0])
  expect(anchor).toMatchObject({ kind: 'heading', path })
  expect(resolveSectionAnchor(indexOutline(make('\n' + body)), 'example', anchor)).toMatchObject({ path, line: 2 })
  expect(resolveSectionAnchor(indexOutline(make(body.replace('Results', 'Renamed'))), 'example', anchor)).toBeUndefined()
  expect(resolveSectionAnchor(indexOutline(make(body + '\n' + body)), 'example', anchor)).toBeUndefined()
})
