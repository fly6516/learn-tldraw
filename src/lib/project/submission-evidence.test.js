import { expect, test } from 'bun:test'
import { assessSubmissionEvidence, assessSubmissionZip, submissionEvidenceLedger } from './submission-evidence'
import { createDefaultProject } from './file-system'
import { calculateCsv } from './csv-calculation'
import { exportExternalBuild } from './submission'
import { assessClaim } from './writing-claims'

const path = 'results.tex'
const data = 'data.csv'
const quote = 'The mean of the first two values is 11.'
const source = 'id,reading\na,10\nb,12\nc,30\n'
const draft = { saved: '\\section{Results}', draft: { base: '\\section{Results}', text: quote } }
const checkpoints = {
  collected: { state: 'draft', before: { [path]: { saved: draft.saved } }, after: { [path]: draft } },
  saved: { state: 'saved', before: { [path]: draft }, after: { [path]: { saved: quote } } },
}
const project = (wording = quote, csv = source, file = path) => ({ ...createDefaultProject('Evidence exercise'), files: new Map([
  [file, { content: wording, path: file, type: 'editable' }], [data, { content: csv, path: data, type: 'editable' }],
]) })
const claim = { path, quote, kind: 'claim', references: [], calculations: [calculateCsv('calc-1', {
  path: data, operation: 'mean', decimals: 2, cells: [{ row: 2, column: 'reading' }, { row: 3, column: 'reading' }],
}, source, false)] }
const confirmed = { decision: 'confirmed', fingerprint: assessClaim(claim, project(), [], 0).fingerprint }
const history = { conversations: [{ manuscript: { id: 'saved', batches: [{ run: 'collected', claims: [claim], sourceRevision: 0 }],
  claimReviews: { 'collected:0': confirmed } } }] }

test('checks saved claims and only the exact dependencies in the proposed archive', () => {
  const makeLedger = (moves = []) => submissionEvidenceLedger(history, checkpoints, {}, moves)
  const ledger = makeLedger()
  expect(assessSubmissionEvidence(project(quote, source.replace('c,30', 'c,99')), ledger)).toEqual({ checked: 1, findings: [] })
  expect(assessSubmissionEvidence(project('Different claims.', source.replace('a,10', 'a,11')), ledger).findings)
    .toMatchObject([{ reasons: ['wording_changed', 'evidence_changed'], path, dependencies: [data] }])
  const movedPath = 'sections/results.tex'
  expect(assessSubmissionEvidence(project(quote, source, movedPath), makeLedger([{ from: path, to: movedPath }])).findings).toEqual([])
  expect(submissionEvidenceLedger(history, { ...checkpoints, saved: { state: 'undone' } }, {}, []).entries).toEqual([])
})

test('binds the evidence check to downloaded ZIP bytes and identifies excluded supporting data', async () => {
  const ledger = submissionEvidenceLedger(history, checkpoints, {}, [])
  const final = project()
  final.files.delete(data)
  const { zip, checksum } = await exportExternalBuild(final)
  await expect(assessSubmissionZip(zip, checksum, ledger)).resolves.toMatchObject({ sourceChecksum: checksum, checked: 1,
    findings: [{ path, quote, reasons: ['evidence_missing'], dependencies: [data] }] })
  await expect(assessSubmissionZip(zip, '0'.repeat(64), ledger)).rejects.toThrow('ZIP changed')
})
