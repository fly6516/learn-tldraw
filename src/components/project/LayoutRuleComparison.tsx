import type { LayoutComparison } from '@/lib/project/word-layout'

const decisions = { sample: '采用样例', standard: '采用规范', manual: '手动设置' }

export function LayoutRuleComparison({ value, guidelineHref }: { value: LayoutComparison; guidelineHref?: string }) {
  return <div className="min-w-0 space-y-1 text-xs">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      <dt>规范要求</dt><dd className="break-words">{value.requirement}</dd>
      <dt>Word 样例</dt><dd className="break-words">{value.sample ?? '待核对'}</dd>
      <dt>采用值</dt><dd className="break-words">{value.selected}{value.decision ? ' · ' + decisions[value.decision] : ''}{value.confirmed ? ' · 人工确认' : ''}</dd>
      {value.detected !== undefined && <><dt>编译检测</dt><dd className="break-words">{value.detected}</dd></>}
    </dl>
    <details className="text-workbench-muted">
      <summary className="cursor-pointer break-words">
        规范原文{value.excerpt ? ` · PDF 第 ${value.excerpt.page} 页` : ''}{value.standardName ? ' · ' + value.standardName : ''}
      </summary>
      <p className="mt-1 whitespace-pre-line break-words">{value.excerpt?.text ?? value.source}</p>
      {guidelineHref && value.excerpt && <a className="underline" href={guidelineHref + '#page=' + value.excerpt.page}
        target="_blank" rel="noreferrer">打开规范第 {value.excerpt.page} 页</a>}
    </details>
  </div>
}
