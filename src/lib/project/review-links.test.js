import { expect, test } from 'bun:test'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { createCanvasFixture } from './canvas-test-fixture'
import { sourceOffsetAtPosition } from './latex-source'
import { bindReviewTarget, makeSelectionAnchor, resolveSelectionAnchor, reviewItems } from './review-links'

test('locates the original selection after moving source and refuses ambiguous repeated text', () => {
  const path = 'sections/results.tex'
  const source = '\uFEFFHeading\r\nSelected text\r\nFollowing text'
  const anchor = makeSelectionAnchor('project', path, source,
    sourceOffsetAtPosition(source, { lineNumber: 2, column: 1 }),
    sourceOffsetAtPosition(source, { lineNumber: 2, column: 14 }))
  expect(anchor.quote).toBe('Selected text')
  expect(resolveSelectionAnchor('project', '\n\n' + source, anchor)).toMatchObject({ path, line: 4 })
  expect(resolveSelectionAnchor('project', source.replace('Selected text', 'New text'), anchor)).toBeUndefined()
  expect(resolveSelectionAnchor('project', source + '\n' + source, anchor)).toBeUndefined()
  expect(resolveSelectionAnchor('other project', source, anchor)).toBeUndefined()
})

test('restores a review card status and selected source range from a project backup', async () => {
  const project = await createCanvasFixture()
  const path = 'sections/results.tex'
  const source = project.files.get(path).content
  const start = source.indexOf('Sample plot')
  const anchor = makeSelectionAnchor(project.metadata.createdAt, path, source, start, start + 'Sample plot'.length)
  const data = bindReviewTarget({ section: 'custom', content: 'Check the caption.', order: 0, level: 1,
    resource: { kind: 'research', role: 'review', status: 'done' } }, { type: 'selection', anchor })
  const original = project.canvas
  const canvas = { ...original, pages: [{ ...original.pages[0], nodes: [{ id: 'review', position: { x: 80, y: 90 }, data }] },
    original.pages[1]] }
  const restored = await decodeProjectBackup(await encodeProjectBackup(canvas, project))
  const [item] = reviewItems(restored.canvas.pages, { project: project.metadata.createdAt, files: restored.project.files })
  expect(item).toMatchObject({ nodeId: 'review', pageId: 'planning', resource: { role: 'review', status: 'done' },
    data: { content: 'Check the caption.' }, source: { path, start } })
})
