import { expect, test } from 'bun:test'
import { createProjectFileSystem, updateFileContent, deleteFile } from './file-system'
import { applyWritingDrafts, draftConflicts } from './writing-drafts'

const template = { documentClass: 'article', packages: [], preamble: '', metadata: {} }

test('compares draft baselines without overwriting newer, identical, or removed sources', () => {
  const original = updateFileContent(createProjectFileSystem(template), 'preamble.tex', 'Original source')
  const drafts = { 'preamble.tex': { base: 'Original source', text: 'My draft' } }
  expect(draftConflicts(original, drafts)).toEqual([])
  const applied = applyWritingDrafts(original, drafts)
  expect(applied.files.get('preamble.tex').content).toBe('My draft')
  expect(draftConflicts(applied, drafts)).toEqual([])
  const changed = updateFileContent(original, 'preamble.tex', 'New project source')
  expect(draftConflicts(changed, drafts)).toEqual(['preamble.tex'])
  expect(applyWritingDrafts(changed, drafts)).toBe(changed)
  const removed = deleteFile(original, 'preamble.tex')
  expect(draftConflicts(removed, drafts)).toEqual(['preamble.tex'])
  expect(applyWritingDrafts(removed, drafts)).toBe(removed)
})
