import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { backupHistorySchema, decodeBackupHistory, encodeBackupHistory } from './backup-history'
import { buildSubmissionLayout, packageSubmissionDelivery, submissionLayoutSchema, verifyArchivedLayout } from './submission-layout'
import { validateReleaseCandidate } from './template-release'

test('pins report and manual confirmation to exact archived bytes', async () => {
  const files = { pdf: new Blob(['accepted PDF']), zip: new Blob(['accepted ZIP']) }
  const origin = { id: 'aps-prl', version: '4.2f', sha256: 'a'.repeat(64) }
  const finding = { label: '检查', status: 'manual', detail: '手动核对', evidence: '投稿指南' }
  const report = await buildSubmissionLayout([finding], files, origin)
  expect(await verifyArchivedLayout(report, files)).toBe(true)
  expect(await verifyArchivedLayout(report, { ...files, pdf: new Blob(['changed PDF']) })).toBe(false)
  expect(await verifyArchivedLayout(report, { ...files, zip: new Blob(['changed ZIP']) })).toBe(false)
  expect(submissionLayoutSchema.safeParse({ ...report, confirmed: [0] }).data?.templateOrigin).toEqual(origin)
  expect(submissionLayoutSchema.safeParse({ ...report, confirmed: [1] }).success).toBe(false)
})

test('staged delivery verifies the report and both files before packaging', async () => {
  const files = { pdf: new Blob(['%PDF-delivery']), zip: new Blob(['source delivery']) }
  const origin = { id: 'agu-jgr-atmospheres', version: '3550522', sha256: 'a'.repeat(64) }
  const delivery = { stage: 'agu-revision', engine: 'pdflatex', entry: 'agujournaltemplate.tex',
    buildId: crypto.randomUUID(), snapshotSha256: 'b'.repeat(64) }
  const report = await buildSubmissionLayout([], files, origin, delivery)
  expect(submissionLayoutSchema.safeParse({ ...report, delivery: { ...delivery, stage: 'njupt-blind' } }).success).toBe(false)
  await expect(packageSubmissionDelivery(report, { ...files, zip: new Blob(['different source']) })).rejects.toThrow()
  const packageZip = await JSZip.loadAsync(await (await packageSubmissionDelivery(report, files)).arrayBuffer())
  expect(JSON.parse(await packageZip.file('report.json').async('string'))).toEqual(report)
  expect(await packageZip.file('manuscript.pdf').async('string')).toBe('%PDF-delivery')
  expect(await packageZip.file('source.zip').async('string')).toBe('source delivery')
})

test('rejects the released version and identical publisher source', () => {
  const current = { id: 'aps-prl', version: '4.2f', sha256: '0'.repeat(64) }
  expect(() => validateReleaseCandidate(current, '4.2f', '1'.repeat(64))).toThrow()
  expect(() => validateReleaseCandidate(current, '4.2f-qa', current.sha256)).toThrow()
  expect(() => validateReleaseCandidate(current, '4.2f-qa', '1'.repeat(64))).not.toThrow()
})

test('round-trips the original report through a portable project backup', async () => {
  const files = { pdf: new Blob(['%PDF-archive']), zip: new Blob(['source archive']) }
  const origin = { id: 'sjtu-graduate-word', version: '2024-07-01', sha256: 'b'.repeat(64) }
  const finding = { label: '摘要页页眉', status: 'manual', detail: '对照学校样例', evidence: 'Word' }
  const measurement = { label: '正文页边距', status: 'pass', detail: '与模板一致', evidence: '版式规则与编译记录',
    expected: '左 25 mm', observed: '左 25 mm', path: 'main.tex', line: 3, page: 4,
    comparisons: [{ label: '左边距（mm）', requirement: '至少 25 mm', sample: '31.8 mm', selected: '25 mm', detected: '25 mm',
      standardName: 'guide.pdf', source: '左边距至少 25 mm。', excerpt: { page: 10, text: '左边距至少\n25 mm。' },
      confirmed: true, decision: 'manual' }] }
  const layoutReport = { ...await buildSubmissionLayout([finding, measurement], files, origin), confirmed: [0] }
  const record = { ...files, id: crypto.randomUUID(), name: 'Archived submission', createdAt: new Date().toISOString(),
    main: 'main.tex', paths: ['main.tex'], excluded: [], drafts: [], issues: [], warnings: false, diagnostics: [], layoutReport }
  const archive = new JSZip()
  const manifest = await encodeBackupHistory(archive, { publication: { submissions: [record], rounds: [] } }, () => {
    throw new Error('No project snapshots are expected.')
  })
  const decoded = await decodeBackupHistory(archive, manifest, () => {
    throw new Error('No project snapshots are expected.')
  })
  const restored = decoded.publication.submissions[0]
  expect(restored.layoutReport).toEqual(layoutReport)
  expect(await verifyArchivedLayout(restored.layoutReport, restored)).toBe(true)
  manifest.publication.submissions[0].layoutReport.pdfChecksum = 'c'.repeat(64)
  expect(backupHistorySchema.safeParse(manifest).success).toBe(false)
})

test('round-trips staged attachments as bytes and rejects a changed archived attachment', async () => {
  const { readSubmissionMaterials, submissionMaterialPath } = await import('./submission-materials')
  const [attachment] = await readSubmissionMaterials({ id: 'response', label: '回复', extensions: ['pdf'] },
    [new File(['%PDF-original reply'], 'response.pdf', { type: 'application/pdf' })])
  const files = { pdf: new Blob(['%PDF-draft']), zip: new Blob(['source']), materials: [attachment.blob] }
  const origin = { id: 'agu-jgr-atmospheres', version: '3550522', sha256: 'a'.repeat(64) }
  const report = { ...await buildSubmissionLayout([], files, origin, { stage: 'agu-revision', engine: 'pdflatex', entry: 'main.tex',
    buildId: crypto.randomUUID(), snapshotSha256: 'b'.repeat(64) }), materials: [attachment.metadata] }
  const version = { ...files, id: crypto.randomUUID(), createdAt: new Date().toISOString(), main: 'main.tex',
    name: 'Original reply', paths: ['main.tex'], drafts: [], excluded: [], issues: [], diagnostics: [], warnings: false, layoutReport: report }
  const archive = new JSZip()
  const history = await encodeBackupHistory(archive, { publication: { submissions: [version], rounds: [] } }, () => {
    throw new Error('No snapshots are needed.')
  })
  const restore = () => decodeBackupHistory(archive, history, () => { throw new Error('No snapshots are needed.') })
  const [restored] = (await restore()).publication.submissions
  expect(await verifyArchivedLayout(restored.layoutReport, restored)).toBe(true)
  const bundle = await JSZip.loadAsync(await (await packageSubmissionDelivery(restored.layoutReport, restored)).arrayBuffer())
  expect(await bundle.file(submissionMaterialPath(attachment.metadata, 0)).async('string')).toBe('%PDF-original reply')
  expect(await verifyArchivedLayout(restored.layoutReport, { ...restored, materials: [new Blob(['changed reply'])] })).toBe(false)
  archive.file('history/submissions/0/0', '%PDF-altered reply')
  await expect(restore()).rejects.toThrow(/checksum/)
})
