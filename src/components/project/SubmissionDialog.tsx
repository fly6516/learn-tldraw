'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Download } from 'lucide-react'
import type { SubmissionIssue, SubmissionVersion, SubmissionVersionInfo } from '@/lib/project/submission'
import type { WritingKey } from '@/lib/project/writing-drafts'
import { listSubmissionVersions, readSubmissionFiles, saveSubmissionVersion } from '@/lib/project/storage'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

type VersionDraft = Omit<SubmissionVersion, 'id' | 'createdAt' | 'name'>

export function SubmissionDialog({ main, drafts, includeDrafts, onDraftChoice, conflicting, paths, excluded, onToggle,
  issues, ready, busy, error, log, result, compilerIssues, onClose, onCompile, onLocate, database, storageKey }: {
  main: string
  drafts: string[]
  includeDrafts: boolean
  onDraftChoice: (include: boolean) => void
  conflicting: boolean
  paths: string[]
  excluded: ReadonlySet<string>
  onToggle: (path: string) => void
  issues: SubmissionIssue[]
  ready: boolean
  busy: boolean
  error: string
  log: string
  result?: VersionDraft
  compilerIssues: SubmissionIssue[]
  onClose: () => void
  onCompile: () => void
  onLocate: (issue: SubmissionIssue) => void
  database: IDBDatabase | null
  storageKey?: WritingKey
}) {
  const [versions, setVersions] = useState<SubmissionVersionInfo[]>([])
  const [versionName, setVersionName] = useState('')
  const [saving, setSaving] = useState(false)
  const [archived, setArchived] = useState<VersionDraft>()
  const [archiveError, setArchiveError] = useState('')
  useEffect(() => {
    if (!database || !storageKey) return
    let active = true
    void listSubmissionVersions(database, storageKey).then(items => { if (active) setVersions(items) })
      .catch(() => { if (active) setArchiveError('Could not load archived submissions.') })
    return () => { active = false }
  }, [database, storageKey])

  async function archive() {
    const name = versionName.trim()
    if (!name || !result || !database || !storageKey || saving) return
    setSaving(true)
    setArchiveError('')
    try {
      const version = { ...result, name, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
      await saveSubmissionVersion(database, storageKey, version)
      const { pdf, zip, ...info } = version
      setVersions(current => [info, ...current])
      setArchived({ ...info, pdf, zip })
      setVersionName('')
    } catch {
      setArchiveError('Could not save the submission version. The compiled downloads are still available.')
    } finally {
      setSaving(false)
    }
  }

  async function downloadArchived(version: SubmissionVersionInfo, kind: 'pdf' | 'zip') {
    if (!database || !storageKey) return
    setArchiveError('')
    try {
      const files = await readSubmissionFiles(database, storageKey, version.id)
      if (!files) throw new Error()
      const name = version.name.replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').replace(/[. ]+$/, '') || 'submission'
      download(files[kind], `${name}${kind === 'zip' ? '-source.zip' : '.pdf'}`)
    } catch {
      setArchiveError('Could not retrieve the archived download.')
    }
  }

  const name = main.split('/').at(-1)?.replace(/\.tex$/i, '') || 'project'
  const allIssues = [...issues, ...compilerIssues]
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}>
    <DialogContent showCloseButton={!saving} className="max-h-[90dvh] overflow-auto sm:max-w-xl">
      <DialogTitle>Prepare submission</DialogTitle>
      <DialogDescription>The PDF is compiled from the exact source ZIP offered for download. Archived versions keep both files in this browser.</DialogDescription>
      <p className="text-sm">Compile entry <code className="break-all">{main}</code></p>
      {drafts.length > 0 && <fieldset disabled={busy || saving} className="space-y-1 text-sm">
        <legend className="font-medium">Source to submit</legend>
        <label className="flex items-center gap-2"><input type="radio" name="submission-source" checked={!includeDrafts}
          onChange={() => onDraftChoice(false)} /> Saved project files · excludes {drafts.length} local {drafts.length === 1 ? 'draft' : 'drafts'}</label>
        <label className="flex items-center gap-2"><input type="radio" name="submission-source" checked={includeDrafts}
          onChange={() => onDraftChoice(true)} /> Include local drafts in both downloads</label>
        {conflicting && <p className="text-amber-800">Compare conflicting included drafts in Writing before compiling.</p>}
      </fieldset>}
      <details className="rounded border p-2 text-sm">
        <summary className="cursor-pointer font-medium">ZIP files · {paths.length - excluded.size} included</summary>
        <ul className="mt-2 max-h-52 space-y-1 overflow-auto">
          {paths.map(path => <li key={path}>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!excluded.has(path)}
              disabled={path === main || busy || saving} onChange={() => onToggle(path)} />
              <span className="break-all font-mono text-xs">{path}{path === main && ' · Main'}{includeDrafts && drafts.includes(path) && ' · Local draft'}</span>
            </label>
          </li>)}
        </ul>
      </details>
      <section aria-label="Submission preflight" className="space-y-1 text-sm">
        <h2 className="font-medium">Preflight</h2>
        {!allIssues.length && <p className="text-slate-600">No issues found by the static checks.</p>}
        <ul className="max-h-52 space-y-1 overflow-auto">
          {allIssues.map((issue, index) => <li key={index} className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}>
            {issue.location ? <button type="button" disabled={busy || saving} onClick={() => onLocate(issue)} className="block w-full break-words text-left underline">
              {issue.message} · {issue.location.path}:{issue.location.line}
            </button> : <p className="break-words">{issue.message}</p>}
          </li>)}
        </ul>
      </section>
      <p role="status" className="text-sm" aria-label="Compilation">
        {busy ? 'Compiling the confirmed source ZIP…' : result ? (result.warnings ? 'Compiled with warnings' : 'Compiled successfully') : error ? 'Compilation failed' : 'Ready to compile'}
      </p>
      {(error || log) && <details open={Boolean(error)} className={error ? 'text-sm text-red-800' : 'text-sm text-amber-800'}>
        <summary>Compiler output</summary><p className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{error || log}</p>
      </details>}
      <div className="flex flex-wrap gap-2">
        {result ? <>
          <Button variant="outline" onClick={() => download(result.zip, `${name}-source.zip`)}><Download /> Download source ZIP</Button>
          <Button onClick={() => download(result.pdf, `${name}.pdf`)}><Download /> Download submission PDF</Button>
        </> : <Button onClick={onCompile} disabled={busy || !ready || conflicting}>Compile submission files</Button>}
      </div>
      {result && database && storageKey && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void archive() }}>
        <label className="flex-1 space-y-1 text-sm font-medium"><span>Version name</span>
          <Input value={versionName} onChange={event => setVersionName(event.target.value)} maxLength={100} disabled={saving} />
        </label>
        <Button type="submit" variant="outline" disabled={saving || !versionName.trim() || archived?.pdf === result.pdf}>Save submission version</Button>
      </form>}
      {!!versions.length && <section aria-label="Archived submissions" className="space-y-2 border-t pt-2 text-sm">
        <h2 className="font-medium">Archived submissions</h2>
        {versions.map(version => <details key={version.id} className="rounded border p-2">
          <summary className="cursor-pointer break-all font-medium">{version.name} · {new Date(version.createdAt).toLocaleString()}</summary>
          <p className="mt-1 break-all">{version.main} · {version.paths.length} files · {version.drafts.length} local drafts</p>
          <p>{version.warnings ? 'Compiled with warnings' : 'Compiled successfully'} · {version.issues.length} preflight findings</p>
          <details className="mt-1"><summary>Files and findings</summary>
            <ul className="max-h-40 overflow-auto break-all">
              {version.paths.map(path => <li key={path}>{path}{version.drafts.includes(path) && ' · Local draft'}</li>)}
              {version.excluded.map(path => <li key={path}>{path} · Excluded</li>)}
              {[...version.issues, ...version.diagnostics].map((issue, index) => <li key={index}>{issue.message}{issue.location && ` · ${issue.location.path}:${issue.location.line}`}</li>)}
            </ul>
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void downloadArchived(version, 'zip')}>Download archived ZIP</Button>
            <Button size="sm" variant="outline" onClick={() => void downloadArchived(version, 'pdf')}>Download archived PDF</Button>
          </div>
        </details>)}
      </section>}
      {archiveError && <p role="alert" className="text-sm text-red-800">{archiveError}</p>}
    </DialogContent>
  </Dialog>
}
