'use client'

import { useEffect, useRef, useState } from 'react'
import { SuepOfficialAttachments, useSuepAttachments } from './SuepOfficialAttachments'
import { bindSuepBundle } from '@/lib/project/suep-bundle-client'
import { suepDocxMembers, suepMemberRoles, suepUndergraduateId, suepUndergraduateOrigin } from '@/lib/project/suep-undergraduate-source'
import { listOfficialTemplateReleases } from '@/lib/project/storage'
import { officialAttachment } from '@/lib/project/official-attachments'
import { matchingWordRelease, usesWordAttachmentRelease } from '@/lib/project/word-release-attachments'
import { wordReleaseFile } from '@/lib/project/word-release-client'
import { readWordTemplate } from '@/lib/project/word-conversion-client'
import type { OfficialTemplateRelease } from '@/lib/project/template-release'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchOfficialFile } from '@/lib/project/official-template-client'
import { templateDigest } from '@/lib/project/paper-templates'
import { projectSourceDigest } from '@/lib/project/external-template-build'
import { exportExternalBuild } from '@/lib/project/submission'
import { submissionDocxConfig, submissionDocxIds, type SubmissionDocxFields, type SubmissionDocxId } from '@/lib/project/submission-docx-config'
import { checkDocxSubmission, verifyWordFinal, type SubmissionDocxDelivery } from '@/lib/project/submission-docx-delivery'
import { captureManuscript, suepImportedCover } from '@/lib/project/template-export'
import type { SubmissionStage } from '@/lib/project/submission-stages'
import type { ProjectFileSystem } from '@/lib/project/types'
import { wordRequest } from '@/lib/project/word-conversion-client'

const labels = [
  ['title', '中文题目', 36], ['author', '作者姓名', 20], ['studentNumber', '学号', 20], ['advisor', '指导教师', 40],
  ['program', '专业与年级', 40], ['affiliation', '所在学院', 40], ['date', '提交日期', 30],
  ['chineseKeywords', '中文关键词', 250], ['englishKeywords', '英文关键词', 250],
] as const

const njuptLabels = [
  ['degree', '申请学位类别', 40], ['englishDegree', '学位类别英文全称', 80], ['englishAdvisor', '导师英文姓名', 80],
] as const

export function SubmissionDocxPanel({ project, main, template, stage, database, disabled, download, onLocate, onArchive }: {
  project: ProjectFileSystem; main: string; template?: string; stage?: SubmissionStage; database?: IDBDatabase; disabled: boolean; download: (blob: Blob, name: string) => void
  onLocate: (path: string, line: number) => void
  onArchive?: (delivery: SubmissionDocxDelivery) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const njupt = template === 'njupt-professional-masters' && stage === 'njupt-deposit'
  const available = njupt ? ['njupt-professional-masters'] as const : submissionDocxIds.filter(id => id !== 'njupt-professional-masters')
  const [school, setSchool] = useState<SubmissionDocxId>(() => available.find(id => id === template) ?? available[0])
  const [fields, setFields] = useState<SubmissionDocxFields>({
    title: '', author: '', studentNumber: '', advisor: '', program: '', affiliation: '', date: '',
    chineseAbstract: '', chineseKeywords: '', englishKeywords: '', confidentiality: 'public',
  })
  const [uploads, setUploads] = useState<{ original?: File; guideline?: File; declaration?: File }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'export' | 'attach' | 'archive'>()
  const [checked, setChecked] = useState<{ project: ProjectFileSystem; main: string; school: SubmissionDocxId; fields: SubmissionDocxFields; report: ReturnType<typeof checkDocxSubmission> }>()
  const [receipt, setReceipt] = useState<{ check: NonNullable<typeof checked>; delivery: SubmissionDocxDelivery }>()
  const [archiveName, setArchiveName] = useState('')
  const [saved, setSaved] = useState('')
  const request = useRef<AbortController | undefined>(undefined)
  const config = submissionDocxConfig(school)
  const suep = school === suepUndergraduateId
  const projectOrigin = project.metadata.activeTemplate?.origin ?? project.metadata.templateOrigin
  const scopedWord = usesWordAttachmentRelease(school)
  const [releaseState, setReleaseState] = useState<{ database: IDBDatabase; school: string; releases: OfficialTemplateRelease[] }>()
  const releases = releaseState?.database === database && releaseState?.school === school ? releaseState?.releases : undefined
  const readReleases = !!database && open && (suep || scopedWord)
  useEffect(() => {
    if (!database || !readReleases) return
    let current = true
    void listOfficialTemplateReleases(database, school)
      .then(releases => { if (current) setReleaseState({ database, school, releases }) })
      .catch(() => {
        if (current) setError('无法读取本机的官方版本记录。')
      })
    return () => { current = false }
  }, [database, readReleases, school])
  const bound = projectOrigin?.id === suepUndergraduateId ? projectOrigin : undefined
  const release = bound ? releases?.find(item => item.version === bound.version && item.sha256 === bound.sha256) : releases?.[0]
  const suepPin = open && suep && (!database || releases) ? {
    ...(bound ?? release ?? suepUndergraduateOrigin), id: suepUndergraduateId,
  } as const : undefined
  const attachments = useSuepAttachments(suepPin, release?.kind === 'word-import' ? release.archive : undefined)
  const wordOrigin = projectOrigin?.id === school ? projectOrigin : undefined
  const pinnedWord = scopedWord && (wordOrigin ? matchingWordRelease(wordOrigin, releases ?? [])
    : (releases ?? []).find(item => item.kind === 'word' && item.attachments))
  const wordRelease = pinnedWord && pinnedWord.kind === 'word' && pinnedWord.attachments ? pinnedWord : undefined
  const declarationPin = officialAttachment(wordRelease?.attachments, 'declaration') ?? config.declaration
  const wordVersionMissing = scopedWord && !!wordOrigin && !wordRelease &&
    Boolean(wordOrigin.manifestSha256 || wordOrigin.sha256 !== config.original.sha256 || wordOrigin.version !== config.version)
  const readyWord = !scopedWord || (!database || !!releases) && !wordVersionMissing
  const usedVersion = suepPin?.version ?? wordRelease?.version ?? (wordVersionMissing ? wordOrigin?.version : undefined) ?? config.version
  const usedSha256 = suepPin?.sha256 ?? wordRelease?.sha256 ?? (wordVersionMissing ? wordOrigin?.sha256 : undefined) ?? config.original.sha256
  const fieldLabels = njupt ? [...labels.filter(([key]) => key !== 'affiliation').map(row =>
    row[0] === 'program' ? ['program', '专业（领域）', row[2]] as const : row), ...njuptLabels] : labels
  const fresh = checked?.project === project && checked.main === main && checked.school === school && checked.fields === fields ? checked : undefined
  const delivery = receipt?.check === fresh ? receipt?.delivery : undefined
  useEffect(() => () => request.current?.abort(), [project, main])

  function openForm() {
    setOpen(true)
    try {
      const snapshot = captureManuscript(project.files, main, { allowLongtable: true })
      const active = project.metadata.activeTemplate
      const importedCover = suep ? suepImportedCover(project.files) : undefined
      const njuptCover = njupt && active?.kind === 'njupt-masters' ? active.fields : undefined
      const cover = njuptCover ?? (suep && active?.kind === 'suep-undergraduate' ? active.fields : undefined)
      const imported = importedCover && { ...importedCover, chineseAbstract: snapshot.importedChineseAbstract ?? '',
        chineseKeywords: snapshot.importedChineseKeywords ?? '' }
      setFields(current => ({ ...current, ...(!current.title ? imported : undefined), ...(cover && !current.title ? {
        title: cover.chineseTitle, advisor: cover.advisor, studentNumber: cover.studentNumber, program: cover.program,
        chineseAbstract: cover.chineseAbstract, chineseKeywords: cover.chineseKeywords, date: cover.date,
        ...(njuptCover && { englishAdvisor: njuptCover.englishAdvisor, degree: njuptCover.degree,
          englishDegree: njuptCover.englishDegree, studyMode: njuptCover.studyMode }),
      } : {}), author: current.author || snapshot.authors.join('、'),
        englishKeywords: current.englishKeywords || (/^[^\\\$\{\}]*$/.test(snapshot.keywords) ? snapshot.keywords : '') }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取当前稿件。')
    }
  }

  async function exportDocx() {
    if (busy || disabled || !readyWord || suep && !attachments.receipt) return
    setError('')
    const check = runCheck()
    const normalized = check.report.fields
    if (!normalized || check.report.findings.some(item => item.status === 'blocking')) return
    const controller = new AbortController()
    request.current = controller
    setBusy('export')
    const { signal } = controller
    async function original(pin: string, local?: File, asset?: 'guideline' | 'declaration') {
      if (!local) return fetchOfficialFile(school, pin, asset, signal)
      if (local.size > 16 * 1024 * 1024 || await templateDigest(await local.arrayBuffer()) !== pin) {
        throw new Error((asset === 'guideline' ? '本地规范' : '本地原件') + '的 SHA-256 与所选登记版不一致。')
      }
      return local
    }
    try {
      let word: File | undefined
      let guide: File | undefined
      let declaration: File | undefined
      try {
        [word, guide, declaration] = await Promise.all([
          suep ? undefined : scopedWord ? wordReleaseFile(school, 'original', signal, wordRelease, uploads.original)
            : original(config.original.sha256, uploads.original),
          config.guideline ? scopedWord ? wordReleaseFile(school, 'guideline', signal, wordRelease, uploads.guideline)
            : original(config.guideline.sha256, uploads.guideline, 'guideline') : undefined,
          config.declaration ? scopedWord ? wordReleaseFile(school, 'declaration', signal, wordRelease, uploads.declaration)
            : original(config.declaration.sha256, uploads.declaration, 'declaration') : undefined,
        ])
      } catch (cause) {
        signal.throwIfAborted()
        throw new Error((cause instanceof Error ? cause.message : '官方原件获取失败。') + ' 可在「手动上传官方原件」选择对应登记版文件。')
      }
      const data = new FormData()
      data.set('intent', 'export-submission-docx')
      data.set('school', school)
      if (stage) data.set('stage', stage)
      data.set('main', main)
      data.set('fields', JSON.stringify(normalized))
      const id = crypto.randomUUID()
      data.set('delivery-id', id)
      if (word) data.set('original', word)
      if (suepPin) bindSuepBundle(data, suepPin)
      if (wordRelease) data.set('word-release', JSON.stringify({
        version: wordRelease.version, sha256: wordRelease.sha256, manifestSha256: wordRelease.manifestSha256,
        attachments: wordRelease.attachments, ...(config.guideline && { layout: (await readWordTemplate(wordRelease.layout)).layout }),
      }))
      if (guide) data.set('guideline', guide)
      if (declaration) data.set('declaration', declaration)
      const [{ zip, checksum }, snapshotSha256] = await Promise.all([exportExternalBuild(project), projectSourceDigest(project.files, main)])
      if ((word?.size ?? 0) + (guide?.size ?? 0) + (declaration?.size ?? 0) + zip.size > 16 * 1024 * 1024) throw new Error('官方原件和项目源包共计不得超过 16 MB。')
      data.set('source', zip, 'manuscript.zip')
      const blob = await (await wordRequest(data, signal)).blob()
      signal.throwIfAborted()
      const name = normalized.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').replace(/[. ]+$/, '') || 'submission'
      const filename = name + '-' + usedVersion + '.docx'
      const template = { id: school, name: config.name, sourceUrl: config.sourceUrl, version: usedVersion, sha256: usedSha256,
        declarationSha256: declarationPin?.sha256, declarationUrl: declarationPin?.url,
        manifestSha256: wordRelease?.manifestSha256,
        attachments: wordRelease?.attachments?.map(item => ({ name: item.role, sha256: item.sha256, url: item.url }))
          ?? (attachments.receipt && suepMemberRoles.map(role => ({
            name: suepDocxMembers[role].name, sha256: attachments.receipt!.manifest.members[role].sha256,
          }))) }
      const generated = await verifyWordFinal(new File([blob], filename), { id, template, snapshotSha256 })
      signal.throwIfAborted()
      setReceipt({ check, delivery: { id, name, createdAt: new Date().toISOString(), template, main, snapshotSha256,
        check: { checkedAt: check.report.checkedAt, findings: check.report.findings },
        source: { name: 'manuscript-source.zip', bytes: zip.size, sha256: checksum }, sourceZip: zip, generated, generatedDocx: blob } })
      setArchiveName(name)
      download(blob, filename)
    } catch (cause) {
      setError(signal.aborted ? '导出已取消，请从当前稿件重新导出。' : cause instanceof Error ? cause.message : 'DOCX 导出失败。')
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setBusy(undefined)
      }
    }
  }

  function runCheck() {
    setError('')
    setSaved('')
    if (fresh) return fresh
    const value = { project, main, school, fields, report: checkDocxSubmission(project, main, fields, school) }
    setChecked(value)
    return value
  }

  async function attachFinal(file?: File) {
    if (!receipt || !delivery || busy) return
    setError('')
    setBusy('attach')
    try {
      const final = file && await verifyWordFinal(file, delivery)
      setReceipt({ ...receipt, delivery: { ...delivery, final, finalDocx: file } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 Word 定稿。')
    } finally { setBusy(undefined) }
  }

  async function archiveDelivery() {
    if (!delivery || !onArchive || busy || disabled || !archiveName.trim()) return
    setError('')
    setBusy('archive')
    try {
      await onArchive({ ...delivery, name: archiveName.trim(), createdAt: new Date().toISOString() })
      setSaved(archiveName.trim())
      setReceipt(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法归档提交版 DOCX。')
    } finally { setBusy(undefined) }
  }

  if (!open) return <Button type="button" variant="outline" disabled={disabled || !main} onClick={openForm}>导出 Word（DOCX）</Button>
  return <form aria-label="导出 Word（DOCX）" noValidate className="space-y-3 rounded-md border p-3 text-sm" onSubmit={event => { event.preventDefault(); void exportDocx() }}>
    <h2 className="font-medium">导出 Word（DOCX）</h2>
    <fieldset disabled={Boolean(busy) || disabled} className="space-y-2">
      <label className="block">目标学校
        <select className="mt-1 block w-full rounded border bg-background p-2" value={school} onChange={event => {
          setSchool(event.target.value as SubmissionDocxId)
          setUploads({})
          setError('')
        }}>
          {available.map(id => <option key={id} value={id}>{submissionDocxConfig(id).name}</option>)}
        </select>
      </label>
      <p>官方版本 {usedVersion} · {(suep || scopedWord) && usedVersion !== config.version ? '此版本待 Word 实机核对' : config.status}</p>
      <p className="break-all text-xs">原件 SHA-256 {usedSha256}</p>
      {wordVersionMissing && <p role="status">请导入项目绑定的官方版本包以恢复附件。</p>}
      {wordRelease?.manifestSha256 && <p className="break-all text-xs">附件清单 SHA-256 {wordRelease.manifestSha256}</p>}
      {wordRelease?.attachments?.map(item => <p key={item.role} className="break-all text-xs">{item.role} SHA-256 {item.sha256}</p>)}
      {declarationPin && <p className="break-all text-xs">声明 SHA-256 {declarationPin.sha256}</p>}
      {config.requirementsUrl && <a className="mr-3 underline" href={config.requirementsUrl} target="_blank" rel="noreferrer">学校撰写标准</a>}
      <a className="underline" href={config.sourceUrl} target="_blank" rel="noreferrer">原件发布来源</a>
      <div className="grid gap-2 sm:grid-cols-2">
        {fieldLabels.map(([key, label, maxLength]) => <label key={key} className="block">{label}
          <Input value={fields[key] ?? ''} maxLength={maxLength} required onChange={event => setFields({ ...fields, [key]: event.target.value })} />
        </label>)}
        {njupt && <label>培养类型
          <select className="mt-1 block w-full rounded border bg-background p-2" value={fields.studyMode ?? ''} onChange={event =>
            setFields({ ...fields, studyMode: (event.target.value || undefined) as SubmissionDocxFields['studyMode'] })}>
            <option value="">请选择</option><option value="full-time">全日制</option><option value="part-time">非全日制</option>
          </select>
        </label>}
        {(school === 'zju-basic-medicine-undergraduate' || njupt) && <label>论文公开状态
          <select className="mt-1 block w-full rounded border bg-background p-2" value={fields.confidentiality} onChange={event =>
            setFields({ ...fields, confidentiality: event.target.value as SubmissionDocxFields['confidentiality'] })}>
            <option value="public">公开</option>
            <option value="restricted">涉密</option>
          </select>
        </label>}
      </div>
      <label className="block">中文摘要
        <textarea className="block min-h-20 w-full rounded-md border bg-background p-2" required maxLength={5000} value={fields.chineseAbstract}
          onChange={event => setFields({ ...fields, chineseAbstract: event.target.value })} />
      </label>
      <label className="block">致谢（选填）
        <textarea className="block w-full rounded-md border bg-background p-2" maxLength={5000} value={fields.acknowledgment ?? ''}
          onChange={event => setFields({ ...fields, acknowledgment: event.target.value })} />
      </label>
      {suep ? suepPin ? <SuepOfficialAttachments state={attachments} disabled={Boolean(busy) || disabled} />
        : <p role="status">正在读取上电官方版本记录</p> : <details className="space-y-2">
        <summary className="cursor-pointer">手动上传官方原件</summary>
        <label className="block">官方 Word
          <Input key={school} type="file" accept={njupt ? '.doc,.docx' : '.docx'} onChange={event => setUploads({ ...uploads, original: event.target.files?.[0] })} />
        </label>
        {config.declaration && <label className="block">官方声明 Word
          <Input type="file" accept=".doc,.docx" onChange={event => setUploads({ ...uploads, declaration: event.target.files?.[0] })} />
        </label>}
        {config.guideline && <label className="block">官方规范 PDF
          <Input type="file" accept=".pdf" onChange={event => setUploads({ ...uploads, guideline: event.target.files?.[0] })} />
        </label>}
      </details>}
      <p>英文摘要与正文取自上方所选稿件。在 Word 中更新整份目录和引用字段后，目录才会显示页码。签名由作者和导师填写。</p>
    </fieldset>
    {checked && !fresh && <p role="status">稿件或导出信息已变更。请重新检查并生成当前交付文件。</p>}
    {fresh && <section aria-label="DOCX 导出前检查" role={fresh.report.findings.some(item => item.status === 'blocking') ? 'alert' : 'status'}>
      <p>{fresh.report.findings.some(item => item.status === 'blocking') ? '请先修正以下问题' : '导出前检查通过'}</p>
      <ul className="list-disc space-y-1 pl-5">{fresh.report.findings.map((item, index) => <li key={index}>
        {item.field && <strong>{fieldLabels.find(([key]) => key === item.field)?.[1] ?? ({
          chineseAbstract: '中文摘要', acknowledgment: '致谢', confidentiality: '论文公开状态', studyMode: '培养类型',
        } as Record<string, string>)[item.field] ?? item.field} · </strong>}
        {item.location && <button type="button" className="underline" onClick={() => onLocate(item.location!.path, item.location!.line)}>
          {item.location.path}:{item.location.line}
        </button>}{item.location && ' · '}{item.message}
      </li>)}</ul>
    </section>}
    {delivery && onArchive && <fieldset disabled={Boolean(busy) || disabled} className="space-y-2 rounded border p-2">
      <p className="break-all">稿件快照 SHA-256 <code>{delivery.snapshotSha256}</code></p>
      <label className="block">交付归档名称<Input maxLength={100} value={archiveName} onChange={event => setArchiveName(event.target.value)} /></label>
      <label className="block">附上 Word 保存的最终文件（选填）
        <Input type="file" accept=".docx" onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void attachFinal(file)
        }} />
      </label>
      {delivery.final && <p>{delivery.final.name} <button type="button" className="underline" onClick={() => void attachFinal()}>移除</button></p>}
      <Button type="button" variant="outline" disabled={!archiveName.trim()} onClick={() => void archiveDelivery()}>归档 DOCX 交付</Button>
    </fieldset>}
    {saved && <p role="status">已归档 {saved}</p>}
    {error && <p role="alert" className="break-words text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={Boolean(busy) || disabled} onClick={runCheck}>检查 DOCX 导出</Button>
      <Button type="submit" disabled={Boolean(busy) || disabled || !readyWord || suep && !attachments.receipt}>{busy === 'export' ? '正在生成 DOCX…' : '生成并下载 DOCX'}</Button>
      <Button type="button" variant="outline" disabled={Boolean(busy && busy !== 'export')} onClick={() => {
        if (busy === 'export') request.current?.abort()
        else setOpen(false)
      }}>{busy === 'export' ? '取消生成' : '收起'}</Button>
    </div>
  </form>
}
