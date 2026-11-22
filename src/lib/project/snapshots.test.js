import { expect, test } from 'bun:test'
import { compareSnapshotFiles, describeSnapshotRestore, restoreSnapshotFiles } from './snapshots'
import { createCanvasFixture } from './canvas-test-fixture'
import { buildProjectOutline } from './outline'
import { indexOutline, resolveSectionAnchor } from './section-links'
import { encodeProjectBackup, decodeProjectBackup } from './backup'
import { exportSourceArchive } from './source-archive'
import { updateFileContent } from './file-system'
import { applyWritingDrafts } from './writing-drafts'
import { POST } from '../../app/api/latex/compile/route'

test('summarizes changed source, equal-size attachments, canvas pages and the active page before restoring', async () => {
  const original = await createCanvasFixture()
  const backup = await decodeProjectBackup(await encodeProjectBackup(original.canvas, original))
  const edited = updateFileContent(original, 'sections/results.tex', 'Revised results')
  const figure = edited.files.get('figures/plot.png')
  const changedBytes = new Uint8Array(await figure.blob.arrayBuffer())
  changedBytes[changedBytes.length - 1] ^= 1
  edited.files.set(figure.path, { ...figure, blob: new Blob([changedBytes], { type: figure.blob.type }) })
  const [plan, evidence] = edited.canvas.pages
  edited.canvas = { activePageId: evidence.id, pages: [plan, { ...evidence, edges: [] }] }

  const summary = await describeSnapshotRestore(edited, backup.project)
  expect(summary.files).toEqual(['Restore figures/plot.png', 'Restore sections/results.tex'])
  expect(summary.pages).toEqual(['Restore Results'])
  expect(summary.activePageChanged).toBe(true)
  expect(summary.mainChanged).toBe(false)

  const restoredOutline = indexOutline(buildProjectOutline(backup.project, 'main.tex'))
  expect(resolveSectionAnchor(restoredOutline, backup.project.metadata.createdAt, evidence.nodes[0].data.sourceAnchor))
    .toMatchObject({ path: 'sections/results.tex', line: 1 })
})

test('restores one selected source while retaining other files, drafts, and the current Canvas', async () => {
  const snapshot = await createCanvasFixture()
  const results = 'sections/results.tex'
  const nested = 'sections/nested.tex'
  const edited = updateFileContent(updateFileContent(snapshot, results, 'Edited results'), nested, 'Saved nested revision')
  edited.canvas = { ...snapshot.canvas, activePageId: snapshot.canvas.pages[1].id }
  const choices = await compareSnapshotFiles(edited, snapshot)
  expect(choices.map(({ action, path }) => [action, path])).toEqual([['Restore', nested], ['Restore', results]])
  expect(choices.find(change => change.path === results)).toMatchObject({ current: { content: 'Edited results' } })
  const partial = restoreSnapshotFiles(edited, snapshot, [results])
  expect(partial.canvas).toBe(edited.canvas)
  expect(partial.metadata.mainFile).toBe(edited.metadata.mainFile)
  expect(partial.files.get(results)).toBe(snapshot.files.get(results))
  expect(partial.files.get(nested)).toBe(edited.files.get(nested))
  expect(applyWritingDrafts(partial, { [nested]: { base: 'Saved nested revision', text: 'Nested local draft' } }).files.get(nested).content)
    .toBe('Nested local draft')
  expect(() => restoreSnapshotFiles(edited, { ...snapshot, files: new Map() }, [edited.metadata.mainFile])).toThrow('main file')
})

test.skipIf(process.env.LATEX_COMPILE_ENABLED !== '1')('compiles a multi-file project with figure, references and a source map', async () => {
  const zip = await exportSourceArchive(await createCanvasFixture())
  const response = await POST(new Request('http://localhost:3000/api/latex/compile?main=main.tex&sync=1', {
    method: 'POST', body: zip,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'content-length': String(zip.size) },
  }))
  if (!response.ok) throw new Error(await response.text())
  const result = await response.formData()
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(await result.get('pdf').arrayBuffer()) })
  try {
    const pdf = await task.promise
    expect(pdf.numPages).toBeGreaterThanOrEqual(2)
    const page = await pdf.getPage(2)
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ')
    expect(text).toContain('Sample plot')
    expect(JSON.parse(result.get('sourceMap')).some(item => item.path === 'sections/nested.tex')).toBe(true)
  } finally {
    await task.destroy()
  }
}, 150_000)
