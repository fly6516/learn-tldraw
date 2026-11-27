import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { buildRevisionPackage } from './revision-package'
import { checkedRevisionZipDigest } from './revision-evidence'

async function source(text) {
  const zip = new JSZip()
  zip.file('main.tex', '\\documentclass{article}\n' + text)
  return zip.generateAsync({ type: 'blob' })
}

test('requires coherent archives and verified responses when packaging a revision', async () => {
  const original = { id: 'before', name: 'Submission v1', main: 'main.tex', zip: await source('Baseline.') }
  const revised = { id: 'after', name: 'Submission v2', main: 'main.tex', zip: await source('Revision.'),
    pdf: new Blob(['%PDF-1.7\narchived bytes']) }
  const round = { id: 'round', name: 'Round 1', submissionId: original.id, revisedSubmissionId: revised.id,
    comments: [{ reviewer: 'A reviewer', text: 'Clarify the manuscript.', response: { kind: 'changed', text: 'We clarified it.', paths: ['missing.tex'] } }] }
  await expect(buildRevisionPackage({ round, original, revised })).rejects.toThrow('verify their evidence')
  round.comments[0].response.paths = ['main.tex']
  await expect(buildRevisionPackage({ round, original, revised: { ...revised, sourceChecksum: '0'.repeat(64) } })).rejects.toThrow('failed its checksum')
  await expect(buildRevisionPackage({ round, original, revised: { ...revised, id: 'wrong-version' } })).rejects.toThrow('archived original and revised')
  await expect(buildRevisionPackage({ round, original, revised })).rejects.toThrow('verify their evidence')
  round.comments[0].response.evidence = { originalId: original.id, revisedId: revised.id,
    originalSha256: await checkedRevisionZipDigest(original.zip), revisedSha256: await checkedRevisionZipDigest(revised.zip),
    changes: [{ path: 'main.tex', before: { start: 2, end: 2 }, after: { start: 2, end: 2 } }] }
  const result = await buildRevisionPackage({ round, original, revised })
  const unpacked = await JSZip.loadAsync(await result.arrayBuffer(), { checkCRC32: true })
  expect(await unpacked.file('manuscript.pdf').async('string')).toBe('%PDF-1.7\narchived bytes')
  expect(await unpacked.file('response.md').async('string')).toContain('Modified · main.tex (original L2, revised L2)')
})
