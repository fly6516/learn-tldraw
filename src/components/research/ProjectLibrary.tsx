'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Archive, ArrowUpRight, FileText, FileUp, FolderOpen, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { decodeProjectBackup, projectBackupExtension } from '@/lib/project/backup'
import type { PortableProjectHistory } from '@/lib/project/backup-history'
import { createDefaultProject } from '@/lib/project/file-system'
import { createTemplateProject, importSpringerTemplate, paperTemplates, springerTemplate, type PaperTemplateId } from '@/lib/project/paper-templates'
import { libraryProjectUrl, libraryStorageKey, type LibraryProject, type LibraryProjectState, type LibraryView, type RecoveryStatus } from '@/lib/project/project-library'
import { addLibraryProject, listLibraryProjects, openProjectStorage, readRecoveryBaseline, updateLibraryProject } from '@/lib/project/storage'
import { importSourceArchive } from '@/lib/project/source-archive'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { PortableWritingState } from '@/lib/project/writing-drafts'
import { ResearchWorkspace } from './ResearchWorkspace'
import { BackupContents } from './BackupContents'
import { WorkbenchSetup } from '@/components/project/WorkbenchSetup'

const sections = [['active', 'Projects'], ['archived', 'Archived'], ['trash', 'Trash']] as const

export function ProjectLibrary() {
  const router = useRouter()
  const params = useSearchParams()
  const requested = params?.get('project')
  const oldWritingLink = !requested && params?.get('view') === 'write'
  const [database, setDatabase] = useState<IDBDatabase>()
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  const [catalog, setCatalog] = useState<LibraryProject[]>()
  const [recovery, setRecovery] = useState<Record<string, RecoveryStatus | undefined>>({})
  const [backup, setBackup] = useState<Awaited<ReturnType<typeof decodeProjectBackup>>>()
  const [section, setSection] = useState<LibraryProjectState>('active')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'recent' | 'name'>('recent')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nameDialog, setNameDialog] = useState<{ id?: string; value: string; starter?: 'canvas' | PaperTemplateId }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const templateInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    let connection: IDBDatabase | undefined
    void openProjectStorage().then(opened => {
      connection = opened
      if (active) setDatabase(opened)
      else opened.close()
    }).catch(() => { if (active) { setStorageUnavailable(true); setError('Local project storage could not be opened.') } })
    return () => { active = false; connection?.close() }
  }, [])

  useEffect(() => {
    if (!database) return
    let active = true
    void listLibraryProjects(database).then(projects => {
      if (active) setCatalog(projects)
    }).catch(() => { if (active) setError('The project list could not be loaded. Reload the page to try again.') })
    return () => { active = false }
  }, [database, requested])

  useEffect(() => {
    if (!database || !catalog || requested) return
    let active = true
    const check = async () => {
      const entries = await Promise.all(catalog.map(async project => {
        try {
          const { baseline, receipt } = await readRecoveryBaseline(database, libraryStorageKey(project.id))
          return [project.id, { receipt, changed: !!receipt && (!receipt.baseline || baseline !== receipt.baseline) }] as const
        } catch { return [project.id, undefined] as const }
      }))
      if (active) setRecovery(Object.fromEntries(entries))
    }
    void check()
    window.addEventListener('focus', check)
    return () => { active = false; window.removeEventListener('focus', check) }
  }, [database, catalog, requested])

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
        setBackup(await decodeProjectBackup(file))
      } else {
        await openCopy(await importSourceArchive(file), 'write')
      }
    })
  }

  const active = catalog?.find(project => project.id === requested && project.state === 'active')
  if (active) return <ResearchWorkspace key={active.id} storageNamespace={libraryStorageKey(active.id)}
    onViewChange={recordView} onImportCopy={openCopy} projectListHref="/research" />

  const sectionProjects = catalog?.filter(project => project.state === section) ?? []
  const nameFilter = query.trim().normalize().toLocaleLowerCase()
  const projects = sectionProjects.filter(project => project.name.normalize().toLocaleLowerCase().includes(nameFilter))
  if (sort === 'name') projects.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }))
  const recent = catalog?.find(project => project.state === 'active')
  const selectedTemplate = paperTemplates.find(template => template.id === nameDialog?.starter)
  const publisherTemplate = selectedTemplate?.id === springerTemplate.id ? selectedTemplate : undefined
  return <main className="mx-auto min-h-dvh max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">Research Canvas</Link>
        <h1 className="mt-2 font-serif text-4xl font-medium tracking-tight sm:text-5xl">Research projects</h1>
      </div>
      <WorkbenchSetup storage={storageUnavailable ? 'unavailable' : database ? 'ready' : 'checking'} />
    </header>
    <section aria-label="Start or continue a project" className="grid overflow-hidden rounded-xl border border-[#d5e1ef] bg-[#f0f5fb] text-[#152942] sm:grid-cols-2">
      {recent && <div className="min-w-0 border-b border-[#d5e1ef] px-5 py-5 sm:border-r sm:border-b-0 sm:px-6">
        <div className="flex items-center gap-2 text-sm font-medium text-[#324d71]"><FileText aria-hidden="true" /> Last opened</div>
        <p className="my-3 break-words font-serif text-2xl">{recent.name}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href={libraryProjectUrl(recent.id, recent.view)}>
            {recent.view === 'write' ? 'Continue writing' : 'Open recent canvas'} <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      </div>}
      <div className="space-y-3 px-5 py-5 sm:px-6">
        <h2 className="font-serif text-2xl">Start a project</h2>
        <p className="text-sm text-[#324d71]">Start with a blank canvas or a LaTeX paper template.</p>
        <div className="flex flex-wrap gap-2">
          <Button className="bg-[#234d80] text-white hover:bg-[#193b64]" disabled={!catalog || busy}
            onClick={() => setNameDialog({ value: '', starter: 'canvas' })}><Plus /> New project</Button>
          <Button variant="outline" disabled={!catalog || busy} onClick={() => fileInput.current?.click()}><FileUp /> Import project</Button>
        </div>
        <Button variant="link" className="h-auto p-0 text-[#234d80]" disabled={!catalog || busy} onClick={() => void run(async () => {
          const { testPaperZip, testPaperName } = await import('@/lib/project/test-paper')
          const sample = await importSourceArchive(new File([await testPaperZip(true)], `${testPaperName}.zip`))
          await openCopy({ ...sample, metadata: { ...sample.metadata, writingSample: true } }, 'write')
        })}>Try a writing sample</Button>
      </div>
    </section>
    <input ref={fileInput} type="file" hidden aria-label="Choose project ZIP or backup"
      accept={`.zip,${projectBackupExtension}`} onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void importFile(file)
      }} />
    <div className="flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-end lg:justify-between">
      <nav className="flex flex-wrap gap-2" aria-label="Project list sections">
        {sections.map(([id, title]) => <Button key={id} variant={section === id ? 'secondary' : 'ghost'}
          aria-pressed={section === id} onClick={() => setSection(id)}>{title}</Button>)}
      </nav>
      <div className="grid gap-3 min-[440px]:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm font-medium">Search projects
          <span className="relative block">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input type="search" className="pl-9" value={query} disabled={!catalog}
              onChange={event => setQuery(event.target.value)} placeholder="Project name" />
          </span>
        </label>
        <label className="grid gap-1 text-sm font-medium">Sort by
          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-ring"
            value={sort} disabled={!catalog} onChange={event => setSort(event.target.value === 'name' ? 'name' : 'recent')}>
            <option value="recent">Recently opened</option>
            <option value="name">Project name</option>
          </select>
        </label>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {requested && catalog && <p role="status" className="text-sm text-muted-foreground">This project is unavailable from this browser or is in Archived or Trash.</p>}
    {!catalog && !error && <p role="status" className="text-sm text-muted-foreground">Opening local projects…</p>}
    {busy && <p role="status" className="text-sm text-muted-foreground">Updating local projects…</p>}
    {catalog && !sectionProjects.length && <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      {section === 'active' ? 'Create a project or import a LaTeX ZIP or Research Canvas backup.' : section === 'archived' ? 'No archived projects.' : 'Trash is empty.'}
    </p>}
    {sectionProjects.length > 0 && !projects.length && <p role="status" className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
      No matching projects. <Button variant="link" className="h-auto p-0" onClick={() => setQuery('')}>Clear search</Button>
    </p>}
    <ul aria-label="Project list" className="grid gap-3 sm:grid-cols-2">
      {projects.map(project => {
        const status = recovery[project.id]
        return <li key={project.id} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-2">
          <FolderOpen className="mt-0.5 size-5 shrink-0 text-indigo-600" />
          <div className="min-w-0">
            <h2 className="break-words font-semibold">{project.name}</h2>
            {section === 'active' && recent?.id === project.id && <p className="text-xs text-muted-foreground">Most recent</p>}
          </div>
        </div>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{status ? 'Saved on this browser' : 'Local save status unavailable'}</p>
          {status?.receipt ? <>
            <p>Last export {new Date(status.receipt.exportedAt).toLocaleString()} · {status.receipt.scope}</p>
            <p className={status.changed ? 'text-amber-800' : undefined}>{status.changed ? 'Current project needs a complete recovery backup' : 'Complete recovery backup matches the saved project'}</p>
          </> : status && <p>No backup export recorded for this browser</p>}
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
      </li>})}
    </ul>
    {backup && <Dialog open onOpenChange={open => { if (!open && !busy) setBackup(undefined) }}>
      <DialogContent>
        <DialogTitle>Preview project backup</DialogTitle>
        <DialogDescription>Restore this backup as a separate project in this browser.</DialogDescription>
        <BackupContents backup={backup} />
        {error && <p role="alert" className="text-sm text-red-900">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setBackup(undefined)}>Cancel</Button>
          <Button disabled={busy} onClick={() => void run(async () => {
            await openCopy(backup.project, backup.writing?.view ? 'write' : 'canvas', backup.writing, backup.history)
            setBackup(undefined)
          })}>Import as new project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
    <Dialog open={Boolean(nameDialog)} onOpenChange={open => { if (!open && !busy) setNameDialog(undefined) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{nameDialog?.id ? 'Rename project' : 'New project'}</DialogTitle>
        <DialogDescription>{nameDialog?.id ? 'Use a name you can recognize in the project list.' : 'Choose how you want to begin.'}</DialogDescription>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault()
          const name = nameDialog?.value.trim()
          if (!name) return
          const id = nameDialog?.id
          const starter = nameDialog?.starter
          if (starter === springerTemplate.id) {
            templateInput.current?.click()
            return
          }
          void run(async connection => {
            if (id) {
              await updateLibraryProject(connection, id, { name })
              setCatalog(await listLibraryProjects(connection))
              setMessage('Project renamed.')
            } else if (starter && starter !== 'canvas') {
              await openCopy(await createTemplateProject(starter, name), 'write')
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
          {!nameDialog?.id && <fieldset className="space-y-2" disabled={busy}>
            <legend className="pb-1 text-sm font-medium">Start with</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-[#234d80]">
              <input className="mt-1 accent-[#234d80]" aria-label="Blank canvas" type="radio" name="starter" value="canvas"
                checked={nameDialog?.starter === 'canvas'} onChange={() => setNameDialog(current => current && { ...current, starter: 'canvas' })} />
              <span className="min-w-0 text-sm">
                <span className="block font-medium">Blank canvas</span>
                <span className="text-muted-foreground">Map ideas and connect notes.</span>
              </span>
            </label>
            {paperTemplates.map(template => <label key={template.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-[#234d80]">
              <input className="mt-1 accent-[#234d80]" aria-label={template.name} type="radio" name="starter" value={template.id}
                checked={nameDialog?.starter === template.id} onChange={() => setNameDialog(current => current && { ...current, starter: template.id })} />
              <span className="min-w-0 text-sm">
                <span className="block font-medium">{template.name}</span>
                <span className="text-muted-foreground">{template.language} · {template.id === springerTemplate.id ? 'Official ZIP import' : 'Built-in template'}</span>
              </span>
            </label>)}
            {selectedTemplate && <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm" aria-label={selectedTemplate.name + ' contents'}>
              <p>{selectedTemplate.sections.join(' · ')}</p>
              <p className="text-muted-foreground">{selectedTemplate.compileDescription}</p>
              {publisherTemplate && <a href={publisherTemplate.sourceUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[#234d80] underline underline-offset-4">
                Download the December 2024 ZIP from Springer Nature <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
              </a>}
            </div>}
          </fieldset>}
          {publisherTemplate && <input ref={templateInput} hidden type="file" accept=".zip" aria-label="Choose Springer Nature ZIP"
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              const name = nameDialog?.value.trim()
              if (file && name) void run(async () => {
                await openCopy(await importSpringerTemplate(file, name), 'write')
                setNameDialog(undefined)
              })
            }} />}
          {error && <p role="alert" className="text-sm text-red-900">{error}</p>}
          <DialogFooter><Button type="submit" disabled={busy || !nameDialog?.value.trim()}>
            {nameDialog?.id ? 'Save name' : publisherTemplate ? 'Import template ZIP' : 'Create project'}
          </Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </main>
}
