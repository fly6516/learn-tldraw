import { compareLayoutRule, hasLayoutConflict, isRuleChecked, layoutKeys, layoutLabels, layoutState, type WordLayout } from '@/lib/project/word-layout'
import { Button } from '@/components/ui/button'
import { LayoutRuleComparison } from '@/components/project/LayoutRuleComparison'

export function WordLayoutReview({ layout, issues = [], locate }: {
  layout: WordLayout
  issues?: { message: string; path?: string; line?: number }[]
  locate?: (path: string, line?: number) => void
}) {
  return <div className="min-w-0 space-y-4 text-sm">
    <div className="rounded-md bg-workbench-explorer p-3 text-workbench-muted">
      <p className="break-words">Word 样例 · {layout.sampleName}</p>
      <p className="break-words">{layout.standardName ? '规范 · ' + layout.standardName : '参考版式 · 未上传规范'}</p>
    </div>
    {issues.length > 0 && <section aria-label="需要检查的版式问题" className="rounded-md border border-workbench-line p-3">
      <h3 className="font-semibold">需要检查</h3>
      <ul className="mt-1 space-y-2">
        {issues.map(({ message, path, line }, index) => <li key={index}>
          <p className="break-words">{message}</p>
          {locate && path && <Button size="sm" variant="link" className="h-auto max-w-full p-0" onClick={() => locate(path, line)}>
            <span className="truncate">{path}{line ? ':' + line : ''}</span>
          </Button>}
        </li>)}
      </ul>
    </section>}
    <dl className="divide-y rounded-md border border-workbench-line">
      {layoutKeys.map(key => {
        const rule = layout.rules[key]
        const comparison = compareLayoutRule(layout, key)
        return <div key={key} className="space-y-1 p-3">
          <dt className="font-medium">{layoutLabels[key]}</dt>
          <dd>{String(rule.chosen.value)} · {layoutState[rule.chosen.origin]}{rule.confirmed ? ' · 人工确认采用' : ''}</dd>
          <dd className="break-words text-xs text-workbench-muted">
            {hasLayoutConflict(rule) ? '待处理冲突' : isRuleChecked(rule) ? '与已提取的规范一致' : '尚未按规范核对'} · {rule.chosen.source}
          </dd>
          {!comparison && rule.sample && (rule.sample.value !== rule.chosen.value || rule.sample.source !== rule.chosen.source)
            && <dd className="break-words text-xs">样例 · {String(rule.sample.value)} · {rule.sample.source}</dd>}
          {comparison && <dd><LayoutRuleComparison value={comparison} /></dd>}
        </div>
      })}
    </dl>
  </div>
}
