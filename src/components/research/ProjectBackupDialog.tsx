"use client"

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  decodeProjectBackup, encodeProjectBackup, projectBackupExtension,
} from '@/lib/project/backup'
import type { BackupHistorySelection, PortableProjectHistory } from '@/lib/project/backup-history'
import type { ResearchCanvas } from '@/lib/project/research-graph'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { PortableWritingState } from '@/lib/project/writing-drafts'

interface ProjectBackupDialogProps {
  canvas: ResearchCanvas
  project: ProjectFileSystem
  writing?: PortableWritingState
  readHistory?: (selection: BackupHistorySelection) => Promise<PortableProjectHistory>
  onRestore: (project: ProjectFileSystem, writing?: PortableWritingState, history?: PortableProjectHistory) => Promise<boolean>
  onClose: () => void
}

export function ProjectBackupDialog({ canvas, project, writing, readHistory, onRestore, onClose }: ProjectBackupDialogProps) {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof decodeProjectBackup>>>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [historyOptions, setHistoryOptions] = useState<BackupHistorySelection>({ publication: false, snapshots: false, ai: false })
  const fileInput = useRef<HTMLInputElement>(null)
  const draftCount = Object.keys(writing?.drafts ?? {}).length
  const importDraftCount = Object.keys(pending?.writing?.drafts ?? {}).length

  async function prepareRestore(file: File) {
    setBusy(true)
    setPending(undefined)
    setError('')
    setMessage('')
    try {
      const backup = await decodeProjectBackup(file)
      setPending(backup)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open project backup.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadBackup() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const history = Object.values(historyOptions).some(Boolean) ? await readHistory?.(historyOptions) : undefined
      const backup = await encodeProjectBackup(canvas, project, includeDrafts && writing ? writing : undefined, history)
      const url = URL.createObjectURL(backup)
      const link = document.createElement('a')
      link.href = url
      const name = project.metadata.projectName.replace(/[<>:"/\\|?*]/g, '_').trim()
      link.download = (name || 'Research Project') + projectBackupExtension
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Backup downloaded.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export project backup.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreProject() {
    if (!pending) return
    setError('')
    setBusy(true)
    try {
      if (!await onRestore(pending.project, pending.writing, pending.history)) return
      setPending(undefined)
      setMessage('Project restored.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore the project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent showCloseButton={!busy} className="max-h-[90dvh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Project Backup</DialogTitle>
          <DialogDescription>
            Save the canvas and project files together, or restore them from a backup in another browser.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileInput}
          type="file"
          accept={projectBackupExtension}
          hidden
          aria-label="Choose a Research Canvas backup"
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void prepareRestore(file)
          }}
        />
        <div className="space-y-1 rounded border p-2 text-sm">
          <p>Every backup includes saved project files and the Canvas.</p>
          {draftCount > 0 ? <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeDrafts} disabled={busy} onChange={event => setIncludeDrafts(event.target.checked)} />
            Include {draftCount} local {draftCount === 1 ? 'draft' : 'drafts'}
          </label> : <p className="text-muted-foreground">{writing ? 'There are no local drafts.' : 'Local drafts are unavailable for export.'}</p>}
          {includeDrafts && draftCount > 0 && <p className="text-xs text-muted-foreground">The backup keeps drafts separate from the saved files.</p>}
          {readHistory && <fieldset disabled={busy} className="space-y-1 border-t pt-2">
            <legend className="text-xs font-semibold">Optional project history</legend>
            {([
              ['publication', 'Include submissions and revision rounds'],
              ['snapshots', 'Include project snapshots'],
              ['ai', 'Include AI conversations and task history'],
            ] as const).map(([kind, label]) => <label key={kind} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={historyOptions[kind]}
                onChange={event => setHistoryOptions({ ...historyOptions, [kind]: event.target.checked })} />
              {label}
            </label>)}
            {historyOptions.ai && <p className="text-xs text-muted-foreground">Conversations and evidence may contain manuscript text. Restored AI sessions require fresh approval.</p>}
          </fieldset>}
        </div>
        {pending && (
          <div className="space-y-1 text-sm">
            <p>Restore <strong>{pending.project.metadata.projectName}</strong>? This replaces the current Canvas, saved files, local drafts, and the included history categories.</p>
            <p>{importDraftCount > 0 ? `The backup contains ${importDraftCount} local ${importDraftCount === 1 ? 'draft' : 'drafts'}.` : 'The backup contains no local drafts.'}</p>
            {pending.history && <ul className="list-inside list-disc">
              {pending.history.publication && <li>{pending.history.publication.submissions.length} submission versions, {pending.history.publication.rounds.length} revision rounds</li>}
              {pending.history.snapshots && <li>{pending.history.snapshots.length} project snapshots</li>}
              {pending.history.ai && <li>{pending.history.ai.history?.conversations.length ?? 0} AI conversations with task history</li>}
            </ul>}
            {pending.conflicts.length > 0 && <p className="text-amber-800">
              {pending.history && <ul className="list-inside list-disc">
              {pending.history.publication && <li>{pending.history.publication.submissions.length} submission versions, {pending.history.publication.rounds.length} revision rounds</li>}
              {pending.history.snapshots && <li>{pending.history.snapshots.length} project snapshots</li>}
              {pending.history.ai && <li>{pending.history.ai.history?.conversations.length ?? 0} AI conversations with task history</li>}
            </ul>}
            {pending.conflicts.length} {pending.conflicts.length === 1 ? 'draft differs' : 'drafts differ'} from their saved baseline. Compare in Writing after restoring.
            </p>}
          </div>
        )}
        {busy && <p role="status">Processing project backup…</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={downloadBackup} disabled={busy}>Download Backup</Button>
          {pending ? (
            <>
              <Button variant="outline" onClick={() => setPending(undefined)} disabled={busy}>Cancel Restore</Button>
              <Button variant="destructive" onClick={restoreProject} disabled={busy}>Replace Project</Button>
            </>
          ) : (
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>Choose Backup</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
