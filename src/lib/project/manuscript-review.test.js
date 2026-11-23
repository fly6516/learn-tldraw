import { expect, test } from 'bun:test'
import { buildManuscriptSnapshot, manuscriptReviewFiles } from './manuscript-review'
import { nextChatCheckpoint } from './writing-chat-actions'

const source = (path, content) => [path, { path, content, type: 'editable', metadata: { editable: true } }]
const project = () => ({
  metadata: { mainFile: 'main.tex' },
  files: new Map([source('main.tex', 'Main.'), source('results.tex', 'Original.'), source('methods.tex', 'Protocol.')]),
})
const saved = { saved: 'Original.' }
const authorDraft = { ...saved, draft: { base: saved.saved, text: 'Author notes.' } }
const aiDraft = { ...saved, draft: { base: saved.saved, text: 'Author notes and AI text.' } }
const result = 'results.tex'
const batch = (before, after) => ({ state: 'draft', before: { [result]: before }, after: { [result]: after } })

test('compiles only explicitly selected task drafts and restores their precise pre-save state', () => {
  const original = project()
  const drafts = { [result]: aiDraft.draft, 'main.tex': { base: 'Main.', text: 'Excluded author draft.' } }
  const chapters = [batch(authorDraft, aiDraft)]
  expect(manuscriptReviewFiles(chapters, original, drafts)[0]).toMatchObject({ hasAuthorDraft: true, conflict: false })
  const { candidate, checkpoint } = buildManuscriptSnapshot(original, drafts, chapters, [result], [])
  expect(candidate.files.get(result).content).toBe(aiDraft.draft.text)
  expect(candidate.files.get('main.tex').content).toBe('Main.')
  expect(original.files.get(result).content).toBe(saved.saved)
  expect(nextChatCheckpoint({ kind: 'undo' }, checkpoint.after, 'main.tex', checkpoint).after).toEqual({ [result]: aiDraft })
  expect(() => buildManuscriptSnapshot(original, drafts, chapters, ['main.tex'], [])).toThrow('main.tex')
})

test('preserves a conflict across later repair batches and requires an explicit author choice', () => {
  const updated = { ...saved, draft: { base: saved.saved, text: 'Author clarification after batch.' } }
  const repaired = { ...saved, draft: { base: saved.saved, text: 'Repaired with author clarification.' } }
  const chapters = [batch(saved, aiDraft), batch(updated, repaired)]
  const drafts = { [result]: repaired.draft }
  expect(manuscriptReviewFiles(chapters, project(), drafts)[0]).toMatchObject({ conflict: true, current: repaired, expected: repaired })
  expect(() => buildManuscriptSnapshot(project(), drafts, chapters, [result], [])).toThrow('results.tex')
  expect(buildManuscriptSnapshot(project(), drafts, chapters, [result], [result]).candidate.files.get(result).content)
    .toBe(repaired.draft.text)
})
