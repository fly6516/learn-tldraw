import { z } from 'zod'
import JSZip from 'jszip'
import { projectCompileUrl } from './compile-profile'
import { templateDigest } from './paper-templates'
import { plainTex } from './project-information'
import { verifyRevision, type RevisionPackageInput } from './revision-package'
import { aguRevisionAnchorSchema, aguRevisionBindingSchema, packageSubmissionDelivery, submissionLayoutSchema, verifyArchivedLayout, type SubmissionLayout } from './submission-layout'
import { submissionStageConfig } from './submission-stages'
import type { SubmissionFiles } from './submission'

const checksum = z.string().regex(/^[a-f0-9]{64}$/)
export const aguDeliveryInfoSchema = z.object({
  id: z.uuid(), createdAt: z.iso.datetime(),
  binding: aguRevisionBindingSchema, sha256: checksum, bytes: z.number().int().positive(),
})
export type AguDeliveryInfo = z.infer<typeof aguDeliveryInfoSchema>
export type AguDelivery = AguDeliveryInfo & { archive: Blob }
export type AguRevisionBinding = z.infer<typeof aguRevisionBindingSchema>

const textDigest = (text: string) => templateDigest(new TextEncoder().encode(text).buffer)

export async function reviewedAguRevision(input: RevisionPackageInput) {
  const clean = input.revised.layoutReport
  if (clean?.delivery?.stage !== 'agu-revision' || clean.templateOrigin?.id !== 'agu-jgr-atmospheres') {
    throw new Error('请为此轮选择用 AGU 修回阶段编译并归档的清洁稿。')
  }
  const { baseline, current, letter } = await verifyRevision(input)
  if (current.version.sourceChecksum !== clean.sourceChecksum || await templateDigest(await input.revised.pdf.arrayBuffer()) !== clean.pdfChecksum) {
    throw new Error('归档清洁稿与提交检查报告的 SHA-256 不匹配。')
  }
  const { id, name, archiveReviewId } = input.round
  const binding = aguRevisionAnchorSchema.parse({
    roundId: id, roundName: name, archiveReviewId,
    original: baseline.version, revised: { ...current.version, pdfChecksum: clean.pdfChecksum },
    responseMarkdownSha256: await textDigest(letter.markdown),
  })
  return { binding, letter, clean }
}

export function aguReplySource(input: Awaited<ReturnType<typeof reviewedAguRevision>>) {
  const { binding, letter } = input
  const glyphs: Record<string, string> = { '<': '\\textless{}', '>': '\\textgreater{}', '|': '\\textbar{}' }
  const text = (value: string) => value.split(/\r\n|\r|\n/).map(line =>
    plainTex(line.replace(/[\t\f]/g, ' ')).replace(/[<>|]/g, glyph => glyphs[glyph])).join('\n\\par\n')
  const title = text(binding.roundName.replace(/\s+/g, ' '))
  const body = [
    '\\section*{Response to the editor and reviewers}',
    '\\textbf{' + title + '}\\par',
    'Original submission: ' + text(binding.original.name) + '\\par',
    'Revised submission: ' + text(binding.revised.name) + '\\par',
    ...letter.entries.flatMap(entry => [
      '\\subsection*{' + text(entry.heading.replace(/\s+/g, ' ')) + '}',
      '\\begin{quote}', text(entry.comment), '\\end{quote}',
      '\\textbf{' + text(entry.disposition) + '}\\par', text(entry.reply) + '\\par',
      ...(entry.evidence.length ? ['\\medskip', 'Changes verified against the revised source ZIP:\\par',
        ...entry.evidence.map(line => text(line) + '\\par')] : []),
    ]),
  ]
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(body.join('\n'))
  return [cjk ? '\\documentclass[fontset=fandol,letterpaper,11pt]{ctexart}' : '\\documentclass[letterpaper,11pt]{article}',
    '\\usepackage[margin=1in]{geometry}', '\\usepackage{fontspec}',
    '\\setmainfont[BoldFont=lmroman10-bold.otf,ItalicFont=lmroman10-italic.otf,BoldItalicFont=lmroman10-bolditalic.otf]{lmroman10-regular.otf}',
    '\\tracinglostchars=3', '\\setlength{\\emergencystretch}{3em}', '\\begin{document}',
    ...body, '\\end{document}', ''].join('\n')
}

export async function compileAguReply(input: Awaited<ReturnType<typeof reviewedAguRevision>>, signal: AbortSignal) {
  const entry = 'response.tex'
  const zip = new JSZip().file(entry, aguReplySource(input))
  const body = await zip.generateAsync({ type: 'blob' })
  const url = projectCompileUrl(entry, { engine: 'xelatex', bibliography: 'none' }).replace('&sync=1', '')
  const response = await fetch(url, { method: 'POST', body, signal })
  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw new Error(['回复信 PDF 生成失败。', error?.error ?? '请检查本地 XeLaTeX。', error?.diagnostics?.[0]?.message]
      .filter(Boolean).join(' '))
  }
  const pdf = await response.blob()
  if (await pdf.slice(0, 5).text() !== '%PDF-') throw new Error('编译器未返回有效的回复信 PDF。')
  return new File([pdf], 'response-to-reviewers.pdf', { type: 'application/pdf' })
}

export async function validAguMarkedFile(name: string, file?: Blob) {
  if (!file) return false
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const extension = name.split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return new TextDecoder().decode(bytes).startsWith('%PDF-')
  if (extension === 'doc') return bytes.join(',') === '208,207,17,224,161,177,26,225'
  if (extension !== 'docx' || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false
  const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => undefined)
  return Boolean(zip?.file('word/document.xml') && zip.file('[Content_Types].xml'))
}

export async function buildAguDelivery(input: RevisionPackageInput, report: SubmissionLayout, files: SubmissionFiles) {
  const { binding, clean } = await reviewedAguRevision(input)
  const checked = submissionLayoutSchema.parse(report)
  const { materials, confirmed, manualReview, aguRevision, ...build } = checked
  const archivedBuild = { ...clean, materials: undefined, confirmed: undefined, manualReview: undefined, aguRevision: undefined }
  const { responsePdfSha256, ...reviewedBinding } = aguRevision ?? {}
  if (JSON.stringify(reviewedBinding) !== JSON.stringify(binding) || JSON.stringify(build) !== JSON.stringify(archivedBuild)
    || !await verifyArchivedLayout(checked, files)) throw new Error('清洁稿或返修轮次已变更，请重新核对。')
  const expected = submissionStageConfig['agu-revision'].materials ?? []
  const required = expected.filter(slot => slot.required === true || slot.required === 'when-figures' && checked.delivery?.figureAttachmentsRequired)
  const indexed = new Map(materials?.map((item, index) => [item.slot, { item, index }]))
  if (input.revised.issues.some(issue => issue.severity === 'error') || checked.findings.some((finding, index) => finding.status === 'issue' || finding.status === 'manual' && !confirmed.includes(index)) ||
    required.some(slot => !indexed.has(slot.id) || !manualReview?.some(review => review.ruleId === slot.rule))) {
    throw new Error('请完成本轮提交检查及必需附件核对。')
  }
  const marked = indexed.get('marked')
  const response = indexed.get('response')
  if (!marked || !response || response.item.sha256 !== responsePdfSha256 || marked.item.sha256 === checked.pdfChecksum ||
    !await validAguMarkedFile(marked.item.name, files.materials?.[marked.index]) ||
    await files.materials?.[response.index]?.slice(0, 5).text() !== '%PDF-') throw new Error('请提供与清洁稿不同的对照稿和已经生成的回复信 PDF。')
  const archive = await packageSubmissionDelivery(checked, files)
  return { binding: aguRevisionBindingSchema.parse(aguRevision), archive, bytes: archive.size, sha256: await templateDigest(await archive.arrayBuffer()) }
}

export async function verifyAguDelivery(record: AguDelivery) {
  return record.archive instanceof Blob && record.archive.size === record.bytes &&
    await templateDigest(await record.archive.arrayBuffer()) === record.sha256
}
