import { expect, test } from 'bun:test'
import { searchCanvasNodes } from './canvas-search'
import { emptyPage } from './research-graph'

test('searches node fields across pages and returns the page and node together', () => {
  const position = { x: 0, y: 0 }
  const pages = [
    { ...emptyPage('Structure', 'structure'), nodes: [
      { id: 'shared-id', position, data: { section: 'method', content: 'Review [Draft].', order: 0, level: 1 } },
    ] },
    { ...emptyPage('Appendix', 'appendix'), nodes: [
      { id: 'shared-id', position, data: { section: 'custom', customLabel: 'Supplement', content: 'Study notes', order: 0,
        level: 2, tags: ['[draft]'], metadata: { sectionNumber: 'A.2', importSource: 'paper.tex' } } },
    ] },
  ]
  expect(searchCanvasNodes(pages, '[draft]').matches).toMatchObject([
    { pageId: 'structure', nodeId: 'shared-id', pageName: 'Structure', title: 'Method', match: '[Draft]' },
    { pageId: 'appendix', nodeId: 'shared-id', pageName: 'Appendix', title: 'Supplement', match: '[draft]' },
  ])
  expect(searchCanvasNodes(pages, 'A.2').matches.map(hit => hit.pageId)).toEqual(['appendix'])
  expect(searchCanvasNodes(pages, 'missing').matches).toEqual([])
})
