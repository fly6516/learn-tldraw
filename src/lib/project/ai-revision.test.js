import { expect, test } from 'bun:test'
import { archiveReplyEvidence, revisionDraftRequestSchema } from './ai-revision'

test('reply evidence uses changed archive bytes and omits unchanged and unselected files', async () => {
  const expanded = 'Intro. '.repeat(300)
  const changes = await archiveReplyEvidence([
    { path: 'results.tex', status: 'Modified', baseline: new Blob([expanded + 'Original claim.']), current: new Blob([expanded + 'Revised estimate.']) },
    { path: 'unchanged.tex', status: 'Unchanged', baseline: 'Same', current: 'Same' },
    { path: 'unselected.tex', status: 'Added', current: 'Unselected' },
  ], ['results.tex', 'unchanged.tex'])
  expect(changes).toHaveLength(1)
  expect(changes[0].before).toContain('Original claim.')
  expect(changes[0].after).toContain('Revised estimate.')
  expect(changes[0].after.length).toBeLessThan(1500)
  const request = { comment: 'Clarify the result.', original: 'v1', revised: 'v2', kind: 'changed', authorNote: '', changes }
  expect(revisionDraftRequestSchema.safeParse(request).success).toBe(true)
  expect(revisionDraftRequestSchema.safeParse({ ...request, changes: [] }).success).toBe(false)
  expect(revisionDraftRequestSchema.safeParse({ ...request, kind: 'retained', changes: [] }).success).toBe(false)
})
