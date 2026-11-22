import { expect, test } from 'bun:test'
import { createCanvasFixture } from './canvas-test-fixture'
import { planFileOperation } from './file-refactor'
import { buildProjectOutline } from './outline'
import { bindReviewTarget, makeSelectionAnchor, resolveSelectionAnchor } from './review-links'
import { applyWritingDrafts, draftConflicts } from './writing-drafts'

test('creates a subsection and moves it with its drafts, inputs and review anchors', async () => {
  const project = await createCanvasFixture()
  const from = 'sections/results-extra.tex'
  const to = 'chapters/details/extra.tex'
  const created = planFileOperation(project, { drafts: {} }, 'main.tex',
    { kind: 'chapter', parent: 'sections/results.tex', to: from, title: 'Sensitivity checks' })
  const base = created.project.files.get(from).content
  const text = base + 'An unsaved result.\n'
  const id = project.metadata.createdAt
  const selection = makeSelectionAnchor(id, from, text, text.indexOf('An unsaved'), text.indexOf('An unsaved') + 10)
  const page = created.project.canvas.pages[1]
  const review = { id: 'review', position: { x: 100, y: 200 }, data: bindReviewTarget({
    section: 'custom', content: 'Verify the estimate.', order: 2, level: 1,
    resource: { kind: 'research', role: 'task', status: 'open' },
  }, { type: 'selection', anchor: selection }) }
  const section = { id: 'subsection', position: { x: 400, y: 200 }, data: {
    section: 'custom', content: 'Preserve this note.', order: 3, level: 2,
    sourceAnchor: { kind: 'label', project: id, label: 'sec:sections-results-extra' },
  } }
  page.nodes.push(review, section)
  page.edges.push({ id: 'comment', source: section.id, target: review.id })
  const moved = planFileOperation(created.project, { drafts: { [from]: { base, text } },
    view: { path: from, lineNumber: 2, column: 1 } }, 'main.tex', { kind: 'move', from, to })
  expect(moved.changes).toMatchObject([{ path: 'sections/results.tex', from: 'sections/results-extra', to: 'chapters/details/extra' }])
  expect(moved.draftPaths).toEqual([from])
  expect(moved.bindings.map(item => item.kind)).toEqual(['Review selection', 'Section or review · label retained'])
  expect(moved.writing.view.path).toBe(to)
  expect(moved.project.files.has(from)).toBe(false)
  expect(moved.project.files.get(to).content).toBe(base)
  expect(draftConflicts(moved.project, moved.writing.drafts)).toEqual([])
  const working = applyWritingDrafts(moved.project, moved.writing.drafts)
  expect(working.files.get(to).content).toBe(text)
  expect(buildProjectOutline(working, 'main.tex').find(heading => heading.title === 'Results').children)
    .toMatchObject([{ path: to, title: 'Sensitivity checks' }])
  const target = moved.project.canvas.pages[1]
  expect(target.edges).toEqual(page.edges)
  expect(target.nodes.at(-2).position).toEqual(review.position)
  expect(resolveSelectionAnchor(id, text, target.nodes.at(-2).data.selectionAnchor)).toMatchObject({ path: to })
})

test('keeps graphics bytes, rewrites literal references and reports unresolved commands', async () => {
  const project = await createCanvasFixture()
  const from = 'figures/plot.png'
  const to = 'images/updated.png'
  const main = project.files.get('main.tex')
  project.files.set(main.path, { ...main, content: main.content + '\n% \\includegraphics{figures/plot.png}\n\\includegraphics{\\plotfile}\n' })
  const moved = planFileOperation(project, { drafts: {} }, main.path, { kind: 'move', from, to })
  expect(moved.project.files.get(to).blob).toBe(project.files.get(from).blob)
  expect(moved.project.files.get('sections/results.tex').content).toContain('\\XeTeXpicfile "images/updated.png"')
  expect(moved.project.files.get(main.path).content).toBe(project.files.get(main.path).content)
  expect(moved.warnings).toMatchObject([{ path: main.path, command: 'includegraphics' }])
  expect(() => planFileOperation(project, { drafts: {} }, main.path, { kind: 'move', from, to: 'main.tex/image.png' }))
    .toThrow('overlaps')
})
