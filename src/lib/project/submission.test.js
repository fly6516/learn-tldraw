import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { exportExternalBuild, prepareSubmission } from './submission'
import { exportSourceArchive } from './source-archive'

test('preflights the final ZIP with exact locations for missing and excluded files and bad references', async () => {
  const file = (path, content) => [path, { path, name: path, type: 'editable', content }]
  const body = String.raw`\includegraphics{figures/missing}
\XeTeXpicfile "figures/temperature.png" width 7cm
\input{\dynamicpath}
\ref{sec:wrong}
\cite{wrong}`
  const project = { files: new Map([
    file('paper/main.tex', String.raw`\documentclass{article}\begin{document}\input{results}\bibliography{refs}\end{document}`),
    file('paper/results.tex', body), file('paper/figures/temperature.png', 'asset'),
    file('paper/refs.bib', '@article{known, title={Known}}'), file('paper/private.txt', 'private'),
  ]) }
  const { target, issues } = prepareSubmission(project, 'paper/main.tex', new Set(['paper/private.txt', 'paper/figures/temperature.png', 'paper/main.tex']))
  expect(issues.map(issue => [issue.location.line, issue.message])).toEqual([
    [1, 'Missing file for \\includegraphics: figures/missing'], [2, 'Excluded dependency: paper/figures/temperature.png'],
    [3, 'Check \\input path manually'], [4, 'Undefined LaTeX reference: sec:wrong'], [5, 'Unknown citation key: wrong'],
  ])
  expect(issues.slice(0, 2).map(({ location }) => body.slice(location.start, location.end))).toEqual(['figures/missing', 'figures/temperature.png'])
  const zip = await JSZip.loadAsync(await (await exportSourceArchive(target)).arrayBuffer())
  expect(Object.keys(zip.files).sort()).toEqual(['paper/main.tex', 'paper/refs.bib', 'paper/results.tex'])
  expect(project.files.has('paper/private.txt')).toBe(true)
})

test('external build ZIP bytes stay identical across export order and carry the displayed SHA-256', async () => {
  const files = new Map([['main.tex', { type: 'editable', path: 'main.tex', content: 'Main' }],
    ['figure.eps', { type: 'asset', path: 'figure.eps', blob: new Blob(['figure data']) }]])
  const first = await exportExternalBuild({ files })
  const second = await exportExternalBuild({ files: new Map([...files].reverse().concat([['figures', { type: 'directory', path: 'figures' }]])) })
  const bytes = await first.zip.arrayBuffer()
  expect(second.checksum).toBe(first.checksum)
  expect(first.checksum).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'))
  const archive = await JSZip.loadAsync(bytes)
  expect(await archive.file('figure.eps').async('text')).toBe('figure data')
})

test('finds Biber in the selected custom class and reports a locally excluded class', () => {
  const file = (path, content) => [path, { path, type: 'editable', content }]
  const project = { files: new Map([
    file('main.tex', String.raw`\documentclass{riverstudy}\begin{document}River\end{document}`),
    file('riverstudy.cls', String.raw`\LoadClass{article}\RequirePackage[backend=biber]{biblatex}`),
  ]) }
  expect(prepareSubmission(project, 'main.tex', new Set()).compatibility.bibliography).toBe('biber')
  expect(prepareSubmission(project, 'main.tex', new Set(['riverstudy.cls'])).issues[0])
    .toMatchObject({ severity: 'error', message: 'Excluded dependency: riverstudy.cls', location: { path: 'main.tex', line: 1 } })
})

test('flags the selected nested bibliography style without requiring inactive class graphics', () => {
  const file = (path, content) => [path, { path, type: 'editable', content }]
  const files = new Map([
    file('paper/main.tex', String.raw`\documentclass[pdflatex,numbered]{journal}\bibliography{refs}`),
    file('paper/journal.cls', String.raw`\bibliographystyle{numbered}
\bibliographystyle{author-year}
\def\optionalLogo{\includegraphics{logo.eps}}`),
    file('paper/refs.bib', '@misc{sample,title={Sample}}'),
    file('paper/bst/numbered.bst', 'selected'), file('paper/bst/author-year.bst', 'inactive'),
  ])
  const { issues, compatibility } = prepareSubmission({ files }, 'paper/main.tex', new Set(['paper/bst/numbered.bst', 'paper/bst/author-year.bst']))
  expect(compatibility).toMatchObject({ engine: 'pdflatex', bibliography: 'bibtex' })
  expect(issues).toMatchObject([
    { severity: 'error', message: 'Excluded bibliography style: paper/bst/numbered.bst', location: { path: 'paper/journal.cls', line: 1 } },
    { severity: 'warning', message: 'Check conditional template graphic: logo.eps' },
  ])
})

test('retains a missing-file error for literal XeTeX graphics even when graphicx has a search path', () => {
  const path = 'main.tex'
  const content = String.raw`\graphicspath{{figures/}}
\XeTeXpicfile "missing.eps" width 2cm`
  const project = { files: new Map([[path, { path, type: 'editable', content }]]) }
  const { issues } = prepareSubmission(project, path, new Set())
  expect(issues.find(issue => issue.location.line === 2)).toMatchObject({ severity: 'error', message: 'Missing file for \\XeTeXpicfile: missing.eps' })
})
