import { expect, test } from 'bun:test'
import {
  checkCitations, collectBibliography, editorOffset, findCitations, findNewUnknownCitations,
  insertCitation, parseBibliography, sourceOffset,
} from './references'

test('indexes bibliography metadata and reports every duplicate definition and missing citation', () => {
  const files = new Map(Object.entries({
    'refs/a.bib': '% @article{ignored, title={Ignored}}\r\n@article{sample, title={{A} Title}, author="Doe, Jane", year=2026}\r\n@string{alias="Alias"}',
    'refs/b.bib': '@book(\n sample, title={Another work}, date={2025-01-01})',
    'sections/results.tex': '\\citep[see][p.~2]{sample,\n missing}\n% \\cite{commented}\n\\verb|\\cite{literal}|',
  }).map(([path, content]) => [path, { path, content }]))
  const project = { files }
  const entries = collectBibliography(project)
  expect(entries).toMatchObject([
    { key: 'sample', line: 2, title: 'A Title', author: 'Doe, Jane', year: '2026' },
    { key: 'sample', line: 2, title: 'Another work', year: '2025-01-01' },
  ])
  expect(checkCitations(project, entries, { path: '', source: '' })).toMatchObject([
    { kind: 'missing', key: 'missing', path: 'sections/results.tex', line: 2 },
    { kind: 'duplicate', key: 'sample', path: 'refs/a.bib', line: 2 },
    { kind: 'duplicate', key: 'sample', path: 'refs/b.bib', line: 2 },
  ])
})

test('recognizes multi-cites and ignores comments and verbatim', () => {
  const source = [
    '% \\begin{verbatim}',
    String.raw`\parencites(see)(p. 12)[ch. 3]{first}[][later]{second,third}`,
    String.raw`\verb|% \cite{literal}| \textcite{present}`,
    String.raw`\begin{verbatim}\cite{ignored}\end{verbatim}`,
    String.raw`\nocite{*}`,
  ].join('\n')
  expect(findCitations('chapter.tex', source).map(({ key }) => key)).toEqual(['first', 'second', 'third', 'present'])
})

test('flags newly proposed unknown keys without re-reporting an unchanged unknown key', () => {
  const entries = parseBibliography('refs.bib', '@book{known, title={Known}}')
  const before = String.raw`Existing \cite{old}. Text \cite{known}.`
  const after = String.raw`Existing \cite{old}. Revised \cite{known,novel}.`
  expect(findNewUnknownCitations('paper.tex', before, after, entries)).toMatchObject([{ key: 'novel', line: 1 }])
})

test('inserts at the textarea caret while preserving original CRLF and mixed newlines', () => {
  const source = 'Heading\r\nResults.\nEnd.\r\n'
  const caret = 'Heading\nResults.'.length
  const next = insertCitation(source, 'sample', sourceOffset(source, caret), sourceOffset(source, caret))
  expect(next.source).toBe('Heading\r\nResults.\\cite{sample}\nEnd.\r\n')
  expect(editorOffset(next.source, next.caret)).toBe(caret + '\\cite{sample}'.length)
})
