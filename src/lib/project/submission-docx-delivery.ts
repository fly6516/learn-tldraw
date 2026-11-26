import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { z } from 'zod'
import { docxSourceFindings, unsupportedDocxStructures } from './docx-manuscript'
import { lineNumber } from './latex-source'
import { buildProjectOutline } from './outline'
import { templateDigest } from './paper-templates'
import { isProjectPath } from './source-archive'
import { prepareSubmission } from './submission'
import { captureManuscript } from './template-export'
import { submissionDocxFields, submissionDocxIdSchema, type SubmissionDocxFields } from './submission-docx-config'
import type { ProjectFileSystem } from './types'

export const submissionDocxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.string().refine(isProjectPath)
const date = z.string().refine(value => Number.isFinite(Date.parse(value)))
const maxDocxBytes = 32 * 1024 * 1024
const artifact = z.object({ name: z.string().min(1).max(180).regex(/^[^/\\:\p{Cc}]+$/u), sha256: digest, bytes: z.number().int().positive().max(maxDocxBytes) })
const finding = z.object({
  status: z.enum(['blocking', 'manual']), message: z.string(),
  field: z.string().optional(), location: z.object({ path, line: z.number().int().positive() }).optional(),
})
export type DocxFinding = z.infer<typeof finding>
export const submissionDocxDeliveryInfo = z.object({
  id: z.uuid(), createdAt: date, name: z.string().min(1).max(100), main: path,
  template: z.object({ id: submissionDocxIdSchema, name: z.string(), version: z.string(), sha256: digest, sourceUrl: z.url() }),
  snapshotSha256: digest, source: artifact, generated: artifact, final: artifact.optional(),
  check: z.object({ checkedAt: date, findings: z.array(finding).refine(items => items.every(item => item.status === 'manual')) }),
})
export type SubmissionDocxDeliveryInfo = z.infer<typeof submissionDocxDeliveryInfo>
export type SubmissionDocxDelivery = SubmissionDocxDeliveryInfo & { sourceZip: Blob; generatedDocx: Blob; finalDocx?: Blob }

export const wordReviewFinding: DocxFinding = { status: 'manual', message: '在 Word 更新整个目录和引用字段，保存后重开核对。归档可以附上作者在 Word 保存的文件。' }

export function checkDocxSubmission(project: ProjectFileSystem, main: string, fields: SubmissionDocxFields) {
  const findings: DocxFinding[] = []
  const parsed = submissionDocxFields.safeParse(fields)
  if (!parsed.success) for (const issue of parsed.error.issues) {
    findings.push({ status: 'blocking', field: String(issue.path[0]), message: '请填写有效的内容。' })
  }
  const add = (issue: Omit<DocxFinding, 'status'>) => {
    if (!findings.some(item => item.location?.path === issue.location?.path && item.location?.line === issue.location?.line && item.message === issue.message)) {
      findings.push({ ...issue, status: 'blocking' })
    }
  }
  try {
    const manuscript = captureManuscript(project.files, main, { allowLongtable: true })
    docxSourceFindings(manuscript).forEach(add)
    for (const float of manuscript.floats) if (float.longTable) findings.push({
      status: 'manual', location: { path: float.path, line: float.line },
      message: 'Word 将自动重复表号、表题和表头。最终分页确认后，请按学校规则核对续页的「续」字样。',
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '无法读取当前稿件。'
    const location = /^(.+):(\d+) · ([\s\S]*)$/.exec(message)
    if (!location) add({ message })
    else add({ message: location[3], location: { path: location[1], line: Number(location[2]) } })
    for (const issue of prepareSubmission(project, main, new Set()).issues) {
      if (issue.severity === 'error' || /^(?:Undefined LaTeX reference|Duplicate LaTeX label|Unknown citation key|Duplicate bibliography key)/.test(issue.message)) add(issue)
    }
    const inspect = (path: string, text: string) => {
      for (const entry of unsupportedDocxStructures(text)) add({ message: entry.message, location: { path, line: lineNumber(text, entry.offset) } })
    }
    buildProjectOutline(project, main, undefined, inspect, inspect)
  }
  return { checkedAt: new Date().toISOString(), findings: [...findings, wordReviewFinding], fields: parsed.data }
}

export async function docxDeliveryArtifact(blob: Blob, name: string) {
  if (!blob.size || blob.size > maxDocxBytes) throw new Error('单个交付文件上限为 32 MB。')
  return artifact.parse({ name, bytes: blob.size, sha256: await templateDigest(await blob.arrayBuffer()) })
}

export async function verifyDocxDelivery(record: SubmissionDocxDelivery) {
  submissionDocxDeliveryInfo.parse(record)
  const matches = (metadata: z.infer<typeof artifact>, file: Blob) =>
    file instanceof Blob && file.size === metadata.bytes && docxDeliveryArtifact(file, metadata.name).then(check => check.sha256 === metadata.sha256)
  return (await Promise.all([matches(record.source, record.sourceZip), matches(record.generated, record.generatedDocx),
    record.final && record.finalDocx ? matches(record.final, record.finalDocx) : !record.final && !record.finalDocx])).every(Boolean)
}

async function readDocxPart(zip: JSZip, path: string) {
  const member = zip.file(path)
  if (!member) throw new Error('文件缺少 DOCX 部件：' + path)
  return new Promise<string>((resolve, reject) => {
    let size = 0
    let text = ''
    // JSZip exposes this browser stream at runtime. Its type declarations only
    // describe async() and nodeStream() for individual members.
    type TextStream = {
      on(event: 'data', next: (value: string) => void): TextStream
      on(event: 'error', next: (error: Error) => void): TextStream
      on(event: 'end', next: () => void): TextStream
      pause(): void
      resume(): void
    }
    const stream = (member as typeof member & { internalStream(type: 'string'): TextStream }).internalStream('string')
    stream.on('data', value => {
      size += value.length
      if (size > 64 * 1024) { stream.pause(); reject(new Error('DOCX 元数据超过读取上限。')); return }
      text += value
    }).on('error', reject).on('end', () => {
      if (/<!DOCTYPE/i.test(text)) reject(new Error('DOCX 元数据含不支持的 XML 声明。'))
      else resolve(text)
    }).resume()
  })
}

export async function verifyWordFinal(file: File, delivery: Pick<SubmissionDocxDeliveryInfo, 'id' | 'template' | 'snapshotSha256'> & { generated?: SubmissionDocxDeliveryInfo['generated'] }) {
  const { id, template, snapshotSha256 } = delivery
  if (!/\.docx$/i.test(file.name) || !file.size || file.size > maxDocxBytes) throw new Error('请选择 32 MB 以内的 DOCX。')
  const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => { throw new Error('文件不是有效的 DOCX。') })
  if (!zip.file('word/document.xml')) throw new Error('文件缺少 DOCX 正文。')
  const properties = new DOMParser().parseFromString(await readDocxPart(zip, 'docProps/core.xml'), 'application/xml')
  const provenance = properties.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'description')[0]?.textContent?.split(/\r?\n/) ?? []
  if (![template.name + ' · ' + template.version, '官方原件 SHA-256 ' + template.sha256, '稿件快照 SHA-256 ' + snapshotSha256, '交付标识 ' + id]
    .every(value => provenance.includes(value))) throw new Error('这份文件的交付标识、模板或稿件快照与本次导出不匹配。请使用从本次导出文件另存的 DOCX。')
  const metadata = await docxDeliveryArtifact(file, file.name.normalize('NFC'))
  if (metadata.sha256 === delivery.generated?.sha256) throw new Error('请选择在 Word 更新并另存后的文件。当前文件与生成稿完全相同。')
  return metadata
}
