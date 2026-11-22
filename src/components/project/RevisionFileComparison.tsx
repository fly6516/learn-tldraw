'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { compareRevisionFiles, type RevisionFile } from '@/lib/project/revision-rounds'
import { projectTextExtension } from '@/lib/project/source-archive'
import type { ProjectFileSystem } from '@/lib/project/types'

const Diff = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })

export function RevisionFileComparison({ baseline, current, baselineName, revisedName, openSource, drafts, conflicts }: {
  baseline: ProjectFileSystem; current: ProjectFileSystem; baselineName: string
  revisedName?: string
  openSource: (path: string) => void; drafts: ReadonlySet<string>; conflicts: readonly string[]
}) {
  const [report, setReport] = useState<{ current: ProjectFileSystem; files?: RevisionFile[]; error?: true }>()
  const [path, setPath] = useState('')
  const [showUnchanged, setShowUnchanged] = useState(false)
  useEffect(() => {
    let active = true
    void compareRevisionFiles(baseline, current).then(files => { if (active) setReport({ current, files }) })
      .catch(() => { if (active) setReport({ current, error: true }) })
    return () => { active = false }
  }, [baseline, current])
  const files = report?.current === current ? report.files : undefined
  const file = files?.find(item => item.path === path)
  return <section aria-label="Revision file comparison" className="space-y-2">
    <p className="text-sm text-muted-foreground">{revisedName ? 'Compare the files in the original and revised submission ZIPs.'
      : 'Compare the archived ZIP with current project files, including applicable local drafts. Files excluded from the ZIP have no archived copy.'}</p>
    {!revisedName && conflicts.length > 0 && <p className="text-sm text-amber-800">Conflicting drafts use the saved source in this comparison. Resolve the draft conflicts in Writing to compare those edits.</p>}
    {report?.current === current && report.error ? <p role="alert">Could not compare the source files.</p> : !files ? <p role="status">Comparing files…</p> : <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} /> Show unchanged files</label>
      <ul className="max-h-36 divide-y overflow-auto rounded border text-sm">
        {files.filter(item => showUnchanged || item.status !== 'Unchanged').map(item => <li key={item.path}>
          <button type="button" className="block w-full break-all px-2 py-1 text-left hover:bg-muted aria-pressed:bg-indigo-50" aria-pressed={path === item.path}
            onClick={() => setPath(item.path)}>{item.status} · {item.path}{!revisedName && drafts.has(item.path) && ' · Local draft'}</button>
        </li>)}
        {!showUnchanged && files.every(item => item.status === 'Unchanged') && <li className="p-2">No file changes.</li>}
      </ul>
      {file && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="break-all text-sm font-medium">{file.path}</h3>
          {!revisedName && file.current !== undefined && projectTextExtension.test(file.path) && <Button size="sm" variant="outline" onClick={() => openSource(file.path)}>Open current file</Button>}
        </div>
        <FileDiff key={file.path} file={file} baselineName={baselineName} revisedName={revisedName} />
      </>}
    </>}
  </section>
}

function FileDiff({ file, baselineName, revisedName }: { file: RevisionFile; baselineName: string; revisedName?: string }) {
  const [text, setText] = useState<{ file: RevisionFile; before: string; after: string }>()
  const isText = projectTextExtension.test(file.path)
  useEffect(() => {
    if (!isText) return
    let active = true
    const read = (entry?: string | Blob) => typeof entry === 'string' ? entry : entry?.text() ?? ''
    void Promise.all([read(file.baseline), read(file.current)]).then(([before, after]) => { if (active) setText({ file, before, after }) })
    return () => { active = false }
  }, [file, isText])
  const originalLabel = `${baselineName} · Archived ZIP`
  const modifiedLabel = revisedName ? `${revisedName} · Archived ZIP` : 'Current project'
  return <div className="space-y-1">
    <div className="grid grid-cols-2 gap-2 text-sm font-medium"><span>{originalLabel}</span><span>{modifiedLabel}</span></div>
    {isText ? <div className="h-[36dvh] min-h-40 rounded border">
      {text?.file === file && <Diff path={file.path} original={text.before} modified={text.after} originalLabel={originalLabel} modifiedLabel={modifiedLabel} />}
    </div> : <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
      {[file.baseline, file.current].map((entry, index) => <span key={index}>{entry instanceof Blob ? `${entry.size} bytes` : 'File absent'}</span>)}
    </div>}
  </div>
}
