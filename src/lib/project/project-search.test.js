import { expect, test } from 'bun:test'
import { searchCanvasNodes } from './canvas-search'
import { createCanvasFixture } from './canvas-test-fixture'
import { readLatexBlocks } from './latex-blocks'
import { indexSearchLinks, searchBibliography } from './project-search'
import { collectBibliography, indexCanvasReferences } from './references'
import { searchProjectSources } from './source-search'
import { applyWritingDrafts } from './writing-drafts'

test('searches drafts, bibliography metadata and linked cards through their exact source ranges', async () => {
  const project = await createCanvasFixture()
  const path = 'sections/results.tex'
  const base = project.files.get(path).content
  const text = base.replace('Sample plot', 'Draft plot caption')
  const working = applyWritingDrafts(project, { [path]: { base, text } })
  const figure = readLatexBlocks(working, 'main.tex', path, text)[0]
  const reference = collectBibliography(working)[0]
  const figureData = { section: 'custom', content: '', resource: { kind: 'image' } }
  const pages = [{ id: 'card-page', name: 'Cards', nodes: [{ id: 'plot', data: figureData }] }]
  const source = searchProjectSources(working.files, 'Draft plot caption').matches[0]
  expect(source.path).toBe(path)
  expect(searchProjectSources(project.files, 'Draft plot caption').matches).toHaveLength(0)
  expect(searchCanvasNodes(pages, 'Draft plot caption', new Map([[figureData, figure]])).matches[0].nodeId).toBe('plot')
  const refs = indexCanvasReferences(working, [reference])
  expect(searchBibliography({ references: refs }, 'author 2020').matches).toEqual([reference])
  const index = indexSearchLinks([
    { nodeId: 'plot', pageId: 'card-page', source: figure },
    { nodeId: 'reference', pageId: 'card-page', source: reference },
  ])
  expect(index.byNode.get('plot').source).toBe(figure)
  expect(index.forSource(source).map(link => link.nodeId)).toEqual(['plot'])
  expect(index.forSource(reference).map(link => link.nodeId)).toEqual(['reference'])
  expect(index.forSource({ ...source, start: figure.extentEnd + 1, end: figure.extentEnd + 6 })).toEqual([])
})
