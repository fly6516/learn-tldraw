import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { addFigure, createProjectFileSystem, updateFileContent } from './file-system'
import { emptyPage } from './research-graph'

const template = { documentClass: 'article', preamble: '', packages: [], metadata: {} }
const node = (id, x, data = {}) => ({
  id, position: { x, y: 274 }, data: { section: 'custom', content: id, level: 1, order: 1, ...data },
})
const canvas = {
  activePageId: 'results',
  pages: [
    { ...emptyPage(), nodes: [node('intro', 120)] },
    {
      ...emptyPage('Results', 'results'), viewport: { x: 25, y: 30, zoom: 0.7 },
      nodes: [node('results', 620, { sourceAnchor: { kind: 'label', project: 'example', label: 'sec:results' } }),
        node('detail', 100, { parentId: 'results', level: 2, tags: ['test'] })],
      edges: [{ id: 'order', source: 'results', target: 'detail' }],
    },
  ],
}

test('round-trips graph pages, node positions, directed edges, viewports, and attachments', async () => {
  const bytes = Uint8Array.of(0, 37, 128, 255)
  const project = addFigure(
    updateFileContent(createProjectFileSystem(template, 'Portable paper'), 'preamble.tex', 'custom'),
    'figure.png', new Blob([bytes], { type: 'image/png' }),
  )
  const restored = await decodeProjectBackup(await encodeProjectBackup(canvas, project))
  expect(restored.project.canvas).toEqual(canvas)
  expect(restored.project.metadata.projectName).toBe('Portable paper')
  expect(restored.project.files.get('preamble.tex').content).toBe('custom')
  const figure = restored.project.files.get('figures/figure.png')
  expect(figure.blob.type).toBe('image/png')
  expect(new Uint8Array(await figure.blob.arrayBuffer())).toEqual(bytes)
  expect(restored.project.files.get('figures/').files).toEqual([figure])
})

test('rejects old backups, invalid graphs and missing attachments', async () => {
  const project = addFigure(createProjectFileSystem(template), 'figure.png', new Blob(['image']))
  const backup = await encodeProjectBackup(canvas, project)
  const archive = await JSZip.loadAsync(await backup.arrayBuffer())
  const manifest = JSON.parse(await archive.file('project.json').async('text'))
  async function read(candidate) {
    archive.file('project.json', JSON.stringify(candidate))
    return decodeProjectBackup(await archive.generateAsync({ type: 'blob' }))
  }
  await expect(read({ ...manifest, version: 1 })).rejects.toThrow('unsupported version')
  const corrupted = structuredClone(manifest)
  corrupted.canvas.pages[1].edges.push({ id: 'cycle', source: 'detail', target: 'results' })
  await expect(read(corrupted)).rejects.toThrow('invalid')
  archive.remove('attachments')
  await expect(read(manifest)).rejects.toThrow('Missing project attachment')
})
