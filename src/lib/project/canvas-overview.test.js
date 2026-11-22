import { expect, test } from 'bun:test'
import { arrangeCanvas, canvasEdges, documentPage, dropOverviewNodes, normalizeCanvas, pageCapacity, projectOverview } from './canvas-overview'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { createCanvasFixture } from './canvas-test-fixture'
import { generateProjectSource } from '../export/export-actions'
import { buildProjectOutline } from './outline'
import { locateLatexBlock, readLatexBlocks } from './latex-blocks'
import { researchCanvasSchema, validResearchConnection } from './research-graph'

const node = (id, order = 0, data = {}) => ({ id, position: { x: 40, y: 40 + order * 80 },
  data: { section: 'custom', customLabel: id, content: `Text for ${id}`, order, level: 1, ...data },
})
const page = (id, nodes, edges = []) => ({ id, name: id, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } })
const link = (source, target) => ({ id: `${source}-${target}`, source, target })

test('drops a selected group in another page, maintaining layout, edges and document order', async () => {
  const old = normalizeCanvas({ activePageId: 'A', pages: [page('A', [node('a'), node('b', 1, { parentId: 'a' }), node('c', 2, { parentId: 'a' })], [link('a', 'b'), link('b', 'c')]), page('B', [node('d', 3)])] })
  const { regions } = projectOverview(old)
  const start = regions[1].origin
  const positions = new Map([['a', { x: start.x + 40, y: 70 }], ['b', { x: start.x + 80, y: 170 }]])
  const { canvas, detached } = dropOverviewNodes(old, regions, 'a', positions)
  expect(canvas.pages[1].nodes.map(node => node.id)).toEqual(['a', 'b', 'd'])
  expect(canvas.pages[1].nodes[1]).toMatchObject({ position: { x: 80, y: 122 }, data: { parentId: 'a' } })
  expect(detached.map(node => node.id)).toEqual(['c'])
  expect(canvas.crossPageEdges).toEqual([link('b', 'c')])
  expect(validResearchConnection(projectOverview(canvas).page, 'c', 'a')).toBe(false)
  expect(researchCanvasSchema.safeParse(canvas).success).toBe(true)
  expect(dropOverviewNodes(old, regions, 'a', new Map([['a', { x: -1000, y: 0 }]]))).toBeUndefined()
  const fixture = await createCanvasFixture()
  const project = { ...fixture, metadata: { ...fixture.metadata, sourceMode: undefined } }
  expect(generateProjectSource(documentPage(canvas), project, undefined, true)).toBe(generateProjectSource(documentPage(old), project, undefined, true))
})

test('auto arrange proposes continuations, groups resources with their chapter, and keeps the same graph', () => {
  const cards = Array.from({ length: 11 }, (_, n) => node(`card-${n}`, n))
  cards.push(node('chapter', 11), node('chart', 12, { parentId: 'chapter', resource: { kind: 'image', path: 'chart.png' } }))
  const old = { activePageId: 'A', globalOrder: true, pages: [page('A', cards, [link('card-10', 'chapter')])] }
  const result = arrangeCanvas(old, () => 'second')
  expect(result.newPages.map(page => page.name)).toEqual(['A (2)'])
  expect(result.canvas.pages.every(page => page.nodes.length <= pageCapacity)).toBe(true)
  expect(result.canvas.pages[1].nodes.map(node => node.id)).toEqual(['chapter', 'chart'])
  expect(result.canvas.pages[1].nodes[1].data.parentId).toBe('chapter')
  expect(canvasEdges(result.canvas)).toEqual(canvasEdges(old))
  expect(documentPage(result.canvas).nodes.map(node => node.id)).toEqual(documentPage(old).nodes.map(node => node.id))
})

test('resolves a figure and table through source changes and backup restoration', async () => {
  const project = await createCanvasFixture()
  const blocks = []
  buildProjectOutline(project, 'main.tex', undefined, (file, text) => blocks.push(...readLatexBlocks(project, 'main.tex', file, text)
    .filter(block => block.kind === 'figure' || block.kind === 'table')))
  expect(blocks.map(item => [item.kind, item.label, item.imagePath])).toEqual([
    ['figure', 'fig:plot', 'figures/plot.png'], ['table', 'tab:sample', undefined],
  ])
  const id = project.metadata.createdAt
  const [image, table] = blocks.map(item => node(item.kind, 0, {
    figureAnchor: { project: id, kind: item.kind, path: item.path, label: item.label, caption: item.caption },
    resource: item.kind === 'figure' ? { kind: 'image', path: item.imagePath } : { kind: 'table' },
  }))
  const original = normalizeCanvas({ activePageId: 'A', display: 'overview', overviewViewport: { x: 40, y: 130, zoom: 0.75 },
    pages: [page('A', [image]), page('B', [table])], crossPageEdges: [link(image.id, table.id)],
  })
  const restored = await decodeProjectBackup(await encodeProjectBackup(original, project))
  expect(restored.canvas).toEqual(original)
  const draft = '\n\n' + project.files.get(blocks[0].path).content.replace('Sample plot', 'Updated chart')
  const current = readLatexBlocks(restored.project, 'main.tex', blocks[0].path, draft)
  expect(locateLatexBlock(current, id, restored.canvas.pages[0].nodes[0].data.figureAnchor)).toMatchObject({
    caption: expect.stringContaining('Updated chart'), line: blocks[0].line + 2,
  })
  expect(locateLatexBlock(current, id, restored.canvas.pages[1].nodes[0].data.figureAnchor)?.label).toBe('tab:sample')
})
