import type { WordLayout } from './word-layout'

export function zjuLayout(layout: WordLayout): WordLayout {
  const rules = { ...layout.rules }
  const editorRules = {
    headerOffset: { value: 12, origin: 'user', source: '留出页眉横线与正文标题的间距，保留样例的正文上边距。' },
    headerSize: { value: 9, origin: 'standard', source: '附件 7 §2.3.2.3 · 页眉采用小五号宋体。' },
    footerSize: { value: 9, origin: 'standard', source: '附件 7 §2.3.2.3 · 页脚采用小五号宋体。' },
    runningHead: { value: 'odd-title', origin: 'standard', source: '附件 7 §2.3.2.3 · 建议奇数页右侧为论文题目、偶数页左侧为学校文字。' },
    fixedHeader: { value: '浙江大学本科生毕业论文（设计）', origin: 'standard', source: '附件 7 §2.3.2.3 · 偶数页页眉建议文字。' },
    chapterBreak: { value: 'new-page', origin: 'sample', source: '附件 6 · 第二章及结论前的显式分页。' },
  } as const
  for (const key of Object.keys(editorRules) as (keyof typeof editorRules)[]) {
    rules[key] = { ...rules[key], chosen: editorRules[key] }
  }
  return { ...layout, rules, presentation: 'zju-basic-medicine' }
}

export function zjuCaptionSetup(native: boolean) {
  return [
    '\\DeclareCaptionFont{zjucaption}{\\songti\\bfseries\\fontsize{10.5bp}{12.6bp}\\selectfont}',
    `\\captionsetup{labelformat=${native ? 'simple' : 'empty'},font=zjucaption}`,
    '\\captionsetup[figure]{position=bottom}', '\\captionsetup[table]{position=top}',
  ]
}
