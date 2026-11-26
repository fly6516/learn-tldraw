import { z } from 'zod'
import { templateCatalog } from './template-catalog'

export const submissionDocxIds = ['zju-basic-medicine-undergraduate', 'suep-undergraduate'] as const
export const submissionDocxIdSchema = z.enum(submissionDocxIds)
export type SubmissionDocxId = z.infer<typeof submissionDocxIdSchema>
const reviewedInWord = '已通过 Microsoft Word 16.115.2（macOS）实机验收'

const line = (length: number) => z.string().trim().min(1).max(length).regex(/^[^\p{Cc}]+$/u)
export const submissionDocxFields = z.object({
  title: line(36), author: line(20), studentNumber: line(20), advisor: line(40),
  program: line(40), affiliation: line(40), date: line(30),
  chineseAbstract: z.string().trim().min(1).max(5000), chineseKeywords: line(250),
  englishKeywords: line(250), acknowledgment: z.string().trim().max(5000).optional(),
  confidentiality: z.enum(['public', 'restricted']).default('public'),
})
export type SubmissionDocxFields = z.input<typeof submissionDocxFields>

export const suepDocxMembers = {
  guide: { name: '6.上海电力大学本科生毕业设计（论文）撰写规范.docx', sha256: '349dd0189406227e776fac8197c479dba80bc1b0679a9002821dae014d3804a4' },
  cover: { name: '7.上海电力大学毕业设计（论文）封面.doc', sha256: 'f06b20bacfc3181be5f7c443e37e940f604e1433b6bfeca79f63051c538ba42b' },
  body: { name: '14.上海电力大学本科生毕业设计（论文）格式示范文本.doc', sha256: '682978def76fb275f269355ea178fbbc06bd8ba1275d49d286bd93f5e45904ff' },
  declaration: { name: '17.上海电力大学毕业设计（论文）原创性及使用授权声明.doc', sha256: 'df4c2d2b90d0b3effb2d704a3c920a4fef2f5e8117850b411a7566302877beb8' },
} as const

export function submissionDocxConfig(id: SubmissionDocxId) {
  const entry = templateCatalog.find(entry => entry.id === id)!
  const workflow = entry.workflow
  if (workflow.kind === 'word' && workflow.guideline) {
    return { id, name: entry.name, version: workflow.version, sourceUrl: entry.sourceUrl!, original: workflow.original,
      guideline: workflow.guideline, status: reviewedInWord }
  }
  if (workflow.kind === 'word-import') {
    return { id, name: entry.name, version: workflow.version, sourceUrl: entry.sourceUrl!, original: workflow.original,
      status: reviewedInWord }
  }
  throw new Error('此模板缺少已登记的 DOCX 原件或规范。')
}
