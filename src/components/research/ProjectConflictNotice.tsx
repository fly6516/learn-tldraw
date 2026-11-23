'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { compareSnapshotFiles, describeSnapshotRestore, type SnapshotFileChange } from '@/lib/project/snapshots'
import type { ProjectFileSystem } from '@/lib/project/types'

const Diff = dynamic(() => import('@/components/project/MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })

export function ProjectConflictNotice({ project, readSaved, onBackup, onReload }: {
  project: ProjectFileSystem; readSaved: () => Promise<ProjectFileSystem | undefined>; onBackup: () => void; onReload: () => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [changes, setChanges] = useState<{ files: SnapshotFileChange[]; pages: string[] }>()
  const [selected, setSelected] = useState<SnapshotFileChange>()

  async function compare() {
    setOpen(true)
    setLoading(true)
    setError('')
    setSelected(undefined)
    setChanges(undefined)
    try {
      const saved = await readSaved()
      if (!saved) throw new Error('The saved project is unavailable.')
      const files = await compareSnapshotFiles(project, saved)
      const { pages } = await describeSnapshotRestore(project, saved, files)
      setChanges({ files, pages })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read the saved project.') }
    finally { setLoading(false) }
  }

  return <>
    <aside aria-label="Project save conflict" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950">
      <p role="status" className="mr-auto">Another tab saved a newer project version.</p>
      <Button size="sm" variant="outline" onClick={() => void compare()}>Compare saved project</Button>
      <Button size="sm" variant="outline" onClick={onBackup}>Back up this tab</Button>
    </aside>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-2xl">
        <DialogTitle>Compare saved project</DialogTitle>
        <DialogDescription>Loading the saved project replaces the Canvas in this tab and restores drafts from browser storage. Back up this tab first to keep any local Canvas edits or drafts that could not be stored.</DialogDescription>
        {loading && <p role="status">Reading the latest saved version…</p>}
        {error && <p role="alert" className="text-sm text-red-900">{error}</p>}
        {changes && <>
          {!changes.files.length && !changes.pages.length && <p className="text-sm">The files and page contents match. Project settings or view state may have changed.</p>}
          <ul aria-label="Changed project files" className="max-h-36 list-inside list-disc overflow-auto break-all text-sm">
            {changes.files.map(item => <li key={item.path}>
              {typeof item.current?.content === 'string' || typeof item.saved?.content === 'string'
                ? <button type="button" className="text-left underline" onClick={() => setSelected(item)}>{item.path}</button> : item.path}
              {' · '}{item.action === 'Restore' ? 'Changed' : item.action === 'Add' ? 'Added' : 'Removed from saved project'}
            </li>)}
          </ul>
          {!!changes.pages.length && <p className="break-words text-sm">Canvas pages changed · {changes.pages.join(', ')}</p>}
          {selected && <Diff key={selected.path} path={selected.path} original={selected.current?.content ?? ''}
            modified={selected.saved?.content ?? ''} originalLabel="This tab" modifiedLabel="Saved in browser" />}
        </>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => { setOpen(false); onBackup() }}>Back up this tab</Button>
          <Button disabled={loading || !changes} onClick={async () => {
            if (!await onReload()) setError('Some drafts are still only in this tab. Download a recovery backup, then reload the page to continue.')
          }}>Load saved project</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
}
