import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { exportSourceArchive, importSourceArchive } from './source-archive'
import { updateFileContent } from './file-system'
import { checkCitations, collectBibliography } from './references'
import { POST } from '../../app/api/latex/compile/route'
import { findPdfRegion, findSourceRegion } from './source-sync'
import { applyWritingDrafts } from './writing-drafts'

const root = 'prism-paper'
const main = `${root}/paper.tex`
const chapter = `${root}/chapters/results.tex`
const intro = `${root}/chapters/introduction.tex`
const picture = `${root}/figures/plot.png`
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGNQaLgDRwzEcQBeEhfB+KME1gAAAABJRU5ErkJggg==', 'base64')

async function fixture(withSyncChapters = false) {
  const zip = new JSZip()
  zip.file(`${root}/main.tex`, String.raw`\documentclass{article}
\begin{document}Default entry only.\end{document}`)
  zip.file(main, String.raw`\documentclass{article}
${withSyncChapters ? String.raw`\makeatletter
\renewcommand\section{\@startsection{section}{1}{0pt}{1ex}{1ex}{\normalfont\normalsize}}
\makeatother` : '\\usepackage{graphicx}'}
\begin{document}
${withSyncChapters ? '\\input{chapters/introduction}\n\\newpage' : 'Selected source entry.'}
\input{chapters/results}
${withSyncChapters ? '' : String.raw`\includegraphics[width=1cm]{figures/plot.png}
\cite{sample}
\bibliographystyle{plain}
\bibliography{refs/library}`}
\end{document}`)
  zip.file(chapter, '\uFEFF' + String.raw`\section{Results}` + '\r\nOriginal result.\r\n')
  if (withSyncChapters) zip.file(intro, '\\section{Introduction}\nIntroduction marker.\n')
  zip.file(picture, png)
  zip.file(`${root}/refs/library.bib`, '@book{sample, title={Reference marker}, author={Doe, Jane}, year={2026}, publisher={Example}}')
  zip.folder(`${root}/empty`)
  return new File([await zip.generateAsync({ type: 'uint8array' })], 'Prism paper.zip')
}

test('preserves Prism-style project paths and all original file bytes on export', async () => {
  const file = await fixture()
  if (process.env.LATEX_TEST_ZIP) await Bun.write(process.env.LATEX_TEST_ZIP, file)
  const project = await importSourceArchive(file)
  expect(project.metadata.mainFile).toBe(`${root}/main.tex`)
  const source = await JSZip.loadAsync(await file.arrayBuffer())
  const exported = await JSZip.loadAsync(await (await exportSourceArchive(project)).arrayBuffer())
  expect(Object.keys(exported.files).sort()).toEqual(Object.keys(source.files).sort())
  for (const [path, entry] of Object.entries(source.files)) {
    if (!entry.dir) expect(await exported.file(path).async('uint8array')).toEqual(await entry.async('uint8array'))
  }
})

test.skipIf(process.env.LATEX_COMPILE_ENABLED !== '1')('edits a chapter and compiles the selected nested entry through the PDF endpoint', async () => {
  const project = await importSourceArchive(await fixture())
  const saved = updateFileContent(project, chapter, String.raw`\section{Results}Edited chapter marker.`)
  const zip = await exportSourceArchive(saved)
  const response = await POST(new Request(`http://localhost:3000/api/latex/compile?main=${encodeURIComponent(main)}`, {
    method: 'POST',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-length': String(zip.size) },
    body: zip,
  }))
  if (!response.ok) throw new Error(await response.text())
  expect(response.headers.get('content-type')).toBe('application/pdf')
  const pdf = await response.arrayBuffer()
  expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
  if (process.env.LATEX_TEST_PDF) await Bun.write(process.env.LATEX_TEST_PDF, pdf)
}, 150_000)

test.skipIf(process.env.LATEX_COMPILE_ENABLED !== '1')('previews two chapter drafts with refreshed source locations and compiler warnings', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const file = await fixture(true)
  if (process.env.LATEX_SYNC_TEST_ZIP) await Bun.write(process.env.LATEX_SYNC_TEST_ZIP, file)
  const project = await importSourceArchive(file)

  async function compilePreview(current) {
    const zip = await exportSourceArchive(current)
    return POST(new Request(`http://localhost:3000/api/latex/compile?sync=1&main=${encodeURIComponent(main)}`, {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-length': String(zip.size) },
      body: zip,
    }))
  }

  async function checkLocations(current, checks, withWarning = false) {
    const response = await compilePreview(current)
    if (!response.ok) throw new Error(await response.text())
    const result = await response.formData()
    const map = JSON.parse(result.get('sourceMap'))
    if (withWarning) {
      const report = JSON.parse(result.get('report'))
      expect(report.hasWarnings).toBe(true)
      expect(report.log).toContain('Overfull')
      expect(report.diagnostics).toContainEqual(expect.objectContaining({ path: chapter, line: 5, severity: 'warning' }))
    }
    const task = getDocument({ data: new Uint8Array(await result.get('pdf').arrayBuffer()) })
    try {
      const document = await task.promise
      for (const { path, line, page, marker } of checks) {
        const region = findPdfRegion(map, path, line)
        expect(region).toMatchObject({ path, line, page })
        const pdfPage = await document.getPage(page)
        const item = (await pdfPage.getTextContent()).items.find(item => item.str?.includes(marker))
        expect(item).toBeDefined()
        const [x, y] = item.transform.slice(4)
        const point = { x: x + item.width / 2, y: pdfPage.view[3] - y - item.height / 3 }
        expect(findSourceRegion(map, page, point.x, point.y)).toMatchObject({ path, line })
        expect(Math.abs(region.y - point.y)).toBeLessThan(18)
      }
    } finally {
      await task.destroy()
    }
  }

  const first = { path: intro, line: 2, page: 1, marker: 'Introduction marker.' }
  await checkLocations(project, [first, { path: chapter, line: 2, page: 2, marker: 'Original result.' }])
  const originalIntro = project.files.get(intro).content
  const originalResults = project.files.get(chapter).content
  const changed = applyWritingDrafts(project, {
    [intro]: { base: originalIntro, text: originalIntro.replace('Introduction marker.', 'Updated introduction.') },
    [chapter]: { base: originalResults, text: String.raw`\null\newpage
% Added during editing
\section{Results}
Updated result.
\par\hbox to 1pt{Wide content for the compiler warning.}
` },
  })
  const broken = updateFileContent(changed, chapter, changed.files.get(chapter).content + '\\undefinedResearchCommand\n')
  const failure = await compilePreview(broken)
  const failureReport = await failure.json()
  expect(failure.status).toBe(422)
  expect(failureReport.diagnostics, failureReport.log).toContainEqual(expect.objectContaining({
    path: chapter, line: 6, severity: 'error',
  }))
  await checkLocations(changed, [
    { ...first, marker: 'Updated introduction.' },
    { path: chapter, line: 4, page: 3, marker: 'Updated result.' },
  ], true)
  expect(project.files.get(intro).content).toBe(originalIntro)
  expect(project.files.get(chapter).content).toBe(originalResults)
}, 150_000)

test.skipIf(process.env.LATEX_COMPILE_ENABLED !== '1')('locates citation and compiler errors in a nested chapter, then recompiles the fixed project', async () => {
  const project = await importSourceArchive(await fixture())
  const broken = updateFileContent(project, chapter, String.raw`\section{Results}
\cite{sampl}
\undefinedResearchCommand
`)
  const issues = checkCitations(broken, collectBibliography(broken))
  expect(issues).toContainEqual(expect.objectContaining({ kind: 'missing', key: 'sampl', path: chapter, line: 2 }))
  const compile = async project => {
    const zip = await exportSourceArchive(project)
    return POST(new Request(`http://localhost:3000/api/latex/compile?main=${encodeURIComponent(main)}`, {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-length': String(zip.size) },
      body: zip,
    }))
  }
  const failure = await compile(broken)
  expect(failure.status).toBe(422)
  const result = await failure.json()
  expect(result.diagnostics, result.log).toContainEqual(expect.objectContaining({ path: chapter, line: 3, severity: 'error' }))

  const fixed = updateFileContent(broken, chapter, String.raw`\section{Results}
Corrected result \cite{sample}.
`)
  expect(checkCitations(fixed, collectBibliography(fixed))).toHaveLength(0)
  const response = await compile(fixed)
  if (!response.ok) throw new Error(await response.text())
  expect(response.headers.get('content-type')).toBe('application/pdf')
  const pdf = await response.arrayBuffer()
  expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
}, 150_000)
