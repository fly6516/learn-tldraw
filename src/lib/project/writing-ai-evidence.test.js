import { expect, test } from 'bun:test'
import { captureEvidenceQuote, locateEvidence } from './writing-ai-evidence'

const oldPath = 'sections/results.tex'
const newPath = 'sections/findings.tex'
const text = 'Opening.\r\nThe measured temperatures are synthetic.\r\nClosing.'
const evidence = { path: oldPath, anchor: captureEvidenceQuote(oldPath, text, 2) }
const project = (...entries) => ({ files: new Map(entries.map(([path, content]) => [path, { content }])) })

test('follows recorded file moves and shifted lines without following a recreated old path', () => {
  const moved = project([newPath, '\r\nNew line.\r\n' + text], [oldPath, text])
  const history = [{ from: oldPath, to: newPath }]
  expect(locateEvidence(moved, evidence, history, 0)).toMatchObject({ path: newPath, line: 4 })
  expect(locateEvidence(moved, evidence, history, 1)).toMatchObject({ path: oldPath, line: 2 })
  const undo = [...history, { from: newPath, to: oldPath }]
  expect(locateEvidence(project([oldPath, text]), evidence, undo, 0)).toMatchObject({ path: oldPath, line: 2 })
})

test('withholds a link when exact blocks repeat or the source is absent or changed', () => {
  const block = 'A'.repeat(60) + '\nThe measured temperatures are synthetic.\n' + 'B'.repeat(60)
  const anchor = captureEvidenceQuote(oldPath, block, 2)
  const item = { path: oldPath, anchor }
  expect(locateEvidence(project([oldPath, block + '\n' + block]), item, [], 0)).toBeUndefined()
  expect(locateEvidence(project([newPath, block]), item, [], 0)).toBeUndefined()
  expect(locateEvidence(project([oldPath, 'Note: The measured temperatures are synthetic.']), item, [], 0)).toBeUndefined()
  expect(locateEvidence(project([oldPath, block]), { path: oldPath }, [], 0)).toBeUndefined()
})

test('does not switch to another occurrence when the originally disambiguated line is removed', () => {
  const first = 'A'.repeat(60) + '\nThe measured temperatures are synthetic.\n' + 'B'.repeat(60)
  const second = 'C'.repeat(60) + '\nThe measured temperatures are synthetic.\n' + 'D'.repeat(60)
  const repeated = first + '\n' + second
  const item = { path: oldPath, anchor: captureEvidenceQuote(oldPath, repeated, 2) }
  expect(locateEvidence(project([oldPath, repeated]), item, [], 0)?.line).toBe(2)
  expect(locateEvidence(project([oldPath, second]), item, [], 0)).toBeUndefined()
})
