'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { applyWordBundle, importWordAsProject } from '@/lib/project/word-conversion-client'
import { wordImportLimit, type WordProfile } from '@/lib/project/word-import'
import type { WordLayoutBundle } from '@/lib/project/word-layout'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { TemplateOrigin } from '@/lib/project/template-release'

export function WordImportDialog({ initialProfile, savedLayout, templateOrigin, close, openProject }: {
  initialProfile: WordProfile
  savedLayout?: { name: string; bundle: WordLayoutBundle; origin?: TemplateOrigin }
  templateOrigin?: TemplateOrigin
  close: () => void
  openProject: (project: ProjectFileSystem) => Promise<void>
}) {
  const [profile, setProfile] = useState(initialProfile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
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
        The manuscript becomes editable TeX. Optional cover and declaration files are inserted as rendered PDF pages.
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
          {!savedLayout?.bundle.assets.cover && <label className="block space-y-1 text-sm">Word cover (optional)
            <Input name="cover" type="file" accept=".doc,.docx" />
          </label>}
          <label className="block space-y-1 text-sm">Word declaration (optional)
            <Input name="declaration" type="file" accept=".doc,.docx" />
          </label>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button disabled={busy}>{busy ? 'Converting Word…' : 'Create TeX project'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
