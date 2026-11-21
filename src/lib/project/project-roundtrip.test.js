import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { exportToLatexFile, exportToLatexZip } from './exporter'
import { createProjectFromImport, importLatexZip } from './importer'
import { getFileTree } from './file-system'

async function archiveWith(files) {
  const archive = new JSZip()
  for (const [path, content] of Object.entries(files)) archive.file(path, content)
  return new File([await archive.generateAsync({ type: 'uint8array' })], 'paper.zip')
}

test('nested LaTeX project preserves source order, bibliography and assets in the ZIP', async () => {
  const result = await importLatexZip(await archiveWith({
    'paper/main.tex': String.raw`\documentclass{article}
\begin{document}
\input{chapters/results}
\include{chapters/intro}
\bibliographystyle{abbrv}
\bibliography{refs/library}
\end{document}`,
    'paper/chapters/results.tex': String.raw`\section{Results} $x^2$ \cite{example}`,
    'paper/chapters/intro.tex': String.raw`\section{Introduction} See results.`,
    'paper/refs/library.bib': '@article{example,title={Example}}',
    'paper/figures/nested/plot.png': 'fixture-bytes',
  }))
  expect(result.source).toContain(String.raw`\cite{example}`)
  expect(result.source).not.toContain(String.raw`\input`)
  const project = createProjectFromImport(result)
  expect(getFileTree(project).find(node => node.name === 'chapters')?.children).toHaveLength(2)

  const nodes = [
    { section: 'result', level: 1, order: 0, content: String.raw`$x^2$ \cite{example}` },
    { section: 'introduction', level: 1, order: 1, content: 'See results.' },
  ]
  const options = { format: 'zip', preserveNodeOrder: true }
  const preview = exportToLatexFile(nodes, project, options)
  expect(preview.indexOf('Results')).toBeLessThan(preview.indexOf('Introduction'))
  expect(preview).toContain(String.raw`\bibliographystyle{abbrv}`)
  expect(preview).toContain(String.raw`\bibliography{refs/library}`)

  const zip = await JSZip.loadAsync(await (await exportToLatexZip(nodes, project, options)).arrayBuffer())
  expect(await zip.file('main.tex').async('text')).toBe(preview)
  expect(await zip.file('refs/library.bib').async('text')).toContain('@article{example')
  expect(await zip.file('figures/nested/plot.png').async('text')).toBe('fixture-bytes')
})

test('ZIP import reports missing and cyclic source references', async () => {
  const missing = await archiveWith({ 'main.tex': String.raw`\input{absent}` })
  await expect(importLatexZip(missing)).rejects.toThrow('Missing LaTeX file: absent.tex')

  const cyclic = await archiveWith({
    'main.tex': String.raw`\input{chapter}`,
    'chapter.tex': String.raw`\input{main}`,
  })
  await expect(importLatexZip(cyclic)).rejects.toThrow('Circular LaTeX include: main.tex')
})
