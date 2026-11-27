import { expect, test } from 'bun:test'
import { buildRevisionLetter, compareRevisionFiles, editRevisionComment, readRevisionBaseline, revisionResponseStatus } from './revision-rounds'
import { exportSourceArchive } from './source-archive'
import { applyWritingDrafts } from './writing-drafts'
import { compareRevisionChanges } from './revision-evidence'

test('compares working drafts against archived ZIP bytes and identifies files omitted from submission', async () => {
  const tex = 'sections/results.tex'
  const file = (path, content) => ({ path, name: path.split('/').at(-1), type: 'editable', content, metadata: { editable: true } })
  const attachment = (path, bytes, type) => ({ path, name: path, type: 'asset', blob: new Blob([bytes], { type }) })
  const archivedFiles = new Map([
    ['main.tex', file('main.tex', '\\documentclass{article}')],
    [tex, file(tex, 'Submitted text')],
    ['figure.png', attachment('figure.png', 'old', 'image/png')],
    ['removed.txt', file('removed.txt', 'Archived only')],
  ])
  const baseline = await readRevisionBaseline(await exportSourceArchive({ files: archivedFiles }))
  const currentFiles = new Map(archivedFiles)
  currentFiles.delete('removed.txt')
  currentFiles.set('file-excluded-from-zip.txt', file('file-excluded-from-zip.txt', 'Current only'))
  currentFiles.set('figure.png', attachment('figure.png', 'new', 'image/png'))
  const current = applyWritingDrafts({ files: currentFiles, metadata: {} }, { [tex]: { base: 'Submitted text', text: 'Local revision' } })
  const changes = await compareRevisionFiles(baseline, current)
  expect(changes.map(({ path, status }) => [path, status])).toEqual([
    ['figure.png', 'Modified'], ['file-excluded-from-zip.txt', 'Added'], ['main.tex', 'Unchanged'],
    ['removed.txt', 'Removed'], [tex, 'Modified'],
  ])
  const result = changes.find(entry => entry.path === tex)
  expect(await result.baseline.text()).toBe('Submitted text')
  expect((await readRevisionBaseline(await exportSourceArchive(current))).files.get(tex).content).toBe('Local revision')
  expect(archivedFiles.get(tex).content).toBe('Submitted text')
})

test('letters verify exact change locations and reject stale or file-only evidence', async () => {
  const binding = { originalId: 'before', revisedId: 'after', originalSha256: 'a'.repeat(64), revisedSha256: 'b'.repeat(64) }
  const round = { name: 'Revision 1', submissionId: 'before', revisedSubmissionId: 'after', comments: [
    { reviewer: 'Reviewer 1', text: 'Clarify the estimate.', response: { kind: 'changed', text: 'We added a definition.', paths: ['results.tex', 'excluded.tex'] } },
    { reviewer: 'Reviewer 2', text: 'Reword the conclusion.', response: { kind: 'retained', text: 'The original distinction is essential.', paths: [] } },
    { reviewer: 'Reviewer 2', text: 'Include <detail>.' },
  ] }
  const files = [{ path: 'results.tex', status: 'Modified', baseline: 'First.\nContext.\nOld result.',
    current: 'Unrelated change.\nContext.\nNew result.' }, { path: 'methods.tex', status: 'Unchanged' }]
  const changes = await compareRevisionChanges(files)
  expect(changes.map(change => [change.before.start, change.after.start])).toEqual([[1, 1], [3, 3]])
  const render = (selected = binding) => buildRevisionLetter(round, 'Submission v1', 'Submission v2', files, selected, changes)
  const { markdown, unresolved } = render()
  expect(unresolved).toEqual([1, 3])
  expect(markdown).not.toContain('Modified · results.tex')
  expect(markdown).not.toContain('Modified · excluded.tex')
  expect(markdown).toContain('Evidence needs review')
  expect(markdown).toContain('text retained')
  expect(markdown).toContain('Awaiting response')
  expect(markdown).toContain('&lt;detail&gt;')
  round.comments[0].response.paths = ['results.tex']
  round.comments.pop()
  const target = { path: 'results.tex', before: { start: 3, end: 3 }, after: { start: 3, end: 3 } }
  round.comments[0].response.evidence = { ...binding, changes: [{ ...target, after: { start: 2, end: 2 } }] }
  expect(render().unresolved).toEqual([1])
  round.comments[0].response.evidence.changes = [target]
  expect(render().unresolved).toEqual([])
  expect(render().markdown).toContain('results.tex (original L3, revised L3)')
  expect(render().markdown).not.toContain('original L1')
  expect(render({ ...binding, revisedSha256: 'c'.repeat(64) }).unresolved).toEqual([1])
})

test('locates insertions and removals on their respective archived side', async () => {
  const changes = await compareRevisionChanges([{ path: 'main.tex', status: 'Modified', baseline: 'Old\nKeeps\nEnd\n', current: 'Keeps\nInserted\nEnd\n' }])
  expect(changes).toEqual([
    { path: 'main.tex', before: { start: 1, end: 1 }, beforeText: 'Old', afterText: '' },
    { path: 'main.tex', after: { start: 2, end: 2 }, beforeText: '', afterText: 'Inserted' },
  ])
})

test('reopens a retained reply after correcting or splitting its comment and preserves verification when ordering', () => {
  const reply = { kind: 'retained', paths: [], text: 'The method already describes the procedure.' }
  const original = { kind: 'comment', target: { type: 'manuscript' }, id: 'one', reviewer: 'Reviewer 1', text: 'Check the procedure.', response: reply }
  const unmatched = { kind: 'comment', target: { type: 'manuscript' }, id: 'two', reviewer: 'Editor', text: 'Check the title.' }
  const round = { id: 'round', name: 'Round', submissionId: 'original', comments: [original, unmatched] }
  const ordered = editRevisionComment(round, original, { kind: 'move', direction: 1 })
  expect(ordered.comments).toEqual([unmatched, original])
  expect(revisionResponseStatus(ordered.comments[1])).toBe('ready')

  const corrected = editRevisionComment(ordered, original, { kind: 'edit', text: original.text, reviewer: 'Reviewer 2',
    destination: { kind: 'canvas', nodeId: 'existing-card' }, editId: 'v2' })
  const edited = corrected.comments[1]
  expect(edited.response.text).toBe(reply.text)
  expect(edited).toMatchObject({ id: 'one', editId: 'v2', reviewer: 'Reviewer 2', nodeId: 'existing-card' })
  expect(revisionResponseStatus(edited)).toBe('review')
  expect(buildRevisionLetter(corrected, 'Original', 'Revised', [], {}, []).unresolved).toEqual([1, 2])
  expect(() => editRevisionComment(corrected, original, { kind: 'move', direction: -1 })).toThrow('changed')

  const split = editRevisionComment(corrected, edited, { kind: 'split', first: 'Check the setup.', second: 'Check the calibration.', editId: 'v3', secondId: 'three' })
  expect(split.comments[1]).toMatchObject({ id: 'one', kind: 'canvas', response: { text: reply.text, reviewRequired: true } })
  expect(split.comments[2]).toMatchObject({ id: 'three', kind: 'comment', reviewer: 'Reviewer 2', target: { type: 'manuscript' } })
  expect(revisionResponseStatus(split.comments[2])).toBe('awaiting')
})
