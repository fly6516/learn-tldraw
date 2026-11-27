'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { projectInformationFields, projectInformationSchema, type ProjectInformation } from '@/lib/project/project-information'

export function ProjectInformationDialog({ information, projectName, onSave, onClose }: {
  information?: ProjectInformation
  projectName: string
  onSave: (info: ProjectInformation) => Promise<void>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(information ?? {})
  const [authors, setAuthors] = useState(information?.authors?.join('\n') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto border-workbench-line bg-workbench-panel text-workbench-ink sm:max-w-2xl">
      <div className="pr-8">
        <DialogTitle>项目信息</DialogTitle>
        <DialogDescription className="mt-1">项目 · {projectName}</DialogDescription>
      </div>
      <form className="space-y-4 text-sm" onSubmit={async event => {
        event.preventDefault()
        const parsed = projectInformationSchema.safeParse({
          ...draft,
          authors: authors.split(/\r?\n/).map(name => name.trim()).filter(Boolean),
        })
        if (!parsed.success) {
          const key = parsed.error.issues[0]?.path[0]
          setError(key === 'authors' ? '请填写有效的作者姓名，最多 40 位，每位 120 字。'
            : '请检查' + (projectInformationFields.find(([field]) => field === key)?.[1] ?? '项目信息') + '的长度及格式。')
          return
        }
        const information = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value?.length))
        setBusy(true)
        setError('')
        try { await onSave(information); onClose() }
        catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存项目信息。') }
        finally { setBusy(false) }
      }}>
        <p className="text-workbench-muted">填写的值会用于更换模板、编译及正式 DOCX 导出。留空的字段从原稿或模板表单取值。姓名、学号、邮箱等身份字段仅用于适用的正式版本，盲审保留匿名检查。</p>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          {projectInformationFields.map(([key, label, limit]) => <label key={key} className={'grid content-start gap-1 ' + (key === 'chineseAbstract' ? 'sm:col-span-2' : '')}>
            {label}
            {key === 'chineseAbstract' ? <textarea className="min-h-20 rounded-md border border-workbench-line bg-workbench-panel p-2" maxLength={limit}
              value={draft[key] ?? ''} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
              : <Input maxLength={limit} value={draft[key] ?? ''} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />}
          </label>)}
          <label className="grid gap-1 sm:col-span-2">作者姓名（每行一位，按署名顺序）
            <textarea className="min-h-16 rounded-md border border-workbench-line bg-workbench-panel p-2" maxLength={4900}
              value={authors} onChange={event => setAuthors(event.target.value)} />
          </label>
        </fieldset>
        {error && <p role="alert" className="text-red-800">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy}>{busy ? '正在保存…' : '保存项目信息'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
