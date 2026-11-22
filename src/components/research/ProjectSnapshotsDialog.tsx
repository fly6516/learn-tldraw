'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { describeSnapshotRestore, type ProjectSnapshotInfo } from '@/lib/project/snapshots'
import { createProjectSnapshot, listProjectSnapshots, readProjectSnapshot, restoreProjectSnapshot } from '@/lib/project/storage'
import type { ProjectFileSystem } from '@/lib/project/types'

export function ProjectSnapshotsDialog({ project, database, storageKey, verifyRestore, onRestore, onClose }: {
  project: ProjectFileSystem
  database: IDBDatabase
  storageKey: string
  verifyRestore: () => string | undefined
  onRestore: (project: ProjectFileSystem) => void
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
  const [pending, setPending] = useState<{ item: ProjectSnapshotInfo; changes: Awaited<ReturnType<typeof describeSnapshotRestore>> }>()

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
      setPending({ item, changes: await describeSnapshotRestore(project, target) })
    })
  }

  const details = pending && [
    ...pending.changes.files,
    ...pending.changes.pages.map(page => `${page} (Canvas page)`),
    ...(pending.changes.mainChanged ? ['Change the LaTeX main file'] : []),
    ...(pending.changes.activePageChanged ? ['Change the active Canvas page'] : []),
    ...(pending.changes.crossPageEdgesChanged ? ['Restore cross-page Canvas connections'] : []),
    ...(pending.changes.settingsChanged ? ['Restore project settings'] : []),
  ]

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-y-auto">
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
        <p className="text-sm text-muted-foreground">Save or discard any local drafts before restoring. A recovery snapshot will preserve your current project.</p>
        {details?.length ? <ul className="max-h-[30dvh] list-disc space-y-1 overflow-y-auto pl-5 text-sm">
          {details.map((change, index) => <li key={`${change}:${index}`} className="break-all">{change}</li>)}
        </ul> : <p className="text-sm">The saved files and Canvas already match this snapshot.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>Back</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void perform(async () => {
            const blocked = verifyRestore()
            if (blocked) throw new Error(blocked)
            const item = { id: crypto.randomUUID(), name: `Before restoring ${pending.item.name}`, createdAt: new Date().toISOString() }
            const result = await restoreProjectSnapshot(database, key, pending.item.id, { ...item, project })
            setSnapshots(items => [item, ...items])
            setPending(undefined)
            onRestore(result)
            setMessage('Project restored. A recovery snapshot is available.')
          })}>Restore snapshot</Button>
        </DialogFooter>
      </section>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>
}
