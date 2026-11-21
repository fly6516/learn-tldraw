import { expect, test } from 'bun:test'
import { collectArrowOrderedNodes, emptyPage, removeResearchNodes, validResearchConnection } from './research-graph'
import { generateProjectSource } from '../export/export-actions'
import { generateMarkdownDocument } from '../export/markdown-exporter'
import { generatePdfHtml } from '../export/pdf-exporter'
import { createProjectFileSystem } from './file-system'
import { exportToLatexZip } from './exporter'
import { parseLatexNodes } from '../import/latex-importer'
import JSZip from 'jszip'

const page = {
  ...emptyPage(),
  nodes: [
    { id: 'a', position: { x: 0, y: 10 }, data: { section: 'introduction', content: 'Intro marker', order: 0, level: 1 } },
    { id: 'b', position: { x: 200, y: 50 }, data: { section: 'result', content: 'Results marker', order: 1, level: 1 } },
    { id: 'c', position: { x: 100, y: 30 }, data: { section: 'conclusion', content: 'Closing marker', order: 2, level: 2, parentId: 'a' } },
  ],
  edges: [{ id: 'b-a', source: 'b', target: 'a' }],
}

test('rejects self-links, repeats, cycles and missing endpoints and clears removed references', () => {
  expect(validResearchConnection(page, 'a', 'a')).toBe(false)
  expect(validResearchConnection(page, 'b', 'a')).toBe(false)
  expect(validResearchConnection(page, 'a', 'b')).toBe(false)
  expect(validResearchConnection(page, 'a', 'missing')).toBe(false)
  expect(validResearchConnection(page, 'a', 'c')).toBe(true)
  const updated = removeResearchNodes(page, new Set(['a']))
  expect(updated.edges).toEqual([])
  expect(updated.nodes.find(node => node.id === 'c').data.parentId).toBeUndefined()
})

test('all exporters follow the active page graph or fall back to section order', async () => {
  const project = createProjectFileSystem({ documentClass: 'article', preamble: '', packages: [], metadata: {} })
  for (const current of [page, { ...page, edges: [] }]) {
    const ordered = collectArrowOrderedNodes(current)
    const zip = await exportToLatexZip(ordered ?? current.nodes.map(node => node.data), project, {
      format: 'zip', preserveNodeOrder: Boolean(ordered),
    })
    const archived = await JSZip.loadAsync(await zip.arrayBuffer())
    const latex = generateProjectSource(current, project)
    expect(await archived.file('main.tex').async('text')).toBe(latex)
    const order = ordered ? ['Results marker', 'Intro marker', 'Closing marker'] : ['Intro marker', 'Results marker', 'Closing marker']
    for (const source of [latex, generateMarkdownDocument(current), generatePdfHtml(current)]) {
      const positions = order.map(marker => source.indexOf(marker))
      expect(positions[0]).toBeGreaterThanOrEqual(0)
      expect(positions[1]).toBeGreaterThan(positions[0])
      expect(positions[2]).toBeGreaterThan(positions[1])
    }
  }
})

test('single-file LaTeX imports retain heading hierarchy and labels', () => {
  const [parent, child] = parseLatexNodes(String.raw`\section{Methods}
Example.
\subsection{Measurements}
Sample text.`)
  expect(parent.data.customLabel).toBe('Methods')
  expect(child.data).toMatchObject({ customLabel: 'Measurements', parentId: parent.id, level: 2 })
})
