import type { LayoutFinding } from '@/lib/project/layout-preflight'
import { LayoutRuleComparison } from './LayoutRuleComparison'

const labels = { pass: '已核对', issue: '发现问题', manual: '待人工核对' }

export function LayoutPreflight({ findings, onSource, onPage, pdfHref, guidelineHref, confirmed, records, onConfirm }: {
  findings?: LayoutFinding[]
  onSource?: (path: string, line?: number) => void
  onPage?: (page: number) => void
  pdfHref?: string
  guidelineHref?: string
  confirmed?: readonly number[]
  records?: readonly { ruleId: string; confirmedAt: string }[]
  onConfirm?: (index: number, checked: boolean) => void
}) {
  if (!findings?.length) return <p role="status" className="text-sm text-workbench-muted">编译当前稿件后查看检查结果。</p>
  return <section aria-label="提交前版式检查结果" className="min-w-0 space-y-2 text-sm">
    <p role="status">{findings.filter(item => item.status === 'issue').length} 项问题 · {findings.filter((item, index) => item.status === 'manual' && !confirmed?.includes(index)).length} 项待人工核对</p>
    <ul className="divide-y rounded-md border border-workbench-line">
      {findings.map((item, index) => <li key={index} className="space-y-1 p-2.5">
        <p className="font-medium">{item.label} · <span className={item.status === 'issue' ? 'text-red-800' : item.status === 'manual' ? 'text-amber-800' : 'text-emerald-800'}>{item.status === 'manual' && confirmed?.includes(index) ? '已人工确认' : labels[item.status]}</span></p>
        <p className="break-words">{item.detail}</p>
        {(item.expected || item.observed) && <dl className="grid gap-x-2 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
          {item.expected && <><dt className="font-medium">规则要求</dt><dd className="break-words">{item.expected}</dd></>}
          {item.observed && <><dt className="font-medium">检测值</dt><dd className="break-words">{item.observed}</dd></>}
        </dl>}
        <p className="break-words text-xs text-workbench-muted">{item.evidence}</p>
        {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-workbench-accent underline">查看规则来源</a>}
        {!!item.comparisons?.length && <div className="space-y-2 rounded bg-workbench-panel p-2">
          {item.comparisons.map(value => <div key={value.label} className="space-y-1">
            {item.comparisons!.length > 1 && <p className="text-xs font-medium">{value.label}</p>}
            <LayoutRuleComparison value={value} guidelineHref={guidelineHref} />
          </div>)}
        </div>}
        <div className="flex flex-wrap gap-3">
          {item.page && onPage && <button type="button" className="text-workbench-accent underline" onClick={() => onPage(item.page!)}>查看 PDF 第 {item.page} 页</button>}
          {item.page && pdfHref && <a href={pdfHref + '#page=' + item.page} target="_blank" rel="noreferrer" className="text-workbench-accent underline">查看 PDF 第 {item.page} 页</a>}
          {item.path && (onSource ? <button type="button" className="break-all text-left text-workbench-accent underline" onClick={() => onSource(item.path!, item.line)}>
            {item.path}{item.line ? ':' + item.line : ''}
          </button> : <span className="break-all">{item.path}{item.line ? ':' + item.line : ''}</span>)}
        </div>
        {item.status === 'manual' && onConfirm && <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmed?.includes(index) ?? false} onChange={event => onConfirm(index, event.target.checked)} />
          人工确认 · {item.label}
        </label>}
        {item.status === 'manual' && !onConfirm && confirmed?.includes(index) && <p>归档前已人工核对
          {records?.find(record => record.ruleId === item.ruleId)?.confirmedAt &&
            ' · ' + new Date(records.find(record => record.ruleId === item.ruleId)!.confirmedAt).toLocaleString()}</p>}
      </li>)}
    </ul>
  </section>
}
