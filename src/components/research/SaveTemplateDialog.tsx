'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { compilerLabels, defaultCompileProfile, type CompileProfile } from '@/lib/project/compile-profile'
import { templateDigest } from '@/lib/project/paper-templates'
import { exportSourceArchive } from '@/lib/project/source-archive'
import { addLocalTemplate } from '@/lib/project/storage'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { LocalPaperTemplate } from '@/lib/project/template-catalog'

export function SaveTemplateDialog({ database, project, onClose, onSave }: {
  database: IDBDatabase
  project: ProjectFileSystem
  onClose: () => void
  onSave: (template: LocalPaperTemplate) => void
}) {
  const files = [...project.files.values()].filter(file => file.type !== 'directory')
  const mainFiles = files.filter(file => /\.tex$/i.test(file.path) && 'content' in file && /\\documentclass\b/.test(file.content ?? ''))
  const [name, setName] = useState(project.metadata.projectName)
  const [main, setMain] = useState(mainFiles.find(file => file.path === project.metadata.mainFile)?.path ?? mainFiles[0]?.path ?? '')
  const [profile, setProfile] = useState(project.metadata.compileProfile ?? defaultCompileProfile)
  const [included, setIncluded] = useState(() => new Set(files.map(file => file.path)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (busy || !main || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const archive = await exportSourceArchive({ ...project,
        files: new Map([...project.files].filter(([path]) => path === main || included.has(path))),
      })
      const template = { id: 'local-' + crypto.randomUUID(), name: name.trim(), version: '1',
        mainFile: main, compileProfile: profile, archive, sha256: await templateDigest(await archive.arrayBuffer()) }
      await addLocalTemplate(database, template)
      onSave(template)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the template.')
    } finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
      <DialogTitle>Save as template</DialogTitle>
      <DialogDescription>Save a reusable ZIP of the selected source files and assets in this browser.</DialogDescription>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save() }}>
        <label className="block space-y-1 text-sm">Template name<Input required value={name} maxLength={120}
          disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label className="block space-y-1 text-sm">Main LaTeX file
          <select className="block w-full rounded-md border bg-background p-2" value={main} disabled={busy || !mainFiles.length}
            onChange={event => setMain(event.target.value)}>
            {mainFiles.map(file => <option key={file.path}>{file.path}</option>)}
          </select>
        </label>
        {!main && <p role="alert" className="text-sm text-destructive">Choose a project with a complete LaTeX document.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">Compiler
            <select className="block w-full rounded-md border bg-background p-2" value={profile.engine} disabled={busy} onChange={event => {
              const engine = event.target.value as CompileProfile['engine']
              setProfile({ engine, bibliography: 'auto' })
            }}>{Object.entries(compilerLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          {(profile.engine === 'pdflatex' || profile.engine === 'xelatex') && <label className="block space-y-1 text-sm">Bibliography
            <select className="block w-full rounded-md border bg-background p-2" value={profile.bibliography} disabled={busy}
              onChange={event => setProfile({ ...profile, bibliography: event.target.value as typeof profile.bibliography })}>
              <option value="auto">Auto</option><option value="bibtex">BibTeX</option><option value="biber">Biber</option><option value="none">None</option>
            </select>
          </label>}
        </div>
        <fieldset disabled={busy} className="rounded-lg border p-3 text-sm">
          <legend className="px-1 font-medium">Include files</legend>
          <div className="max-h-40 space-y-1 overflow-auto">{files.map(file => <label key={file.path} className="flex items-start gap-2 break-all">
            <input className="mt-1 accent-workbench-accent" type="checkbox" disabled={file.path === main}
              checked={file.path === main || included.has(file.path)} onChange={event => {
                const checked = event.target.checked
                setIncluded(previous => {
                  const next = new Set(previous)
                  if (checked) next.add(file.path)
                  else next.delete(file.path)
                  return next
                })
              }} /> <span>{file.path}</span>
          </label>)}</div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !main || !name.trim()}>{busy ? 'Saving…' : 'Save template'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
