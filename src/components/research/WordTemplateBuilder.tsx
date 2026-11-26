'use client'

import { njuptLayout } from '@/lib/project/official-thesis-front'
import { sjtuLayout } from '@/lib/project/sjtu-export-front'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { LocalPaperTemplate } from '@/lib/project/template-catalog'
import { addLocalTemplate } from '@/lib/project/storage'
import { templateDigest } from '@/lib/project/paper-templates'
import { catalogWordAttachments, readWordAttachmentCandidate, usesWordAttachmentRelease, type WordReleaseAssets } from '@/lib/project/word-release-attachments'
import { officialAttachment, verifyAttachment, type AttachmentRole, type OfficialAttachment } from '@/lib/project/official-attachments'
import { readCandidateOrigin, type TemplateOrigin } from '@/lib/project/template-release'
import { applyWordBundle, importWordAsProject, packWordTemplate, previewWordLayout, previewWordProject, wordRequest } from '@/lib/project/word-conversion-client'
import type { LayoutFinding } from '@/lib/project/layout-preflight'
import { LayoutPreflight } from '@/components/project/LayoutPreflight'
import { LayoutRuleComparison } from '@/components/project/LayoutRuleComparison'
import {
  compareLayoutRule, comparisonValue, defaultLayout, hasLayoutConflict, isRuleChecked, layoutChoices, layoutKeys, layoutLabels, matchesStandard,
  layoutState, layoutValues, wordLayoutAssets, wordLayoutSchema, type LayoutKey, type WordLayout, type WordLayoutBundle,
} from '@/lib/project/word-layout'

const SyncedPdfPreview = dynamic(() => import('@/components/project/SyncedPdfPreview').then(module => module.SyncedPdfPreview), { ssr: false })

const translated: Record<string, string> = {
  a4: 'A4', a5: 'A5', letter: 'Letter', song: '宋体', hei: '黑体', kai: '楷体', fangsong: '仿宋',
  times: 'Times New Roman', sans: 'Arial', modern: 'Latin Modern',
  multiple: '倍数', exact: '固定磅值', none: '不显示', left: '靠左', center: '居中', right: '靠右',
  word: '按 Word 标题样式', numbered: '识别编号标题', plain: '沿用正文', separate: '中英文分别排版',
  keep: '保留原编号', chapter: '按章编号', continuous: '连续编号',
  'as-written': '保留稿件格式', 'author-year': '著者—出版年',
  Roman: '大写罗马数字（I）', roman: '小写罗马数字（i）', arabic: '阿拉伯数字（1）',
  same: '单双页相同', 'odd-chapter': '奇数页用章标题', 'even-chapter': '偶数页用章标题', 'chapter-all': '从摘要起使用章级标题',
  split: '每页左侧固定文字、右侧章标题', 'new-page': '另起一页',
  hyphen: '短横线（2-1）', dot: '点号（2.1）', next: '下一页', odd: '奇数页起排',
}

function show(value: string | number) { return translated[value] ?? String(value) }
const formFile = (form: FormData, key: string) => {
  const file = form.get(key)
  return file instanceof File && file.size ? file : undefined
}

export function WordTemplateBuilder({ database, close, onSave, previous, official }: {
  database: IDBDatabase
  close: () => void
  onSave: (template: LocalPaperTemplate) => void
  previous?: { name: string; version: string; bundle: WordLayoutBundle; origin?: TemplateOrigin }
  official?: { origin: TemplateOrigin; file?: File; standard?: File; extraFiles?: Partial<Record<AttachmentRole, File>>; parentAttachments?: OfficialAttachment[]; candidateSources?: OfficialAttachment[];
    publish?: (template: LocalPaperTemplate, original: File, previewSha256: string, assets?: WordReleaseAssets) => Promise<void> }
}) {
  const [layout, setLayout] = useState<WordLayout | undefined>(previous?.bundle.layout)
  const [sample, setSample] = useState<File>()
  const [releaseAssets, setReleaseAssets] = useState<WordReleaseAssets>()
  const scopedAttachments = official && usesWordAttachmentRelease(official.origin.id)
  const registered = official && catalogWordAttachments(official.origin.id)
  const supplemental = registered?.filter(item => item.role === 'declaration' || item.role === 'blind-cover') ?? []
  const expectsGuideline = officialAttachment(registered, 'guideline') !== undefined
  const [assets, setAssets] = useState<WordLayoutBundle['assets']>(previous?.bundle.assets ?? {})
  const [name, setName] = useState(previous?.name ?? '')
  const [preview, setPreview] = useState<string>()
  const [previewFindings, setPreviewFindings] = useState<LayoutFinding[]>([])
  const [guidelineHref, setGuidelineHref] = useState<string>()
  const [previewSha256, setPreviewSha256] = useState('')
  const [origin, setOrigin] = useState(previous?.origin ?? official?.origin)
  const [page, setPage] = useState(1)
  const [ai, setAi] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'extract' | 'compile' | 'save'>()
  const request = useRef<AbortController>(undefined)

  useEffect(() => () => { request.current?.abort() }, [])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => () => { if (guidelineHref) URL.revokeObjectURL(guidelineHref) }, [guidelineHref])

  async function run(action: typeof busy, work: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(action)
    setError('')
    try { await work(controller.signal) }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '操作失败，请重试。') }
    finally {
      request.current = undefined
      if (!controller.signal.aborted) setBusy(undefined)
    }
  }

  function extract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = formFile(form, 'body') ?? official?.file
    if (!body) { setError('请选择 Word 样例。'); return }
    form.set('body', body)
    const standard = formFile(form, 'standard') ?? official?.standard
    if (standard) form.set('standard', standard)
    form.set('intent', 'inspect')
    void run('extract', async signal => {
      if (official) {
        if (official.publish) {
          const version = String(form.get('officialVersion') ?? '')
          if (scopedAttachments) {
            const files: Partial<Record<AttachmentRole, File>> = { ...official.extraFiles, guideline: standard }
            for (const item of supplemental) files[item.role] = formFile(form, item.role) ?? files[item.role]
            const candidate = await readWordAttachmentCandidate(official.origin, version, body, files,
              official.parentAttachments, official.candidateSources)
            setOrigin(candidate.origin)
            setReleaseAssets(candidate)
          } else setOrigin(await readCandidateOrigin(official.origin, version, body))
        } else if (await body.arrayBuffer().then(templateDigest) !== official.origin.sha256) {
          throw new Error('上传的 Word 与卡片所选版本不符。请下载对应原件，或在官方版本管理中验收候选。')
        } else if (scopedAttachments) {
          const guide = officialAttachment(catalogWordAttachments(official.origin.id), 'guideline')
          if (guide) {
            if (!standard) throw new Error('请提供所选版本的官方规范 PDF。')
            await verifyAttachment(standard, guide)
          }
        }
      }
      const response = await wordRequest(form, signal)
      const result = await response.json()
      const extracted = wordLayoutSchema.parse(result.layout)
      setLayout(official?.publish && official.origin.id === 'sjtu-graduate-word' ? sjtuLayout(extracted)
        : official?.origin.id === 'njupt-professional-masters' ? njuptLayout(extracted, true)
          : official?.publish && official.origin.id.startsWith('njupt-') ? njuptLayout(extracted) : extracted)
      setGuidelineHref(standard && /\.pdf$/i.test(standard.name) ? URL.createObjectURL(standard) : undefined)
      setSample(body)
      setAi(String(result.ai))
      setName(body.name.replace(/\.docx?$/i, '').slice(0, 120))
    })
  }

  function pick(key: LayoutKey, side: 'sample' | 'standard' | 'manual', value?: string | number) {
    setPreview(undefined)
    setLayout(current => {
      if (!current) return current
      const rule = current.rules[key]
      const chosen = side === 'manual' ? { value: value ?? rule.chosen.value, origin: 'user' as const, source: '用户在预览前编辑。' } : rule[side]
      if (!chosen) return current
      return { ...current, rules: { ...current.rules, [key]: { ...rule, chosen, decision: side, confirmed: undefined } } }
    })
  }

  const conflicts = layout ? layoutKeys.filter(key => hasLayoutConflict(layout.rules[key])) : []
  const checked = layout ? layoutKeys.filter(key => isRuleChecked(layout.rules[key])).length : 0
  function compile() {
    if (!layout || !sample) return
    setPreview(undefined)
    void run('compile', async signal => {
      const validated = wordLayoutSchema.parse(layout)
      layoutValues(validated)
      const form = new FormData()
      form.set('body', sample)
      applyWordBundle(form, { layout: validated, assets })
      if (releaseAssets?.files.declaration) form.set('declaration', releaseAssets.files.declaration)
      const project = await importWordAsProject(form, 'Word layout preview', signal)
      const { pdf, findings } = layoutKeys.some(key => validated.rules[key].standard)
        ? await previewWordLayout(project, validated, signal)
        : { pdf: await previewWordProject(project, signal), findings: [] }
      setPreviewFindings(findings)
      if (official?.publish) setPreviewSha256(await pdf.arrayBuffer().then(templateDigest))
      setPage(1)
      setPreview(URL.createObjectURL(pdf))
    })
  }

  function save() {
    if (!layout || !preview || !name.trim()) return
    void run('save', async () => {
      const [major, minor, patch] = (previous?.version ?? '1.0.0').split('.').map(Number)
      const template = await packWordTemplate(name.trim(), { layout, assets }, previous ? `${major}.${minor}.${patch + 1}` : undefined, origin)
      if (official?.publish) { await official.publish(template, sample!, previewSha256, releaseAssets); return }
      await addLocalTemplate(database, template)
      onSave(template)
    })
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent showCloseButton={!busy} className={layout ? 'max-h-[92dvh] overflow-y-auto sm:max-w-6xl' : 'max-h-[92dvh] overflow-y-auto sm:max-w-lg'}>
      <DialogTitle>{official?.publish ? '验收模板候选' : previous ? '编辑 Word 版式' : '从 Word 生成模板'}</DialogTitle>
      <DialogDescription>{layout
        ? '核对规则、处理冲突，再编译样例。保存后可用这套规则导入另一份稿件。'
        : '使用学校的 Word 模板提取版式。可以上传撰写规范一起核对。'}</DialogDescription>
      {!layout ? <form onSubmit={extract} className="space-y-4">
        <fieldset disabled={!!busy} className="space-y-4">
          {official?.publish && <label className="block space-y-1 text-sm">候选版本号
            <Input name="officialVersion" required maxLength={48} />
          </label>}
          {official?.file && <p className="text-sm">
            已校验官方 Word · {!official.publish && <>{official.origin.version} · </>}{official.file.name}
          </p>}
          {(!official?.file || official.publish) && <label className="block space-y-1 text-sm">Word 样例{official?.file && '（可替换）'}
            <Input type="file" name="body" required={!official?.file} accept=".doc,.docx" />
          </label>}
          {official?.standard && <p className="text-sm">已核验的规范 PDF · {official.standard.name}</p>}
          {(!scopedAttachments && !official?.standard || expectsGuideline && (!official?.standard || official.publish)) && <label className="block space-y-1 text-sm">
            {expectsGuideline ? '官方规范 PDF' : '学校撰写规范（选填）'}
            <Input type="file" name="standard" accept={expectsGuideline ? '.pdf' : '.pdf,.doc,.docx,.txt'} />
          </label>}
          {official?.publish && supplemental.map(item => <label className="block space-y-1 text-sm" key={item.role}>
            {item.role === 'declaration' ? '官方声明 Word' : '官方盲审封面 Word'}
            {official.extraFiles?.[item.role] && <span className="block text-xs">当前候选使用 {official.extraFiles[item.role]?.name}</span>}
            <Input type="file" name={item.role} accept=".doc,.docx" required={!official.extraFiles?.[item.role]} />
          </label>)}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="assist" value="1" className="mt-1 accent-workbench-accent" />
            <span>使用 AI 辅助识别结构<span className="mt-1 block text-xs text-workbench-muted">将标题及排版相关摘录发送给已配置的 AI 服务。关闭时在本机提取。</span></span>
          </label>
        </fieldset>
        <Button disabled={!!busy}>{busy === 'extract' ? '读取文件中…' : '生成版式配置'}</Button>
      </form> : <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-label="版式配置" className="min-w-0 rounded-lg border border-workbench-line">
            <div className="space-y-2 border-b bg-workbench-explorer p-3">
              <label className="block space-y-1 text-sm">模板名称
                <Input value={name} onChange={event => setName(event.target.value)} maxLength={120} disabled={!!busy} />
              </label>
              {ai && <p className="text-xs text-workbench-muted">{ai}</p>}
              <p className="text-xs text-workbench-muted">样例 {layout.sampleName}{layout.standardName ? ' · 规范 ' + layout.standardName : ' · 参考版式，未提供官方规范'}</p>
              <p role="status" className="text-xs font-medium">{checked} 条与所选规范一致 · {layoutKeys.length - checked} 条尚未按规范核对 · {conflicts.length} 个待处理冲突</p>
            </div>
            <fieldset disabled={!!busy} className="divide-y lg:max-h-[48dvh] lg:overflow-auto">
              {layoutKeys.map(key => {
                const rule = layout.rules[key]
                const values = key in layoutChoices ? layoutChoices[key as keyof typeof layoutChoices] : undefined
                const conflict = rule.sample && rule.standard && !matchesStandard(rule.standard, rule.sample.value)
                const comparison = compareLayoutRule(layout, key)
                return <div key={key} className={hasLayoutConflict(rule) ? 'bg-amber-50 p-3' : 'p-3'}>
                  <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,12rem)]">
                    <label htmlFor={'word-rule-' + key} className="text-sm font-medium">{layoutLabels[key]}</label>
                    {values ? <select id={'word-rule-' + key} value={String(rule.chosen.value)}
                      className="h-8 w-full rounded-md border bg-white px-2 text-sm"
                      onChange={event => pick(key, 'manual', event.target.value)}>
                      {values.map(value => <option key={value} value={value}>{key === 'references' ? comparisonValue(key, value) : show(value)}</option>)}
                    </select> : key === 'fixedHeader' ? <Input id={'word-rule-' + key} maxLength={120}
                      placeholder="留空使用稿件页眉" value={String(rule.chosen.value)} onChange={event => pick(key, 'manual', event.target.value)} />
                      : <Input id={'word-rule-' + key} type="number" step={key === 'tocDepth' ? 1 : 0.1}
                      value={typeof rule.chosen.value === 'number' && Number.isFinite(rule.chosen.value) ? rule.chosen.value : ''}
                      placeholder={String(defaultLayout[key])}
                      onChange={event => pick(key, 'manual', event.target.value === '' ? NaN : event.target.valueAsNumber)} />}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-workbench-muted">
                    {layoutState[rule.chosen.origin]} · {rule.chosen.source}{isRuleChecked(rule) ? ' · 已与规范比对'
                      : rule.standard && !hasLayoutConflict(rule) ? ' · 采用值与规范不符' : ' · 尚未按规范核对'}
                  </p>
                  <label className="mt-1 flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={!!rule.confirmed} disabled={hasLayoutConflict(rule)}
                      onChange={event => {
                        const confirmed = event.target.checked
                        setLayout(current => current && {
                          ...current, rules: { ...current.rules, [key]: { ...current.rules[key], confirmed } },
                        })
                      }} />人工确认采用此规则
                  </label>
                  {comparison && <div className="mt-2"><LayoutRuleComparison value={comparison} guidelineHref={guidelineHref} /></div>}
                  {conflict && <div className="mt-2 space-y-1 text-xs">
                    <p className="font-medium">{hasLayoutConflict(rule) ? '样例与规范不一致，请选择' : '已处理样例与规范的差异'}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => pick(key, 'sample')}>采用样例</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => pick(key, 'standard')}>采用规范</Button>
                    </div>
                  </div>}
                </div>
              })}
            </fieldset>
          </section>
          <section aria-label="版式 PDF 预览" className="flex min-h-72 min-w-0 flex-col overflow-hidden rounded-lg border border-workbench-line bg-workbench-canvas">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-workbench-panel p-3">
              <h3 className="text-sm font-semibold">样例 PDF</h3>
              {preview && <a className="text-sm text-workbench-accent underline" href={preview} download="word-layout-preview.pdf">下载预览 PDF</a>}
            </div>
            {preview ? <div className="h-[45dvh] min-h-60 overflow-hidden">
              <SyncedPdfPreview url={preview} page={page} onPage={setPage} regions={[]} target={null} onLocate={() => {}} />
            </div> : <p className="m-auto p-6 text-sm text-workbench-muted">
              {busy === 'compile' ? '正在转换样例并编译…' : '编译后可在这里核对版式。'}
            </p>}
            {preview && previewFindings.length > 0 && <details className="border-t bg-white p-3" open>
              <summary className="cursor-pointer text-sm font-medium">规范和编译结果对照</summary>
              <div className="mt-2 max-h-64 overflow-auto">
                <LayoutPreflight findings={previewFindings} guidelineHref={guidelineHref} onPage={setPage} />
              </div>
            </details>}
            <fieldset disabled={!!busy} className="grid gap-2 border-t bg-white p-3 sm:grid-cols-2">
              {previous && <label className="block min-w-0 space-y-1 text-xs sm:col-span-2">用于预览的 Word 稿件
                <Input type="file" accept=".doc,.docx" onChange={event => {
                  setPreview(undefined)
                  setSample(event.target.files?.[0])
                }} />
              </label>}
              {wordLayoutAssets.map(role => <label key={role} className="block min-w-0 space-y-1 text-xs">
                {role === 'cover' ? '随模板保存的封面（选填）' : '随模板保存的校徽（选填）'}
                <Input type="file" accept={role === 'cover' ? '.doc,.docx' : '.png,.jpg,.jpeg'}
                  onChange={event => { const file = event.target.files?.[0]; setPreview(undefined); setAssets(current => ({ ...current, [role]: file })) }} />
                {assets[role] && <span className="block truncate text-workbench-muted">{assets[role]?.name}</span>}
                {assets[role] && <Button type="button" variant="ghost" size="sm" onClick={event => {
                  const parent = event.currentTarget.parentElement
                  const input = parent?.querySelector('input')
                  if (input) input.value = ''
                  setPreview(undefined)
                  setAssets(current => ({ ...current, [role]: undefined }))
                }}>移除素材</Button>}
              </label>)}
            </fieldset>
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-workbench-muted">保存版式规则、来源和所选素材。样例正文仅用于预览。</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={!!busy || !!conflicts.length || !sample} onClick={compile}>编译 PDF 预览</Button>
            <Button type="button" disabled={!!busy || !preview || !name.trim()} onClick={save}>{official?.publish ? '发布新版本' : previous ? '另存为新版本' : '保存到我的模板'}</Button>
          </div>
        </div>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>
}
