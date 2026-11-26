'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Download } from 'lucide-react'
import type { SubmissionIssue, SubmissionVersion, SubmissionVersionInfo } from '@/lib/project/submission'
import type { WritingKey } from '@/lib/project/writing-drafts'
import { listSubmissionVersions, readSubmissionFiles, saveSubmissionVersion } from '@/lib/project/storage'
import { ExternalCompilePanel } from './ExternalCompilePanel'
import type { CompileCompatibility, ExternalEngine } from '@/lib/project/compile-compatibility'
import { compilerLabels } from '@/lib/project/compile-profile'
import type { ProjectFileSystem } from '@/lib/project/types'
import { claimSourceLine } from '@/lib/project/writing-claims'
import { SubmissionEvidenceFindings, SubmissionEvidencePanel, useSubmissionEvidence } from './SubmissionEvidence'
import { LayoutPreflight } from './LayoutPreflight'
import type { LayoutFinding } from '@/lib/project/layout-preflight'
import { blindDeliveryBlocked, njuptBlindCover, submissionStageInfo, type SubmissionStage } from '@/lib/project/submission-stages'
import { readSubmissionMaterials, submissionMaterialsSchema, type AttachedSubmissionMaterial, type SubmissionMaterialSlot } from '@/lib/project/submission-materials'
import { packageSubmissionDelivery, verifyArchivedLayout, type SubmissionLayout } from '@/lib/project/submission-layout'

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function submissionFilename(name: string) {
  return name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').replace(/[. ]+$/, '') || 'submission'
}

type VersionDraft = Omit<SubmissionVersion, 'id' | 'createdAt' | 'name'>

export function SubmissionDialog({ main, compileEntry = main, drafts, includeDrafts, onDraftChoice, conflicting, paths, excluded, onToggle,
  issues, ready, busy, error, log, result, compilerIssues, onClose, onCompile, onLocate, database, storageKey,
  compatibility, external, staleExternal, onPrepareExternal, onAttachExternal, onStartRevision, target, working, onEvidenceLocate,
  layoutAvailable, layoutFindings, generatedLayout, stageOptions, templateOriginId, stage, onStage, onBlindCover, staleStage }: {
  stageOptions: SubmissionStage[]
  templateOriginId?: string
  stage?: SubmissionStage
  onStage: (stage?: SubmissionStage) => void
  onBlindCover: (file?: File) => void
  staleStage?: boolean
  main: string
  compileEntry?: string
  drafts: string[]
  includeDrafts: boolean
  onDraftChoice: (include: boolean) => void
  conflicting: boolean
  paths: string[]
  excluded: ReadonlySet<string>
  onToggle: (path: string) => void
  issues: SubmissionIssue[]
  ready: boolean
  busy: boolean
  error: string
  log: string
  result?: VersionDraft
  compilerIssues: SubmissionIssue[]
  onClose: () => void
  onCompile: () => void
  onLocate: (issue: SubmissionIssue) => void
  database: IDBDatabase | null
  storageKey?: WritingKey
  compatibility: CompileCompatibility
  external?: { downloadUrl: string; checksum: string }
  staleExternal?: boolean
  onPrepareExternal: () => Promise<void>
  onAttachExternal: (pdf: File, engine: ExternalEngine, checksum: string) => void
  onStartRevision: (submissionId: string) => void
  target: ProjectFileSystem
  working: ProjectFileSystem
  onEvidenceLocate: (path: string, line?: number) => void
  generatedLayout?: boolean
  layoutAvailable?: boolean
  layoutFindings?: LayoutFinding[]
}) {
  const [versions, setVersions] = useState<SubmissionVersionInfo[]>([])
  const [versionName, setVersionName] = useState('')
  const [saving, setSaving] = useState(false)
  const [archived, setArchived] = useState<VersionDraft>()
  const [materials, setMaterials] = useState<{ report: SubmissionLayout; files: AttachedSubmissionMaterial[] }>()
  const [hashing, setHashing] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const [layoutPdf, setLayoutPdf] = useState('')
  const [manualReview, setManualReview] = useState<{ report: SubmissionLayout; checked: Record<number, string> }>()
  const [archivedReview, setArchivedReview] = useState<{ id: string; url: string; materials?: Blob[] }>()
  const archivedReviewUrl = archivedReview?.url
  useEffect(() => () => { if (archivedReviewUrl) URL.revokeObjectURL(archivedReviewUrl) }, [archivedReviewUrl])
  const blockDelivery = Boolean(result && blindDeliveryBlocked(stage, layoutFindings))
  const compiledPdf = blockDelivery ? undefined : result?.pdf
  const currentLayoutReport = result?.layoutReport
  const checked = currentLayoutReport && manualReview?.report === currentLayoutReport ? manualReview.checked : {}
  const config = stage && submissionStageInfo(stage, templateOriginId)
  const attached = currentLayoutReport && materials?.report === currentLayoutReport ? materials.files : []
  const materialMetadata = attached.length ? attached.map(item => item.metadata) : undefined
  const confirmed = Object.keys(checked).map(Number)
  const requiredMaterials = config ? config.materials?.filter(slot => slot.required === true ||
    slot.required === 'when-figures' && currentLayoutReport?.delivery?.figureAttachmentsRequired) ?? [] : []
  const unresolvedMaterials = requiredMaterials.filter(slot => !attached.some(item => item.metadata.slot === slot.id))
  const pendingChecks = currentLayoutReport?.findings.some((finding, index) => finding.status === 'issue' ||
    finding.status === 'manual' && !checked[index])
  const officialReady = Boolean(currentLayoutReport?.delivery && !unresolvedMaterials.length && !pendingChecks && !issues.some(item => item.severity === 'error') && !blockDelivery && !hashing)
  const reviewedReport = currentLayoutReport && { ...currentLayoutReport, materials: materialMetadata, confirmed, manualReview: confirmed.flatMap(index => {
    const ruleId = currentLayoutReport.findings[index]?.ruleId
    return ruleId ? [{ ruleId, confirmedAt: checked[index] }] : []
  }) }
  useEffect(() => {
    if (!layoutAvailable || !compiledPdf) return
    const url = URL.createObjectURL(compiledPdf)
    setLayoutPdf(url)
    return () => URL.revokeObjectURL(url)
  }, [layoutAvailable, compiledPdf])
  const evidence = useSubmissionEvidence(database, storageKey, target, result)
  useEffect(() => {
    if (!database || !storageKey) return
    let active = true
    void listSubmissionVersions(database, storageKey).then(items => { if (active) setVersions(items) })
      .catch(() => { if (active) setArchiveError('Could not load archived submissions.') })
    return () => { active = false }
  }, [database, storageKey])

  async function updateMaterials(slot: SubmissionMaterialSlot, files: File[]) {
    const report = currentLayoutReport
    if (!report || hashing || saving) return
    setHashing(true)
    setArchiveError('')
    try {
      const next = [...attached.filter(item => item.metadata.slot !== slot.id), ...await readSubmissionMaterials(slot, files)]
      if (!submissionMaterialsSchema.safeParse(next.map(item => item.metadata)).success) throw new Error('全部附件上限为 64 MB 或 24 份。')
      setMaterials({ report, files: next })
      const index = report.findings.findIndex(item => item.ruleId === slot.rule)
      setManualReview(previous => {
        if (previous?.report !== report || index === -1) return previous
        const next = { ...previous.checked }
        delete next[index]
        return { report, checked: next }
      })
    } catch (cause) { setArchiveError(cause instanceof Error ? cause.message : '无法读取附件。') }
    finally { setHashing(false) }
  }

  const sameArchivedBuild = archived?.pdf === result?.pdf &&
    JSON.stringify(archived?.layoutReport) === JSON.stringify(reviewedReport)

  async function archive() {
    const name = versionName.trim()
    if (!name || !result || !database || !storageKey || saving || hashing || blockDelivery || !evidence.canArchive || layoutAvailable && !currentLayoutReport) return
    setSaving(true)
    setArchiveError('')
    try {
      const record = await evidence.archiveRecord()
      const version = { ...result, materials: attached.length ? attached.map(item => item.blob) : undefined, layoutReport: reviewedReport, evidence: record, name, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
      await saveSubmissionVersion(database, storageKey, version)
      const { pdf, zip, materials, ...info } = version
      setVersions(current => [info, ...current])
      setArchived({ ...info, pdf, zip, materials })
      setVersionName('')
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : 'Could not save the submission version. The compiled downloads are still available.')
    } finally {
      setSaving(false)
    }
  }

  async function downloadArchived(version: SubmissionVersionInfo, kind: 'pdf' | 'zip') {
    if (!database || !storageKey) return
    setArchiveError('')
    try {
      const files = await readSubmissionFiles(database, storageKey, version.id)
      if (!files) throw new Error()
      const name = submissionFilename(version.name)
      download(files[kind], `${name}${kind === 'zip' ? '-source.zip' : '.pdf'}`)
    } catch {
      setArchiveError('Could not retrieve the archived download.')
    }
  }

  async function downloadDelivery(version?: SubmissionVersionInfo) {
    const report = version ? version.layoutReport : reviewedReport
    if (!report?.delivery || (!version && (blockDelivery || hashing))) return
    setArchiveError('')
    try {
      const files = version && database && storageKey ? await readSubmissionFiles(database, storageKey, version.id) : result && { ...result, materials: attached.map(item => item.blob) }
      if (!files) throw new Error('无法读取交付文件。')
      download(await packageSubmissionDelivery(report, files), report.delivery.stage + '-delivery.zip')
    } catch (cause) {
      setArchiveError(cause instanceof Error ? cause.message : '无法生成交付包。')
    }
  }

  async function openArchivedLayout(version: SubmissionVersionInfo) {
    if (!database || !storageKey || !version.layoutReport) return
    setArchiveError('')
    setArchivedReview(undefined)
    try {
      const files = await readSubmissionFiles(database, storageKey, version.id)
      if (!files || !(await verifyArchivedLayout(version.layoutReport, files))) throw new Error('归档报告与保存的 PDF 或源包不匹配。')
      setArchivedReview({ id: version.id, url: URL.createObjectURL(files.pdf), materials: files.materials })
    } catch (cause) { setArchiveError(cause instanceof Error ? cause.message : '无法读取归档版式报告。') }
  }

  const name = compileEntry.split('/').at(-1)?.replace(/\.tex$/i, '') || 'project'
  const allIssues = [...issues, ...compilerIssues]
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-auto sm:max-w-xl">
      <DialogTitle>Prepare submission</DialogTitle>
      <DialogDescription>Build the final source ZIP here or in your own TeX installation. Archived versions keep both files in this browser.</DialogDescription>
      {!!stageOptions.length && <fieldset disabled={busy || saving || hashing} className="space-y-2 rounded-md border p-3 text-sm">
        <label className="flex items-center gap-2 font-medium">提交阶段
          <select className="rounded-md border bg-background px-2 py-1" value={stage ?? ''} onChange={event => {
            onStage(stageOptions.find(option => option === event.target.value))
          }}>
            <option value="">通用检查</option>
            {stageOptions.map(option => <option key={option} value={option}>{submissionStageInfo(option, templateOriginId).label}</option>)}
          </select>
        </label>
        {config && <p>{config.note} {config.sourceUrl && <a target="_blank" rel="noreferrer" className="underline"
          href={config.sourceUrl}>官方要求</a>}</p>}
        {stage === 'njupt-blind' && <label className="block space-y-1">手动上传官方盲审封面（选填）
          <Input type="file" accept=".doc,.docx" onChange={event => onBlindCover(event.target.files?.[0])} />
          <a href={njuptBlindCover.page} target="_blank" rel="noreferrer" className="underline">封面发布页</a>
        </label>}
      </fieldset>}
      {staleStage && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">稿件已修改。请重新编译和检查后下载交付包。历史记录仍可复查。</p>}
      <p className="text-sm">Compile entry <code className="break-all">{compileEntry}</code></p>
      {drafts.length > 0 && <fieldset disabled={busy || saving} className="space-y-1 text-sm">
        <legend className="font-medium">Source to submit</legend>
        <label className="flex items-center gap-2"><input type="radio" name="submission-source" checked={!includeDrafts}
          onChange={() => onDraftChoice(false)} /> Saved project files · excludes {drafts.length} local {drafts.length === 1 ? 'draft' : 'drafts'}</label>
        <label className="flex items-center gap-2"><input type="radio" name="submission-source" checked={includeDrafts}
          onChange={() => onDraftChoice(true)} /> Include local drafts in both downloads</label>
        {conflicting && <p className="text-amber-800">Compare conflicting included drafts in Writing before compiling.</p>}
      </fieldset>}
      <details className="rounded border p-2 text-sm">
        <summary className="cursor-pointer font-medium">ZIP files · {paths.length - excluded.size} included</summary>
        <ul className="mt-2 max-h-52 space-y-1 overflow-auto">
          {paths.map(path => <li key={path}>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!excluded.has(path)}
              disabled={path === main || busy || saving} onChange={() => onToggle(path)} />
              <span className="break-all font-mono text-xs">{path}{path === main && ' · Main'}{includeDrafts && drafts.includes(path) && ' · Local draft'}</span>
            </label>
          </li>)}
        </ul>
      </details>
      <section aria-label="Submission preflight" className="space-y-1 text-sm">
        <h2 className="font-medium">Preflight</h2>
        {!allIssues.length && <p className="text-slate-600">No issues found by the static checks.</p>}
        <ul className="max-h-52 space-y-1 overflow-auto">
          {allIssues.map((issue, index) => <li key={index} className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}>
            {issue.location ? <button type="button" disabled={busy || saving} onClick={() => onLocate(issue)} className="block w-full break-words text-left underline">
              {issue.message} · {issue.location.path}:{issue.location.line}
            </button> : <p className="break-words">{issue.message}</p>}
          </li>)}
        </ul>
      </section>
      {layoutAvailable && <details className="space-y-2 rounded-md border p-3" open={Boolean(layoutFindings?.some(item => item.status === 'issue')) || undefined}>
        <summary className="cursor-pointer text-sm font-medium">提交前版式检查</summary>
        <LayoutPreflight findings={layoutFindings} pdfHref={compiledPdf ? layoutPdf : undefined} onSource={generatedLayout ? undefined : onEvidenceLocate}
          confirmed={confirmed} onConfirm={currentLayoutReport && !saving && !hashing ? (index, enabled) => {
            const next = { ...checked }
            const slot = requiredMaterials.find(slot => slot.rule === currentLayoutReport.findings[index]?.ruleId)
            if (enabled && slot && unresolvedMaterials.includes(slot)) {
              setArchiveError('请先附上' + slot.label + '。')
              return
            }
            setArchiveError('')
            if (enabled) next[index] = new Date().toISOString()
            else delete next[index]
            setManualReview({ report: currentLayoutReport, checked: next })
          } : undefined} />
      </details>}
      <SubmissionEvidencePanel review={evidence} working={working} disabled={busy || saving}
        onLocate={finding => onEvidenceLocate(finding.path, claimSourceLine(finding, working))} />
      <p role="status" className="text-sm" aria-label="Compilation">
        {busy ? 'Compiling the confirmed source ZIP…' : result?.externalEngine ? `External PDF attached · ${result.externalEngine} · Source match confirmed by you`
          : result ? (result.warnings ? 'Compiled with warnings' : 'Compiled successfully') : error ? 'Compilation failed' : 'Ready to compile'}
      </p>
      {(error || log) && <details open={Boolean(error)} className={error ? 'text-sm text-red-800' : 'text-sm text-amber-800'}>
        <summary>Compiler output</summary><p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{error || log}</p>
      </details>}
      {blockDelivery && <p role="alert" className="text-sm text-red-800">盲审隐私检查未通过。修正后重新编译，才可下载或归档。</p>}
      {stage && config && !blockDelivery && <section aria-label="正式提交材料" className="space-y-2 rounded-md border p-3 text-sm">
        <h2 className="font-medium">正式提交材料</h2>
        <p role="status">{officialReady ? '工作台检查已完成，请按提交系统要求上传。' : '材料待核对。可预览已生成的稿件并归档当前检查记录。'}</p>
        {result && currentLayoutReport && config.output !== 'attached' && (config.output === 'source'
          ? <Button size="sm" variant="outline" onClick={() => download(result.zip, name + '-source.zip')}>下载清洁版 LaTeX 源包</Button>
          : <Button size="sm" variant="outline" onClick={() => download(result.pdf, name + '.pdf')}>
            {stage === 'njupt-blind' ? '下载匿名 PDF' : '下载稿件 PDF'}</Button>)}
        {result && currentLayoutReport && config.output === 'confirm' &&
          <Button size="sm" variant="outline" onClick={() => download(result.zip, name + '-source.zip')}>下载稿件 LaTeX 源包</Button>}
        {unresolvedMaterials.length > 0 && <p>待补齐 {unresolvedMaterials.map(slot => slot.label).join('、')}</p>}
        {config.materials?.map(slot => {
          const files = attached.filter(item => item.metadata.slot === slot.id)
          const index = currentLayoutReport?.findings.findIndex(item => item.ruleId === slot.rule) ?? -1
          return <div key={slot.id} className="space-y-1 border-t pt-2">
            <label className="block">{slot.label}
              <Input type="file" accept={slot.extensions.map(ext => '.' + ext).join(',')} multiple={slot.multiple}
                disabled={!currentLayoutReport || busy || saving || hashing} onChange={event => {
                  const files = Array.from(event.target.files ?? [])
                  if (files.length) void updateMaterials(slot, files)
                  event.target.value = ''
                }} />
            </label>
            <p>{files.length ? checked[index] ? '已附 · 已人工确认' : '已附 · 待人工确认' : '未附'}</p>
            {files.map((file, index) => <div key={index} className="break-all">
              <button type="button" className="underline" onClick={() => download(file.blob, file.metadata.name)}>{file.metadata.name}</button>
              <p className="text-xs">SHA-256 <code>{file.metadata.sha256}</code></p>
            </div>)}
            {files.length > 0 && <Button type="button" variant="ghost" size="sm" disabled={saving || hashing} onClick={() => void updateMaterials(slot, [])}>移除附件</Button>}
          </div>
        })}
      </section>}
      <div className="flex flex-wrap gap-2">
        {result && !blockDelivery ? <>
          {stage ? <section aria-label="本地核验材料" className="space-y-2 rounded-md border p-3 text-sm">
            <h2 className="font-medium">本地核验材料</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!currentLayoutReport?.delivery || hashing} onClick={() => void downloadDelivery()}><Download /> 下载交付包</Button>
              {config && (config.output === 'source' || config.output === 'attached')
                ? <Button size="sm" variant="outline" onClick={() => download(result.pdf, name + '.pdf')}>下载校样 PDF</Button>
                : <Button size="sm" variant="outline" onClick={() => download(result.zip, name + '-source.zip')}>下载复编源包</Button>}
            </div>
          </section> : <>
            <Button variant="outline" onClick={() => download(result.zip, `${name}-source.zip`)}><Download /> Download source ZIP</Button>
            <Button onClick={() => download(result.pdf, `${name}.pdf`)}><Download /> Download submission PDF</Button>
          </>}
        </> : <Button onClick={onCompile} disabled={busy || !ready || conflicting}>Compile submission files</Button>}
      </div>
      {(!stage || stage === 'catalog-delivery') && !result && <ExternalCompilePanel main={compileEntry} compatibility={compatibility} error={error} checksum={external?.checksum} stale={staleExternal}
        downloadUrl={external?.downloadUrl}
        busy={busy} ready={ready && !conflicting} onPrepare={onPrepareExternal}
        onAttach={(pdf, engine) => { if (external) onAttachExternal(pdf, engine, external.checksum) }} />}
      {!blockDelivery && result && database && storageKey && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void archive() }}>
        <label className="flex-1 space-y-1 text-sm font-medium"><span>Version name</span>
          <Input value={versionName} onChange={event => setVersionName(event.target.value)} maxLength={100} disabled={saving} />
        </label>
        <Button type="submit" variant="outline" disabled={saving || hashing || !versionName.trim() || sameArchivedBuild || !evidence.canArchive || layoutAvailable && !currentLayoutReport}>
          Save submission version
        </Button>
      </form>}
      {!!versions.length && <section aria-label="Archived submissions" className="space-y-2 border-t pt-2 text-sm">
        <h2 className="font-medium">Archived submissions</h2>
        {versions.map(version => <details key={version.id} className="rounded border p-2">
          <summary className="cursor-pointer break-all font-medium">{version.name} · {new Date(version.createdAt).toLocaleString()}</summary>
          <p className="mt-1 break-all">{version.main} · {version.paths.length} files · {version.drafts.length} local drafts</p>
          <p>{version.externalEngine ? `External PDF · ${version.externalEngine}` : version.warnings ? 'Compiled with warnings' : 'Compiled successfully'}
            {version.compileProfile && !version.externalEngine && ` · ${compilerLabels[version.compileProfile.engine]}`} · {version.issues.length} preflight findings</p>
          {version.sourceChecksum && <p className="break-all text-xs">ZIP SHA-256 <code>{version.sourceChecksum}</code></p>}
          {version.layoutReport && <>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void openArchivedLayout(version)}>复查归档版式报告</Button>
            {archivedReview?.id === version.id && <section className="mt-2 space-y-2 rounded border p-2" aria-label="归档版式报告">
              <p>原 PDF 和源包校验通过 · {new Date(version.layoutReport.checkedAt).toLocaleString()}</p>
              <p>模板版本 {version.layoutReport.templateOrigin
                ? version.layoutReport.templateOrigin.id + ' · ' + version.layoutReport.templateOrigin.version : '未记录官方版本'}</p>
              {version.layoutReport.templateOrigin && <p className="break-all text-xs">原件 SHA-256 <code>{version.layoutReport.templateOrigin.sha256}</code></p>}
              {version.layoutReport.delivery && <>
                <p>{submissionStageInfo(version.layoutReport.delivery.stage, version.layoutReport.templateOrigin?.id).label} · {version.layoutReport.delivery.entry} · {compilerLabels[version.layoutReport.delivery.engine]}</p>
                {version.layoutReport.delivery.sourceMatch === 'author-confirmed' && <p>外部编译 PDF · 源包一致性已由作者确认</p>}
                <p className="break-all text-xs">原稿快照 SHA-256 <code>{version.layoutReport.delivery.snapshotSha256}</code></p>
                {version.layoutReport.delivery.attachmentSha256 && <p className="break-all text-xs">附件 SHA-256 <code>{version.layoutReport.delivery.attachmentSha256}</code></p>}
                <Button size="sm" variant="outline" onClick={() => void downloadDelivery(version)}>下载归档交付包</Button>
              </>}
              <p className="break-all text-xs">PDF SHA-256 <code>{version.layoutReport.pdfChecksum}</code></p>
              <p className="break-all text-xs">源包 SHA-256 <code>{version.layoutReport.sourceChecksum}</code></p>
              {!!version.layoutReport.materials?.length && <section aria-label="归档附件" className="space-y-1">
                <h3 className="font-medium">归档附件 · SHA-256 校验通过</h3>
                {version.layoutReport.materials.map((item, index) => <div key={index} className="break-all">
                  <button type="button" className="underline" onClick={() => {
                    const blob = archivedReview.materials?.[index]
                    if (blob) download(blob, item.name)
                  }}>{item.name}</button>
                  <p className="text-xs">SHA-256 <code>{item.sha256}</code></p>
                </div>)}
              </section>}
              <LayoutPreflight findings={version.layoutReport.findings} confirmed={version.layoutReport.confirmed} records={version.layoutReport.manualReview} pdfHref={archivedReview.url} />
            </section>}
          </>}
          {version.evidence && <details className="mt-1"><summary>Archived evidence check · {version.evidence.checked} claims</summary>
            {version.evidence.exceptionAccepted && <p>Evidence exceptions accepted for this ZIP.</p>}
            <SubmissionEvidenceFindings findings={version.evidence.findings} />
          </details>}
          <details className="mt-1"><summary>Files and findings</summary>
            <ul className="max-h-40 overflow-auto break-all">
              {version.paths.map(path => <li key={path}>{path}{version.drafts.includes(path) && ' · Local draft'}</li>)}
              {version.excluded.map(path => <li key={path}>{path} · Excluded</li>)}
              {[...version.issues, ...version.diagnostics].map((issue, index) => <li key={index}>{issue.message}{issue.location && ` · ${issue.location.path}:${issue.location.line}`}</li>)}
            </ul>
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void downloadArchived(version, 'zip')}>Download archived ZIP</Button>
            <Button size="sm" variant="outline" onClick={() => void downloadArchived(version, 'pdf')}>Download archived PDF</Button>
            <Button size="sm" variant="outline" onClick={() => onStartRevision(version.id)}>Start revision</Button>
          </div>
        </details>)}
      </section>}
      {archiveError && <p role="alert" className="text-sm text-red-800">{archiveError}</p>}
    </DialogContent>
  </Dialog>
}
