import JSZip from 'jszip'
import { emptyPage } from './research-graph'
import { importSourceArchive } from './source-archive'

export async function createCanvasFixture() {
  const zip = new JSZip()
  zip.file('main.tex', [
    '\\documentclass{article}',
    '\\makeatletter',
    '\\renewcommand\\section{\\@startsection{section}{1}{0pt}{2ex}{1ex}{\\normalfont\\normalsize}}',
    '\\makeatother',
    '\\renewcommand{\\bfdefault}{m}',
    '\\renewcommand{\\ttdefault}{\\rmdefault}',
    '\\input{preamble}',
    '\\begin{document}',
    '\\input{sections/introduction}',
    '\\input{sections/methods}',
    '\\newpage',
    '\\input{sections/results}',
    '\\appendix',
    '\\input{appendices/notes}',
    '\\begin{thebibliography}{9}',
    '\\bibitem{sample2020} A. Author. Sample Reference, 2020.',
    '\\end{thebibliography}',
    '\\end{document}',
  ].join('\n'))
  zip.file('preamble.tex', [
    '\\newtheorem{claim}{Claim}',
    '\\newenvironment{protocol}{\\par}{\\par}',
    '\\newenvironment{pseudocode}{\\par}{\\par}',
  ].join('\n'))
  zip.file('sections/introduction.tex', '\\section{Introduction}\nAn example citation\\cite{sample2020}.')
  zip.file('sections/methods.tex', [
    '\\section{Methods}',
    '\\input{sections/nested}',
    '\\begin{equation}',
    '\\label{eq:sample}',
    '\\mbox{A = B}',
    '\\end{equation}',
  ].join('\n'))
  zip.file('sections/nested.tex', 'Nested source marker.')
  zip.file('sections/results.tex', [
    '\\section{Results}\\label{sec:results}',
    '\\begin{figure}[h]',
    '\\XeTeXpicfile "figures/plot.png" width 1cm',
    '\\caption{Sample plot}\\label{fig:plot}',
    '\\end{figure}',
    '\\begin{table}[h]',
    '\\caption{Sample table}\\label{tab:sample}',
    '\\end{table}',
  ].join('\n'))
  zip.file('appendices/notes.tex', [
    '\\section{Notes}',
    '\\begin{pseudocode}Sample step.\\end{pseudocode}',
    '\\begingroup\\let\\itshape\\upshape',
    '\\begin{claim}Sample claim.\\end{claim}',
    '\\endgroup',
    '\\begin{protocol}Sample procedure.\\end{protocol}',
    '\\begin{verbatim}',
    'Sample listing.',
    '\\end{verbatim}',
  ].join('\n'))
  zip.file('references/library.bib', '@article{sample2020, title={Sample Reference}, author={A. Author}, year={2020}}')
  zip.file('data/values.csv', 'id,value\n1,10\n')
  zip.file('attachments/notes.txt', 'An attachment.')
  zip.file('figures/plot.png', 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGNQaLgDRwzEcQBeEhfB+KME1gAAAABJRU5ErkJggg==', { base64: true })
  const project = await importSourceArchive(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'Canvas fixture.zip'))
  const first = emptyPage('Planning', 'planning')
  const second = emptyPage('Results', 'results')
  second.nodes = ['results', 'notes'].map((id, order) => ({
    id, position: { x: 50, y: 50 + order * 200 },
    data: { section: 'custom', content: id, order, level: 1,
      sourceAnchor: id === 'results' ? { kind: 'label', project: project.metadata.createdAt, label: 'sec:results' } : undefined },
  }))
  second.edges = [{ id: 'results-notes', source: 'results', target: 'notes' }]
  return { ...project, canvas: { activePageId: first.id, pages: [first, second] } }
}
