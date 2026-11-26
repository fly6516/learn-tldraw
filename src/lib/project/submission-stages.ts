import { njuptBlindCover, templateCatalog } from './template-catalog'
export { njuptBlindCover } from './template-catalog'

import { groupEnd, lineNumber, maskLatexCode } from './latex-source'
import type { LayoutFinding, PdfLayoutPage } from './layout-preflight'
import type { SubmissionMaterialSlot } from './submission-materials'
import type { ProjectFileSystem } from './types'

export const submissionStages = ['njupt-blind', 'njupt-deposit', 'agu-initial', 'agu-revision', 'sjtu-deposit', 'prl-review', 'prl-production', 'catalog-delivery'] as const
export type SubmissionStage = typeof submissionStages[number]

const njuptBlindNotice = 'https://pg.njupt.edu.cn/2026/0313/c1049a297791/page.htm'
const njuptDepositGuide = 'https://pg.njupt.edu.cn/_upload/article/files/df/5b/879140a8429cb3d7039c331701d7/a2a32500-a030-4aa7-acda-b869dccc7543.pdf'
const aguGuide = 'https://www.agu.org/publications/authors/journals/submission-checklists'

type StageConfig = { template: string; label: string; source: string; sourceUrl: string; note: string; output: 'pdf' | 'source' | 'confirm' | 'attached'; materials?: SubmissionMaterialSlot[] }

export const submissionStageConfig: Record<SubmissionStage, StageConfig> = {
  'njupt-blind': { template: 'njupt-professional-masters', label: '南邮 · 盲审稿', source: '南邮研究生院 · 硕士论文送审通知', sourceUrl: njuptBlindNotice, output: 'pdf',
    note: '学校送审系统要求上传匿名 PDF。源包和报告供本机核验。请人工检查图表、成果和附件中的身份信息。' },
  'njupt-deposit': { template: 'njupt-professional-masters', label: '南邮 · 归档稿', source: '南邮研究生院 · 硕士答辩与学位申请指南', sourceUrl: njuptDepositGuide + '#page=7', output: 'pdf',
    materials: [{ id: 'deposit-word', label: '正式归档 Word', extensions: ['doc', 'docx'], required: true, rule: 'deposit-materials' }],
    note: '核对最终 PDF、Word 和签字要求。签字件是否另交按当期通知确认。' },
  'agu-initial': { template: 'agu-jgr-atmospheres', label: 'AGU · 初投稿', source: 'AGU · New Manuscripts Checklist', sourceUrl: aguGuide + '#checklist-new-manuscripts', output: 'pdf',
    materials: [{ id: 'supporting', label: '补充材料 PDF（适用时）', extensions: ['pdf'], multiple: true, rule: 'agu-data-access' }],
    note: '初投稿使用一份完整稿件 PDF。补充材料按适用性单独上传。' },
  'agu-revision': { template: 'agu-jgr-atmospheres', label: 'AGU · 修回稿', source: 'AGU · Revised or Resubmitted Manuscript Checklist', sourceUrl: aguGuide + '#checklist-submitting-a-revised-or-resubmitted-manuscript', output: 'source',
    materials: [
      { id: 'marked', label: '修订痕迹对照稿', extensions: ['doc', 'docx', 'pdf'], required: true, rule: 'agu-marked-version' },
      { id: 'response', label: '逐条回复审稿意见', extensions: ['doc', 'docx', 'pdf'], required: true, rule: 'agu-review-response' },
      { id: 'figures', label: '修回图件（有图时）', extensions: ['eps', 'pdf', 'jpg', 'jpeg', 'tif', 'tiff'], multiple: true, required: 'when-figures', rule: 'agu-revision-figures' },
      { id: 'supporting', label: '补充材料 PDF（适用时）', extensions: ['pdf'], multiple: true, rule: 'agu-data-access' },
    ],
    note: '修回使用清洁版 LaTeX 源文件。带修订痕迹稿、逐条回复和图件按投稿清单另准备，PDF 用于本机校样。' },
  'sjtu-deposit': { template: 'sjtu-graduate-word', label: '上交大 · 学位论文定稿', source: '上海交通大学研究生工作手册 · 学位',
    sourceUrl: 'https://www.gs.sjtu.edu.cn/storage/gs/web/cn/article/2025/11/a11b68c3cf6d5138bce86f635d6e15ea.pdf',
    note: '核对最终装订顺序、作者与导师签署、答辩决议及院系存档方式。请附含完整签署页的定稿 PDF。',
    output: 'attached', materials: [{ id: 'signed-thesis', label: '已核对的签署版定稿 PDF', extensions: ['pdf'], required: true, rule: 'sjtu-signed-thesis' }] },
  'prl-review': { template: 'aps-prl', label: 'PRL · 同行评审稿', source: 'APS · Web Submission Guidelines',
    sourceUrl: 'https://journals.aps.org/authors/web-submission-guidelines-physical-review',
    note: '评审使用包含正文和图表的一份 PDF。适用的补充材料另附并在稿中引用。', output: 'pdf',
    materials: [{ id: 'supporting', label: 'PRL 补充材料 PDF（适用时）', extensions: ['pdf'], multiple: true, rule: 'prl-review-materials' }] },
  'prl-production': { template: 'aps-prl', label: 'PRL · 接收后源文件', source: 'APS · Web Submission Guidelines',
    sourceUrl: 'https://journals.aps.org/authors/web-submission-guidelines-physical-review',
    note: '按编辑部通知核对 REVTeX 生产源文件与原始图件。', output: 'source',
    materials: [{ id: 'figures', label: '生产图件（适用时）', extensions: ['eps', 'ps', 'pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'], multiple: true, rule: 'prl-production-materials' }] },
  'catalog-delivery': { template: '', label: '按模板准备提交', source: '模板目录', sourceUrl: '',
    note: '按实际学校、期刊和提交阶段核对文件格式、声明与附件。此清单记录准备情况。',
    output: 'confirm', materials: [{ id: 'supporting', label: '按要求另交的文件（适用时）', extensions: ['pdf', 'doc', 'docx', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff'], multiple: true, rule: 'catalog-portal' }] },
}

export function submissionStageInfo(stage: SubmissionStage, template?: string) {
  const config = submissionStageConfig[stage]
  if (stage !== 'catalog-delivery') return config
  const entry = templateCatalog.find(item => item.id === template)
  if (!entry) return config
  return { ...config, label: entry.category === 'school' ? '论文定稿准备' : entry.category === 'journal' ? '投稿材料准备' : config.label,
    source: entry.name, sourceUrl: entry.requirementsUrl ?? entry.sourceUrl ?? '' }
}

export function stagesForTemplate(template?: string): SubmissionStage[] {
  if (!template) return []
  const entry = templateCatalog.find(item => item.id === template)
  if (!entry || entry.workflow.kind === 'reference') return []
  return [...submissionStages.filter(stage => submissionStageConfig[stage].template === template), 'catalog-delivery']
}

type PhaseFinding = Omit<LayoutFinding, 'evidence' | 'sourceUrl'> & { ruleId: string }
export type BlindEvidence = { attachmentSha256?: string; coverVerified: boolean; identifiers: readonly string[] }

function textFiles(project: ProjectFileSystem, main: string) {
  const files = [...project.files].flatMap(([path, file]) => file.type !== 'directory' && typeof file.content === 'string'
    ? [{ path, text: file.content }] : [])
  return files.sort((a, b) => Number(b.path === main) - Number(a.path === main))
}

function firstMatch(files: ReturnType<typeof textFiles>, pattern: RegExp) {
  for (const file of files) {
    const raw = maskLatexCode(file.text)
    const match = pattern.exec(raw)
    if (match) return { path: file.path, text: raw, match, line: lineNumber(raw, match.index) }
  }
}

const omittedHeading = /^(?:致谢|鸣谢|acknowledg(?:e)?ments?)$/iu
const headingPattern = /\\((?:sub){0,2}section)\*?\s*\{([^{}\r\n]+)\}/g

/** Remove structured acknowledgments from the render while keeping every source line index. */
export function omitBlindAcknowledgments(body: string) {
  const headings = [...maskLatexCode(body).matchAll(headingPattern)]
  let output = body
  for (const [i, heading] of headings.entries()) {
    if (!omittedHeading.test(heading[2].trim())) continue
    const start = heading.index
    const end = headings.slice(i + 1).find(next => next[1].length <= heading[1].length)?.index ?? body.length
    output = output.slice(0, start) + output.slice(start, end).replace(/[^\r\n]/g, ' ') + output.slice(end)
  }
  return output
}

const normalizeIdentity = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}@]/gu, '').toLowerCase()

function sections(project: ProjectFileSystem, main: string, stage: SubmissionStage, pages: PdfLayoutPage[], blind?: BlindEvidence): PhaseFinding[] {
  const files = textFiles(project, main)
  const source = files.filter(file => /\.(?:tex|bib)$/i.test(file.path))
  const extracted = pages.map(page => page.text)
  const detected = (ruleId: string, label: string, found: boolean, yes: string, no: string, location?: Pick<LayoutFinding, 'path' | 'line' | 'page'>): PhaseFinding =>
    ({ ruleId, label, status: found ? 'pass' : 'issue', detail: found ? yes : no, ...location })
  const manual = (ruleId: string, label: string, detail: string): PhaseFinding => ({ ruleId, label, detail, status: 'manual' })
  const pageWith = (pattern: RegExp) => {
    const index = extracted.findIndex(text => pattern.test(text.replace(/\s+/g, '')))
    return index >= 0 ? { page: index + 1 } : undefined
  }

  if (stage === 'njupt-blind') {
    const ids = [...new Set((blind?.identifiers ?? []).map(normalizeIdentity).filter(value => value.length >= 2))]
    const leaks = [...extracted, ...project.files.keys(), ...files.map(file => file.text)].some(value => {
      const text = normalizeIdentity(value)
      return ids.some(id => text.includes(id))
    })
    const front = pageWith(/(?:原创性声明|独创性声明|学位论文使用授权声明|ThesisSubmittedtoNanjingUniversity|^(?:致谢|Acknowledg(?:e)?ments))/i)
    return [
      detected('blind-cover', '南邮专硕官方盲审封面', !!blind?.coverVerified, '本次渲染使用校验过的官方盲审封面。', '缺少可核验的盲审封面，请从启用南邮专业硕士的项目生成。', { page: 1 }),
      detected('blind-front', '盲审稿排除英文题名页、声明和致谢', pages.length > 0 && !front,
        'PDF 文本中未检出这些前置页和独立致谢标题。', '检出须排除的内容或无法读取 PDF，请复核。', front),
      detected('blind-identities', '盲审身份信息', pages.length > 0 && ids.length > 0 && !leaks,
        '未检出已知的姓名、学号或导师信息。', '检测到可识别信息或缺少检查证据。请检查原稿、文件名、文献及附件。'),
      manual('blind-assets', '图表、成果及隐藏身份信息', '逐页查看图表与附件元数据，核对成果清单已隐去作者和题名，再确认导师审核和匿名上传。'),
    ]
  }

  if (stage === 'njupt-deposit') {
    const declaration = pageWith(/(?:原创性|独创性)声明/)
    const authorization = pageWith(/使用授权(?:声明|书)/)
    const title = pageWith(/专业学位硕士论文/)
    return [
      detected('deposit-title', '归档题名页', !!title, 'PDF 中找到专业学位硕士题名页。', 'PDF 未识别到专硕题名页。', title),
      detected('deposit-declaration', '原创性与使用授权声明', !!declaration && !!authorization,
        'PDF 中检测到两份声明的标题。', '核对原稿是否含两份声明。', declaration ?? authorization),
      manual('deposit-signatures', '作者和导师签署', '按学位申请要求检查签署人、日期和正式纸质件。'),
      manual('deposit-materials', '学校系统和图书馆交稿', '确认最终定稿、公开或保密要求，以及需要另交的 Word 和签字材料。'),
    ]
  }

  if (stage === 'catalog-delivery') {
    return [manual('catalog-portal', '提交系统、文件和适用附件', '按当前提交要求核对稿件版本、所需 PDF 或源文件、声明签署、补充材料及文件命名。')]
  }
  if (stage === 'sjtu-deposit') {
    return [manual('sjtu-signed-thesis', '签署版稿件与答辩决议', '核对最终稿与当前稿件一致，并包含已签署的原创性声明、使用授权书及适用的答辩决议。')]
  }
  if (stage === 'prl-review') {
    return [manual('prl-review-materials', '评审 PDF 和适用补充材料', '核对单份稿件 PDF 包含正文、图表和参考文献。确认适用的独立补充材料及正文引用。')]
  }
  if (stage === 'prl-production') {
    return [manual('prl-production-materials', '生产源文件和适用独立图件', '按编辑通知核对干净源稿、图件格式、文献及正式提交文件名。')]
  }

  const keyPoints = firstMatch(source, /\\keypoints\s*(?=\{)/)
  let offset = keyPoints ? keyPoints.match.index + keyPoints.match[0].length : 0
  const points: string[] = []
  for (let i = 0; keyPoints && i < 3; i++) {
    while (/\s/.test(keyPoints.text[offset] ?? '')) offset++
    const end = keyPoints.text[offset] === '{' ? groupEnd(keyPoints.text, offset, '{', '}') : undefined
    if (end === undefined || end < 0) break
    points.push(keyPoints.text.slice(offset + 1, end).trim())
    offset = end + 1
  }
  const pls = firstMatch(source, /\\begin\s*\{plainlanguagesummary\}([\s\S]*?)\\end\s*\{plainlanguagesummary\}/)
  const research = firstMatch(source, /\\section\*?\s*\{\s*(?:Open Research(?: Statement)?|Data Availability)\s*\}([\s\S]*?)(?=\\(?:section|bibliography|end\s*\{document\})|$)/i)
  const location = (match?: ReturnType<typeof firstMatch>) => match && ({ path: match.path, line: match.line })
  const findings = [
    detected('agu-key-points', 'AGU Key Points', points.length === 3 && points.every(point => point && point.length <= 140),
      '检测到三条不超过 140 字符的要点。', '按投稿清单检查三条简短要点。', location(keyPoints)),
    detected('agu-plain-language', 'AGU Plain Language Summary', !!pls?.match[1].trim(),
      '稿件含独立的通俗摘要。', 'JGR: Atmospheres 需要通俗摘要。', location(pls)),
    detected('agu-open-research', 'AGU Open Research Statement', !!research?.match[1].trim(),
      '稿件含非空开放研究声明。', '请补上数据可用性声明及适用的软件声明。', location(research)),
    manual('agu-data-access', '数据、软件及适用的补充材料', '核对存储库与引用、访问条件及补充材料。需要时按投稿系统单独上传。'),
  ]
  if (stage === 'agu-revision') {
    const markup = firstMatch(source, /\\(?:added|deleted|replaced|DIFadd|DIFdel|DIFaddbegin|DIFdelbegin)\b/)
    return [...findings,
      detected('agu-clean-revision', '修回清洁版稿件', !markup, '未检出常用 LaTeX 修订标记。', '检测到修订标记，请用接受所有修改后的源稿。', location(markup)),
      manual('agu-marked-version', '修订痕迹对照稿', '检查本轮另行准备的带修订痕迹 Word 或 PDF。'),
      manual('agu-review-response', '逐条回复审稿意见', '准备逐条回复文件，保留审稿人和编辑的意见原文。'),
      manual('agu-revision-figures', '修回图件', '按出版方列出的格式和分辨率单独准备生产用图件。'),
    ]
  }
  const draft = firstMatch(source, /\\documentclass\s*\[([^\]]+)\]\s*\{agujournal2025\}/)
  const numberedPage = pages.findIndex(page => page.runningLineNumbers)
  const draftSpacing = Boolean(draft?.match[1].split(',').some(option => option.trim() === 'draft'))
  return [...findings,
    detected('agu-initial-line-numbers', '初投行号与审稿行距', draftSpacing && numberedPage >= 0,
      '使用官方类的 draft 行距，并在 PDF 左边距观察到连续行号。', '请启用官方类的 draft 行距和 linenumbers，并检查编译后的 PDF。',
      numberedPage >= 0 ? { page: numberedPage + 1 } : location(draft)),
    manual('agu-initial-form', '初投稿系统信息', '核对通讯作者 ORCID、作者信息、建议审稿人和利益冲突声明。')]
}

export function submissionHasFigures(project: ProjectFileSystem, main: string, pages: PdfLayoutPage[]) {
  return pages.some(page => page.figureCaption) || Boolean(firstMatch(textFiles(project, main).filter(file => /\.tex$/i.test(file.path)),
    /\\begin\s*\{figure\*?\}|\\includegraphics\b/))
}

export function assessSubmissionStage(project: ProjectFileSystem, main: string, stage: SubmissionStage, pages: PdfLayoutPage[], generated: boolean,
  blind?: BlindEvidence): LayoutFinding[] {
  const config = submissionStageInfo(stage, project.metadata?.templateOrigin?.id)
  return sections(project, main, stage, pages, blind).map(finding => ({
    ...finding, path: generated ? undefined : finding.path, line: generated ? undefined : finding.line,
    evidence: config.source, sourceUrl: finding.ruleId === 'blind-cover' ? njuptBlindCover.page : config.sourceUrl || undefined,
  }))
}

export function blindDeliveryBlocked(stage?: SubmissionStage, findings: LayoutFinding[] = []) {
  return stage === 'njupt-blind' && (['blind-cover', 'blind-front', 'blind-identities'] as const)
    .some(rule => !findings.some(finding => finding.ruleId === rule && finding.status === 'pass'))
}
