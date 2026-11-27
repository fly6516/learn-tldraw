import { z } from 'zod'
import { groupEnd, maskLatexCode } from './latex-source'
import type { ActiveTemplate, TemplateFields } from './active-template'
import type { ProjectFileSystem } from './types'

export const projectInformationFields = [
  ['title', '稿件主标题', 200],
  ['chineseTitle', '中文题目', 80],
  ['studentNumber', '学号', 20],
  ['advisor', '指导教师', 40],
  ['englishAdvisor', '导师英文姓名', 80],
  ['affiliation', '所在学院／作者单位', 160],
  ['englishAffiliation', '单位英文全称', 160],
  ['email', '通讯邮箱', 160],
  ['program', '专业（领域）', 80],
  ['date', '提交日期', 30],
  ['chineseKeywords', '中文关键词', 160],
  ['englishKeywords', '英文关键词', 250],
  ['chineseAbstract', '中文摘要', 5000],
] as const

type InformationTextField = typeof projectInformationFields[number][0]
const line = (limit: number) => z.string().trim().max(limit).regex(/^[^\p{Cc}]*$/u)
const textFields = Object.fromEntries(projectInformationFields.map(([field, , limit]) => [
  field, (field === 'chineseAbstract' ? z.string().trim().max(limit) : line(limit)).optional(),
])) as Record<InformationTextField, z.ZodOptional<z.ZodString>>

export const projectInformationSchema = z.object({
  ...textFields,
  authors: z.array(line(120).min(1)).max(40).optional(),
})
export type ProjectInformation = z.infer<typeof projectInformationSchema>

export function plainTex(text: string) {
  const escapes: Record<string, string> = {
    '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
  }
  return text.replace(/[\\{}%#&_$^~]/g, char => escapes[char] ?? '\\' + char)
}

const sharedFields = ['chineseTitle', 'affiliation', 'englishAffiliation', 'email', 'studentNumber',
  'advisor', 'englishAdvisor', 'program', 'date', 'chineseAbstract', 'chineseKeywords'] as const
export type SharedTemplateField = typeof sharedFields[number]

export function sharedTemplateFields(info: ProjectInformation | undefined, article: boolean) {
  if (!info) return {}
  const fields: Partial<Pick<TemplateFields, SharedTemplateField>> = {}
  for (const key of sharedFields) {
    if (info[key]) fields[key] = info[key]
  }
  if (article && info.englishAffiliation) fields.affiliation = info.englishAffiliation
  return fields
}

export function isArticleTemplate(kind?: string) {
  return kind === 'jmlr-article' || kind === 'publisher-article' || kind === 'prl-article' || kind === 'starter-article'
}

export function withTemplateFields(template: ActiveTemplate, values: Partial<TemplateFields>): ActiveTemplate {
  const fields = { ...template.fields }
  for (const [key, value] of Object.entries(values)) {
    if (Object.hasOwn(fields, key)) Object.assign(fields, { [key]: value })
  }
  return { ...template, fields } as ActiveTemplate
}

export function templateWithProjectInformation(template: ActiveTemplate, info?: ProjectInformation): ActiveTemplate {
  return info ? withTemplateFields(template, sharedTemplateFields(info, isArticleTemplate(template.kind))) : template
}

export function plainTitle(text: string) {
  return text.replace(/\\(textbackslash|textasciicircum|textasciitilde)\{\}|\\([{}&%#$ _])/g,
    (_, escape: string | undefined, char: string | undefined) =>
      char ?? (escape === 'textbackslash' ? '\\' : escape === 'textasciicircum' ? '^' : '~'))
}

export function projectInformationKey(info?: ProjectInformation) {
  return info ? JSON.stringify(info) : ''
}

/** Override standard TeX title/author commands in a disposable build copy, keeping source line numbers. */
export function sourcesWithProjectInformation(project: ProjectFileSystem, main: string): ProjectFileSystem {
  const info = project.metadata.information
  const title = info?.title
  const authors = info?.authors
  if (!title && !authors?.length) return project
  const entry = project.files.get(main)
  if (!entry || entry.type === 'directory' || typeof entry.content !== 'string') return project
  const code = maskLatexCode(entry.content)
  const start = /\\begin\s*\{document\}/.exec(code)?.index
  if (start === undefined) throw new Error(main + ' · 找不到正文入口，无法应用项目信息。')
  const insertions: string[] = []
  const edits: { start: number; end: number; text: string }[] = []
  for (const [command, value] of [
    ['title', title && plainTex(title)],
    ['author', authors?.length ? authors.map(plainTex).join(' \\and ') : undefined],
  ]) {
    if (!value) continue
    const matches = [...code.matchAll(new RegExp(String.raw`\\\\|\\${command}(?![a-zA-Z@])`, 'g'))].filter(match => match[0] !== '\\\\')
    if (!matches.length) {
      insertions.push('\\' + command + '{' + value + '}')
      continue
    }
    const match = matches[0]
    const argument = match.index + match[0].length + (code.slice(match.index + match[0].length).match(/^\s*/)?.[0].length ?? 0)
    const end = code[argument] === '{' ? groupEnd(code, argument, '{', '}') : undefined
    if (matches.length !== 1 || end === undefined) throw new Error(main + ' · 请先将 \\' + command + ' 整理为单一的标准命令，再从项目信息填充。')
    edits.push({ start: argument, end: end + 1, text: '{' + value + '}' + (entry.content.slice(argument, end).match(/\r\n|\r|\n/g) ?? []).join('') })
  }
  if (insertions.length) edits.push({ start, end: start, text: insertions.join(' ') + ' ' })
  let content = entry.content
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end)
  const files = new Map(project.files).set(main, { ...entry, blob: undefined, content })
  return { ...project, files, metadata: { ...project.metadata, mainFile: main } }
}

const thesisFields = ['chineseTitle', 'studentNumber', 'advisor', 'program', 'affiliation', 'date', 'chineseAbstract', 'chineseKeywords'] as const
const templateFieldLabels: Partial<Record<keyof TemplateFields, string>> = {
  ...Object.fromEntries(projectInformationFields.map(([key, label]) => [key, label])),
  englishAffiliation: '学院英文全称',
  degree: '申请学位类别',
  degreeTitle: '学位类别中文全称',
  englishDegree: '学位类别英文全称',
  englishProgram: '学科专业英文全称',
  studyMode: '培养类型',
  direction: '研究方向',
  track: '培养类型',
  keyPoint: 'Key Point',
  plainLanguageSummary: 'Plain Language Summary',
  openResearch: 'Open Research Statement',
  advisorTitle: 'Thesis supervisor title',
  acceptor: 'Departmental acceptor name',
  acceptorTitle: 'Departmental acceptor title',
  acceptorRole: 'Departmental acceptor role',
  degreeDate: 'Degree month and year',
}

export function missingTemplateFields(kind: string, id: string, fields: Partial<TemplateFields>, anonymous = false) {
  let required: readonly (keyof TemplateFields)[]
  switch (kind) {
    case 'zju-undergraduate':
    case 'suep-undergraduate': required = thesisFields; break
    case 'sjtu-graduate-word': required = [...thesisFields, 'englishAdvisor', 'englishAffiliation']; break
    case 'njupt-masters':
      required = [...thesisFields.filter(key => key !== 'affiliation'), 'degree', 'englishDegree', 'englishAdvisor',
        id === 'njupt-professional-masters' ? 'studyMode' : 'direction']
      if (anonymous) required = ['chineseTitle', 'program', 'degree', 'studyMode', 'chineseAbstract', 'chineseKeywords']
      break
    case 'official-thesis':
      required = id === 'scau-undergraduate' ? thesisFields : [...thesisFields, 'degree', 'track']
      if (id === 'ustc-graduate-word') required = [...required, 'englishAdvisor', 'englishAffiliation', 'englishProgram', 'direction']
      break
    case 'thuthesis':
      required = [...thesisFields.filter(key => key !== 'studentNumber'), 'degree', 'englishAdvisor', 'englishProgram']
      if (fields.degree && fields.degree !== 'bachelor') required = [...required, 'degreeTitle', 'englishDegree']
      break
    case 'mit-thesis':
      required = ['affiliation', 'degree', 'advisor', 'advisorTitle', 'acceptor', 'acceptorTitle', 'acceptorRole', 'degreeDate', 'date']
      break
    case 'jmlr-article':
    case 'prl-article':
    case 'publisher-article':
      required = id === 'agu-jgr-atmospheres' ? ['affiliation', 'email', 'keyPoint', 'plainLanguageSummary', 'openResearch'] : ['affiliation']
      break
    default: required = []
  }
  return required.filter(key => !String(fields[key] ?? '').trim())
    .map(key => isArticleTemplate(kind) && key === 'affiliation' ? '作者单位' : templateFieldLabels[key] ?? key)
}
