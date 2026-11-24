'use client'

import { useEffect, useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { applyProjectEdits, buildChapterContext, maxChapterLength, projectAnswerSchema, type ChapterEditRequest } from '@/lib/project/ai-edit'
import { collectBibliography, findNewUnknownCitations } from '@/lib/project/references'
import type { ProjectFileSystem } from '@/lib/project/types'
import { editableSource, type WritingDrafts } from '@/lib/project/writing-drafts'

type Result = ReturnType<typeof projectAnswerSchema.parse>
type Run = { main: string; result: Result; files: ProjectFileSystem['files']; saved: ProjectFileSystem['files'] }

function sourceAt(files: ProjectFileSystem['files'], path: string) {
  const file = files.get(path)
  return file && 'content' in file ? file.content : undefined
}

export function ProjectAiPanel({ project, saved, main, compiler, conflicts, disabled, onLocate, onApply }: {
  project: ProjectFileSystem; saved: ProjectFileSystem; main: string; compiler: ChapterEditRequest['compiler']
  conflicts: readonly string[]; disabled: boolean; onLocate: (path: string, line: number) => void
  onApply: (edits: WritingDrafts) => Promise<void>
}) {
  const [paths, setPaths] = useState<string[]>([])
  const [instruction, setInstruction] = useState('')
  const [run, setRun] = useState<Run>()
  const [selectedEdits, setSelectedEdits] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const candidates = [...project.files.values()].filter(file => file.type === 'editable' && file.metadata?.editable
    && /\.tex$/i.test(file.path) && Boolean(file.content?.trim()) && file.content!.length <= maxChapterLength && !conflicts.includes(file.path))
    .map(file => file.path).sort()
  const eligible = paths.filter(path => candidates.includes(path))
  const selected = run?.result.edits.filter((_, index) => selectedEdits.includes(index)) ?? []
  const stale = run && (run.main !== main || selected.some(({ path }) => !candidates.includes(path)
    || sourceAt(run.files, path) !== sourceAt(project.files, path) || sourceAt(run.saved, path) !== editableSource(saved, path)))
  const originals = new Map((run?.result.edits ?? []).map(({ path }) => [path, sourceAt(run!.files, path) ?? '']))
  const previews = run && applyProjectEdits(originals, selected)
  const bibliography = run && previews?.size ? collectBibliography(project) : []
  const unknown = previews ? [...previews].flatMap(([path, text]) => findNewUnknownCitations(path, originals.get(path)!, text, bibliography)) : []

  async function generate(mode: 'project-review' | 'project-rewrite') {
    if (busy || disabled || eligible.length < 2) return
    const controller = new AbortController()
    request.current = controller
    const [path] = eligible
    const source = editableSource(project, path)
    if (!source) return
    setRun(undefined); setSelectedEdits([]); setError(''); setStatus(''); setBusy(true)
    try {
      const response = await fetch('/api/latex/suggest', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, path, main, source, instruction, compiler,
          projectPaths: eligible, context: buildChapterContext(project, path, main, eligible) } satisfies ChapterEditRequest) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not request a project suggestion.')
      const result = projectAnswerSchema.parse(data)
      applyProjectEdits(new Map(eligible.map(path => [path, editableSource(project, path)!])), result.edits)
      if (!controller.signal.aborted) setRun({ main, result, files: project.files, saved: saved.files })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not request a project suggestion.')
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false) }
    }
  }

  async function apply() {
    if (!previews?.size || stale || disabled || busy) return
    setError('')
    setBusy(true)
    try {
      const entries = Object.fromEntries([...previews].map(([path, text]) => [path, { base: sourceAt(run!.saved, path)!, text }]))
      await onApply(entries)
      setRun(undefined); setSelectedEdits([]); setStatus(`Applied to ${previews.size} local ${previews.size === 1 ? 'draft' : 'drafts'}.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply selected edits.') }
    finally { setBusy(false) }
  }

  return <section aria-label="Project AI" className="space-y-3 p-3 text-sm">
    <fieldset disabled={busy} className="space-y-1">
      <legend className="font-medium">LaTeX files for this run</legend>
      <p className="text-xs text-slate-600">Select two to six files. The provider receives the initial chapter and the project excerpts it requests.</p>
      {[...project.files.values()].some(file => file.type === 'editable' && /\.tex$/i.test(file.path)
        && (file.content?.length ?? 0) > maxChapterLength) && <p className="text-xs text-slate-600">
        Use Writing AI to work on a passage in a long file.
      </p>}
      <div className="max-h-32 space-y-1 overflow-auto rounded border p-2">
        {candidates.map(path => <label key={path} className="flex items-start gap-2 break-all"><input type="checkbox" className="mt-1"
          checked={eligible.includes(path)} disabled={!eligible.includes(path) && eligible.length >= 6}
          onChange={event => setPaths(event.target.checked ? [...eligible, path] : eligible.filter(item => item !== path))} />{path}</label>)}
        {!candidates.length && <p>No editable LaTeX files available.</p>}
      </div>
    </fieldset>
    <label className="grid gap-1">Project instruction (optional)<Textarea value={instruction} maxLength={1000}
      disabled={busy} onChange={event => setInstruction(event.target.value)} /></label>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={() => void generate('project-review')} disabled={busy || disabled || eligible.length < 2}>Review files</Button>
      <Button size="sm" variant="outline" onClick={() => void generate('project-rewrite')} disabled={busy || disabled || eligible.length < 2}>Propose edits</Button>
      {busy && !run && <Button size="sm" variant="ghost" onClick={() => request.current?.abort()}>Cancel request</Button>}
    </div>
    {busy && <p role="status">Working on the selected files…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {run && <section aria-label="Project proposal" className="space-y-2 border-t pt-2">
      <h3 className="font-semibold">Project proposal</h3>
      <p className="whitespace-pre-wrap break-words">{run.result.summary}</p>
      {!run.result.findings.length && <p className="text-xs text-slate-600">No findings with verified source locations were returned.</p>}
      {run.result.findings.length > 0 && <ul className="space-y-2">
        {run.result.findings.map((item, index) => <li key={index} className="rounded border p-2">
          <p>{item.message}</p>
          {item.locations.map(({ path, line }) => <button type="button" key={`${path}:${line}`} className="block break-all text-left text-xs underline disabled:no-underline"
            disabled={sourceAt(run.files, path) !== sourceAt(project.files, path)} onClick={() => onLocate(path, line)}>{path}:{line}</button>)}
        </li>)}
      </ul>}
      {run.result.edits.length > 0 && <fieldset disabled={busy} className="space-y-2">
        <legend className="font-medium">Select changes to apply</legend>
        {[...new Set(run.result.edits.map(edit => edit.path))].map(path => <div key={path} className="space-y-1">
          <h4 className="break-all font-medium">{path}</h4>
          {run.result.edits.map((edit, index) => edit.path === path && <div key={index} className="overflow-hidden rounded border text-xs">
            <label className="flex items-center gap-2 p-2"><input type="checkbox" checked={selectedEdits.includes(index)}
              onChange={event => setSelectedEdits(previous => event.target.checked ? [...previous, index] : previous.filter(item => item !== index))} />
              Apply change {index + 1} to {path}</label>
            <pre className="whitespace-pre-wrap break-words bg-red-50 p-2 text-red-950">{edit.before}</pre>
            <pre className="whitespace-pre-wrap break-words bg-green-50 p-2 text-green-950">{edit.after || '(Removed)'}</pre>
          </div>)}
        </div>)}
      </fieldset>}
      {unknown.length > 0 && <ul role="alert" className="rounded border border-amber-300 p-2 text-amber-900">
        {unknown.map(item => <li key={`${item.path}:${item.start}`}>Unknown citation {item.key} · {item.path}:{item.line}</li>)}
      </ul>}
      {stale && <p role="status" className="text-amber-800">The selected source or main file changed. Request a new proposal.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRun(undefined)}>Discard proposal</Button>
        {run.result.edits.length > 0 && <Button size="sm" disabled={busy || disabled || Boolean(stale) || !previews?.size} onClick={() => void apply()}>Apply selected to drafts</Button>}
      </div>
    </section>}
  </section>
}
