'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fetchOfficialFile } from '@/lib/project/official-template-client'
import { templateDigest } from '@/lib/project/paper-templates'
import { exportSourceArchive } from '@/lib/project/source-archive'
import { submissionDocxConfig, submissionDocxFields, submissionDocxIds, type SubmissionDocxFields, type SubmissionDocxId } from '@/lib/project/submission-docx-config'
import { captureManuscript } from '@/lib/project/template-export'
import type { ProjectFileSystem } from '@/lib/project/types'
import { wordRequest } from '@/lib/project/word-conversion-client'

const labels = [
  ['title', '中文题目', 36], ['author', '作者姓名', 20], ['studentNumber', '学号', 20], ['advisor', '指导教师', 40],
  ['program', '专业与年级', 40], ['affiliation', '所在学院', 40], ['date', '提交日期', 30],
  ['chineseKeywords', '中文关键词', 250], ['englishKeywords', '英文关键词', 250],
] as const

export function SubmissionDocxPanel({ project, main, template, disabled, download }: {
  project: ProjectFileSystem; main: string; template?: string; disabled: boolean; download: (blob: Blob, name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [school, setSchool] = useState<SubmissionDocxId>(() => submissionDocxIds.find(id => id === template) ?? submissionDocxIds[0])
  const [fields, setFields] = useState<SubmissionDocxFields>({
    title: '', author: '', studentNumber: '', advisor: '', program: '', affiliation: '', date: '',
    chineseAbstract: '', chineseKeywords: '', englishKeywords: '', confidentiality: 'public',
  })
  const [uploads, setUploads] = useState<{ original?: File; guideline?: File }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)
  const config = submissionDocxConfig(school)
  useEffect(() => () => request.current?.abort(), [project, main])

  function openForm() {
    setOpen(true)
    try {
      const snapshot = captureManuscript(project.files, main)
      setFields(current => ({ ...current, author: current.author || snapshot.authors.join('、'),
        englishKeywords: current.englishKeywords || (/^[^\\\$\{\}]*$/.test(snapshot.keywords) ? snapshot.keywords : '') }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取当前稿件。')
    }
  }

  async function exportDocx() {
    if (busy || disabled) return
    setError('')
    const checked = submissionDocxFields.safeParse(fields)
    if (!checked.success) {
      const name = checked.error.issues[0]?.path[0]
      setError('请核对“' + (labels.find(([key]) => key === name)?.[1] ?? '中文摘要') + '”。')
      return
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    const { signal } = controller
    async function original(pin: string, local?: File, asset?: 'guideline' | 'docx-bundle') {
      if (!local) return fetchOfficialFile(school, pin, asset, signal)
      if (local.size > 16 * 1024 * 1024 || await templateDigest(await local.arrayBuffer()) !== pin) {
        throw new Error((asset === 'guideline' ? '本地规范' : '本地原件') + '的 SHA-256 与所选登记版不一致。')
      }
      return local
    }
    try {
      captureManuscript(project.files, main)
      let word: File
      let guide: File | undefined
      try {
        [word, guide] = await Promise.all([
          original(config.original.sha256, uploads.original, school === 'suep-undergraduate' ? 'docx-bundle' : undefined),
          config.guideline ? original(config.guideline.sha256, uploads.guideline, 'guideline') : undefined,
        ])
      } catch (cause) {
        signal.throwIfAborted()
        throw new Error((cause instanceof Error ? cause.message : '官方原件获取失败。') + ' 可在「手动上传官方原件」选择对应登记版文件。')
      }
      const data = new FormData()
      data.set('intent', 'export-submission-docx')
      data.set('school', school)
      data.set('main', main)
      data.set('fields', JSON.stringify(checked.data))
      data.set('original', word)
      if (guide) data.set('guideline', guide)
      const zip = await exportSourceArchive(project)
      if (word.size + (guide?.size ?? 0) + zip.size > 16 * 1024 * 1024) throw new Error('官方原件和项目源包共计不得超过 16 MB。')
      data.set('source', zip, 'manuscript.zip')
      const blob = await (await wordRequest(data, signal)).blob()
      signal.throwIfAborted()
      const name = checked.data.title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').replace(/[. ]+$/, '') || 'submission'
      download(blob, name + '-' + config.version + '.docx')
    } catch (cause) {
      setError(signal.aborted ? '导出已取消，请从当前稿件重新导出。' : cause instanceof Error ? cause.message : 'DOCX 导出失败。')
    } finally {
      if (request.current === controller) {
        request.current = undefined
        setBusy(false)
      }
    }
  }

  if (!open) return <Button type="button" variant="outline" disabled={disabled || !main} onClick={openForm}>导出 Word（DOCX）</Button>
  return <form aria-label="导出 Word（DOCX）" className="space-y-3 rounded-md border p-3 text-sm" onSubmit={event => { event.preventDefault(); void exportDocx() }}>
    <h2 className="font-medium">导出 Word（DOCX）</h2>
    <fieldset disabled={busy || disabled} className="space-y-2">
      <label className="block">目标学校
        <select className="mt-1 block w-full rounded border bg-background p-2" value={school} onChange={event => {
          setSchool(event.target.value as SubmissionDocxId)
          setUploads({})
          setError('')
        }}>
          {submissionDocxIds.map(id => <option key={id} value={id}>{submissionDocxConfig(id).name}</option>)}
        </select>
      </label>
      <p>官方登记版 {config.version} · {config.status}</p>
      <p className="break-all text-xs">原件 SHA-256 {config.original.sha256}</p>
      <a className="underline" href={config.sourceUrl} target="_blank" rel="noreferrer">原件发布来源</a>
      <div className="grid gap-2 sm:grid-cols-2">
        {labels.map(([key, label, maxLength]) => <label key={key} className="block">{label}
          <Input value={fields[key]} maxLength={maxLength} required onChange={event => setFields({ ...fields, [key]: event.target.value })} />
        </label>)}
        {school === 'zju-basic-medicine-undergraduate' && <label>论文公开状态
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
      <details className="space-y-2">
        <summary className="cursor-pointer">手动上传官方原件</summary>
        <label className="block">{config.guideline ? '官方 Word' : '官方附件包 RAR'}
          <Input key={school} type="file" accept={config.guideline ? '.docx' : '.rar'} onChange={event => setUploads({ ...uploads, original: event.target.files?.[0] })} />
        </label>
        {config.guideline && <label className="block">官方规范 PDF
          <Input type="file" accept=".pdf" onChange={event => setUploads({ ...uploads, guideline: event.target.files?.[0] })} />
        </label>}
      </details>
      <p>英文摘要与正文取自上方所选稿件。在 Word 中更新整份目录和引用字段后，目录才会显示页码。签名由作者和导师填写。</p>
    </fieldset>
    {error && <p role="alert" className="break-words text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy || disabled}>{busy ? '正在生成 DOCX…' : '生成并下载 DOCX'}</Button>
      <Button type="button" variant="outline" onClick={() => {
        if (busy) request.current?.abort()
        else setOpen(false)
      }}>{busy ? '取消生成' : '收起'}</Button>
    </div>
  </form>
}
