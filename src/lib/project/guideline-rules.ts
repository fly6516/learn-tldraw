import type { GuidelinePage } from './pdf-guideline'
import { layoutValuesSchema, type LayoutKey, type LayoutStandard } from './word-layout'

const margin = { 上: 'top', 下: 'bottom', 左: 'left', 右: 'right' } as const
const width = '(\\d+(?:\\.\\d+)?)\\s*(mm|cm|毫米|厘米)'
const mm = (value: string, unit: string) => Number(value) * (/cm|厘米/i.test(unit) ? 10 : 1)

export function guidelineEvidence(value: LayoutStandard['value'], line: GuidelinePage,
  constraint?: LayoutStandard['constraint']): LayoutStandard {
  const text = line.text.trim().slice(0, 360)
  return { value, origin: 'standard', source: text.replace(/\s+/g, ' ').slice(0, 200),
    excerpt: line.page === undefined ? undefined : { page: line.page, text }, constraint }
}

/** Read explicit clauses before the line-based extraction for simpler formats. */
export function guidelineClauses(pages: readonly GuidelinePage[]) {
  const found: Partial<Record<LayoutKey, LayoutStandard>> = {}
  const add = (key: LayoutKey, value: LayoutStandard['value'], line: GuidelinePage, constraint?: LayoutStandard['constraint']) => {
    if (layoutValuesSchema.shape[key].safeParse(value).success && (!found[key] || constraint && !found[key].constraint)) {
      found[key] = guidelineEvidence(value, line, constraint)
    }
  }
  const pair = new RegExp('([上下左右])(?:方|侧|边)(?:和|与|及|、)([上下左右])(?:方|侧|边)(?:分别|各)?(?:留|至少留)' + width + '(?:以上|或更多)', 'gi')
  const single = new RegExp('([上下左右])(?:方|侧|边距)(?:至少|不小于|不得小于|不低于|≥)' + width, 'gi')
  const singleAfter = new RegExp('([上下左右])(?:方|侧|边距)(?:留|为|应留|需留|[:：])' + width + '以上', 'gi')
  for (const { text, page } of pages) {
    // Include neighboring lines to recover clauses wrapped by PDF typesetting.
    // Do not merge turns across physical pages or complete sentences.
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    for (const [index, line] of lines.entries()) {
      const next = lines[index + 1]
      const excerpt = { page, text: next ? line + '\n' + next : line }
      const clause = excerpt.text.normalize('NFKC').replace(/\s+/g, '')
      if (/纸张|边距|版面|间隙|空白/.test(clause)) {
        for (const [, first, second, value, unit] of clause.matchAll(pair)) {
          add(margin[first as keyof typeof margin], mm(value, unit), excerpt, { kind: 'minimum' })
          add(margin[second as keyof typeof margin], mm(value, unit), excerpt, { kind: 'minimum' })
        }
        for (const pattern of [single, singleAfter]) {
          for (const [, side, value, unit] of clause.matchAll(pattern)) {
            add(margin[side as keyof typeof margin], mm(value, unit), excerpt, { kind: 'minimum' })
          }
        }
      }
      // Match the single normative sentence, without merging conditional examples.
      const reference = /(?:可采用|可选用|可使用)[^。；]{0,80}(?:顺序编码制|著者[-—－]?出版年制)(?:[^。；]{0,55})(?:也可采用|也可使用|或采用|或|以及)(?:[^。；]{0,30})(?:顺序编码制|著者[-—－]?出版年制)/.exec(clause)
      if (reference && /顺序编码制/.test(reference[0]) && /著者[-—－]?出版年制/.test(reference[0])) {
        add('references', 'numbered', excerpt, { kind: 'one-of', values: ['numbered', 'author-year'] })
      }
      const captionClause = /(?:图|表).{0,28}(?:一律|按章|分章|第[\dxl]+章|编号)|(?:按章|分章).{0,35}(?:图|表)/i.test(clause)
      if (captionClause) {
        for (const [, kind] of clause.matchAll(/([图表])(?:\d+|x|l)\.(?:\d+|y)(?!\d)/gi)) {
          add(kind === '图' ? 'figures' : 'tables', 'chapter', excerpt)
          add('captionSeparator', 'dot', excerpt)
        }
      }
      if (/页码(?:排在|置于|位于|在)?(?:页脚)?居中|页脚为居中|页脚.{0,14}页码居中/.test(clause)) {
        add('footer', 'center', excerpt)
      }
    }
  }
  return found
}
