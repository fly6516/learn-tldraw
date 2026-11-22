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
  const second = await exportExternalBuild({ files: new Map([...files].reverse()) })
  const bytes = await first.zip.arrayBuffer()
  expect(second.checksum).toBe(first.checksum)
  expect(first.checksum).toBe(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'))
  const archive = await JSZip.loadAsync(bytes)
  expect(await archive.file('figure.eps').async('text')).toBe('figure data')
})
