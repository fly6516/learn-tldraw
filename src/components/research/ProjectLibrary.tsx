'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Archive, ArrowUpRight, BookOpen, ChevronRight, Download, FileText, FileUp, Folder, HardDrive, PanelRight, Plus, Search, Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { decodeProjectBackup, encodeProjectBackup, projectBackupExtension, projectBackupFilename } from '@/lib/project/backup'
import { downloadFile } from '@/lib/export/export-actions'
import type { PortableProjectHistory } from '@/lib/project/backup-history'
import { createDefaultProject } from '@/lib/project/file-system'
import { createTemplateProject, importSpringerTemplate, paperTemplates, springerTemplate, type PaperTemplateId } from '@/lib/project/paper-templates'
import { libraryChangesChannel, libraryProjectUrl, libraryStorageKey, type LibraryProject, type LibraryProjectState, type LibraryView, type RecoveryStatus } from '@/lib/project/project-library'
import { addLibraryProject, deleteTrashedLibraryProject, listLibraryProjects, openProjectStorage, readLibraryBackup, readRecoveryBaseline, recordProjectBackup, updateLibraryProject } from '@/lib/project/storage'
import { normalizeCanvas } from '@/lib/project/canvas-overview'
import { emptyCanvas } from '@/lib/project/research-graph'
import { importSourceArchive } from '@/lib/project/source-archive'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { PortableWritingState } from '@/lib/project/writing-drafts'
import { ResearchWorkspace } from './ResearchWorkspace'
import { BackupContents } from './BackupContents'
import { WorkbenchSetup } from '@/components/project/WorkbenchSetup'

const sections = [['active', 'Projects', Folder], ['archived', 'Archived', Archive], ['trash', 'Trash', Trash2]] as const
const openedAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : openedAt.format(date)
}

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
  const [selection, setSelection] = useState<string>()
  const [mobileDetails, setMobileDetails] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LibraryProject>()
  const fileInput = useRef<HTMLInputElement>(null)
  const templateInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const details = useRef<HTMLElement>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const deleteTrigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function focusProjectSearch(event: globalThis.KeyboardEvent) {
      const input = searchInput.current
      if (!input || input.disabled || event.defaultPrevented || event.key !== '/' || event.altKey || event.metaKey || event.ctrlKey
        || !(event.target instanceof HTMLElement) || event.target.closest('input, select, textarea, [contenteditable]')
        || document.querySelector('[role=dialog][data-state=open], [role=alertdialog][data-state=open]')) return
      event.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', focusProjectSearch)
    return () => window.removeEventListener('keydown', focusProjectSearch)
  }, [])

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
    let latest = 0
    async function refresh() {
      if (!database) return
      const request = ++latest
      try {
        const projects = await listLibraryProjects(database)
        if (active && latest === request) setCatalog(projects)
      } catch {
        if (active && latest === request) setError('The project list could not be loaded. Reload the page to try again.')
      }
    }
    void refresh()
    // Refresh open libraries without disrupting an editor in another tab.
    if (requested) return () => { active = false }
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(libraryChangesChannel)
    function onStorage(event: StorageEvent) {
      if (event.key === libraryChangesChannel) void refresh()
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') void refresh()
    }
    channel?.addEventListener('message', refresh)
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      channel?.close()
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
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
    return () => { active = false }
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
    setCatalog(current => [imported, ...(current ?? []).filter(project => project.id !== imported.id)])
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
  const selected = projects.find(project => project.id === selection) ?? projects[0]
  const recoveryStatus = selected && recovery[selected.id]
  const origin = selected?.templateOrigin
  const templateName = origin && (paperTemplates.find(template => template.id === origin.id)?.name ?? origin.id)
  const sectionTitle = sections.find(([id]) => id === section)?.[1]

  function changeState(project: LibraryProject, state: LibraryProjectState, focusList = false) {
    void run(async connection => {
      await updateLibraryProject(connection, project.id, { state })
      setCatalog(await listLibraryProjects(connection))
      setMessage(state === 'active' ? 'Project restored to Projects.' : state === 'archived' ? 'Project archived.' : 'Project moved to Trash.')
      if (focusList) requestAnimationFrame(() => {
        const next = projects.find(item => item.id !== project.id)
        const focusTarget = next ? rows.current.get(next.id) : searchInput.current
        focusTarget?.focus()
      })
    })
  }

  function selectProject(project: LibraryProject) {
    setSelection(project.id)
    setMobileDetails(true)
    if (window.matchMedia('(width < 64rem)').matches) {
      requestAnimationFrame(() => details.current?.focus())
    }
  }

  function downloadRecoveryBackup(project: LibraryProject) {
    void run(async connection => {
      const snapshot = await readLibraryBackup(connection, project.id)
      const canvas = normalizeCanvas(snapshot.project.canvas ?? emptyCanvas)
      const file = await encodeProjectBackup(canvas, snapshot.project, snapshot.writing, snapshot.history)
      await decodeProjectBackup(file)
      downloadFile(file, projectBackupFilename(snapshot.project.metadata.projectName))
      const receipt = { exportedAt: new Date().toISOString(), baseline: snapshot.baseline,
        scope: 'files and Canvas, local drafts, submissions and revisions, snapshots' }
      try {
        const key = libraryStorageKey(project.id)
        await recordProjectBackup(connection, key, receipt)
        const current = await readRecoveryBaseline(connection, key)
        setRecovery(status => ({ ...status, [project.id]: {
          receipt: current.receipt, changed: current.receipt?.baseline !== current.baseline,
        } }))
        setMessage('Recovery backup sent to the browser for download.')
      } catch {
        setMessage('Recovery backup sent for download. The export could not be recorded in local storage.')
      }
    })
  }

  function handleRowKey(event: KeyboardEvent<HTMLButtonElement>, project: LibraryProject, index: number) {
    const positions: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: projects.length - 1 }
    if (Object.hasOwn(positions, event.key)) {
      event.preventDefault()
      const next = projects[positions[event.key]]
      if (next) {
        setSelection(next.id)
        rows.current.get(next.id)?.focus()
      }
    } else if (event.key === 'Enter' && project.state === 'active') {
      event.preventDefault()
      router.push(libraryProjectUrl(project.id, project.view))
    } else if (event.key === 'F2' && project.state !== 'trash' && !busy) {
      event.preventDefault()
      setNameDialog({ id: project.id, value: project.name })
    } else if (event.key === 'Delete' && project.state !== 'trash' && !busy) {
      event.preventDefault()
      changeState(project, 'trash', true)
    }
  }
  return <main className="research-theme flex min-h-dvh flex-col bg-workbench-canvas text-workbench-ink">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-workbench-line bg-workbench-toolbar px-4 py-2.5 text-workbench-ink sm:px-5">
      <Link href="/" className="inline-flex items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4">
        <span className="grid size-7 place-items-center rounded border border-workbench-line bg-workbench-selection">
          <BookOpen aria-hidden="true" className="size-4 text-workbench-accent" />
        </span>
        Research Canvas
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="bg-workbench-accent text-white hover:bg-workbench-accent-hover" disabled={!catalog || busy}
          onClick={() => setNameDialog({ value: '', starter: 'canvas' })}><Plus /> New project</Button>
        <Button variant="outline" size="sm"
          disabled={!catalog || busy} onClick={() => fileInput.current?.click()}><FileUp /> Import project</Button>
        <WorkbenchSetup storage={storageUnavailable ? 'unavailable' : database ? 'ready' : 'checking'} />
      </div>
    </header>
    <input ref={fileInput} type="file" hidden aria-label="Choose project ZIP or backup"
      accept={`.zip,${projectBackupExtension}`} onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void importFile(file)
      }} />
    <div className="grid min-w-0 flex-1 lg:grid-cols-[11rem_minmax(0,1fr)_17rem] xl:grid-cols-[13rem_minmax(0,1fr)_20rem]">
      <aside className="min-w-0 border-b border-workbench-line bg-workbench-explorer px-3 py-3 lg:border-r lg:border-b-0 lg:px-3.5 lg:py-5" aria-label="Project explorer">
        <h2 className="mb-2 px-2 font-mono text-[11px] font-semibold tracking-[0.13em] uppercase text-workbench-muted">Explorer</h2>
        <nav className="flex flex-wrap gap-1 lg:flex-col" aria-label="Project list sections">
          {sections.map(([id, title, Icon]) => <button key={id} type="button" aria-pressed={section === id}
            className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium text-workbench-ink hover:bg-workbench-selection focus-visible:outline-2 focus-visible:outline-workbench-accent aria-pressed:bg-workbench-selection-strong aria-pressed:text-workbench-accent lg:w-full"
            onClick={() => { setSection(id); setSelection(undefined); setMobileDetails(false) }}>
            <Icon className="size-4 shrink-0" aria-hidden="true" /> {title}
            {catalog && <span aria-hidden="true" className="font-mono text-[11px] text-workbench-muted lg:ml-auto">{catalog.filter(project => project.state === id).length}</span>}
          </button>)}
        </nav>
        <div className="mt-2 flex flex-wrap gap-1 border-t border-workbench-line pt-2 lg:mt-4 lg:flex-col lg:pt-3">
          <button type="button" className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium text-workbench-ink hover:bg-workbench-selection focus-visible:outline-2 focus-visible:outline-workbench-accent disabled:opacity-50"
            disabled={!catalog || busy} onClick={() => setNameDialog({ value: '', starter: 'english-article' })}>
            <BookOpen className="size-4 shrink-0" aria-hidden="true" /> Paper templates
          </button>
          <button type="button" className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium text-workbench-ink hover:bg-workbench-selection focus-visible:outline-2 focus-visible:outline-workbench-accent disabled:opacity-50"
            disabled={!catalog || busy} onClick={() => void run(async () => {
              const { testPaperZip, testPaperName } = await import('@/lib/project/test-paper')
              const sample = await importSourceArchive(new File([await testPaperZip(true)], `${testPaperName}.zip`))
              await openCopy({ ...sample, metadata: { ...sample.metadata, writingSample: true } }, 'write')
            })}><FileText className="size-4 shrink-0" aria-hidden="true" /> Try a writing sample</button>
        </div>
      </aside>
      <section aria-label="Project index" className="min-w-0 bg-white">
        <div className="border-b border-workbench-line px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">Research projects</h1>
            {recent && <Link href={libraryProjectUrl(recent.id, recent.view)} title={recent.name}
              aria-label={recent.view === 'write' ? 'Continue writing' : 'Open recent canvas'}
              className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-sm text-sm font-medium text-workbench-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
              <span className="shrink-0">{recent.view === 'write' ? 'Continue writing' : 'Open recent canvas'}</span>
              <span className="max-w-36 truncate text-xs font-normal text-workbench-muted">· {recent.name}</span>
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>}
          </div>
          <div className="mt-4 grid gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative flex min-w-0 items-center">
              <span className="sr-only">Search projects</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-workbench-muted" />
              <Input ref={searchInput} type="search" autoComplete="off" className="min-w-0 border-workbench-line bg-workbench-panel pl-9 focus-visible:ring-workbench-accent"
                value={query} disabled={!catalog} onChange={event => setQuery(event.target.value)} placeholder="Search projects"
                onKeyDown={event => {
                  if (event.key === 'Escape' && query) { event.preventDefault(); setQuery('') }
                  if (event.key === 'ArrowDown' && selected) { event.preventDefault(); rows.current.get(selected.id)?.focus() }
                }} />
            </label>
            <label className="flex min-w-0 items-center gap-2 text-sm text-workbench-muted">
              <span>Sort by</span>
              <select className="h-9 min-w-0 flex-1 rounded-md border border-workbench-line bg-white px-2.5 focus-visible:outline-2 focus-visible:outline-workbench-accent"
                value={sort} disabled={!catalog} onChange={event => setSort(event.target.value === 'name' ? 'name' : 'recent')}>
                <option value="recent">Recently opened</option>
                <option value="name">Project name</option>
              </select>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-workbench-line bg-workbench-panel px-4 py-2 sm:px-6">
          <h2 className="text-sm font-semibold">{sectionTitle}</h2>
          {catalog && <span className="font-mono text-xs text-workbench-muted">{projects.length} {projects.length === 1 ? 'project' : 'projects'}</span>}
        </div>
        {error && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:px-6">{error}</p>}
        {message && <p role="status" className="border-b border-workbench-line px-4 py-3 text-sm text-workbench-muted sm:px-6">{message}</p>}
        {requested && catalog && <p role="status" className="px-4 py-3 text-sm text-workbench-muted sm:px-6">This project is unavailable from this browser or is in Archived or Trash.</p>}
        {!catalog && !error && <p role="status" className="px-4 py-4 text-sm text-workbench-muted sm:px-6">Opening local projects…</p>}
        {busy && <p role="status" className="px-4 py-3 text-sm text-workbench-muted sm:px-6">Updating local projects…</p>}
        {catalog && !sectionProjects.length && <div className="px-4 py-12 text-center text-workbench-muted sm:px-6">
          <Folder className="mx-auto mb-3 size-8 text-workbench-muted/75" aria-hidden="true" />
          <p className="mx-auto max-w-xs text-sm">{section === 'active' ? 'Create a project or import a LaTeX ZIP or Research Canvas backup.' : section === 'archived' ? 'No archived projects.' : 'Trash is empty.'}</p>
        </div>}
        {sectionProjects.length > 0 && !projects.length && <p role="status" className="px-4 py-8 text-center text-sm text-workbench-muted sm:px-6">
          No matching projects. <Button variant="link" className="h-auto p-0" onClick={() => { setQuery(''); searchInput.current?.focus() }}>Clear search</Button>
        </p>}
        {projects.length > 0 && <>
          <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_8.5rem_6.25rem_2.25rem] gap-2 border-b border-workbench-line px-6 py-2 font-mono text-[11px] tracking-wide uppercase text-workbench-muted sm:grid">
            <span>Project</span><span>Last opened</span><span>Backup</span><span />
          </div>
          <ul aria-label="Project list">
            {projects.map((project, index) => {
              const status = recovery[project.id]
              const backupLabel = !status ? 'Unavailable' : !status.receipt ? 'No backup' : status.changed ? 'Outdated' : 'Current'
              const isSelected = selected?.id === project.id
              const href = libraryProjectUrl(project.id, project.view)
              return <li key={project.id}
                className={`grid min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-2 border-b border-l-2 border-b-workbench-line pr-3 sm:pr-6 ${isSelected ? 'border-l-workbench-accent bg-workbench-selection' : 'border-l-transparent hover:bg-workbench-panel'}`}>
                <h3 className="min-w-0">
                  <button type="button" ref={node => { if (node) rows.current.set(project.id, node); else rows.current.delete(project.id) }}
                    tabIndex={isSelected ? 0 : -1} aria-label={project.name} aria-pressed={isSelected}
                    className="grid min-h-14 w-full min-w-0 items-center gap-2 py-2 pr-1 pl-[0.875rem] text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-workbench-accent sm:grid-cols-[minmax(0,1fr)_8.5rem_6.25rem] sm:pl-[1.375rem]"
                    onClick={() => selectProject(project)} onKeyDown={event => handleRowKey(event, project, index)}
                    onDoubleClick={project.state === 'active' ? () => router.push(href) : undefined}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      {project.view === 'write' ? <FileText className="size-4 shrink-0 text-workbench-accent" aria-hidden="true" />
                        : <Folder className="size-4 shrink-0 text-workbench-accent" aria-hidden="true" />}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold" title={project.name}>{project.name}</span>
                        <span className="block text-xs font-normal text-workbench-muted">{project.view === 'write' ? 'Writing' : 'Canvas'}</span>
                      </span>
                    </span>
                    <span className="hidden font-mono text-[11px] leading-snug font-normal text-workbench-muted sm:block">{formatDate(project.lastOpenedAt)}</span>
                    <span className={`hidden items-center gap-1.5 text-xs font-medium sm:flex ${status?.changed ? 'text-[#774b17]' : 'text-workbench-muted'}`}>
                      <span className={`size-1.5 shrink-0 rounded-full ${status?.changed ? 'bg-[#b6722c]' : status?.receipt ? 'bg-workbench-accent' : 'bg-workbench-muted/60'}`} aria-hidden="true" />{backupLabel}
                    </span>
                  </button>
                </h3>
                {project.state === 'active' && <Link href={href} aria-label={`Open ${project.name}`} title={`Open ${project.name}`}
                  className="grid size-9 place-items-center rounded-md text-workbench-accent hover:bg-workbench-selection-strong focus-visible:outline-2 focus-visible:outline-workbench-accent">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>}
                {project.state !== 'active' && <ChevronRight aria-hidden="true" className="justify-self-center size-4 text-workbench-muted/75" />}
              </li>
            })}
          </ul>
        </>}
      </section>
      <aside ref={details} tabIndex={-1} aria-label="Project details"
        className={`min-w-0 border-t border-workbench-line bg-workbench-panel focus:outline-none lg:block lg:border-t-0 lg:border-l ${mobileDetails && selected ? 'block' : 'hidden'}`}>
        <div className="flex min-h-11 items-center justify-between border-b border-workbench-line px-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><PanelRight className="size-4 text-workbench-muted" aria-hidden="true" /> Details</h2>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => {
            setMobileDetails(false)
            if (selected) rows.current.get(selected.id)?.focus()
          }}>Hide details</Button>
        </div>
        {selected ? <div className="space-y-5 p-4">
          <div>
            <p className="text-xs text-workbench-muted">{sectionTitle} / {selected.view === 'write' ? 'Writing' : 'Canvas'}</p>
            <p className="mt-1 text-xl leading-tight font-semibold break-words">{selected.name}</p>
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-y border-workbench-line py-3 text-xs">
            <dt className="text-workbench-muted">Last opened</dt><dd>{formatDate(selected.lastOpenedAt)}</dd>
            <dt className="text-workbench-muted">Template</dt><dd className="break-words">{origin ? `${templateName} · ${origin.version}` : 'None recorded'}</dd>
            <dt className="text-workbench-muted">Backup</dt><dd>
              <p>{recoveryStatus ? 'Saved on this browser' : 'Local save status unavailable'}</p>
              {recoveryStatus?.receipt ? <>
                <p className="mt-1">Last export {formatDate(recoveryStatus.receipt.exportedAt)} · {recoveryStatus.receipt.scope}</p>
                <p className={recoveryStatus.changed ? 'mt-1 text-[#774b17]' : 'mt-1'}>{recoveryStatus.changed ? 'Current project needs a complete recovery backup' : 'Complete recovery backup matches the saved project'}</p>
              </> : recoveryStatus && <p className="mt-1">No backup export recorded for this browser</p>}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => downloadRecoveryBackup(selected)}
              title="Includes files, Canvas, local drafts, submissions, revisions, and snapshots"><Download /> Download recovery backup</Button>
            {section === 'active' && <Button size="sm" className="bg-workbench-accent text-white hover:bg-workbench-accent-hover" asChild>
              <Link href={libraryProjectUrl(selected.id, selected.view)}>{selected.view === 'write' ? 'Open Writing' : 'Open Canvas'} <ArrowUpRight /></Link>
            </Button>}
            {section !== 'trash' && <Button size="sm" variant="outline" disabled={busy}
              onClick={() => setNameDialog({ id: selected.id, value: selected.name })}>Rename</Button>}
            {section === 'active' && <Button size="sm" variant="outline" disabled={busy} onClick={() => changeState(selected, 'archived')}><Archive /> Archive</Button>}
            {section !== 'active' && <Button size="sm" variant="outline" disabled={busy} onClick={() => changeState(selected, 'active')}>Restore</Button>}
            {section !== 'trash' ? <Button size="sm" variant="ghost" className="text-[#963c33] hover:text-[#963c33]"
              disabled={busy} onClick={() => changeState(selected, 'trash')}><Trash2 /> Move to Trash</Button>
              : <Button ref={deleteTrigger} size="sm" variant="outline" className="text-[#963c33] hover:text-[#963c33]"
                disabled={busy} onClick={() => { setError(''); setDeleteTarget(selected) }}><Trash2 /> Delete permanently</Button>}
          </div>
        </div> : <p className="p-4 text-sm text-workbench-muted">Select a project to see its details.</p>}
      </aside>
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-workbench-line bg-workbench-explorer px-4 py-2 font-mono text-[11px] text-workbench-muted sm:px-5">
      <span className="inline-flex items-center gap-1.5"><HardDrive className="size-3.5" aria-hidden="true" /> {storageUnavailable ? 'Storage unavailable' : database ? 'Local browser storage' : 'Opening storage'}</span>
      <span className="hidden sm:inline">/ Search · ↑ ↓ Navigate · Enter Open · F2 Rename · Del Trash</span>
    </footer>
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => { if (!open && !busy) setDeleteTarget(undefined) }}>
      <AlertDialogContent onCloseAutoFocus={event => {
        event.preventDefault()
        if (deleteTrigger.current) deleteTrigger.current.focus()
        else searchInput.current?.focus()
      }}>
        <AlertDialogTitle>Permanently delete this project?</AlertDialogTitle>
        <AlertDialogDescription>
          The local files, drafts, snapshots, and AI history for “{deleteTarget?.name}” will be deleted. This cannot be undone.
        </AlertDialogDescription>
        {error && <p role="alert" className="text-sm text-red-900">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => {
            if (!deleteTarget) return
            void run(async connection => {
              await deleteTrashedLibraryProject(connection, deleteTarget.id)
              setCatalog(await listLibraryProjects(connection))
              setDeleteTarget(undefined)
              setMessage('Project permanently deleted.')
            })
          }}>Delete permanently</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-workbench-accent">
              <input className="mt-1 accent-workbench-accent" aria-label="Blank canvas" type="radio" name="starter" value="canvas"
                checked={nameDialog?.starter === 'canvas'} onChange={() => setNameDialog(current => current && { ...current, starter: 'canvas' })} />
              <span className="min-w-0 text-sm">
                <span className="block font-medium">Blank canvas</span>
                <span className="text-muted-foreground">Map ideas and connect notes.</span>
              </span>
            </label>
            {paperTemplates.map(template => <label key={template.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-workbench-accent">
              <input className="mt-1 accent-workbench-accent" aria-label={template.name} type="radio" name="starter" value={template.id}
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
                className="inline-flex items-center gap-1 font-medium text-workbench-accent underline underline-offset-4">
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
