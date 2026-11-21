'use client'

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import type { editor, IPosition } from 'monaco-editor'
import { BookOpen, ChevronRight, CircleAlert, Download, Ellipsis, FileCode2, FileText, Folder, LocateFixed, PanelLeft, Play, Save, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import { getFileTree, updateFileContent, type FileTreeNode } from '@/lib/project/file-system'
import { exportSourceArchive } from '@/lib/project/source-archive'
import type { ProjectFile, ProjectFileSystem, ResearchNodeData } from '@/lib/project/types'
import { ChapterAiPanel } from './ChapterAiPanel'
import { ReferencesPanel } from './ReferencesPanel'
import { OutlinePanel } from './OutlinePanel'
import { checkCitations, collectBibliography } from '@/lib/project/references'
import { sourcePosition, type SourceLocation } from '@/lib/project/latex-source'
import type { SourceProblem } from './MonacoSourceEditor'
import type { CompileDiagnostic } from '@/lib/project/compile-diagnostics'
import { findPdfRegion, type SyncRegion } from '@/lib/project/source-sync'
import { applyWritingDrafts, draftConflicts, editableSource, type WritingDrafts } from '@/lib/project/writing-drafts'
import { clearWritingState, commitWritingDrafts } from '@/lib/project/storage'
import { useWritingDrafts } from './useWritingDrafts'

const MonacoSourceEditor = dynamic(() => import('./MonacoSourceEditor').then(module => module.MonacoSourceEditor), {
  ssr: false,
  loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Loading source editor…</p>,
})
const SyncedPdfPreview = dynamic(() => import('./SyncedPdfPreview').then(module => module.SyncedPdfPreview), {
  ssr: false,
  loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Loading PDF preview…</p>,
})
const WritingDraftComparison = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })

function Files({ nodes, selected, main, onSelect, dirty, sourcePaths, onSetMain }: {
  nodes: FileTreeNode[]
  selected: string
  main: string
  dirty: WritingDrafts
  onSelect: (path: string) => void
  sourcePaths: ReadonlySet<string>
  onSetMain: (path: string) => void
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map(node => (
        <li key={node.path}>
          {node.type === 'directory' ? (
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-600 hover:bg-white">
                <ChevronRight className="size-3 group-open:rotate-90" /><Folder className="size-3.5 text-indigo-500" />
                <span className="truncate">{node.name}</span>
              </summary>
              <div className="ml-3 border-l border-slate-200 pl-2">
                <Files nodes={node.children ?? []} selected={selected} main={main} dirty={dirty} onSelect={onSelect}
                  sourcePaths={sourcePaths} onSetMain={onSetMain} />
              </div>
            </details>
          ) : (
            <div className="flex min-w-0 items-center gap-0.5">
            <button type="button" title={node.path} disabled={!sourcePaths.has(node.path)} aria-current={selected === node.path ? 'true' : undefined}
              onClick={() => onSelect(node.path)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-45 ${
                selected === node.path ? 'bg-indigo-100 font-semibold text-indigo-950' : 'text-slate-700 hover:bg-white'
              }`}>
              <FileText className="size-3.5 shrink-0" /><span className="truncate">{node.name}</span>
              {node.path === main && <span className="ml-auto rounded border border-indigo-200 bg-white px-1 text-[10px] text-indigo-700">Main</span>}
              {Object.hasOwn(dirty, node.path) && <span aria-label="Unsaved" className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
            </button>
            {/\.tex$/i.test(node.path) && sourcePaths.has(node.path) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-7 shrink-0"
                  aria-label={`Actions for ${node.name}`}><Ellipsis /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem disabled={node.path === main} onSelect={() => onSetMain(node.path)}>Set as main file</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

type GenerateSource = (project: ProjectFileSystem, onNode?: (node: ResearchNodeData, line: number) => void) => string

export interface SourceWorkspaceHandle {
  openFile: (path: string, line?: number) => void
  openGeneratedNode: (node: ResearchNodeData) => void
  confirmLeave: () => boolean
  prepareReplacement: () => Promise<boolean>
}

function sameSources(previous: ProjectFileSystem['files'], current: ProjectFileSystem['files']) {
  if (previous === current) return true
  return previous.size === current.size && [...previous].every(([path, before]) => {
    const after = current.get(path)
    if (before === after) return true
    if (!after || before.type !== after.type) return false
    if (before.type === 'directory' || after.type === 'directory') return true
    return before.content !== undefined ? before.content === after.content : before.blob === after.blob && after.content === undefined
  })
}

export function SourceProjectWorkspace({ project, ref, active, actions, generateSource, onOpenCanvas }: {
  project: ProjectFileSystem
  ref: Ref<SourceWorkspaceHandle>
  active: boolean
  actions: HTMLElement | null
  generateSource?: GenerateSource
  onOpenCanvas: () => void
}) {
  const { setFileSystem, storage, storageKey, acceptStoredProject } = useProjectFileSystem()
  const journal = useWritingDrafts(storage, storageKey, project.metadata.createdAt)
  const { drafts, restoredView, recordView } = journal
  const textFiles = useMemo(() => [...project.files.values()].filter(
    (file): file is ProjectFile & { content: string } => file.type !== 'directory' && typeof file.content === 'string',
  ).sort((a, b) => a.path.localeCompare(b.path)), [project.files])
  const sourcePaths = useMemo(() => new Set(textFiles.map(file => file.path)), [textFiles])
  const texFiles = textFiles.filter(file => /\.tex$/i.test(file.path))
  const main = texFiles.find(file => file.path === project.metadata.mainFile)?.path
    ?? (generateSource && sourcePaths.has('main.tex') ? 'main.tex' : texFiles[0]?.path ?? '')
  const [selection, setSelected] = useState<string>()
  const wanted = selection ?? restoredView?.path ?? main
  const selected = sourcePaths.has(wanted) ? wanted : main
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [comparison, setComparison] = useState<string>()
  const [error, setError] = useState('')
  const [log, setLog] = useState('')
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([])
  const [diagnosticSources, setDiagnosticSources] = useState<ProjectFileSystem['files']>()
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfFilename, setPdfFilename] = useState('')
  const [lastCompile, setLastCompile] = useState<{ main: string; files: ProjectFileSystem['files'] }>()
  const [sourceMap, setSourceMap] = useState<SyncRegion[]>([])
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfTarget, setPdfTarget] = useState<SyncRegion | null>(null)
  const [syncMessage, setSyncMessage] = useState('')
  const [panel, setPanel] = useState<'problems' | 'references' | 'ai' | null>(null)
  const [navigation, setNavigation] = useState<'files' | 'outline'>('files')
  const [narrowView, setNarrowView] = useState<'source' | 'pdf'>('source')
  const [mobileFiles, setMobileFiles] = useState(false)
  const [desktopFiles, setDesktopFiles] = useState(true)
  const navPanel = useRef<ImperativePanelHandle>(null)
  const fileToggle = useRef<HTMLButtonElement>(null)
  const firstFileTab = useRef<HTMLButtonElement>(null)
  const compileRequest = useRef<AbortController | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const restoredCursor = useRef(false)
  const writeInProgress = useRef(false)
  const pendingJump = useRef<{ path: string; range?: { start: IPosition; end: IPosition } } | null>(null)
  const isTex = /\.tex$/i.test(selected)
  const draftPaths = Object.keys(drafts)
  const dirty = draftPaths.length > 0
  const conflicts = useMemo(() => draftConflicts(project, drafts), [project, drafts])
  const unprotected = journal.pending > 0 || (dirty && (journal.loadError || journal.failed.size > 0))
  const locked = busy || writing || !journal.ready
  const currentFile = textFiles.find(file => file.path === selected)
  const readOnly = currentFile?.type !== 'editable' || !currentFile.metadata?.editable || conflicts.includes(selected)
  const withGeneratedSource = useCallback((next: ProjectFileSystem) => {
    const generated = next.files.get('main.tex')
    if (!generateSource || generated?.type !== 'generated') return next
    const source = generateSource(next)
    return source === generated.content ? next : updateFileContent(next, 'main.tex', source)
  }, [generateSource])
  const workingProject = useMemo(() => withGeneratedSource(applyWritingDrafts(project, drafts)), [drafts, project, withGeneratedSource])
  const source = currentFile?.content ?? ''
  const workingFile = workingProject.files.get(selected)
  const draft = workingFile && 'content' in workingFile ? workingFile.content ?? '' : ''
  const pdfStale = Boolean(lastCompile && (lastCompile.main !== main || !sameSources(lastCompile.files, workingProject.files)))
  const tree = useMemo(() => getFileTree(project), [project])
  const bibliography = useMemo(() => collectBibliography(workingProject), [workingProject])
  const currentDiagnostics = useMemo(() => diagnostics.filter(issue => {
    const file = workingProject.files.get(issue.path)
    const original = diagnosticSources?.get(issue.path)
    return file && original && 'content' in file && 'content' in original
      && typeof file.content === 'string' && file.content === original.content
      && issue.line <= file.content.split(/\r\n|\n|\r/).length
  }), [diagnostics, diagnosticSources, workingProject.files])
  const problems = useMemo<SourceProblem[]>(() => [
    ...currentDiagnostics,
    ...checkCitations(workingProject, bibliography).map(issue => ({
      path: issue.path, line: issue.line, severity: 'warning' as const, location: issue,
      message: issue.kind === 'missing' ? `Unknown citation key: ${issue.key}` : `Duplicate bibliography key: ${issue.key}`,
    })),
  ], [bibliography, currentDiagnostics, workingProject])

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  useEffect(() => () => compileRequest.current?.abort(), [])

  useEffect(() => {
    if (mobileFiles && active) firstFileTab.current?.focus()
  }, [mobileFiles, active])

  useEffect(() => {
    if (!unprotected || !journal.ready) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unprotected, journal.ready])

  const captureCursor = useCallback((path: string, position: IPosition) => recordView({ path, ...position }), [recordView])

  const applyPendingJump = useCallback((instance: editor.IStandaloneCodeEditor | null) => {
    editorRef.current = instance
    if (!instance) return
    requestAnimationFrame(() => {
      const pending = pendingJump.current
      const model = instance.getModel()
      if (!model) return
      if (!pending) {
        if (!restoredCursor.current && restoredView && model.uri.path.endsWith('/' + restoredView.path)) {
          restoredCursor.current = true
          const position = model.validatePosition(restoredView)
          instance.setPosition(position)
          instance.revealLineInCenter(position.lineNumber)
        }
        return
      }
      if (!model.uri.path.endsWith('/' + pending.path)) return
      restoredCursor.current = true
      pendingJump.current = null
      if (pending.range) {
        const start = model.validatePosition(pending.range.start)
        const end = model.validatePosition(pending.range.end)
        instance.setSelection({
          startLineNumber: start.lineNumber, startColumn: start.column,
          endLineNumber: end.lineNumber, endColumn: end.column,
        })
        instance.revealLineInCenter(start.lineNumber)
      }
      const position = instance.getPosition()
      if (position) captureCursor(pending.path, position)
      instance.focus()
    })
  }, [captureCursor, restoredView])

  function openFile(path: string, line?: number, location?: SourceLocation, selectLine = false) {
    if (!sourcePaths.has(path)) return
    const file = workingProject.files.get(path)
    setSelected(path)
    setMobileFiles(false)
    setNarrowView('source')
    if (!/\.tex$/i.test(path) || file?.type !== 'editable' || !file.metadata?.editable) {
      setPanel(current => current === 'ai' ? null : current)
    }
    const text = file && 'content' in file ? file.content ?? '' : ''
    const start = location ? sourcePosition(text, location.start) : line === undefined ? undefined : { lineNumber: line, column: 1 }
    const end = location ? sourcePosition(text, location.end)
      : start && (selectLine ? { ...start, column: Number.MAX_SAFE_INTEGER } : start)
    pendingJump.current = { path, range: start && end ? { start, end } : undefined }
    applyPendingJump(editorRef.current)
  }

  function confirmDiscard() {
    return !dirty || window.confirm('Discard unsaved edits to project files?')
  }

  useImperativeHandle(ref, () => ({
    openFile,
    confirmLeave: () => !unprotected || window.confirm('Some drafts have not been saved locally. Leave this page?'),
    async prepareReplacement() {
      if (writeInProgress.current || !journal.ready || !confirmDiscard()) return false
      try {
        await journal.storedDrafts()
        if (storage && journal.key) await clearWritingState(storage, journal.key)
        return true
      } catch {
        setSaveError('Local drafts could not be cleared. The project was kept.')
        return false
      }
    },
    openGeneratedNode(node) {
      let line: number | undefined
      generateSource?.(workingProject, (candidate, position) => {
        if (candidate === node) line = position
      })
      if (line !== undefined) openFile('main.tex', line)
    },
  }))

  function locate(location: SourceLocation) {
    openFile(location.path, location.line, location)
  }

  const canSync = !locked && !pdfStale && sourceMap.length > 0

  function showInPdf() {
    const line = editorRef.current?.getPosition()?.lineNumber
    if (!line || !canSync) return
    const target = findPdfRegion(sourceMap, selected, line)
    if (target) {
      setPdfPage(target.page)
      setPdfTarget({ ...target })
      setSyncMessage(target.line === line ? `Source line ${line} · PDF page ${target.page}`
        : `Nearest typeset line ${target.line} · PDF page ${target.page}`)
    } else {
      setSyncMessage('The selected file has no mapped content in this PDF.')
    }
    setNarrowView('pdf')
  }

  function showInSource(location: SyncRegion | undefined) {
    if (!location) {
      setSyncMessage('No source location here. Click closer to the typeset content.')
      return
    }
    setPdfTarget(null)
    setSyncMessage(`${location.path}:${location.line}`)
    openFile(location.path, location.line)
  }

  const changePdfPage = useCallback((page: number) => {
    setPdfPage(page)
    setPdfTarget(null)
    setSyncMessage('')
  }, [])

  async function commitDrafts(entries: WritingDrafts) {
    if (!Object.keys(entries).length) return workingProject
    if (writeInProgress.current || !journal.ready) return
    writeInProgress.current = true
    setWriting(true)
    setSaveError('')
    try {
      if (!storage || !journal.key) throw new Error('Project storage is unavailable. Keep this tab open to retain your edits.')
      const stored = await journal.storedDrafts()
      const result = await commitWritingDrafts(storage, journal.key, project, entries, stored)
      acceptStoredProject(result.project, project)
      if (result.conflicts.length) {
        setComparison(result.conflicts[0])
        return
      }
      journal.forget(Object.keys(entries))
      return result.project
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the project.')
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function save() {
    if (locked || !dirty) return
    if (conflicts.length) setComparison(conflicts[0])
    else await commitDrafts(drafts)
  }

  function markSourceChanged() {
    setPdfTarget(null)
    setSyncMessage('')
    setDiagnostics([])
    setDiagnosticSources(undefined)
    setError('')
  }

  function changeDraft(value: string) {
    if (locked || readOnly || value === draft) return
    const base = Object.hasOwn(drafts, selected) ? drafts[selected].base : source
    journal.change(selected, value === source ? undefined : { base, text: value })
    markSourceChanged()
  }

  function insertReference(key: string) {
    const instance = editorRef.current
    const range = instance?.getSelection()
    if (!instance || !range || !isTex || readOnly || locked || !instance.getModel()?.uri.path.endsWith('/' + selected)) return
    setNarrowView('source')
    instance.pushUndoStop()
    instance.executeEdits('citation', [{ range, text: `\\cite{${key}}`, forceMoveMarkers: true }])
    instance.pushUndoStop()
    requestAnimationFrame(() => instance.focus())
  }

  function setMain(path: string) {
    if (locked) return
    setFileSystem(current => current ? { ...current, metadata: { ...current.metadata, mainFile: path } } : current)
    markSourceChanged()
  }

  async function discard(paths: string[]) {
    if (locked) return
    setWriting(true)
    await journal.discard(paths)
    setWriting(false)
    markSourceChanged()
  }

  async function compile() {
    if (!main || locked || compileRequest.current) return
    if (conflicts.length) {
      setComparison(conflicts[0])
      return
    }
    const controller = new AbortController()
    compileRequest.current = controller
    setBusy(true)
    setSyncMessage('')
    setError('')
    setLog('')
    setDiagnostics([])
    setDiagnosticSources(undefined)
    try {
      const saved = await commitDrafts(drafts)
      if (!saved || controller.signal.aborted) return
      const compiledProject = withGeneratedSource(saved)
      const archive = await exportSourceArchive(compiledProject)
      const response = await fetch(`/api/latex/compile?main=${encodeURIComponent(main)}&sync=1`, {
        method: 'POST', body: archive, signal: controller.signal,
      })
      if (!response.ok) {
        const failure = await response.json()
        setError(failure.error)
        setLog(failure.log ?? '')
        setDiagnostics(failure.diagnostics ?? [])
        setDiagnosticSources(compiledProject.files)
        setPanel('problems')
        return
      }
      const result = await response.formData()
      if (controller.signal.aborted) return
      const pdf = result.get('pdf')
      if (!(pdf instanceof Blob)) throw new Error('The compiler did not return a PDF.')
      const map = result.get('sourceMap')
      setSourceMap(typeof map === 'string' ? JSON.parse(map) : [])
      setPdfTarget(null)
      setPdfUrl(URL.createObjectURL(pdf))
      setPdfFilename(main.split('/').at(-1)?.replace(/\.tex$/i, '.pdf') ?? 'project.pdf')
      setLastCompile({ main, files: compiledProject.files })
      setNarrowView('pdf')
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Could not compile the project.')
      setPanel('problems')
    } finally {
      compileRequest.current = null
      setBusy(false)
    }
  }

  function closeMobileFiles(restoreFocus = false) {
    setMobileFiles(false)
    if (restoreFocus) fileToggle.current?.focus()
  }

  const comparedDraft = comparison && Object.hasOwn(drafts, comparison) ? drafts[comparison] : undefined
  const comparedSource = comparison ? editableSource(project, comparison) : undefined
  const draftStatus = !journal.ready ? 'Restoring local drafts…'
    : journal.pending ? 'Saving drafts on this device…'
      : journal.failed.size || (dirty && journal.loadError) ? 'Some local drafts could not be saved'
        : dirty ? `${draftPaths.length} local draft${draftPaths.length === 1 ? '' : 's'} · Not saved to project`
          : 'All changes saved to project'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f6f8fc] text-slate-900">
      {actions && createPortal(<>
        <div className="mr-auto min-w-0 text-xs md:mr-0 md:text-right" title={main}>
          <span className="block text-slate-500">Main file</span>
          <span className="block truncate font-mono font-medium min-[385px]:hidden">{main.split('/').at(-1) || 'None'}</span>
          <span className="hidden max-w-56 truncate font-mono font-medium min-[385px]:block">{main || 'None'}</span>
        </div>
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || locked}><Save /> {writing ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" className="bg-indigo-700 text-white hover:bg-indigo-800" onClick={compile} disabled={!main || locked}>
          <Play /> {busy ? 'Compiling…' : 'Compile PDF'}
        </Button>
      </>, actions)}
      {conflicts.length > 0 && <div className="max-h-24 shrink-0 overflow-auto border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950">
        <p role="status" className="font-medium">Project source changed since these drafts were created. Compare before saving or compiling.</p>
        <ul className="flex flex-wrap gap-x-4">
          {conflicts.map(path => <li key={path}><button className="break-all text-left underline" onClick={() => setComparison(path)}>
            Compare {path}
          </button></li>)}
        </ul>
      </div>}
      {saveError && <p role="alert" className="shrink-0 border-b bg-red-50 px-3 py-1.5 text-sm text-red-900">{saveError}</p>}
      <div className="flex shrink-0 items-center gap-2 border-b bg-white px-2 py-1.5 lg:hidden">
        <Button ref={fileToggle} size="sm" variant="outline" aria-expanded={mobileFiles} aria-controls="writing-files"
          onClick={() => setMobileFiles(open => !open)}><PanelLeft /> Files</Button>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5" aria-label="Writing pane" role="group">
          {(['source', 'pdf'] as const).map(pane => <Button key={pane} size="sm"
            variant={narrowView === pane ? 'outline' : 'ghost'} aria-pressed={narrowView === pane}
            onClick={() => { setNarrowView(pane); setMobileFiles(false) }}>{pane === 'source' ? 'Source' : 'PDF'}</Button>)}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {mobileFiles && <div className="absolute inset-0 z-10 bg-slate-900/25 lg:hidden" onClick={() => closeMobileFiles(true)} />}
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel id="writing-navigation" order={1} ref={navPanel} defaultSize={19} minSize={13} maxSize={35} collapsible
            onCollapse={() => setDesktopFiles(false)} onExpand={() => setDesktopFiles(true)}
            className={mobileFiles
              ? 'max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:w-64 max-lg:max-w-[85%] max-lg:!flex-none max-lg:shadow-lg'
              : 'hidden lg:block'}>
            <aside id="writing-files" aria-label="Project navigation"
              className={'flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 text-sm ' + (desktopFiles ? '' : 'lg:hidden')}
              onKeyDown={event => { if (event.key === 'Escape' && mobileFiles) closeMobileFiles(true) }}>
              <div className="flex shrink-0 items-center gap-1 border-b p-2">
                {(['files', 'outline'] as const).map(tab => <Button key={tab} ref={tab === 'files' ? firstFileTab : undefined}
                  size="sm" variant={navigation === tab ? 'secondary' : 'ghost'}
                  aria-pressed={navigation === tab} onClick={() => setNavigation(tab)}>{tab === 'files' ? 'Files' : 'Outline'}</Button>)}
                <Button size="icon-sm" variant="ghost" aria-label="Close file navigation" className="ml-auto lg:hidden"
                  onClick={() => closeMobileFiles(true)}><X /></Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {navigation === 'files'
                  ? <Files nodes={tree} selected={selected} main={main} dirty={drafts} sourcePaths={sourcePaths}
                      onSelect={openFile} onSetMain={setMain} />
                  : <OutlinePanel project={workingProject} main={main} path={selected} draft={draft} onLocate={locate} />}
              </div>
            </aside>
          </ResizablePanel>
          <ResizableHandle className="hidden lg:flex" />
          <ResizablePanel id="writing-source" order={2} defaultSize={44} minSize={28}
            className={narrowView === 'source' ? '' : 'hidden lg:block'}>
            <section aria-label="Source editor" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#fffefc]">
              <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-white px-2 py-1.5 text-xs sm:px-3">
                <Button size="icon-sm" variant="ghost" aria-label={desktopFiles ? 'Collapse file navigation' : 'Expand file navigation'}
                  aria-expanded={desktopFiles} aria-controls="writing-files" className="hidden lg:inline-flex"
                  onClick={() => desktopFiles ? navPanel.current?.collapse() : navPanel.current?.expand()}><PanelLeft /></Button>
                <FileCode2 className="size-4 shrink-0 text-indigo-600" />
                <span className="min-w-0 flex-1 truncate font-medium" title={selected}>{selected || 'Select a source file'}</span>
                <Button size="sm" variant="outline" disabled={!isTex || !canSync} onClick={showInPdf}
                  title={canSync ? 'Find the editor cursor in the compiled PDF' : 'Compile the current source to enable positioning'}>
                  <LocateFixed /> Show in PDF
                </Button>
              </div>
              {currentFile?.type === 'generated' && <div className="flex shrink-0 flex-wrap items-center gap-x-2 border-b border-indigo-100 bg-indigo-50 px-3 py-1 text-xs text-indigo-950">
                Generated from the active canvas page · Read-only
                <Button variant="link" size="sm" className="h-7 px-1 text-indigo-700" onClick={onOpenCanvas}>Edit in Canvas</Button>
              </div>}
              <div className="min-h-0 flex-1">
                {!journal.ready && <p role="status" className="p-3 text-sm">Restoring local drafts…</p>}
                {selected && journal.ready && <MonacoSourceEditor path={selected} value={draft} readOnly={locked || readOnly} problems={problems}
                  onChange={changeDraft} onEditor={applyPendingJump} onSave={save} onCursor={captureCursor} />}
              </div>
            </section>
          </ResizablePanel>
          <ResizableHandle withHandle className="hidden lg:flex" />
          <ResizablePanel id="writing-pdf" order={3} defaultSize={37} minSize={24}
            className={narrowView === 'pdf' ? '' : 'hidden lg:block'}>
            <section aria-label="PDF Preview" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-slate-100">
              <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b bg-white px-3 py-1.5 text-xs">
                <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-indigo-600" /> PDF Preview</h2>
                {pdfUrl && <Button size="sm" variant="outline" asChild><a href={pdfUrl} download={pdfFilename}><Download /> Download PDF</a></Button>}
              </div>
              {pdfUrl ? <>
                <div className="shrink-0 border-b bg-white px-3 py-1.5 text-xs">
                  <p className={pdfStale ? 'font-medium text-amber-800' : 'text-slate-600'}>
                    Last successful compile{pdfStale ? ' · Out of date' : ' · Up to date'}{busy ? ' · Compiling…' : ''}
                  </p>
                  <p role="status" className="break-words text-slate-600">
                    {busy ? 'Updating PDF…' : pdfStale ? 'Recompile to restore source and PDF navigation.'
                      : syncMessage || (canSync ? 'Click PDF content to find its source.' : 'This PDF has no source locations.')}
                  </p>
                </div>
                <SyncedPdfPreview key={pdfUrl} url={pdfUrl} page={pdfPage} regions={canSync ? sourceMap : []}
                  target={pdfStale ? null : pdfTarget} onLocate={showInSource}
                  onPage={changePdfPage} />
              </> : <div className="m-auto max-w-64 p-4 text-center">
                <FileText className="mx-auto mb-3 size-8 text-indigo-400" />
                <p role="status" className="text-sm text-slate-600">{busy ? 'Running the LaTeX engine…' : 'Compile the main file to preview your PDF.'}</p>
              </div>}
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <section aria-label="Writing tools" className="flex min-h-0 max-h-[42%] shrink-0 flex-col border-t bg-white [@media(max-height:550px)]:max-h-[32%]">
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 px-1.5 py-1 sm:gap-1 sm:px-2">
          {([
            ['problems', 'Problems', CircleAlert], ['references', 'References', BookOpen], ['ai', 'Chapter AI', Sparkles],
          ] as const).map(([tab, label, Icon]) => <Button key={tab} size="sm" variant={panel === tab ? 'secondary' : 'ghost'}
            className="gap-1 px-1.5 text-xs sm:gap-1.5 sm:px-3 sm:text-sm" aria-expanded={panel === tab} aria-controls="writing-tools-content" disabled={tab === 'ai' && (!isTex || readOnly)}
            onClick={() => setPanel(current => current === tab ? null : tab)}>
            <Icon className="hidden sm:block" /> {label}
            {tab === 'problems' && (problems.length > 0 || error) && <span className={currentDiagnostics.some(problem => problem.severity === 'error') || error
              ? 'rounded-full bg-red-100 px-1.5 text-xs text-red-900' : 'rounded-full bg-amber-100 px-1.5 text-xs text-amber-900'}>
              {problems.length || 'Failed'}
            </span>}
          </Button>)}
          {panel && <Button size="icon-sm" variant="ghost" aria-label="Collapse writing tools" className="ml-auto"
            onClick={() => setPanel(null)}><X /></Button>}
        </div>
        <div id="writing-tools-content" hidden={!panel} className={panel ? 'h-[min(34dvh,20rem)] min-h-0 overflow-auto border-t' : undefined}>
          {panel === 'problems' && <div className="space-y-3 p-3">
            {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}
            {!problems.length && !error && <p className="text-sm text-slate-600">No problems detected.</p>}
            <ul className="space-y-1">
              {problems.map((problem, index) => <li key={[problem.path, problem.line, index].join(':')}>
                <button type="button" onClick={() => openFile(problem.path, problem.line, problem.location, true)}
                  disabled={!sourcePaths.has(problem.path)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-indigo-50 disabled:opacity-60">
                  <CircleAlert aria-hidden className={'mt-0.5 size-4 shrink-0 ' + (problem.severity === 'error' ? 'text-red-600' : 'text-amber-600')} />
                  <span className="sr-only">{problem.severity === 'error' ? 'Compile error' : 'Warning'}</span>
                  <span className="min-w-0"><span className="block break-words text-sm">{problem.message}</span>
                    <span className="block break-all font-mono text-xs text-slate-600">{problem.path}:{problem.line}</span></span>
                </button>
              </li>)}
            </ul>
            {log && <details className="rounded-md border p-2 text-xs" open={!currentDiagnostics.length && Boolean(error)}>
              <summary className="cursor-pointer font-medium">Compiler log</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{log}</pre>
            </details>}
          </div>}
          {panel === 'references' && <ReferencesPanel project={workingProject} entries={bibliography} path={selected} draft={draft}
            canInsert={isTex && !readOnly && !locked} onInsert={insertReference} onLocate={locate} />}
          {panel === 'ai' && isTex && !readOnly && <ChapterAiPanel key={selected} project={workingProject} path={selected} main={main}
            source={source} draft={draft} log={log} bibliography={bibliography} disabled={locked}
            onApply={text => {
              const entry = { base: source, text }
              journal.change(selected, entry)
              void commitDrafts({ [selected]: entry })
              markSourceChanged()
            }} />}
        </div>
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-t bg-white px-3 py-1 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <span role="status" className={dirty ? 'font-medium text-amber-800' : undefined}>
            {draftStatus}
          </span>
          {dirty && <Button variant="link" size="sm" className="h-6 px-0 text-slate-600" onClick={() => {
            if (confirmDiscard()) void discard(draftPaths)
          }} disabled={locked}>Discard drafts</Button>}
        </div>
        <span>{/\.bib$/i.test(selected) ? 'BibTeX' : isTex ? 'LaTeX' : 'Plain text'} · Ctrl / ⌘ + S to save</span>
      </footer>
      {comparison && comparedDraft && <Dialog open onOpenChange={open => { if (!open) setComparison(undefined) }}>
        <DialogContent className="flex h-[85dvh] min-h-0 flex-col sm:max-w-[90vw]">
          <DialogTitle>Compare local draft</DialogTitle>
          <DialogDescription className="break-all">{comparison}. {comparedSource === undefined
            ? 'This file is missing or no longer editable. Copy the local text before discarding it.'
            : 'The project file changed after this draft was created. Choosing the draft keeps it local until you save.'}</DialogDescription>
          <div className="grid grid-cols-2 gap-2 text-sm font-medium"><span>Current project source</span><span>Local draft</span></div>
          <div className="min-h-0 flex-1 overflow-hidden rounded border">
            <WritingDraftComparison path={comparison} original={comparedSource ?? ''} modified={comparedDraft.text} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={locked} onClick={async () => {
              await discard([comparison])
              setComparison(undefined)
            }}>Discard local draft</Button>
            <Button disabled={locked || comparedSource === undefined} onClick={() => {
              if (comparedSource === undefined) return
              journal.change(comparison, { base: comparedSource, text: comparedDraft.text })
              setComparison(undefined)
              openFile(comparison)
            }}>Keep local draft</Button>
          </div>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
