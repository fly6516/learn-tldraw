import { expect, test } from 'bun:test'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { searchCanvasNodes } from './canvas-search'
import { createCanvasFixture } from './canvas-test-fixture'
import { blockFingerprint, locateLatexBlock, readProjectLatexBlocks } from './latex-blocks'
import { renderLatexMath } from './latex-math-preview'
import { buildProjectOutline } from './outline'
import { emptyCanvas, emptyPage } from './research-graph'

function inspect(project, active) {
  const documents = new Map()
  const preamble = new Map()
  const headings = buildProjectOutline(project, 'main.tex', active, (path, text) => documents.set(path, text),
    (path, text) => preamble.set(path, text))
  return { headings, blocks: readProjectLatexBlocks(project, 'main.tex', documents, preamble) }
}

test('discovers formula groups, algorithms, listings and declared environments', () => {
  const documents = new Map([
    ['preamble.tex', '\\newtheorem{claim}{Claim}\n\\newenvironment{experiment}{}{}'],
    ['chapter.tex', [
      '% \\begin{equation} commented \\end{equation}',
      '\\begin{subequations}\\label{eq:group}',
      '\\begin{align} x &= y \\label{eq:x} \\\\ y &= z \\label{eq:y} \\end{align}',
      '\\end{subequations}',
      '\\begin{algorithm}\\caption{Sensor calibration}\\begin{algorithmic} steps \\end{algorithmic}\\end{algorithm}',
      '\\begin{lstlisting}\n\\begin{equation} literal \\end{equation}\n\\end{lstlisting}',
      '\\begin{claim}[Sensor consistency]\\label{claim:consistency} Statement. \\end{claim}',
      '\\begin{experiment}\\label{experiment:walk} Extended example. \\end{experiment}',
      '\\[ \\Delta T = 0 \\]',
    ].join('\n')],
  ])
  const blocks = readProjectLatexBlocks({ files: new Map() }, 'main.tex', documents)
  expect(blocks.map(block => [block.kind, block.environment])).toEqual([
    ['equation', 'subequations'], ['algorithm', 'algorithm'], ['listing', 'lstlisting'],
    ['theorem', 'claim'], ['environment', 'experiment'], ['equation', 'displaymath'],
  ])
  expect(blocks[0].labels).toEqual(['eq:group', 'eq:x', 'eq:y'])
  expect(blocks[0].equations).toHaveLength(1)
  expect(renderLatexMath(blocks[0].equations[0])).toContain('katex-display')
  expect(blocks[2].preview).toContain('literal')
  expect(blocks[3].caption).toBe('Sensor consistency')
  const listing = blocks[2]
  expect(locateLatexBlock(blocks, 'sample', {
    project: 'sample', kind: listing.kind, path: listing.path, caption: blockFingerprint(listing),
  })).toBe(listing)
})

test('round-trips a formula across pages and resolves its edited source and appendix', async () => {
  const project = await createCanvasFixture()
  const { headings, blocks } = inspect(project)
  expect(blocks.map(block => block.kind)).toEqual(['equation', 'figure', 'table', 'algorithm', 'theorem', 'environment', 'listing'])
  expect(headings.filter(heading => heading.appendix).map(heading => heading.path)).toEqual(['appendices/notes.tex'])
  const formula = blocks.find(block => block.label === 'eq:sample')
  expect(renderLatexMath({ source: formula.preview, environment: formula.environment })).toContain('katex-display')
  expect(renderLatexMath({ source: '\\unknownProjectMacro{x}', environment: 'equation' })).toBeUndefined()
  const figureAnchor = { project: project.metadata.createdAt, kind: 'equation', path: formula.path, label: formula.label, caption: '' }
  const canvas = { ...emptyCanvas, display: 'overview', pages: [...emptyCanvas.pages, {
    ...emptyPage('Methods', 'methods'),
    nodes: [{ id: 'paired', position: { x: 50, y: 60 },
      data: { section: 'custom', content: '', order: 0, level: 1, figureAnchor, resource: { kind: 'equation', environment: 'equation' } },
    }],
  }] }
  const restored = await decodeProjectBackup(await encodeProjectBackup(canvas, project))
  const { data } = restored.canvas.pages[1].nodes[0]
  const source = project.files.get(formula.path).content
  const draft = '\n\n' + source.replace('A = B', 'A = adjusted')
  const current = inspect(restored.project, { path: formula.path, source: draft }).blocks
  const resolved = locateLatexBlock(current, project.metadata.createdAt, data.figureAnchor)
  expect(resolved.line).toBe(formula.line + 2)
  expect(searchCanvasNodes(restored.canvas.pages, 'adjusted', new Map([[data, resolved]])).matches[0])
    .toMatchObject({ pageId: 'methods', nodeId: 'paired' })
  const duplicates = inspect(restored.project, { path: formula.path, source: draft + '\n\\label{eq:sample}' }).blocks
  expect(locateLatexBlock(duplicates, project.metadata.createdAt, data.figureAnchor)).toBeUndefined()
})
