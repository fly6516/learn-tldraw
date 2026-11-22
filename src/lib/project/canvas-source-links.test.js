import { expect, test } from 'bun:test'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { recordHistory, stepCanvasHistory } from './canvas-history'
import { findSourceLinkIssues, repairSourceLink, sourceLinkTargets } from './canvas-source-links'
import { createCanvasFixture } from './canvas-test-fixture'
import { updateFileContent } from './file-system'
import { readProjectLatexBlocks } from './latex-blocks'
import { indexLatexLabels } from './latex-source'
import { buildProjectOutline } from './outline'
import { collectBibliography, indexCanvasReferences } from './references'
import { resolveSectionAnchor, indexOutline } from './section-links'

function catalog(project) {
  const main = project.metadata.mainFile
  const documents = new Map()
  const preamble = new Map()
  const headings = buildProjectOutline(project, main, undefined, (path, source) => documents.set(path, source),
    (path, source) => preamble.set(path, source))
  const labels = indexLatexLabels(new Map([...preamble, ...documents]))
  return { project: project.metadata.createdAt, index: indexOutline(headings, labels),
    blocks: readProjectLatexBlocks(project, main, documents, preamble, labels),
    references: indexCanvasReferences(project, collectBibliography(project)), files: project.files,
  }
}

test('keeps a moved heading linked and reports competing labels even outside headings', async () => {
  const project = await createCanvasFixture()
  const path = 'sections/results.tex'
  const moved = updateFileContent(project, path, '\n\n' + project.files.get(path).content.replace('{Results}', '{Revised results}'))
  const index = catalog(moved)
  const { sourceAnchor } = project.canvas.pages[1].nodes[0].data
  expect(findSourceLinkIssues(moved.canvas.pages, index)).toEqual([])
  expect(resolveSectionAnchor(index.index, index.project, sourceAnchor)).toMatchObject({ path, line: 3, title: 'Revised results' })
  const other = 'sections/methods.tex'
  const conflict = updateFileContent(moved, other, moved.files.get(other).content + '\n\\label{sec:results}')
  const current = catalog(conflict)
  expect(resolveSectionAnchor(current.index, current.project, sourceAnchor)).toBeUndefined()
  expect(findSourceLinkIssues(moved.canvas.pages, current)).toMatchObject([{
    nodeId: 'results', resolution: { status: 'conflict', locations: [{ path: other }, { path, line: 3 }] },
  }])
})

test('repairs existing section, block and bibliography cards without changing graph or losing links in backups', async () => {
  let project = await createCanvasFixture()
  const id = project.metadata.createdAt
  const extra = [
    { figureAnchor: { project: id, kind: 'equation', label: 'eq:sample', path: 'sections/methods.tex', caption: '' },
      resource: { kind: 'equation', environment: 'equation' } },
    { resource: { kind: 'bibliography', project: id, key: 'sample2020' } },
  ].map((data, i) => ({
    id: 'card-' + i, position: { x: 42, y: 90 + i * 300 },
    data: { content: 'Keep this note.', section: 'custom', order: 4 + i, level: 1, ...data },
  }))
  const [first, second] = project.canvas.pages
  const original = { ...project.canvas, display: 'overview', pages: [{ ...first, nodes: extra }, second],
    crossPageEdges: [{ id: 'across', source: extra[0].id, target: second.nodes[0].id }] }
  expect(findSourceLinkIssues(original.pages, catalog(project))).toEqual([])
  const method = 'sections/methods.tex'
  const results = 'sections/results.tex'
  const bibliography = 'references/library.bib'
  project = updateFileContent(project, method, project.files.get(method).content +
    '\n\\label{eq:sample}\n\\begin{equation}\\label{eq:other} a=b \\end{equation}')
  project = updateFileContent(project, results, project.files.get(results).content.replace('sec:results', 'sec:replacement'))
  const entry = project.files.get(bibliography).content
  project = updateFileContent(project, bibliography, [entry, entry, entry.replace('sample2020', 'other2020')].join('\n'))
  const current = catalog(project)
  const issues = findSourceLinkIssues(original.pages, current)
  expect(issues.map(issue => [issue.link.type, issue.resolution.status])).toEqual([
    ['block', 'conflict'], ['bibliography', 'conflict'], ['section', 'missing'],
  ])
  let repaired = original
  for (const issue of issues) {
    const candidates = sourceLinkTargets(repaired, current, issue)
    const target = candidates.find(({ link, title }) => link.type === 'section' ? title === 'Results'
      : (link.type === 'block' ? link.anchor.label === 'eq:other' : link.anchor.key === 'other2020'))
    expect(target).toBeDefined()
    expect(repairSourceLink(repaired, current, issue, { ...target, title: 'Stale preview' })).toBe(repaired)
    repaired = repairSourceLink(repaired, current, issue, target)
  }
  expect(findSourceLinkIssues(repaired.pages, current)).toEqual([])
  expect(repaired.crossPageEdges).toEqual(original.crossPageEdges)
  for (const [i, page] of repaired.pages.entries()) {
    expect(page.edges).toEqual(original.pages[i].edges)
    expect(page.nodes.map(node => [node.id, node.position, node.data.content]))
      .toEqual(original.pages[i].nodes.map(node => [node.id, node.position, node.data.content]))
  }
  const undo = stepCanvasHistory(recordHistory({ undo: [], redo: [] }, original), repaired, 'undo')
  expect(undo.snapshot).toEqual(original)
  const { canvas, project: restored } = await decodeProjectBackup(await encodeProjectBackup(repaired, project))
  expect(canvas).toEqual(repaired)
  expect(findSourceLinkIssues(canvas.pages, catalog(restored))).toEqual([])
})
