import { expect, test } from 'bun:test'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { materialKind, researchCardKinds } from './canvas-card-kinds'
import { recordHistory, stepCanvasHistory } from './canvas-history'
import { documentPage, dropOverviewNodes, normalizeCanvas, projectOverview } from './canvas-overview'
import { searchCanvasNodes } from './canvas-search'
import { createCanvasFixture } from './canvas-test-fixture'
import { updateFileContent } from './file-system'
import { collectBibliography, indexCanvasReferences } from './references'
import { describeSnapshotRestore } from './snapshots'

test('indexes updated bibliography metadata and citation locations, and rejects ambiguous keys', async () => {
  const project = await createCanvasFixture()
  const bibPath = 'references/library.bib'
  const methodPath = 'sections/methods.tex'
  const bib = project.files.get(bibPath).content
  const updated = updateFileContent(updateFileContent(project, bibPath, '\n\n' + bib),
    methodPath, '\\cite{sample2020}\n' + project.files.get(methodPath).content)
  const references = indexCanvasReferences(updated, collectBibliography(updated))
  expect(references.definitions.get('sample2020')).toMatchObject({ path: bibPath, line: 3, year: '2020' })
  expect(references.uses.get('sample2020')).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: methodPath, line: 1 }),
    expect.objectContaining({ path: 'sections/introduction.tex' }),
  ]))
  const duplicate = updateFileContent(project, bibPath, bib + '\n' + bib)
  expect(indexCanvasReferences(duplicate, collectBibliography(duplicate)).definitions.get('sample2020')).toBeUndefined()
})

test('moves and restores materials and research cards with paths, status and custom type intact', async () => {
  const project = await createCanvasFixture()
  const assets = ['data/values.csv', 'attachments/notes.txt', 'figures/plot.png']
  const resources = assets.map(path => ({ kind: materialKind(path), path }))
  expect(resources.map(resource => resource.kind)).toEqual(['dataset', 'attachment', 'image'])
  resources.push({ kind: 'bibliography', project: project.metadata.createdAt, key: 'sample2020' })
  resources.push(...researchCardKinds.map(role => ({ kind: 'research', role,
    ...(role === 'custom' ? { customType: 'Analysis decision' } : {}),
    ...(role === 'task' ? { status: 'done' } : {}),
  })))
  const cards = resources.map((resource, index) => ({
    id: 'card-' + index, position: { x: 50, y: 50 + index * 230 },
    data: { section: 'custom', order: index + 20, content: '', level: 1, resource },
  }))
  const canvas = normalizeCanvas({ ...project.canvas, display: 'overview',
    pages: project.canvas.pages.map((page, index) => index === 1 ? { ...page, nodes: [...page.nodes, ...cards] } : page),
  })
  const { regions } = projectOverview(canvas)
  const target = regions[0].origin
  const moved = dropOverviewNodes(canvas, regions, cards[0].id, new Map(cards.slice(0, 2).map((card, index) => [
    card.id, { x: target.x + 50, y: target.y + 100 + index * 230 },
  ]))).canvas
  expect(moved.pages[0].nodes.slice(-2).map(node => node.id)).toEqual(cards.slice(0, 2).map(card => card.id))
  expect(documentPage(moved).nodes.map(node => node.id)).toEqual(documentPage(canvas).nodes.map(node => node.id))
  const history = recordHistory({ undo: [], redo: [] }, canvas)
  const undo = stepCanvasHistory(history, moved, 'undo')
  expect(undo.snapshot).toEqual(canvas)
  expect(stepCanvasHistory(undo.history, canvas, 'redo').snapshot).toEqual(moved)
  const restored = await decodeProjectBackup(await encodeProjectBackup(moved, project))
  expect(restored.canvas).toEqual(moved)
  for (const path of assets) {
    expect(await restored.project.files.get(path).blob.arrayBuffer()).toEqual(await project.files.get(path).blob.arrayBuffer())
  }
  const reference = restored.canvas.pages[1].nodes.find(node => node.data.resource?.kind === 'bibliography')
  const entry = collectBibliography(restored.project).find(entry => entry.key === 'sample2020')
  expect(searchCanvasNodes(restored.canvas.pages, entry.author, undefined, new Map([[reference.data, entry]])).matches[0].nodeId)
    .toBe(reference.id)
  expect(searchCanvasNodes(restored.canvas.pages, 'Analysis decision').matches).toHaveLength(1)
  expect(searchCanvasNodes(restored.canvas.pages, 'done').matches).toHaveLength(1)
  expect((await describeSnapshotRestore(restored.project, { ...project, canvas })).pages).toHaveLength(2)
})
