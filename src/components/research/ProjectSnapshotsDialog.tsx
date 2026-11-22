'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { compareSnapshotFiles, describeSnapshotRestore, type ProjectSnapshotInfo, type SnapshotFileChange } from '@/lib/project/snapshots'
import { createProjectSnapshot, listProjectSnapshots, readProjectSnapshot, restoreProjectSnapshot, restoreSelectedSnapshotFiles } from '@/lib/project/storage'
import type { ProjectFileSystem } from '@/lib/project/types'

const FileComparison = dynamic(() => import('@/components/project/MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })

export function ProjectSnapshotsDialog({ project, database, storageKey, verifyRestore, onRestore, onClose }: {
  project: ProjectFileSystem
  database: IDBDatabase
  storageKey: string
  verifyRestore: (paths?: readonly string[]) => string | undefined
  onRestore: (project: ProjectFileSystem, selectedFiles?: boolean) => void
  onClose: () => void
}) {
  const projectId = project.metadata.createdAt
  const key: [string, string] = [storageKey, projectId]
  const [snapshots, setSnapshots] = useState<ProjectSnapshotInfo[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ item: ProjectSnapshotInfo; files: SnapshotFileChange[]; baseline: ProjectFileSystem['files'];
    changes: Awaited<ReturnType<typeof describeSnapshotRestore>> }>()
  const [selected, setSelected] = useState<string[]>([])
  const [compared, setCompared] = useState<SnapshotFileChange>()

  useEffect(() => {
    let active = true
    void listProjectSnapshots(database, [storageKey, projectId]).then(items => {
      if (active) setSnapshots(items)
    }).catch(() => {
      if (active) setError('Could not load project snapshots.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [database, projectId, storageKey])

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete the snapshot operation.')
    } finally {
      setBusy(false)
    }
  }

  function preview(item: ProjectSnapshotInfo) {
    void perform(async () => {
      const target = await readProjectSnapshot(database, key, item.id)
      if (!target) throw new Error('The selected snapshot is unavailable.')
      const files = await compareSnapshotFiles(project, target)
      setSelected([])
      setCompared(undefined)
      setPending({ item, files, baseline: project.files, changes: await describeSnapshotRestore(project, target, files) })
    })
  }

  function restore(paths?: readonly string[]) {
    if (!pending) return
    void perform(async () => {
      if (pending.baseline !== project.files) throw new Error('Project files changed. Reopen the restore preview.')
      const blocked = verifyRestore(paths)
      if (blocked) throw new Error(blocked)
      const partial = Boolean(paths)
      const item = { id: crypto.randomUUID(), name: `Before restoring ${partial ? 'files from ' : ''}${pending.item.name}`, createdAt: new Date().toISOString() }
      const checkpoint = { ...item, project }
      const result = paths ? await restoreSelectedSnapshotFiles(database, key, pending.item.id, checkpoint, paths)
        : await restoreProjectSnapshot(database, key, pending.item.id, checkpoint)
      setSnapshots(items => [item, ...items])
      setPending(undefined)
      setCompared(undefined)
      onRestore(result, partial)
      setMessage(paths ? `${paths.length} ${paths.length === 1 ? 'file' : 'files'} restored. A recovery snapshot is available.`
        : 'Project restored. A recovery snapshot is available.')
    })
  }

  const details = pending && [
    ...pending.changes.files.filter(change => !pending.files.some(file => `${file.action} ${file.path}` === change)),
    ...pending.changes.pages.map(page => `${page} (Canvas page)`),
    ...(pending.changes.mainChanged ? ['Change the LaTeX main file'] : []),
    ...(pending.changes.activePageChanged ? ['Change the active Canvas page'] : []),
    ...(pending.changes.crossPageEdgesChanged ? ['Restore cross-page Canvas connections'] : []),
    ...(pending.changes.settingsChanged ? ['Restore project settings'] : []),
  ]

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy} className={`max-h-[90dvh] overflow-y-auto ${compared ? 'sm:max-w-[min(90vw,72rem)]' : ''}`}>
      <DialogHeader>
        <DialogTitle>Project Snapshots</DialogTitle>
        <DialogDescription>Keep named versions of the saved sources, Canvas and attachments in this browser.</DialogDescription>
      </DialogHeader>
      {!pending && <>
        <form className="space-y-2" onSubmit={event => {
          event.preventDefault()
          const title = name.trim()
          if (!title || busy || loading) return
          void perform(async () => {
            const item = { id: crypto.randomUUID(), name: title, createdAt: new Date().toISOString() }
            await createProjectSnapshot(database, key, { ...item, project })
            setSnapshots(items => [item, ...items])
            setName('')
            setMessage('Snapshot created.')
          })
        }}>
          <label className="grid gap-1 text-sm font-medium">Snapshot name
            <Input value={name} onChange={event => setName(event.target.value)} maxLength={100} disabled={busy} />
          </label>
          <Button type="submit" disabled={!name.trim() || busy || loading}>Create snapshot</Button>
        </form>
        {loading ? <p role="status">Loading snapshots…</p> : snapshots.length ? <ul className="max-h-[32dvh] divide-y overflow-y-auto rounded border">
          {snapshots.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{item.name}</p>
              <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => preview(item)} aria-label={`Review restore ${item.name}`}>Review restore</Button>
          </li>)}
        </ul> : !error && <p className="text-sm text-muted-foreground">No snapshots yet.</p>}
      </>}
      {pending && <section className="space-y-2" aria-label="Restore preview">
        <h3 className="break-words font-medium">Restore {pending.item.name}</h3>
        <p className="text-sm text-muted-foreground">Restore selected files to keep your Canvas and other edits, or restore the entire snapshot. A recovery snapshot preserves your current saved project.</p>
        {pending.files.length > 0 && <ul className="max-h-[22dvh] divide-y overflow-y-auto rounded border">
          {pending.files.map(file => {
            const disabled = file.saved?.type === 'generated' || file.current?.type === 'generated'
              || (file.action === 'Remove' && project.metadata.mainFile === file.path)
            return <li key={file.path} className="flex flex-wrap items-center justify-between gap-1 px-2 py-1 text-sm">
              <label className="flex min-w-0 items-start gap-2">
                <input type="checkbox" className="mt-1" checked={selected.includes(file.path)} disabled={busy || disabled}
                  onChange={event => setSelected(paths => event.target.checked ? [...paths, file.path] : paths.filter(path => path !== file.path))} />
                <span className="break-all">{file.action} {file.path}{disabled && ' · Entire snapshot only'}</span>
              </label>
              <Button variant="ghost" size="sm" aria-label={`Compare ${file.path}`} onClick={() => setCompared(file)}>Compare</Button>
            </li>
          })}
        </ul>}
        {compared && <section aria-label="File comparison" className="space-y-1 rounded border p-2">
          <div className="flex items-center justify-between gap-2"><h4 className="break-all font-medium">{compared.path}</h4>
            <Button variant="ghost" size="sm" onClick={() => setCompared(undefined)}>Close comparison</Button></div>
          <div className="grid grid-cols-2 gap-2 text-sm"><span>Current saved file</span><span>Snapshot file</span></div>
          {typeof compared.current?.content === 'string' || typeof compared.saved?.content === 'string'
            ? <div className="h-[32dvh] min-h-44"><FileComparison path={compared.path} original={compared.current?.content ?? ''}
              modified={compared.saved?.content ?? ''} originalLabel="Current saved file" modifiedLabel="Snapshot file" /></div>
            : <div className="grid grid-cols-2 gap-2 text-sm">
              {[compared.current, compared.saved].map((file, index) => <p key={index}>{file
                ? `${file.blob?.size ?? file.size ?? 0} bytes · ${file.mimeType || file.blob?.type || 'Binary file'}` : 'File absent'}</p>)}
            </div>}
        </section>}
        {details?.length ? <ul className="max-h-[22dvh] list-disc space-y-1 overflow-y-auto pl-5 text-sm">
          {details.map((change, index) => <li key={`${change}:${index}`} className="break-all">{change}</li>)}
        </ul> : !pending.files.length && <p className="text-sm">The saved files and Canvas already match this snapshot.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>Back</Button>
          <Button variant="outline" disabled={busy || !selected.length} onClick={() => restore(selected)}>Restore selected files{selected.length > 0 && ` (${selected.length})`}</Button>
          <Button variant="destructive" disabled={busy} onClick={() => restore()}>Restore snapshot</Button>
        </DialogFooter>
      </section>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>
}
