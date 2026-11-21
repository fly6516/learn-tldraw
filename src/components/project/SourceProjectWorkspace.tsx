'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import { updateFileContent } from '@/lib/project/file-system'
import { exportSourceArchive } from '@/lib/project/source-archive'
import type { ProjectFile, ProjectFileSystem } from '@/lib/project/types'
import { ChapterAiPanel } from './ChapterAiPanel'
import { ReferencesPanel } from './ReferencesPanel'
import { OutlinePanel } from './OutlinePanel'
import { collectBibliography, editorOffset, insertCitation, sourceOffset } from '@/lib/project/references'
import type { SourceLocation } from '@/lib/project/latex-source'

export function SourceProjectWorkspace({ project, initialFile, onClose }: {
  project: ProjectFileSystem
  initialFile?: string
  onClose: () => void
}) {
  const { setFileSystem } = useProjectFileSystem()
  const editable = [...project.files.values()].filter(
    (file): file is ProjectFile => file.type === 'editable' && 'content' in file,
  ).sort((a, b) => a.path.localeCompare(b.path))
  const texFiles = editable.filter(file => /\.tex$/i.test(file.path))
  const main = texFiles.find(file => file.path === project.metadata.mainFile)?.path ?? texFiles[0]?.path ?? ''
  const [selected, setSelected] = useState(initialFile ?? main)
  const source = editable.find(file => file.path === selected)?.content ?? ''
  const [draft, setDraft] = useState(source)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [log, setLog] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [panel, setPanel] = useState<'pdf' | 'ai' | 'references' | 'outline'>('pdf')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const isTex = /\.tex$/i.test(selected)
  const dirty = draft !== source
  const bibliography = useMemo(() => collectBibliography(project, { path: selected, source: draft }), [project, selected, draft])

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }
  }, [pdfUrl])

  function saveChanges() {
    if (!dirty) return project
    const updated = updateFileContent(project, selected, draft)
    setFileSystem(updated)
    return updated
  }

  function selectSource(path: string) {
    if (path === selected) return true
    const file = editable.find(file => file.path === path)
    if (!file || (dirty && !window.confirm('Discard unsaved edits?'))) return false
    setSelected(path)
    setDraft(file.content ?? '')
    if (panel === 'ai' && !/\.tex$/i.test(path)) setPanel('pdf')
    return true
  }

  function focusSource(start: number, end: number, line?: number) {
    requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      editor.focus()
      editor.setSelectionRange(start, end)
      if (line !== undefined) {
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight)
        editor.scrollTop = Math.max(0, (line - 2) * lineHeight)
      }
    })
  }

  function locateSource(location: SourceLocation) {
    const target = location.path === selected ? draft : editable.find(file => file.path === location.path)?.content ?? ''
    if (selectSource(location.path)) {
      focusSource(editorOffset(target, location.start), editorOffset(target, location.end), location.line)
    }
  }

  function insertReference(key: string) {
    const editor = editorRef.current
    if (!editor || !isTex || busy) return
    const change = insertCitation(draft, key, sourceOffset(draft, editor.selectionStart), sourceOffset(draft, editor.selectionEnd))
    setDraft(change.source)
    setPdfUrl('')
    const caret = editorOffset(change.source, change.caret)
    focusSource(caret, caret)
  }

  async function compile() {
    setPanel('pdf')
    setBusy(true)
    setError('')
    setLog('')
    setPdfUrl('')
    try {
      const archive = await exportSourceArchive(saveChanges())
      const response = await fetch(`/api/latex/compile?main=${encodeURIComponent(main)}`, {
        method: 'POST', body: archive,
      })
      if (!response.ok) {
        const failure = await response.json()
        setError(failure.error)
        setLog(failure.log ?? '')
        return
      }
      setPdfUrl(URL.createObjectURL(await response.blob()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not compile the project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy && (!dirty || window.confirm('Discard unsaved edits?'))) onClose() }}>
      <DialogContent className="flex h-[92vh] flex-col overflow-hidden sm:max-w-[95vw]" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>LaTeX Project</DialogTitle>
          <DialogDescription>{project.metadata.projectName}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            Main file
            <select className="max-w-72 rounded border bg-background p-2" value={main} disabled={busy}
              onChange={event => {
                setFileSystem({ ...project, metadata: { ...project.metadata, mainFile: event.target.value } })
                setPdfUrl('')
              }}>
              {texFiles.map(file => <option key={file.path}>{file.path}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Edit source
            <select className="max-w-72 rounded border bg-background p-2" value={selected} disabled={busy}
              onChange={event => selectSource(event.target.value)}>
              {editable.map(file => <option key={file.path}>{file.path}</option>)}
            </select>
          </label>
          <Button variant="outline" onClick={saveChanges} disabled={!dirty || busy}>Save</Button>
          <Button variant={panel === 'outline' ? 'secondary' : 'outline'} aria-pressed={panel === 'outline'}
            disabled={busy || !main} onClick={() => setPanel(panel === 'outline' ? 'pdf' : 'outline')}>Outline</Button>
          <Button variant={panel === 'references' ? 'secondary' : 'outline'} aria-pressed={panel === 'references'}
            disabled={busy} onClick={() => setPanel(panel === 'references' ? 'pdf' : 'references')}>References</Button>
          <Button variant={panel === 'ai' ? 'secondary' : 'outline'} aria-pressed={panel === 'ai'} disabled={busy || !isTex}
            onClick={() => setPanel(panel === 'ai' ? 'pdf' : 'ai')}>Chapter AI</Button>
          <Button onClick={compile} disabled={!main || busy}>{busy ? 'Compiling…' : 'Compile PDF'}</Button>
          {pdfUrl && <Button variant="outline" asChild><a href={pdfUrl} download={main.split('/').at(-1)?.replace(/\.tex$/i, '.pdf')}>Download PDF</a></Button>}
        </div>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
          <Textarea ref={editorRef} aria-label="LaTeX source" wrap="off" value={draft} disabled={!selected || busy}
            onChange={event => { setDraft(event.target.value); setPdfUrl('') }}
            className="h-full min-h-0 resize-none font-mono" spellCheck={false} />
          {panel === 'outline' ? (
            <div className="min-h-0 overflow-auto rounded border">
              <OutlinePanel project={project} main={main} path={selected} draft={draft} onLocate={locateSource} />
            </div>
          ) : panel === 'references' ? (
            <div className="min-h-0 overflow-auto rounded border">
              <ReferencesPanel project={project} entries={bibliography} path={selected} draft={draft}
                canInsert={isTex && !busy} onInsert={insertReference} onLocate={locateSource} />
            </div>
          ) : panel === 'ai' ? (
            <div className="min-h-0 overflow-auto rounded border">
              <ChapterAiPanel key={selected} project={project} path={selected} main={main} source={source} draft={draft}
                log={log} bibliography={bibliography} disabled={busy} onApply={text => {
                  setFileSystem(updateFileContent(project, selected, text))
                  setDraft(text)
                  setPdfUrl('')
                }} />
            </div>
          ) : <div className="min-h-0 overflow-auto rounded border">
            {error && <p role="alert" className="p-3 text-destructive">{error}</p>}
            {log && <pre className="whitespace-pre-wrap break-words p-3 text-xs">{log}</pre>}
            {pdfUrl && <iframe title="Compiled PDF" src={pdfUrl} className="h-full w-full" />}
            {!pdfUrl && !error && <p role="status" className="p-3 text-sm text-muted-foreground">
              {busy ? 'Running the LaTeX engine…' : 'Compile the project to preview the PDF here.'}
            </p>}
          </div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
