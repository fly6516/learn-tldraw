'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { editor, IPosition } from 'monaco-editor'
import { BookOpen, ChevronRight, CircleAlert, Download, FileCode2, FileText, Folder, Play, Save, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import { getFileTree, updateFileContent, type FileTreeNode } from '@/lib/project/file-system'
import { exportSourceArchive } from '@/lib/project/source-archive'
import type { ProjectFile, ProjectFileSystem } from '@/lib/project/types'
import { ChapterAiPanel } from './ChapterAiPanel'
import { ReferencesPanel } from './ReferencesPanel'
import { OutlinePanel } from './OutlinePanel'
import { checkCitations, collectBibliography } from '@/lib/project/references'
import { sourcePosition, type SourceLocation } from '@/lib/project/latex-source'
import type { SourceProblem } from './MonacoSourceEditor'
import type { CompileDiagnostic } from '@/lib/project/compile-diagnostics'

const MonacoSourceEditor = dynamic(() => import('./MonacoSourceEditor').then(module => module.MonacoSourceEditor), {
  ssr: false,
  loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Loading source editor…</p>,
})

function Files({ nodes, selected, main, onSelect, dirty }: {
  nodes: FileTreeNode[]
  selected: string
  main: string
  dirty: Record<string, string>
  onSelect: (path: string) => void
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
                <Files nodes={node.children ?? []} selected={selected} main={main} dirty={dirty} onSelect={onSelect} />
              </div>
            </details>
          ) : (
            <button type="button" title={node.path} disabled={!node.editable} aria-current={selected === node.path ? 'page' : undefined}
              onClick={() => onSelect(node.path)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-45 ${
                selected === node.path ? 'bg-indigo-100 font-semibold text-indigo-950' : 'text-slate-700 hover:bg-white'
              }`}>
              <FileText className="size-3.5 shrink-0" /><span className="truncate">{node.name}</span>
              {node.path === main && <span className="ml-auto rounded border border-indigo-200 bg-white px-1 text-[10px] text-indigo-700">Main</span>}
              {Object.hasOwn(dirty, node.path) && <span aria-label="Unsaved" className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function SourceProjectWorkspace({ project, initialFile, onClose }: {
  project: ProjectFileSystem
  initialFile?: string
  onClose: () => void
}) {
  const { setFileSystem } = useProjectFileSystem()
  const editable = useMemo(() => [...project.files.values()].filter(
    (file): file is ProjectFile => file.type === 'editable' && 'content' in file,
  ).sort((a, b) => a.path.localeCompare(b.path)), [project.files])
  const texFiles = editable.filter(file => /\.tex$/i.test(file.path))
  const main = texFiles.find(file => file.path === project.metadata.mainFile)?.path ?? texFiles[0]?.path ?? ''
  const [selected, setSelected] = useState(initialFile ?? main)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [log, setLog] = useState('')
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([])
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfFilename, setPdfFilename] = useState('')
  const [pdfStale, setPdfStale] = useState(false)
  const [panel, setPanel] = useState<'pdf' | 'problems' | 'references' | 'ai'>('pdf')
  const [navigation, setNavigation] = useState<'files' | 'outline'>('files')
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const outputRef = useRef<HTMLElement | null>(null)
  const pendingJump = useRef<{ path: string; start: IPosition; end: IPosition } | null>(null)
  const isTex = /\.tex$/i.test(selected)
  const dirty = Object.keys(drafts).length > 0
  const source = editable.find(file => file.path === selected)?.content ?? ''
  const draft = drafts[selected] ?? source
  const workingProject = useMemo(() => Object.entries(drafts).reduce(
    (current, [path, content]) => updateFileContent(current, path, content), project,
  ), [drafts, project])
  const tree = useMemo(() => getFileTree(project), [project])
  const bibliography = useMemo(() => collectBibliography(workingProject), [workingProject])
  const problems = useMemo<SourceProblem[]>(() => [
    ...diagnostics,
    ...checkCitations(workingProject, bibliography).map(issue => ({
      path: issue.path, line: issue.line, severity: 'warning' as const, location: issue,
      message: issue.kind === 'missing' ? `Unknown citation key: ${issue.key}` : `Duplicate bibliography key: ${issue.key}`,
    })),
  ], [bibliography, diagnostics, workingProject])

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  const applyPendingJump = useCallback((instance: editor.IStandaloneCodeEditor | null) => {
    editorRef.current = instance
    if (!instance) return
    requestAnimationFrame(() => {
      const pending = pendingJump.current
      const model = instance.getModel()
      if (!pending || !model?.uri.path.endsWith('/' + pending.path)) return
      pendingJump.current = null
      const start = model.validatePosition(pending.start)
      const end = model.validatePosition(pending.end)
      instance.setSelection({
        startLineNumber: start.lineNumber, startColumn: start.column,
        endLineNumber: end.lineNumber, endColumn: end.column,
      })
      instance.revealLineInCenter(start.lineNumber)
      instance.getDomNode()?.scrollIntoView({ block: 'nearest' })
      instance.focus()
    })
  }, [])

  function selectSource(path: string) {
    if (busy || !editable.some(file => file.path === path)) return
    setSelected(path)
    if (panel === 'ai' && !/\.tex$/i.test(path)) setPanel('pdf')
  }

  function jump(path: string, line: number, location?: SourceLocation) {
    if (busy || !editable.some(file => file.path === path)) return
    const file = workingProject.files.get(path)
    const text = file && 'content' in file ? file.content ?? '' : ''
    const start = location ? sourcePosition(text, location.start) : { lineNumber: line, column: 1 }
    const end = location ? sourcePosition(text, location.end) : start
    pendingJump.current = { path, start, end }
    selectSource(path)
    applyPendingJump(editorRef.current)
  }

  function locate(location: SourceLocation) {
    jump(location.path, location.line, location)
  }

  const save = useCallback(() => {
    if (!dirty || busy) return
    setFileSystem(workingProject)
    setDrafts({})
  }, [busy, dirty, setFileSystem, workingProject])

  function markSourceChanged() {
    setPdfStale(true)
    setDiagnostics([])
    setError('')
  }

  function changeDraft(value: string) {
    if (busy || value === draft) return
    setDrafts(current => {
      const next = { ...current }
      if (value === source) delete next[selected]
      else next[selected] = value
      return next
    })
    markSourceChanged()
  }

  function insertReference(key: string) {
    const instance = editorRef.current
    const range = instance?.getSelection()
    if (!instance || !range || !isTex || busy) return
    instance.pushUndoStop()
    instance.executeEdits('citation', [{ range, text: `\\cite{${key}}`, forceMoveMarkers: true }])
    instance.pushUndoStop()
    instance.focus()
  }

  async function compile() {
    if (!main || busy) return
    save()
    setBusy(true)
    setPanel('pdf')
    outputRef.current?.scrollIntoView({ block: 'nearest' })
    setError('')
    setLog('')
    setDiagnostics([])
    try {
      const archive = await exportSourceArchive(workingProject)
      const response = await fetch(`/api/latex/compile?main=${encodeURIComponent(main)}`, {
        method: 'POST', body: archive,
      })
      if (!response.ok) {
        const failure = await response.json()
        setError(failure.error)
        setLog(failure.log ?? '')
        setDiagnostics(failure.diagnostics ?? [])
        setPanel('problems')
        return
      }
      setPdfUrl(URL.createObjectURL(await response.blob()))
      setPdfFilename(main.split('/').at(-1)?.replace(/\.tex$/i, '.pdf') ?? 'project.pdf')
      setPdfStale(false)
      setPanel('pdf')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not compile the project.')
      setPanel('problems')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => {
      if (!open && !busy && (!dirty || window.confirm('Discard unsaved project edits?'))) onClose()
    }}>
      <DialogContent className="flex h-[95dvh] min-h-0 flex-col gap-0 overflow-hidden rounded-xl border-slate-200 bg-[#f6f8fc] p-0 text-slate-900 sm:max-w-[97vw]" showCloseButton={!busy}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-indigo-100 p-2 text-indigo-700"><FileCode2 className="size-5" /></div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{project.metadata.projectName}</DialogTitle>
              <DialogDescription className="text-xs">LaTeX workspace</DialogDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">Main file
              <select aria-label="Main file" className="max-w-48 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-900" value={main} disabled={busy}
                onChange={event => {
                  setFileSystem({ ...project, metadata: { ...project.metadata, mainFile: event.target.value } })
                  markSourceChanged()
                }}>
                {texFiles.map(file => <option key={file.path}>{file.path}</option>)}
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={save} disabled={!dirty || busy}><Save className="size-3.5" /> Save</Button>
            <Button size="sm" className="bg-indigo-700 text-white hover:bg-indigo-800" onClick={compile} disabled={!main || busy}>
              <Play className="size-3.5" /> {busy ? 'Compiling…' : 'Compile PDF'}
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 content-start grid-cols-1 grid-rows-[max-content_minmax(25rem,1fr)_minmax(25rem,1fr)] overflow-y-auto md:grid-cols-2 md:grid-rows-[max-content_minmax(25rem,1fr)] lg:grid-cols-[12rem_minmax(0,1.15fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[14rem_minmax(0,1.15fr)_minmax(0,1fr)]">
          <aside aria-label="Project navigation" className="flex min-h-0 flex-col border-b border-slate-200 bg-slate-50 text-sm md:col-span-2 lg:col-span-1 lg:border-r lg:border-b-0">
            <div className="flex gap-1 border-b border-slate-200 p-2">
              {(['files', 'outline'] as const).map(tab => <Button key={tab} size="sm" variant={navigation === tab ? 'secondary' : 'ghost'}
                aria-pressed={navigation === tab} onClick={() => setNavigation(tab)}>{tab === 'files' ? 'Files' : 'Outline'}</Button>)}
            </div>
            <div className="max-h-36 overflow-auto p-2 lg:max-h-none">
              {navigation === 'files'
                ? <Files nodes={tree} selected={selected} main={main} dirty={drafts} onSelect={selectSource} />
                : <OutlinePanel project={workingProject} main={main} path={selected} draft={draft} onLocate={locate} />}
            </div>
          </aside>

          <section aria-label="Source" className="flex min-h-[25rem] min-w-0 flex-col border-r border-slate-200 bg-[#fffefc] lg:min-h-0">
            <div className="flex min-w-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 text-xs">
              <FileCode2 className="size-4 shrink-0 text-indigo-600" />
              <span className="truncate font-medium" title={selected}>{selected || 'Select a source file'}</span>
              {Object.hasOwn(drafts, selected) && <span className="ml-auto shrink-0 text-amber-700">Unsaved</span>}
            </div>
            <div className="min-h-0 flex-1">
              {selected && <MonacoSourceEditor path={selected} value={draft} readOnly={busy} problems={problems}
                onChange={changeDraft} onEditor={applyPendingJump} onSave={save} />}
            </div>
          </section>

          <section ref={outputRef} aria-label="Output and tools" className="flex min-h-[25rem] min-w-0 flex-col bg-slate-100 lg:min-h-0">
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
              {([
                ['pdf', 'PDF Preview', FileText], ['problems', 'Problems', CircleAlert],
                ['references', 'References', BookOpen], ['ai', 'Chapter AI', Sparkles],
              ] as const).map(([tab, label, Icon]) => <Button key={tab} size="sm" variant={panel === tab ? 'secondary' : 'ghost'}
                className="gap-1.5" aria-pressed={panel === tab} disabled={tab === 'ai' && !isTex} onClick={() => setPanel(tab)}>
                <Icon className="size-3.5" /> {label}
                {tab === 'problems' && problems.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-900">{problems.length}</span>}
              </Button>)}
            </div>
            {panel === 'pdf' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {pdfUrl && <>
                  <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-xs">
                    <span className={pdfStale || busy ? 'text-amber-800' : 'text-slate-600'}>{busy ? 'Recompiling…' : pdfStale ? 'Previous PDF · recompile to update' : 'Latest successful compile'}</span>
                    <Button size="sm" variant="outline" asChild><a href={pdfUrl} download={pdfFilename}>
                      <Download className="size-3.5" /> Download PDF
                    </a></Button>
                  </div>
                  <iframe title="Compiled PDF" src={pdfUrl} className="min-h-0 w-full flex-1" />
                </>}
                {!pdfUrl && <div className="m-auto max-w-60 p-4 text-center">
                  <FileText className="mx-auto mb-3 size-8 text-indigo-400" />
                  <p role="status" className="text-sm text-slate-600">{busy ? 'Running the LaTeX engine…' : 'Compile the main file to preview your PDF.'}</p>
                </div>}
              </div>
            ) : <div className="min-h-0 flex-1 overflow-auto bg-white">
              {panel === 'problems' && <div className="space-y-3 p-3">
                {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}
                {!problems.length && !error && <p className="text-sm text-slate-600">No problems detected.</p>}
                <ul className="space-y-1">
                  {problems.map((problem, index) => <li key={`${problem.path}:${problem.line}:${index}`}>
                    <button type="button" onClick={() => jump(problem.path, problem.line, problem.location)}
                      disabled={busy || !editable.some(file => file.path === problem.path)}
                      className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-indigo-50 disabled:opacity-60">
                      <CircleAlert aria-hidden className={`mt-0.5 size-4 shrink-0 ${problem.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`} />
                      <span className="sr-only">{problem.severity === 'error' ? 'Compile error' : 'Warning'}</span>
                      <span className="min-w-0"><span className="block break-words text-sm">{problem.message}</span>
                        <span className="block break-all font-mono text-xs text-slate-600">{problem.path}:{problem.line}</span></span>
                    </button>
                  </li>)}
                </ul>
                {log && <details className="rounded-md border border-slate-200 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">Compiler log</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words">{log}</pre>
                </details>}
              </div>}
              {panel === 'references' && <ReferencesPanel project={workingProject} entries={bibliography} path={selected} draft={draft}
                canInsert={isTex && !busy} onInsert={insertReference} onLocate={locate} />}
              {panel === 'ai' && <ChapterAiPanel key={selected} project={workingProject} path={selected} main={main}
                source={source} draft={draft} log={log} bibliography={bibliography} disabled={busy}
                onApply={text => {
                  setFileSystem(updateFileContent(project, selected, text))
                  setDrafts(current => {
                    const next = { ...current }
                    delete next[selected]
                    return next
                  })
                  markSourceChanged()
                }} />}
            </div>}
          </section>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-1 border-t border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600">
          <span>{dirty ? `${Object.keys(drafts).length} unsaved file(s)` : 'All changes saved'}</span>
          <span>{/\.bib$/i.test(selected) ? 'BibTeX' : isTex ? 'LaTeX' : 'Plain text'} · Ctrl / ⌘ + S to save</span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
