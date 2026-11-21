import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import {
  ArrowBindingUtil, ArrowShapeUtil, createBindingId, createShapeId, createTLStore,
  getSnapshot, loadSnapshot, PageRecordType,
} from 'tldraw'
import { ResearchNodeShapeUtil } from '../../shapes/research/ResearchNodeShapeUtil'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { addFigure, createProjectFileSystem, updateFileContent } from './file-system'

const template = {
  documentClass: 'article',
  preamble: '',
  packages: [],
  metadata: {},
}

test('restores custom nodes, arrow bindings, page layout, and attachments into a fresh store', async () => {
  const original = createTLStore({ shapeUtils: [ResearchNodeShapeUtil, ArrowShapeUtil] })
  original.ensureStoreIsUsable()
  const page = original.allRecords().find(record => record.typeName === 'page')
  const secondPage = PageRecordType.create({ name: 'Appendix', index: 'a2' })
  const shape = original.schema.types.shape
  const first = shape.create({
    id: createShapeId(), type: 'research-node', parentId: page.id, index: 'a1', x: 120, y: 270,
    props: { ...ResearchNodeShapeUtil.prototype.getDefaultProps(), content: 'Restored heading' },
  })
  const second = shape.create({ ...first, id: createShapeId(), index: 'a2', x: 620 })
  const arrow = shape.create({
    id: createShapeId(), type: 'arrow', parentId: page.id, index: 'a3',
    props: ArrowShapeUtil.prototype.getDefaultProps(),
  })
  const start = original.schema.types.binding.create({
    id: createBindingId(), type: 'arrow', fromId: arrow.id, toId: first.id,
    props: { ...ArrowBindingUtil.prototype.getDefaultProps(), terminal: 'start' },
  })
  const end = original.schema.types.binding.create({
    ...start, id: createBindingId(), toId: second.id, props: { ...start.props, terminal: 'end' },
  })
  const bytes = Uint8Array.of(0, 37, 128, 255)
  const asset = original.schema.types.asset.create({
    id: 'asset:example', type: 'image',
    props: {
      name: 'canvas.png', src: 'data:image/png;base64,ACWA/w==', w: 1, h: 1,
      mimeType: 'image/png', isAnimated: false,
    },
  })
  original.put([secondPage, first, second, arrow, start, end, asset])
  const project = addFigure(
    updateFileContent(createProjectFileSystem(template, 'Portable paper'), 'preamble.tex', 'custom'),
    'figure.png',
    new Blob([bytes], { type: 'image/png' }),
  )
  const snapshot = getSnapshot(original)
  const restored = await decodeProjectBackup(await encodeProjectBackup(snapshot, project))

  const destination = createTLStore({ schema: original.schema })
  loadSnapshot(destination, restored.canvas, { forceOverwriteSessionState: true })
  expect(destination.getStoreSnapshot()).toEqual(original.getStoreSnapshot())
  expect(restored.canvas.session).toEqual(snapshot.session)
  expect(restored.project.metadata.projectName).toBe('Portable paper')
  expect(restored.project.files.get('preamble.tex').content).toBe('custom')
  const figure = restored.project.files.get('figures/figure.png')
  expect(figure.blob.type).toBe('image/png')
  expect(new Uint8Array(await figure.blob.arrayBuffer())).toEqual(bytes)
  expect(restored.project.files.get('figures/').files).toEqual([figure])
})

test('rejects incompatible backups and archives with missing attachments', async () => {
  const store = createTLStore()
  store.ensureStoreIsUsable()
  const project = addFigure(createProjectFileSystem(template), 'figure.png', new Blob(['image']))
  const backup = await encodeProjectBackup(getSnapshot(store), project)
  const archive = await JSZip.loadAsync(await backup.arrayBuffer())
  archive.remove('attachments')
  await expect(decodeProjectBackup(new Blob([await archive.generateAsync({ type: 'uint8array' })])))
    .rejects.toThrow('Missing project attachment')

  const manifest = JSON.parse(await archive.file('project.json').async('text'))
  archive.file('project.json', JSON.stringify({ ...manifest, version: 2 }))
  await expect(decodeProjectBackup(new Blob([await archive.generateAsync({ type: 'uint8array' })])))
    .rejects.toThrow('unsupported version')
})
