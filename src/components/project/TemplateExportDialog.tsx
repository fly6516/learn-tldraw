'use client'

import dynamic from 'next/dynamic'
import { SuepOfficialAttachments, useSuepAttachments } from './SuepOfficialAttachments'
import { suepUndergraduateId } from '@/lib/project/suep-undergraduate-source'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { isArticleTemplate, missingTemplateFields, plainTitle, sharedTemplateFields, withTemplateFields, type ProjectInformation } from '@/lib/project/project-information'
import { captureManuscript, suepImportedCover } from '@/lib/project/template-export'
import { exportTargets, exportWithTemplate, prepareExternalTemplate, supportsSwitchRelease, switchTargetForRelease, type ExportFields } from '@/lib/project/template-export-client'
import { attachExternalTemplate, type ExternalTemplatePreview } from '@/lib/project/external-template-build'
import type { TemplatePreview } from '@/lib/project/template-source-map'
import type { ActiveTemplate } from '@/lib/project/active-template'
import type { ProjectFileSystem } from '@/lib/project/types'
import { listOfficialTemplateReleases } from '@/lib/project/storage'
import { findPdfRegion, type SyncRegion } from '@/lib/project/source-sync'
import type { TemplateOrigin } from '@/lib/project/template-release'

const PdfPreview = dynamic(() => import('./SyncedPdfPreview').then(module => module.SyncedPdfPreview), { ssr: false })
const inputStyle = 'w-full rounded-md border border-workbench-line bg-workbench-panel px-2 py-1.5 text-sm'
const initialFields: ExportFields = {
  affiliation: '', email: '', advisor: '', studentNumber: '', program: '', date: '',
  chineseTitle: '', chineseAbstract: '', chineseKeywords: '', declarations: true,
}

type Build = Awaited<ReturnType<typeof exportWithTemplate>>
type ExternalBuild = Awaited<ReturnType<typeof prepareExternalTemplate>> & { url: string }
type ExternalFiles = { pdf?: File; sync?: File; receipt?: File }
type Output = { pdf: string; archive: string; name: string; template: ActiveTemplate; preview: TemplatePreview | ExternalTemplatePreview }

export function TemplateExportDialog({ files, main, active, database, originalName, originalOrigin, information, onEditInformation, onSetCurrent, onClose }: {
  files: ProjectFileSystem['files']; main: string; active?: ActiveTemplate; originalName: string; originalOrigin?: TemplateOrigin
  database?: IDBDatabase
  information?: ProjectInformation
  onEditInformation: () => void
  onSetCurrent?: (template?: ActiveTemplate, preview?: TemplatePreview | ExternalTemplatePreview) => Promise<void>; onClose: () => void
}) {
  const [input] = useState(() => {
    try { return { manuscript: captureManuscript(files, main, { information }) } }
    catch (cause) { return { error: cause instanceof Error ? cause.message : '无法读取稿件快照。' } }
  })
  const importedCover = suepImportedCover(files)
  const [selection, setSelection] = useState(active?.origin.id ?? (importedCover ? originalOrigin?.id : undefined) ?? exportTargets.find(item => item.entry.exportProfile === 'zju-undergraduate')?.entry.id ?? exportTargets[0].entry.id)
  const [version, setVersion] = useState<string>()
  function defaults(templateId: string): ExportFields {
    return {
      ...initialFields, ...(importedCover && {
        chineseTitle: importedCover.title, program: importedCover.program, studentNumber: importedCover.studentNumber,
        affiliation: importedCover.affiliation, advisor: importedCover.advisor, date: importedCover.date,
        chineseAbstract: input.manuscript?.importedChineseAbstract ?? '', chineseKeywords: input.manuscript?.importedChineseKeywords ?? '',
      }), ...(active?.origin.id === templateId && active.fields),
    }
  }
  const [templateFields, setFields] = useState<ExportFields>(() => defaults(selection))
  const [releases, setReleases] = useState<Awaited<ReturnType<typeof listOfficialTemplateReleases>>>()
  const [releaseError, setReleaseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [output, setOutput] = useState<Output>()
  const [externalBuild, setExternalBuild] = useState<ExternalBuild>()
  const [externalFiles, setExternalFiles] = useState<ExternalFiles>({})
  const [page, setPage] = useState(1)
  const [previewTarget, setPreviewTarget] = useState<SyncRegion | null>(null)
  const [previewLocation, setPreviewLocation] = useState<SyncRegion>()
  const task = useRef<AbortController | null>(null)
  const objectUrls = useRef<string[]>([])
  const base = exportTargets.find(item => item.entry.id === selection) ?? exportTargets[0]
  const versions = [...(releases ?? []).flatMap(release => {
    const target = release.id === selection && release.switchAcceptance?.protocol === 1 && switchTargetForRelease(release)
    return target ? [target] : []
  }), base]
  const target = versions.find(item => item.version === (version ?? (active?.origin.id === selection ? active.origin.version : importedCover && originalOrigin?.id === selection ? originalOrigin.version : undefined)))
    ?? versions[0]
  const shared = sharedTemplateFields(information, isArticleTemplate(target.entry.exportProfile))
  const fields = { ...templateFields, ...shared }
  const missing = missingTemplateFields(target.entry.exportProfile ?? '', selection, fields)
  const zju = target.entry.exportProfile === 'zju-undergraduate'
  const suep = target.entry.exportProfile === 'suep-undergraduate'
  const suepOriginal = useSuepAttachments(suep
    ? { id: suepUndergraduateId, version: target.version, sha256: target.sha256 } : undefined,
    target.release?.kind === 'word-import' ? target.release.archive : undefined)
  const sjtu = target.entry.exportProfile === 'sjtu-graduate-word'
  const njupt = target.entry.exportProfile === 'njupt-masters'
  const njuptProfessional = njupt && target.entry.workflow.kind === 'word' && target.entry.workflow.njuptTrack === 'professional'
  const agu = target.entry.id === 'agu-jgr-atmospheres'
  const additionalThesis = target.entry.exportProfile === 'official-thesis'
  const scau = target.entry.id === 'scau-undergraduate'
  const ustc = target.entry.id === 'ustc-graduate-word'
  const mit = target.entry.exportProfile === 'mit-thesis'
  const starter = target.entry.delivery === 'built-in'
  const thuThesis = target.entry.exportProfile === 'thuthesis'
  const thesis = zju || suep || sjtu || njupt || additionalThesis
  const loadingReleases = !!database && supportsSwitchRelease(selection) && !releases && !releaseError
  const currentOrigin = active?.origin ?? originalOrigin

  useEffect(() => {
    if (!database) return
    let current = true
    void Promise.all(exportTargets.filter(({ entry }) => supportsSwitchRelease(entry.id))
      .map(({ entry }) => listOfficialTemplateReleases(database, entry.id)))
      .then(groups => { if (current) setReleases(groups.flat()) })
      .catch(() => { if (current) setReleaseError('无法读取本机的已发布版本。仍可使用目录登记版。') })
    return () => { current = false }
  }, [database])

  useEffect(() => () => {
    task.current?.abort()
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
  }, [])

  function clearOutput() {
    objectUrls.current.forEach(url => URL.revokeObjectURL(url))
    objectUrls.current = []
    setOutput(undefined)
    setExternalBuild(undefined)
    setExternalFiles({})
    setPreviewTarget(null)
    setPreviewLocation(undefined)
  }

  function cancel() {
    task.current?.abort()
    task.current = null
    setBusy(false)
  }

  function setResult(build: Omit<Build, 'preview'> & { preview: TemplatePreview | ExternalTemplatePreview }) {
    const pdf = URL.createObjectURL(build.preview.pdf)
    const archive = URL.createObjectURL(build.archive)
    objectUrls.current.push(pdf, archive)
    setOutput({ pdf, archive, name: build.name, template: build.template, preview: build.preview })
  }

  async function compile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!input.manuscript || missing.length || loadingReleases || suep && !suepOriginal.receipt) return
    cancel()
    clearOutput()
    setError('')
    setPage(1)
    const controller = new AbortController()
    task.current = controller
    setBusy(true)
    try {
      if (mit) {
        const prepared = await prepareExternalTemplate(input.manuscript, files, main, target, fields, controller.signal,
          active?.kind === 'mit-thesis' ? active : undefined, information)
        if (task.current !== controller) return
        const url = URL.createObjectURL(prepared.build.archive)
        objectUrls.current.push(url)
        setExternalBuild({ ...prepared, url })
        return
      }
      const build = await exportWithTemplate(input.manuscript, target, suep ? { ...fields, original: suepOriginal.upload } : fields, controller.signal)
      if (task.current === controller) setResult(build)
    } catch (cause) {
      if (task.current === controller) setError(cause instanceof Error ? cause.message : '导出失败。')
    } finally {
      if (task.current === controller) cancel()
    }
  }

  async function attachMitResult() {
    const { pdf, sync, receipt } = externalFiles
    if (!externalBuild || !pdf || !sync || !receipt || busy) return
    const controller = new AbortController()
    task.current = controller
    setBusy(true)
    setError('')
    try {
      const { build, template } = externalBuild
      const preview = await attachExternalTemplate(build, pdf, sync, receipt, controller.signal)
      if (task.current === controller) setResult({ archive: build.archive, name: 'mit-thesis-' + template.origin.version, template, preview })
    } catch (cause) {
      if (task.current === controller) setError(cause instanceof Error ? cause.message : '无法验证外部编译结果。')
    } finally {
      if (task.current === controller) cancel()
    }
  }

  function showBodyInPreview() {
    if (!output || !input.manuscript) return
    for (const { path, line } of input.manuscript.lineSources.body.values()) {
      const region = findPdfRegion(output.preview.regions, path, line)
      if (region?.line !== line) continue
      setPreviewLocation(region)
      setPreviewTarget(region)
      setPage(region.page)
      break
    }
  }

  async function setCurrent(template?: ActiveTemplate, preview?: TemplatePreview | ExternalTemplatePreview) {
    if (!onSetCurrent || saving) return
    cancel()
    setError('')
    setSaving(true)
    try {
      // Keep the user's template-specific entries as fallbacks without duplicating shared fields.
      const selected = template && withTemplateFields(template, Object.fromEntries(Object.keys(shared)
        .map(key => [key, templateFields[key as keyof typeof shared] ?? ''])))
      await onSetCurrent(selected, preview)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存当前模板。')
      setSaving(false)
    }
  }

  function updateField<K extends keyof ExportFields>(key: K, value: ExportFields[K]) {
    cancel()
    clearOutput()
    setError('')
    setFields(previous => ({ ...previous, [key]: value }))
  }

  function field(key: Exclude<keyof ExportFields, 'declarations' | 'original' | 'guideline' | 'cover' | 'declaration'>, label: string, options: { optional?: boolean; multiline?: boolean; maxLength?: number } = {}) {
    const props = {
      className: inputStyle, value: fields[key] ?? '', required: !options.optional, maxLength: options.maxLength ?? 160,
      readOnly: Object.hasOwn(shared, key),
    }
    return <label className="grid min-w-0 gap-1 text-xs font-medium">
      <span>{label}{props.readOnly && <span aria-hidden="true" className="ml-1 text-workbench-muted">· 项目信息</span>}</span>
      {options.multiline ? <textarea {...props} rows={3} onChange={event => updateField(key, event.target.value)} />
        : <input {...props} onChange={event => updateField(key, event.target.value)} />}
    </label>
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) { cancel(); onClose() } }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto border-workbench-line bg-workbench-panel text-workbench-ink sm:max-w-5xl">
      <div className="pr-8">
        <DialogTitle>更换模板</DialogTitle>
        <DialogDescription className="mt-1">预览后可设为当前模板。普通编译会用所选版式排版最新稿件。</DialogDescription>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0">
          <p>当前模板 · {active ? active.name + ' · ' + active.origin.version : originalName}</p>
          {currentOrigin && <p className="break-all font-mono text-xs text-workbench-muted">当前原件 SHA-256 {currentOrigin.sha256}</p>}
        </div>
        {active && onSetCurrent && <Button type="button" size="sm" variant="outline" disabled={saving}
          onClick={() => void setCurrent()}>切回原模板</Button>}
      </div>
      {saving && <p role="status" className="text-sm">正在保存当前模板…</p>}
      {releaseError && <p role="status" className="text-sm">{releaseError}</p>}
      {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {input.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{input.error}</p>}
      {input.manuscript && <div className={'grid min-w-0 gap-4 ' + (output ? 'lg:grid-cols-[19rem_minmax(0,1fr)]' : '')}>
        <form className="grid min-w-0 content-start gap-3" onSubmit={compile}>
          <fieldset disabled={saving} className="grid min-w-0 gap-3">
            <label className="grid gap-1 text-xs font-medium">
              目标模板
              <select aria-label="目标模板" className={inputStyle} value={selection} onChange={event => {
                cancel()
                clearOutput()
                setError('')
                setSelection(event.target.value)
                setVersion(undefined)
                setFields(defaults(event.target.value))
              }}>
                {exportTargets.map(({ entry }) =>
                  <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium">
              模板版本
              <select className={inputStyle} value={target.version} disabled={loadingReleases} onChange={event => {
                cancel()
                clearOutput()
                setError('')
                setVersion(event.target.value)
                setFields(({ original: _original, guideline: _guideline, ...rest }) => rest)
              }}>
                {versions.map(item => <option key={item.version} value={item.version}>
                  {item.version}{item.release ? ' · 已发布并验收' : ' · 目录登记版'}
                  {item.sha256 === currentOrigin?.sha256 && item.version === currentOrigin.version ? ' · 当前项目' : ''}
                </option>)}
              </select>
            </label>
            <p className="break-all text-xs text-workbench-muted">SHA-256 {target.sha256}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-workbench-line p-2 text-xs">
              <p className="break-words">稿件 · {plainTitle(input.manuscript.title)} · {input.manuscript.authors.map(plainTitle).join('、')}</p>
              <Button type="button" size="sm" variant="outline" onClick={onEditInformation}>编辑项目信息</Button>
            </div>
            {missing.length > 0 && <p role="status" aria-label="模板缺少的必填项" className="text-xs text-amber-800">缺少必填项 · {missing.join('、')}</p>}
            <div className={'grid gap-2 ' + (output ? '' : 'sm:grid-cols-2')}>
              {mit ? <>
                {field('affiliation', 'MIT Department')}
                {field('degree', 'Degree name')}
                {field('advisor', 'Thesis supervisor name')}
                {field('advisorTitle', 'Thesis supervisor title')}
                {field('acceptor', 'Departmental acceptor name')}
                {field('acceptorTitle', 'Departmental acceptor title')}
                {field('acceptorRole', 'Departmental acceptor role')}
                {field('degreeDate', 'Degree month and year')}
                {field('date', 'Thesis submission date')}
              </> : thuThesis ? <>
                {field('chineseTitle', '中文题目', { maxLength: 80 })}
                {field('advisor', '指导教师')}
                {field('englishAdvisor', '导师英文姓名')}
                {field('affiliation', '培养单位')}
                {field('program', '学科专业')}
                {field('englishProgram', '学科专业英文全称')}
                {field('date', '提交日期（YYYY-MM-DD）')}
                {field('chineseAbstract', '中文摘要', { multiline: true, maxLength: 6000 })}
                {field('chineseKeywords', '中文关键词')}
                <label className="grid gap-1 text-xs">学位
                  <select aria-label="学位" className={inputStyle} value={fields.degree ?? ''} required onChange={event => updateField('degree', event.target.value)}>
                    <option value="">请选择</option><option value="bachelor">本科</option><option value="master">硕士</option><option value="doctor">博士</option>
                  </select>
                </label>
                {fields.degree && fields.degree !== 'bachelor' && <>
                  {field('degreeTitle', '学位类别中文全称')}
                  {field('englishDegree', '学位类别英文全称')}
                </>}
              </> : thesis ? <>
                {field('chineseTitle', '中文题目', { maxLength: suep ? 36 : 80 })}
                {field('studentNumber', '学号', suep ? { maxLength: 20 } : {})}
                {field('advisor', '指导教师', suep ? { maxLength: 40 } : {})}
                {field('program', njuptProfessional ? '专业（领域）' : '年级与专业', suep ? { maxLength: 40 } : {})}
                {field('affiliation', suep ? '所在院系' : '所在学院', { optional: njupt, maxLength: suep ? 40 : 160 })}
                {field('date', '提交日期', suep ? { maxLength: 30 } : {})}
                {field('chineseAbstract', '中文摘要', { multiline: true, maxLength: 6000 })}
                {field('chineseKeywords', '中文关键词')}
                {(sjtu || njupt || ustc) && <>
                  {field('englishAdvisor', '导师英文姓名')}
                  {(sjtu || ustc) && field('englishAffiliation', '学院英文全称')}
                  {sjtu && <p className="text-xs">题名页按研究生院 Word 原件的工学硕士样式排版。</p>}
                  {njupt && <>
                    {njuptProfessional ? <label className="grid gap-1 text-xs font-medium">
                      培养类型
                      <select className={inputStyle} value={fields.studyMode ?? ''} required onChange={event =>
                        updateField('studyMode', event.target.value as ExportFields['studyMode'])}>
                        <option value="">请选择</option><option value="full-time">全日制</option><option value="part-time">非全日制</option>
                      </select>
                    </label> : field('direction', '研究方向')}
                    {field('degree', '申请学位类别')}
                    {field('englishDegree', '学位类别英文全称')}
                  </>}
                </>}
                {additionalThesis && !scau && <>
                  <label className="grid gap-1 text-xs">培养类型
                    <select className={inputStyle} value={fields.track ?? ''} required onChange={event =>
                      updateField('track', event.target.value as ExportFields['track'])}>
                      <option value="">请选择</option><option value="academic">学术学位</option><option value="professional">专业学位</option>
                    </select>
                  </label>
                  {field('degree', ustc ? '学位（硕士或博士）' : '申请学位类别')}
                  {field('classification', '中图分类号', { optional: true })}
                  {ustc && <>
                    {field('englishProgram', '学科专业英文全称')}
                    {field('direction', '研究方向')}
                    {field('udc', 'UDC 分类号', { optional: true })}
                    {field('confidentiality', '密级', { optional: true })}
                  </>}
                </>}
                {(zju || sjtu || njupt || additionalThesis) && <label className="flex gap-2 text-sm">
                  <input type="checkbox" checked={fields.declarations} onChange={event => updateField('declarations', event.target.checked)} />
                  附上未签署的官方声明与授权书
                </label>}
                {suep && <p className="text-xs">封面使用本次填写的字段，声明签名栏留空。</p>}
              </> : !starter && <>
                {field('affiliation', '作者单位')}
                {field('email', agu ? '通讯邮箱' : '通讯邮箱（选填）', { optional: !agu })}
                {agu && <>
                  {field('keyPoint', 'Key Point', { maxLength: 140 })}
                  {field('keyPoint2', '第二条要点（选填）', { maxLength: 140, optional: true })}
                  {field('keyPoint3', '第三条要点（选填）', { maxLength: 140, optional: true })}
                  {field('plainLanguageSummary', 'Plain Language Summary', { multiline: true, maxLength: 2400 })}
                  {field('openResearch', 'Open Research Statement', { multiline: true, maxLength: 1200 })}
                </>}
              </>}
            </div>
            {target.entry.id === 'plos-one' && <p className="text-xs">项目预览保留插图。初投稿按 PLOS ONE 要求单独上传图片，稿件 PDF 保留图注。</p>}
            {suep && <SuepOfficialAttachments state={suepOriginal} disabled={busy || saving} />}
            {!suep && !starter && !target.release && <details key={selection + target.version} className="space-y-2 text-xs">
              <summary className="cursor-pointer font-medium">手动上传官方原件</summary>
              <label className="grid gap-1">
                {thesis ? '官方 Word' : '官方 ZIP'}
                <input className={inputStyle} type="file" accept={thesis ? '.doc,.docx' : '.zip'}
                  onChange={event => updateField('original', event.target.files?.[0])} />
              </label>
              {target.entry.workflow.kind === 'word' && target.entry.workflow.guideline && <label className="grid gap-1">
                官方规范 PDF
                <input className={inputStyle} type="file" accept=".pdf"
                  onChange={event => updateField('guideline', event.target.files?.[0])} />
              </label>}
            </details>}
            {njupt && fields.declarations && <label className="grid gap-1 text-xs">手动上传官方声明（选填）
              <input className={inputStyle} type="file" accept=".doc,.docx"
                onChange={event => updateField('declaration', event.target.files?.[0])} />
            </label>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !!missing.length || loadingReleases || suep && !suepOriginal.receipt} className="bg-workbench-accent text-white">{mit ? "准备外部编译源包" : "编译预览"}</Button>
              {busy && <Button type="button" variant="outline" onClick={cancel}>取消导出</Button>}
            </div>
          </fieldset>
          {busy && <p role="status" className="text-sm text-workbench-muted">{mit ? '正在处理外部编译文件…' : '正在准备目标模板并编译 PDF…'}</p>}
          {externalBuild && !output && <fieldset disabled={busy || saving} className="grid min-w-0 gap-2 rounded border border-workbench-line p-3 text-sm">
            <legend className="px-1 font-medium">MIT 外部编译回传</legend>
            <a href={externalBuild.url} download="mit-thesis-external.zip" className="text-workbench-accent underline">下载外部编译源包</a>
            <p>解压到新目录，安装 LuaLaTeX、Biber、latexmk 和 Node.js 后运行 <code>node compile-mit.mjs</code>，上传本次生成的三个文件。</p>
            {([['pdf', '外部编译 PDF', '.pdf'], ['sync', '外部编译 SyncTeX', '.gz'], ['receipt', '外部编译记录', '.json']] as const)
              .map(([key, label, accept]) => <label key={key} className="grid gap-1 text-xs">{label}
                <input className={inputStyle} type="file" accept={accept}
                  onChange={event => setExternalFiles(previous => ({ ...previous, [key]: event.target.files?.[0] }))} />
              </label>)}
            <Button type="button" variant="outline" disabled={!externalFiles.pdf || !externalFiles.sync || !externalFiles.receipt}
              onClick={() => void attachMitResult()}>核验并预览外部 PDF</Button>
          </fieldset>}
        </form>
        {output && <section aria-label="目标模板预览" className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {onSetCurrent && <Button size="sm" disabled={saving} onClick={() => void setCurrent(output.template, output.preview)}>设为当前模板</Button>}
            <Button variant="outline" size="sm" asChild><a href={output.pdf} download={output.name + '.pdf'}>下载 PDF</a></Button>
            <Button variant="outline" size="sm" asChild><a href={output.archive} download={output.name + '.zip'}>下载 LaTeX 源包</a></Button>
            {output.preview.regions.length > 0 && <Button variant="outline" size="sm" onClick={showBodyInPreview}>定位正文</Button>}
          </div>
          {previewLocation && <p role="status" className="text-xs">{previewLocation.path}:{previewLocation.line} · PDF 第 {previewLocation.page} 页</p>}
          <div className="flex h-[50dvh] min-h-64 min-w-0 flex-col border border-workbench-line bg-workbench-canvas">
            <PdfPreview url={output.pdf} page={page} onPage={setPage} regions={output.preview.regions}
              target={previewTarget} onLocate={location => { setPreviewLocation(location); setPreviewTarget(location ?? null) }} />
          </div>
        </section>}
      </div>}
    </DialogContent>
  </Dialog>
}
