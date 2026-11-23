'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Archive, FileUp, FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { decodeProjectBackup, projectBackupExtension } from '@/lib/project/backup'
import type { PortableProjectHistory } from '@/lib/project/backup-history'
import { createDefaultProject } from '@/lib/project/file-system'
import { libraryProjectUrl, libraryStorageKey, type LibraryProject, type LibraryProjectState, type LibraryView } from '@/lib/project/project-library'
import { addLibraryProject, listLibraryProjects, openProjectStorage, updateLibraryProject } from '@/lib/project/storage'
import { importSourceArchive } from '@/lib/project/source-archive'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { PortableWritingState } from '@/lib/project/writing-drafts'
import { ResearchWorkspace } from './ResearchWorkspace'

const sections = [['active', 'Projects'], ['archived', 'Archived'], ['trash', 'Trash']] as const

export function ProjectLibrary() {
  const router = useRouter()
  const params = useSearchParams()
  const requested = params?.get('project')
  const oldWritingLink = !requested && params?.get('view') === 'write'
  const [database, setDatabase] = useState<IDBDatabase>()
  const [catalog, setCatalog] = useState<LibraryProject[]>()
  const [section, setSection] = useState<LibraryProjectState>('active')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nameDialog, setNameDialog] = useState<{ id?: string; value: string }>()
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    let connection: IDBDatabase | undefined
    void openProjectStorage().then(opened => {
      connection = opened
      if (active) setDatabase(opened)
      else opened.close()
    }).catch(() => { if (active) setError('Local project storage could not be opened.') })
    return () => { active = false; connection?.close() }
  }, [])

  useEffect(() => {
    if (!database) return
    let active = true
    void listLibraryProjects(database).then(projects => {
      if (active) setCatalog(projects)
    }).catch(() => { if (active) setError('The project list could not be loaded.') })
    return () => { active = false }
  }, [database, requested])

  useEffect(() => {
    const recent = catalog?.find(project => project.state === 'active')
    if (oldWritingLink && recent) router.replace(libraryProjectUrl(recent.id, 'write'))
  }, [catalog, oldWritingLink, router])

  const recordView = useCallback((view: LibraryView) => {
    if (!database || !requested) return
    void updateLibraryProject(database, requested, { view }).catch(() => {})
  }, [database, requested])

  const openCopy = useCallback(async (project: ProjectFileSystem, view: LibraryView,
    writing?: PortableWritingState, history?: PortableProjectHistory) => {
    if (!database) throw new Error('The project list is still loading.')
    const imported = await addLibraryProject(database, project, view, writing, history)
    setCatalog(current => [imported, ...(current ?? [])])
    router.push(libraryProjectUrl(imported.id, view))
  }, [database, router])

  async function run(action: (connection: IDBDatabase) => Promise<void>) {
    if (!database || busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try { await action(database) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the project list.') }
    finally { setBusy(false) }
  }

  async function importFile(file: File) {
    await run(async () => {
      if (file.name.toLowerCase().endsWith(projectBackupExtension)) {
        const backup = await decodeProjectBackup(file)
        await openCopy(backup.project, backup.writing?.view ? 'write' : 'canvas', backup.writing, backup.history)
      } else {
        await openCopy(await importSourceArchive(file), 'write')
      }
    })
  }

  const active = catalog?.find(project => project.id === requested && project.state === 'active')
  if (active) return <ResearchWorkspace key={active.id} storageNamespace={libraryStorageKey(active.id)}
    onViewChange={recordView} onImportCopy={openCopy} projectListHref="/research" />

  const projects = catalog?.filter(project => project.state === section) ?? []
  const recent = catalog?.find(project => project.state === 'active')
  return <main className="mx-auto min-h-dvh max-w-5xl space-y-6 px-4 py-8 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">Research Canvas</Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Research projects</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!catalog || busy} onClick={() => fileInput.current?.click()}><FileUp /> Import project</Button>
        <Button disabled={!catalog || busy} onClick={() => setNameDialog({ value: '' })}><Plus /> New project</Button>
        <input ref={fileInput} type="file" hidden aria-label="Choose project ZIP or backup"
          accept={`.zip,${projectBackupExtension}`} onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importFile(file)
          }} />
      </div>
    </header>
    <nav className="flex flex-wrap gap-2 border-b pb-3" aria-label="Project list sections">
      {sections.map(([id, title]) => <Button key={id} variant={section === id ? 'secondary' : 'ghost'}
        aria-pressed={section === id} onClick={() => setSection(id)}>{title}</Button>)}
    </nav>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {requested && catalog && <p role="status" className="text-sm text-muted-foreground">This project is unavailable from this browser or is in Archived or Trash.</p>}
    {!catalog && !error && <p role="status" className="text-sm text-muted-foreground">Opening local projects…</p>}
    {busy && <p role="status" className="text-sm text-muted-foreground">Updating local projects…</p>}
    {catalog && !projects.length && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      {section === 'active' ? 'Create a project or import a LaTeX ZIP or Research Canvas backup.' : section === 'archived' ? 'No archived projects.' : 'Trash is empty.'}
    </p>}
    <ul className="grid gap-3 sm:grid-cols-2">
      {projects.map(project => <li key={project.id} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-2">
          <FolderOpen className="mt-0.5 size-5 shrink-0 text-indigo-600" />
          <div className="min-w-0">
            <h2 className="break-words font-semibold">{project.name}</h2>
            {section === 'active' && recent?.id === project.id && <p className="text-xs text-muted-foreground">Most recent</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {section === 'active' && <Button size="sm" asChild><Link href={libraryProjectUrl(project.id, project.view)}
            aria-label={`Open ${project.name}`}>Open</Link></Button>}
          {section !== 'trash' && <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => setNameDialog({ id: project.id, value: project.name })}>Rename</Button>}
          {(section === 'active' ? ['archived', 'trash'] : section === 'archived' ? ['active', 'trash'] : ['active']).map(target =>
            <Button key={target} size="sm" variant="ghost" disabled={busy} onClick={() => void run(async connection => {
              await updateLibraryProject(connection, project.id, { state: target as LibraryProjectState })
              setCatalog(await listLibraryProjects(connection))
              setMessage(target === 'active' ? 'Project restored to Projects.' : target === 'archived' ? 'Project archived.' : 'Project moved to Trash.')
            })}>
              {target === 'active' ? 'Restore' : target === 'archived' ? <><Archive /> Archive</> : 'Move to Trash'}
            </Button>,
          )}
        </div>
      </li>)}
    </ul>
    <Dialog open={Boolean(nameDialog)} onOpenChange={open => { if (!open && !busy) setNameDialog(undefined) }}>
      <DialogContent>
        <DialogTitle>{nameDialog?.id ? 'Rename project' : 'New project'}</DialogTitle>
        <DialogDescription>Use a name you can recognize in the project list.</DialogDescription>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault()
          const name = nameDialog?.value.trim()
          if (!name) return
          const id = nameDialog?.id
          void run(async connection => {
            if (id) {
              await updateLibraryProject(connection, id, { name })
              setCatalog(await listLibraryProjects(connection))
              setMessage('Project renamed.')
            } else {
              await openCopy(createDefaultProject(name), 'canvas')
            }
            setNameDialog(undefined)
          })
        }}>
          <label className="grid gap-1 text-sm">Project name
            <Input value={nameDialog?.value ?? ''} maxLength={120} autoFocus
              onChange={event => setNameDialog(current => current && { ...current, value: event.target.value })} />
          </label>
          {error && <p role="alert" className="text-sm text-red-900">{error}</p>}
          <DialogFooter><Button type="submit" disabled={busy || !nameDialog?.value.trim()}>{nameDialog?.id ? 'Save name' : 'Create project'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>
}
