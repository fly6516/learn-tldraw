import { expect, test } from 'bun:test'
import { nextChatCheckpoint } from './writing-chat-actions'

const main = 'paper.tex'
const current = {
  'methods.tex': { saved: 'A method.', draft: { base: 'A method.', text: 'The method.' } },
  'results.tex': { saved: 'A result.' },
}
const run = { main, sources: current }
const action = { kind: 'apply', run, edits: [
  { path: 'methods.tex', before: 'The method.', after: 'The protocol.' },
  { path: 'results.tex', before: 'A result.', after: 'A finding.' },
] }

test('stages selected AI edits as drafts and saves without losing the undo baseline', () => {
  const staged = nextChatCheckpoint(action, current, main)
  expect(staged.state).toBe('draft')
  expect(staged.after['methods.tex']).toEqual({ saved: 'A method.', draft: { base: 'A method.', text: 'The protocol.' } })
  const saved = nextChatCheckpoint({ kind: 'save' }, staged.after, main, staged)
  expect(saved.after).toEqual({ 'methods.tex': { saved: 'The protocol.' }, 'results.tex': { saved: 'A finding.' } })
  expect(nextChatCheckpoint({ kind: 'undo' }, saved.after, main, saved).after).toEqual(current)
})

test('rejects stale sources, stale drafts, out-of-scope edits and a changed compile entry', () => {
  expect(() => nextChatCheckpoint(action, { ...current, 'results.tex': { saved: 'New result.' } }, main)).toThrow('results.tex')
  expect(() => nextChatCheckpoint(action, { ...current, 'methods.tex': { saved: 'A method.' } }, main)).toThrow('methods.tex')
  expect(() => nextChatCheckpoint(action, current, 'other.tex')).toThrow('compile entry')
  expect(() => nextChatCheckpoint({ ...action, edits: [{ path: 'extra.tex', before: 'Old', after: 'New' }] }, current, main)).toThrow('extra.tex')
})

test('keeps a newer draft during undo and never replays a saved or rejected proposal', () => {
  const saved = nextChatCheckpoint({ ...action, kind: 'apply-save' }, current, main)
  expect(saved.state).toBe('saved')
  expect(() => nextChatCheckpoint({ kind: 'undo' }, {
    ...saved.after, 'results.tex': { saved: 'A finding.', draft: { base: 'A finding.', text: 'A new finding.' } },
  }, main, saved)).toThrow('results.tex')
  expect(nextChatCheckpoint(action, current, main, saved)).toBeUndefined()
  const rejected = nextChatCheckpoint({ kind: 'reject' }, {}, main)
  expect(nextChatCheckpoint(action, current, main, rejected)).toBeUndefined()
})
