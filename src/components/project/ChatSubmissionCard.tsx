'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { readSubmissionFiles, saveSubmissionVersion } from '@/lib/project/storage'
import { prepareSubmission, type SubmissionBuild, type SubmissionSelection } from '@/lib/project/submission'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { ChatCompileFeedback, SubmissionChatRequest } from '@/lib/project/writing-chat'
import type { WritingDrafts, WritingKey } from '@/lib/project/writing-drafts'
import { download, submissionFilename } from './SubmissionDialog'

export function ChatSubmissionCard({ runId, request, saved, working, drafts, main, active, disabled, storage, projectKey, archived,
  onBuild, onLocate, onExternal, onResult, onArchive }: {
  runId: string; request: SubmissionChatRequest; saved: ProjectFileSystem; working: ProjectFileSystem; drafts: WritingDrafts
  main: string; active: boolean; disabled: boolean; storage: IDBDatabase; projectKey: WritingKey; archived?: string
  onBuild: (selection: SubmissionSelection, signal: AbortSignal) => Promise<{ feedback: ChatCompileFeedback; submission?: SubmissionBuild } | undefined>
  onLocate: (path: string, line: number) => void
  onExternal: (include: boolean, excluded: string[]) => void
  onResult: (feedback: ChatCompileFeedback) => void
  onArchive: () => Promise<void>
}) {
  const [include, setInclude] = useState(request.includeDrafts ?? false)
  const [excluded, setExcluded] = useState(() => new Set(request.excluded))
  const [name, setName] = useState(request.name ?? '')
  const [build, setBuild] = useState<{ selection: SubmissionSelection; result: SubmissionBuild }>()
  const [feedback, setFeedback] = useState<{ selection: SubmissionSelection; result: ChatCompileFeedback }>()
  const [archiveName, setArchiveName] = useState(archived)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operation = useRef<AbortController>(null)
  const source = include ? working : saved
  const paths = useMemo(() => [...source.files].filter(([, file]) => file.type !== 'directory').map(([path]) => path).sort(), [source])
  const invalid = [...excluded].filter(path => path === main || !paths.includes(path))
  const selection = useMemo(() => {
    const { target, issues } = prepareSubmission(source, main, excluded)
    const included = [...target.files.keys()].sort()
    return { target, issues, paths: included, excluded: paths.filter(path => excluded.has(path)),
      drafts: include ? included.filter(path => Object.hasOwn(drafts, path)) : [] }
  }, [drafts, excluded, include, main, paths, source])
  const current = useRef(selection)
  const allowed = active && !disabled && !busy && !archiveName
  const canBuild = main && !invalid.length && !selection.issues.some(issue => issue.severity === 'error')
  useEffect(() => {
    current.current = selection
    return () => operation.current?.abort()
  }, [selection])
  useEffect(() => {
    if (!active) operation.current?.abort()
    return () => operation.current?.abort()
  }, [active])

  async function compile() {
    if (!allowed || !canBuild || operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError('')
    try {
      const result = await onBuild(selection, controller.signal)
      if (controller.signal.aborted || current.current !== selection) return
      if (!result) throw new Error('Compile is busy. Try again.')
      setFeedback({ selection, result: result.feedback })
      onResult(result.feedback)
      if (result.submission) setBuild({ selection, result: result.submission })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not compile the submission.')
    } finally {
      operation.current = null
      setBusy(false)
    }
  }

  async function archive() {
    const title = name.trim()
    if (!allowed || !title || !build || build.selection !== selection || operation.current) return
    setBusy(true)
    setError('')
    try {
      await saveSubmissionVersion(storage, projectKey, { ...build.result, id: runId, name: title, createdAt: new Date().toISOString() }, runId)
      setArchiveName(title)
      await onArchive()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive the submission.')
    } finally { setBusy(false) }
  }

  const result = build?.selection === selection || archiveName ? build?.result : undefined
  const compiler = feedback?.selection === selection ? feedback.result : undefined
  const filename = submissionFilename(archiveName || name.trim() || main.split('/').at(-1)?.replace(/\.tex$/i, '') || 'submission')
  async function downloadResult(kind: 'zip' | 'pdf') {
    try {
      const files = result ?? (archiveName && await readSubmissionFiles(storage, projectKey, runId))
      if (!files) throw new Error('The archived files are unavailable in this project.')
      download(files[kind], `${filename}${kind === 'zip' ? '-source.zip' : '.pdf'}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not retrieve the download.') }
  }
  return <section className="space-y-2 rounded border border-indigo-200 p-2 text-xs" aria-label="Submission task">
    <h3 className="font-semibold">Submission preflight</h3>
    {archiveName && <p role="status">Archived {archiveName}.</p>}
    {!archiveName && <>
      <p className="break-all">Compile entry · {main || 'Choose a main file'}</p>
      {!!Object.keys(drafts).length && <label className="flex gap-1">
        <input type="checkbox" checked={include} disabled={!allowed} onChange={event => setInclude(event.target.checked)} /> Include local drafts in the ZIP
      </label>}
      <details>
        <summary>ZIP manifest · {selection.paths.length} files</summary>
        <ul className="max-h-44 overflow-auto break-all">{paths.map(path => <li key={path}><label className="flex gap-1">
          <input type="checkbox" checked={!excluded.has(path)} disabled={!allowed || path === main} onChange={event => {
            const next = new Set(excluded)
            if (event.target.checked) next.delete(path)
            else next.add(path)
            setExcluded(next)
          }} /> {path}{selection.drafts.includes(path) && ' · Local draft'}
        </label></li>)}</ul>
      </details>
      {!!invalid.length && <p role="alert" className="break-all text-red-800">
        Cannot exclude {invalid.join(', ')}. <button className="underline" disabled={!allowed} onClick={() => setExcluded(new Set([...excluded].filter(path => !invalid.includes(path))))}>Clear invalid exclusions</button>
      </p>}
      {!selection.issues.length && <p>No issues found by the static checks.</p>}
      {selection.issues.map((issue, index) => <div key={index} className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}>
        {issue.location ? <button className="text-left underline" onClick={() => onLocate(issue.location!.path,
          !include && Object.hasOwn(drafts, issue.location!.path) ? 1 : issue.location!.line)}>
          {issue.message} · {issue.location.path}:{issue.location.line}
        </button> : issue.message}
      </div>)}
      {!result && <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={!allowed || !canBuild} onClick={() => void compile()}>Compile reviewed ZIP</Button>
        <Button size="sm" variant="outline" disabled={!allowed || !canBuild} onClick={() => onExternal(include, selection.excluded)}>Open external compile handoff</Button>
        {busy && <Button size="sm" variant="ghost" onClick={() => operation.current?.abort()}>Cancel compile</Button>}
      </div>}
      {build && !result && <p className="text-amber-800">The manifest or sources changed. Compile the reviewed ZIP again.</p>}
    </>}
    {compiler && <p role="status" className={compiler.status === 'failed' ? 'text-red-800' : undefined}>{compiler.message}</p>}
    {(result || archiveName) && <>
      {result && <p className="break-all">ZIP SHA-256 <code>{result.sourceChecksum}</code></p>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void downloadResult('zip')}>Download compiled source ZIP</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void downloadResult('pdf')}>Download compiled PDF</Button>
      </div>
      {!archiveName && <div className="flex flex-wrap items-center gap-1">
        <Input aria-label="Submission version name" className="min-w-28 flex-1" value={name} maxLength={100} onChange={event => setName(event.target.value)} disabled={!allowed} />
        <Button size="sm" disabled={!allowed || !name.trim()} onClick={() => void archive()}>Confirm submission archive</Button>
      </div>}
    </>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>
}
