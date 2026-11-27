import JSZip from 'jszip'
import { submissionStageConfig, submissionStageInfo, submissionStages } from './submission-stages'
import { submissionMaterialPath, submissionMaterialsSchema, verifySubmissionMaterials } from './submission-materials'
import { z } from 'zod'
import { isProjectPath } from './source-archive'
import { templateDigest } from './paper-templates'
import type { LayoutFinding } from './layout-preflight'
import type { TemplateOrigin } from './template-release'
import { layoutComparisonSchema } from './word-layout'

const checksum = z.string().regex(/^[a-f0-9]{64}$/)
const finding = z.object({
  label: z.string(), status: z.enum(['pass', 'issue', 'manual']), detail: z.string(), evidence: z.string(),
  ruleId: z.string().min(1).optional(), sourceUrl: z.url({ protocol: /^https$/ }).optional(),
  expected: z.string().optional(), observed: z.string().optional(),
  comparisons: z.array(layoutComparisonSchema).optional(),
  path: z.string().refine(isProjectPath).optional(), line: z.number().int().positive().optional(),
  page: z.number().int().positive().optional(),
})
export const templateOriginSchema = z.object({ id: z.string(), version: z.string(), sha256: checksum, manifestSha256: checksum.optional() })
export const aguRevisionAnchorSchema = z.object({
  roundId: z.string().min(1), roundName: z.string().min(1), archiveReviewId: z.uuid().optional(),
  original: z.object({ id: z.string().min(1), name: z.string().min(1), sourceChecksum: checksum }),
  revised: z.object({ id: z.string().min(1), name: z.string().min(1), sourceChecksum: checksum, pdfChecksum: checksum }),
  responseMarkdownSha256: checksum,
})
export const aguRevisionBindingSchema = aguRevisionAnchorSchema.extend({ responsePdfSha256: checksum })
  .refine(binding => binding.original.id !== binding.revised.id)

export const submissionLayoutSchema = z.object({
  version: z.literal(1), sourceChecksum: checksum, pdfChecksum: checksum,
  checkedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  templateOrigin: templateOriginSchema.optional(),
  delivery: z.object({ stage: z.enum(submissionStages), buildId: z.uuid(), snapshotSha256: checksum,
    entry: z.string().refine(isProjectPath), engine: z.enum(['pdflatex', 'xelatex', 'lualatex', 'tectonic']), attachmentSha256: checksum.optional(), sourceMatch: z.literal('author-confirmed').optional(), figureAttachmentsRequired: z.boolean().optional() }).optional(),
  materials: submissionMaterialsSchema.optional(),
  aguRevision: aguRevisionBindingSchema.optional(),
  findings: z.array(finding), confirmed: z.array(z.number().int().nonnegative()),
  manualReview: z.array(z.object({ ruleId: z.string().min(1), confirmedAt: z.iso.datetime() })).optional(),
}).refine(report => (!report.delivery || Boolean(report.templateOrigin && (report.delivery.stage === 'catalog-delivery' ||
    submissionStageConfig[report.delivery.stage].template === report.templateOrigin.id)))
  && (!report.materials?.length || Boolean(report.delivery && report.materials.every(item =>
    submissionStageConfig[report.delivery!.stage].materials?.some(slot => slot.id === item.slot))))
  && (!report.aguRevision || (report.delivery?.stage === 'agu-revision' &&
    report.aguRevision.revised.sourceChecksum === report.sourceChecksum && report.aguRevision.revised.pdfChecksum === report.pdfChecksum &&
    report.materials?.some(material => material.slot === 'response' && material.sha256 === report.aguRevision!.responsePdfSha256)))
  && new Set(report.confirmed).size === report.confirmed.length
  && report.confirmed.every(index => report.findings[index]?.status === 'manual')
  && (!report.manualReview || (new Set(report.manualReview.map(record => record.ruleId)).size === report.manualReview.length
    && report.manualReview.every(record => report.confirmed.some(index => report.findings[index]?.ruleId === record.ruleId))
    && report.confirmed.every(index => !report.findings[index]?.ruleId
      || report.manualReview!.some(record => record.ruleId === report.findings[index].ruleId)))))

export type SubmissionLayout = z.infer<typeof submissionLayoutSchema>

export async function buildSubmissionLayout(findings: LayoutFinding[], files: { pdf: Blob; zip: Blob; sourceChecksum?: string },
  templateOrigin?: TemplateOrigin, delivery?: SubmissionLayout['delivery']): Promise<SubmissionLayout> {
  const [sourceChecksum, pdfChecksum] = await Promise.all([
    files.sourceChecksum ?? files.zip.arrayBuffer().then(templateDigest),
    files.pdf.arrayBuffer().then(templateDigest),
  ])
  return submissionLayoutSchema.parse({ version: 1, sourceChecksum, pdfChecksum, checkedAt: new Date().toISOString(),
    templateOrigin, delivery, findings, confirmed: [] })
}

export async function verifyArchivedLayout(report: SubmissionLayout, files: { pdf: Blob; zip: Blob; materials?: Blob[] }) {
  const [source, pdf] = await Promise.all([files.zip.arrayBuffer().then(templateDigest), files.pdf.arrayBuffer().then(templateDigest)])
  return source === report.sourceChecksum && pdf === report.pdfChecksum && await verifySubmissionMaterials(report.materials, files.materials)
}

export async function packageSubmissionDelivery(report: SubmissionLayout, files: { pdf: Blob; zip: Blob; materials?: Blob[] }) {
  const checked = submissionLayoutSchema.parse(report)
  if (!checked.delivery || !(await verifyArchivedLayout(checked, files))) throw new Error('交付报告与 PDF 或源包的校验值不匹配。')
  const json = JSON.stringify(checked, null, 2) + '\n'
  const zip = new JSZip()
  zip.file('manuscript.pdf', await files.pdf.arrayBuffer())
  zip.file('source.zip', await files.zip.arrayBuffer())
  zip.file('report.json', json)
  const materialHashes: Record<string, string> = {}
  for (const [index, item] of (checked.materials ?? []).entries()) {
    const path = submissionMaterialPath(item, index)
    zip.file(path, await files.materials![index].arrayBuffer())
    materialHashes[path] = item.sha256
  }
  zip.file('manifest.json', JSON.stringify({
    ...checked.delivery, template: checked.templateOrigin,
    ...(checked.aguRevision && { aguRevision: checked.aguRevision }),
    files: {
      'manuscript.pdf': checked.pdfChecksum, 'source.zip': checked.sourceChecksum,
      'report.json': await templateDigest(new TextEncoder().encode(json).buffer), ...materialHashes,
    },
  }, null, 2) + '\n')
  const config = submissionStageInfo(checked.delivery.stage, checked.templateOrigin?.id)
  zip.file('README.txt', [config.label, config.note, config.sourceUrl, '此包用于本地复查。正式文件请按当前提交阶段分别取出。', '编译入口为 ' + checked.delivery.entry + '。源包如含 BUILD.md，可查看依赖与命令。', '检查结果和人工核对状态见 report.json。'].join('\n'))
  return new Blob([await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })], { type: 'application/zip' })
}
