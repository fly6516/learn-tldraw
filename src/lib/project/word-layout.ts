import { z } from 'zod'

export const layoutChoices = {
  paper: ['a4', 'letter', 'a5'],
  cjkFont: ['song', 'hei', 'kai', 'fangsong'],
  latinFont: ['times', 'sans', 'modern'],
  lineMode: ['multiple', 'exact'],
  header: ['none', 'left', 'center', 'right'],
  footer: ['none', 'left', 'center', 'right'],
  headings: ['word', 'numbered'],
  abstract: ['plain', 'separate'],
  figures: ['keep', 'chapter', 'continuous'],
  tables: ['keep', 'chapter', 'continuous'],
  references: ['as-written', 'numbered', 'author-year'],
  frontPages: ['none', 'Roman', 'roman', 'arabic'],
  runningHead: ['same', 'odd-title', 'odd-chapter', 'even-chapter', 'split', 'chapter-all'],
  chapterBreak: ['continuous', 'new-page'],
  bodyOpening: ['next', 'odd'],
  captionSeparator: ['hyphen', 'dot'],
} as const

export const layoutLabels = {
  paper: '纸张', top: '上边距（mm）', bottom: '下边距（mm）', left: '左边距（mm）', right: '右边距（mm）',
  gutter: '装订线（mm）',
  cjkFont: '中文字体', latinFont: '西文字体', bodySize: '正文字号（pt）', lineMode: '行距方式', spacing: '正文行距（倍数或 pt）',
  header: '页眉位置', headerSize: '页眉字号（pt）', footer: '页码位置', footerSize: '页码字号（pt）',
  headerOffset: '页眉距页边（mm）', footerOffset: '页脚距页边（mm）',
  headings: '标题层级识别', heading1: '一级标题字号（pt）', heading2: '二级标题字号（pt）', heading3: '三级标题字号（pt）',
  abstract: '摘要', tocDepth: '目录层级（0 关闭）', figures: '插图编号', tables: '表格编号', references: '参考文献',
  frontPages: '摘要与目录页码', runningHead: '页眉内容规则', fixedHeader: '固定页眉文字', chapterBreak: '一级标题起页方式',
  captionSeparator: '图表章号分隔符', bodyOpening: '正文首页排版',
} as const

export const layoutValuesSchema = z.object({
  paper: z.enum(layoutChoices.paper),
  top: z.number().min(5).max(75), bottom: z.number().min(5).max(75),
  left: z.number().min(5).max(75), right: z.number().min(5).max(75),
  gutter: z.number().min(0).max(30),
  cjkFont: z.enum(layoutChoices.cjkFont), latinFont: z.enum(layoutChoices.latinFont),
  bodySize: z.number().min(8).max(22), lineMode: z.enum(layoutChoices.lineMode), spacing: z.number().min(1).max(48),
  header: z.enum(layoutChoices.header), footer: z.enum(layoutChoices.footer),
  headerSize: z.number().min(7).max(18), footerSize: z.number().min(7).max(18),
  headerOffset: z.number().min(0).max(50), footerOffset: z.number().min(0).max(50),
  headings: z.enum(layoutChoices.headings), heading1: z.number().min(9).max(26),
  heading2: z.number().min(9).max(26), heading3: z.number().min(9).max(26),
  abstract: z.enum(layoutChoices.abstract), tocDepth: z.number().int().min(0).max(3),
  figures: z.enum(layoutChoices.figures), tables: z.enum(layoutChoices.tables), references: z.enum(layoutChoices.references),
  frontPages: z.enum(layoutChoices.frontPages), runningHead: z.enum(layoutChoices.runningHead),
  fixedHeader: z.string().trim().max(120), chapterBreak: z.enum(layoutChoices.chapterBreak),
  captionSeparator: z.enum(layoutChoices.captionSeparator),
  bodyOpening: z.enum(layoutChoices.bodyOpening),
}).strict()
export const renderLayoutSchema = layoutValuesSchema.superRefine((data, context) => {
  if (data.lineMode === 'multiple' && data.spacing > 3 || data.lineMode === 'exact' && data.spacing < data.bodySize) {
    context.addIssue({ code: 'custom', path: ['spacing'], message: '倍数行距须为 1–3；固定值不得小于正文字号。' })
  }
  if (data.paper === 'a5' && (data.left + data.right + data.gutter > 115 || data.top + data.bottom > 165)) {
    context.addIssue({ code: 'custom', path: ['paper'], message: 'A5 的可用正文区域太小。' })
  }
})
export type LayoutValues = z.infer<typeof layoutValuesSchema>
export type LayoutKey = keyof LayoutValues
export const layoutKeys = Object.keys(layoutLabels) as LayoutKey[]
export const defaultLayout: LayoutValues = {
  paper: 'a4', top: 25.4, bottom: 25.4, left: 25.4, right: 25.4, gutter: 0,
  cjkFont: 'song', latinFont: 'times', bodySize: 12, lineMode: 'multiple', spacing: 1.5,
  header: 'none', headerSize: 9, footer: 'center', footerSize: 10,
  headerOffset: 12.7, footerOffset: 12.7,
  headings: 'numbered', heading1: 16, heading2: 14, heading3: 12, abstract: 'separate',
  tocDepth: 3, figures: 'chapter', tables: 'chapter', references: 'as-written',
  frontPages: 'none', runningHead: 'same', fixedHeader: '', chapterBreak: 'continuous',
  captionSeparator: 'hyphen', bodyOpening: 'next',
}

export const evidenceSchema = z.object({
  value: z.union([z.string().max(120), z.number()]),
  origin: z.enum(['file', 'sample', 'pending', 'standard', 'user']),
  source: z.string().min(1).max(240),
})
export const standardExcerptSchema = z.object({ page: z.number().int().positive(), text: z.string().min(1).max(360) })
const decisionSchema = z.enum(['sample', 'standard', 'manual'])
export const layoutComparisonSchema = z.object({
  label: z.string(), requirement: z.string(), sample: z.string().optional(), selected: z.string(),
  detected: z.string().optional(), standardName: z.string().optional(), source: z.string(),
  excerpt: standardExcerptSchema.optional(), decision: decisionSchema.optional(), confirmed: z.boolean().optional(),
})
const standardEvidenceSchema = evidenceSchema.extend({
  excerpt: standardExcerptSchema.optional(),
  constraint: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('minimum') }),
    z.object({ kind: z.literal('one-of'), values: z.array(evidenceSchema.shape.value).min(2).max(12) }),
  ]).optional(),
})
const ruleSchema = z.object({
  chosen: evidenceSchema,
  sample: evidenceSchema.optional(),
  standard: standardEvidenceSchema.optional(),
  decision: decisionSchema.optional(),
  confirmed: z.boolean().optional(),
})
const migrateRules = (data: unknown) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const rules = { ...data }
  for (const key of ['frontPages', 'runningHead', 'fixedHeader', 'chapterBreak', 'captionSeparator', 'bodyOpening'] as const) {
    if (!(key in rules)) Object.assign(rules, { [key]: { chosen: { value: defaultLayout[key], origin: 'pending', source: '旧版版式的兼容默认值。' } } })
  }
  return rules
}
export const wordLayoutSchema = z.object({
  presentation: z.enum(['zju-basic-medicine', 'sjtu-engineering', 'njupt-academic', 'njupt-professional']).optional(),
  version: z.literal(1),
  sampleName: z.string().max(180),
  standardName: z.string().max(180).optional(),
  rules: z.preprocess(migrateRules, z.record(z.enum(layoutKeys as [LayoutKey, ...LayoutKey[]]), ruleSchema)),
}).superRefine((layout, context) => {
  for (const key of layoutKeys) {
    const rule = layout.rules[key]
    for (const value of [rule.chosen.value, rule.sample?.value, rule.standard?.value]) {
      if (value !== undefined && !layoutValuesSchema.shape[key].safeParse(value).success) {
        context.addIssue({ code: 'custom', path: ['rules', key], message: '无效的版式参数。' })
      }
    }
    const requirement = rule.standard?.constraint
    if (requirement?.kind === 'minimum' && typeof rule.standard?.value !== 'number'
      || requirement?.kind === 'one-of' && (!requirement.values.includes(rule.standard!.value)
        || new Set(requirement.values).size !== requirement.values.length
        || requirement.values.some(value => !layoutValuesSchema.shape[key].safeParse(value).success))) {
      context.addIssue({ code: 'custom', path: ['rules', key, 'standard'], message: '无效的规范条件。' })
    }
  }
})
export type WordLayout = z.infer<typeof wordLayoutSchema>
export type LayoutEvidence = z.infer<typeof evidenceSchema>
export type LayoutStandard = z.infer<typeof standardEvidenceSchema>
export type LayoutRule = WordLayout['rules'][LayoutKey]
export type LayoutComparison = z.infer<typeof layoutComparisonSchema>
export const wordLayoutAssets = ['cover', 'logo'] as const
export type WordLayoutAsset = typeof wordLayoutAssets[number]
export type WordLayoutBundle = { layout: WordLayout; assets: Partial<Record<WordLayoutAsset, File>> }
export const wordLayoutIssuesSchema = z.array(z.object({
  message: z.string().max(400),
  path: z.string().max(160).optional(),
  line: z.number().int().positive().optional(),
})).max(40)

export const layoutState = {
  file: '从文件读取',
  sample: '从样例推断',
  pending: '待确认',
  standard: '从规范读取',
  user: '手动设置',
}

export function matchesStandard(standard: LayoutStandard, value: LayoutEvidence['value'], tolerance = 0) {
  if (standard.constraint?.kind === 'one-of') return standard.constraint.values.includes(value)
  if (typeof value === 'number' && typeof standard.value === 'number') {
    return standard.constraint?.kind === 'minimum' ? value >= standard.value - tolerance
      : Math.abs(value - standard.value) <= tolerance
  }
  return value === standard.value
}

export function formatStandard(standard: LayoutStandard, show: (value: LayoutEvidence['value']) => string = String) {
  if (standard.constraint?.kind === 'one-of') return standard.constraint.values.map(show).join(' 或 ')
  return (standard.constraint?.kind === 'minimum' ? '至少 ' : '') + show(standard.value)
}

const comparisonValues: Record<string, string> = {
  'author-year': '著者—出版年制', 'as-written': '保留稿件格式', mixed: '同时出现顺序编码与著者—出版年条目',
  dot: '点号（1.1）', hyphen: '短横线（1-1）', chapter: '按章编号',
  center: '居中', left: '靠左', right: '靠右', none: '不显示',
  Roman: '大写罗马数字', roman: '小写罗马数字', arabic: '阿拉伯数字', next: '下一页', odd: '奇数页起排',
}

export function comparisonValue(key: LayoutKey, value: LayoutEvidence['value']) {
  if (key === 'references' && value === 'numbered') return '顺序编码制'
  if (typeof value === 'number') return Number(value.toFixed(2)) + (['top', 'bottom', 'left', 'right', 'gutter'].includes(key) ? ' mm' : '')
  return comparisonValues[value] ?? value
}

export function compareLayoutRule(layout: WordLayout, key: LayoutKey, detected?: LayoutEvidence['value']): LayoutComparison | undefined {
  const rule = layout.rules[key]
  if (!rule.standard) return
  const show = (value: LayoutEvidence['value']) => comparisonValue(key, value)
  return { label: layoutLabels[key], requirement: formatStandard(rule.standard, show),
    sample: rule.sample && show(rule.sample.value), selected: show(rule.chosen.value), detected: detected === undefined ? undefined : show(detected),
    standardName: layout.standardName, source: rule.standard.source, excerpt: rule.standard.excerpt,
    decision: rule.decision, confirmed: rule.confirmed }
}

export function hasLayoutConflict(rule: LayoutRule) {
  return !!(rule.sample && rule.standard && !matchesStandard(rule.standard, rule.sample.value) && !rule.decision)
}

export function layoutValues(layout: WordLayout) {
  return renderLayoutSchema.parse(Object.fromEntries(layoutKeys.map(key => [key, layout.rules[key].chosen.value])))
}

export function isRuleChecked(rule: LayoutRule) {
  return !!(rule.standard && matchesStandard(rule.standard, rule.chosen.value) && !hasLayoutConflict(rule))
}
