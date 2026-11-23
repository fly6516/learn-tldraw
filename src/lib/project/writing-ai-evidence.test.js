import { expect, test } from 'bun:test'
import { captureEvidenceQuote, inlineEvidenceTargets, locateEvidence } from './writing-ai-evidence'

test('links only observed citations and makes changed or ambiguous locations available for fresh evidence', () => {
  const original = 'Opening\nObserved result.\nEnd'
  const item = { path: 'sections/a.tex', line: 2, text: 'Observed result.', kind: 'read_source',
    anchor: captureEvidenceQuote('sections/a.tex', original, 2) }
  const bibPath = 'refs.bib'
  const bib = '@book{source2020, title={Observed title}}'
  const reference = { path: bibPath, line: 1, text: 'source2020 · Observed title', kind: 'query_references',
    anchor: captureEvidenceQuote(bibPath, bib, 1) }
  const project = content => ({ files: new Map([['sections/b.tex', { content }], [bibPath, { content: bib }]]) })
  const moves = [{ from: 'sections/a.tex', to: 'sections/b.tex' }]
  const definitions = new Map([['source2020', { path: bibPath, line: 1 }]])
  const found = inlineEvidenceTargets(project('Inserted\n' + original), [item, reference], moves, 0, definitions)
  expect(found.get('sections/a.tex:2').location).toMatchObject({ path: 'sections/b.tex', line: 3 })
  expect(found.has('sections/a.tex:999')).toBe(false)
  expect(found.get('@source2020').location).toMatchObject({ path: bibPath, line: 1 })
  const ambiguous = inlineEvidenceTargets(project(original + '\n' + original), [item, reference], moves, 0, new Map())
  expect(ambiguous.get('sections/a.tex:2').location).toBeUndefined()
  expect(ambiguous.get('source2020').location).toBeUndefined()
})

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
