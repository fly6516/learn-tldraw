'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { applyWordBundle, importWordAsProject } from '@/lib/project/word-conversion-client'
import { wordImportLimit, type WordProfile } from '@/lib/project/word-import'
import type { WordLayoutBundle } from '@/lib/project/word-layout'
import type { ProjectFileSystem } from '@/lib/project/types'
import { SuepOfficialAttachments, useSuepAttachments } from '@/components/project/SuepOfficialAttachments'
import { bindSuepBundle } from '@/lib/project/suep-bundle-client'
import { suepUndergraduateId } from '@/lib/project/suep-undergraduate-source'
import type { TemplateOrigin } from '@/lib/project/template-release'

const suepFields = [
  ['title', '中文题目', 36], ['author', '作者姓名', 20], ['studentNumber', '学号', 20], ['affiliation', '所在院系', 40],
  ['program', '专业年级', 40], ['advisor', '指导教师', 40], ['date', '提交日期', 30],
] as const

export function WordImportDialog({ initialProfile, savedLayout, templateOrigin, officialArchive, manual, close, openProject }: {
  initialProfile: WordProfile
  savedLayout?: { name: string; bundle: WordLayoutBundle; origin?: TemplateOrigin }
  templateOrigin?: TemplateOrigin
  officialArchive?: Blob
  manual?: boolean
  close: () => void
  openProject: (project: ProjectFileSystem) => Promise<void>
}) {
  const [profile, setProfile] = useState(initialProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pin = templateOrigin?.id === suepUndergraduateId ? ({ ...templateOrigin, id: suepUndergraduateId } as const) : undefined
  const attachments = useSuepAttachments(pin, officialArchive, manual)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || pin && !attachments.receipt) return
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const body = data.get('body')
    if (!name || !(body instanceof File) || !body.size) {
      setError('Enter a project name and choose a manuscript.')
      return
    }
    if (savedLayout) applyWordBundle(data, savedLayout.bundle)
    else if (templateOrigin) data.set('profile', initialProfile)
    const size = [...data.values()].reduce((total, value) => total + (value instanceof File ? value.size : 0), 0)
    if (size > wordImportLimit) {
      setError('Choose Word files totaling at most 16 MB.')
      return
    }
    if (pin) {
      bindSuepBundle(data, pin)
      data.set('suep-cover-fields', JSON.stringify(Object.fromEntries(suepFields.map(([key]) => [key, data.get(key)]))))
      for (const [key] of suepFields) data.delete(key)
    }
    data.delete('name')
    setBusy(true)
    setError('')
    try {
      const project = await importWordAsProject(data, name)
      const origin = savedLayout?.origin ?? templateOrigin
      await openProject(origin ? {
        ...project, metadata: { ...project.metadata, templateOrigin: origin },
      } : project)
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Word import failed.')
    } finally {
      setBusy(false)
    }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto">
      <DialogTitle>Import Word to TeX</DialogTitle>
      <DialogDescription>
        {pin ? '上传自己的稿件并填写封面。工作台将自动加载校验后的上电官方封面和声明，正文可在 TeX 编辑器中继续编辑。'
          : 'The manuscript becomes editable TeX. Optional cover and declaration files are inserted as rendered PDF pages.'}
      </DialogDescription>
      <form className="space-y-4" onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block space-y-1 text-sm">Project name
            <Input name="name" required maxLength={120} autoFocus />
          </label>
          {savedLayout ? <p className="text-sm font-medium">使用版式 · {savedLayout.name}{savedLayout.origin ? ' · ' + savedLayout.origin.version : ''}</p> : <label className="block space-y-1 text-sm">TeX layout
            <select name="profile" value={profile} disabled={!!templateOrigin} onChange={event => setProfile(event.target.value as WordProfile)}
              className="h-9 w-full rounded-md border bg-white px-2">
              <option value="article">General article</option>
              <option value="suep-undergraduate">上海电力大学 · 本科</option>
            </select>
          </label>}
          <label className="block space-y-1 text-sm">Word manuscript
            <Input name="body" type="file" accept=".doc,.docx" required />
          </label>
          {pin && <>
            <SuepOfficialAttachments state={attachments} disabled={busy} />
            <div className="grid gap-2 sm:grid-cols-2">
              {suepFields.map(([key, label, maxLength]) => <label key={key} className="block text-sm">{label}
                <Input name={key} required maxLength={maxLength} />
              </label>)}
            </div>
          </>}
          {!pin && !savedLayout?.bundle.assets.cover && <label className="block space-y-1 text-sm">Word cover (optional)
            <Input name="cover" type="file" accept=".doc,.docx" />
          </label>}
          {!pin && <label className="block space-y-1 text-sm">Word declaration (optional)
            <Input name="declaration" type="file" accept=".doc,.docx" />
          </label>}
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button disabled={busy || Boolean(pin && !attachments.receipt)}>{busy ? 'Converting Word…' : 'Create TeX project'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
