import { expect, test } from 'bun:test'
import { aiReadExclusionsSchema, aiReadScope } from './ai-read-scope'

test('protects only valid files or folder paths and follows the rename chain in both directions', () => {
  expect(aiReadExclusionsSchema.parse(['private/', 'new.tex'])).toEqual(['private/', 'new.tex'])
  expect(aiReadExclusionsSchema.safeParse(['../private/']).success).toBe(false)
  const scope = aiReadScope(['private/', 'new.tex'], [
    { from: 'original.tex', to: 'old.tex' }, { from: 'old.tex', to: 'new.tex' },
    { from: 'private/raw.csv', to: 'data/moved.csv' },
  ])
  for (const path of ['original.tex', 'old.tex', 'new.tex', 'private/raw.csv', 'data/moved.csv']) expect(scope.denies(path)).toBe(true)
  expect(scope.denies('private-notes/readme.md')).toBe(false)
})
