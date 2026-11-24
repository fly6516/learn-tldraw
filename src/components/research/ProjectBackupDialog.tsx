"use client"

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  decodeProjectBackup, encodeProjectBackup, projectBackupExtension, projectBackupFilename,
} from '@/lib/project/backup'
import { downloadFile } from '@/lib/export/export-actions'
import type { BackupHistorySelection, PortableProjectHistory } from '@/lib/project/backup-history'
import type { RecoveryReceipt } from '@/lib/project/project-library'
import type { ResearchCanvas } from '@/lib/project/research-graph'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { PortableWritingState } from '@/lib/project/writing-drafts'
import { BackupContents } from './BackupContents'

interface ProjectBackupDialogProps {
  canvas: ResearchCanvas
  project: ProjectFileSystem
  writing?: PortableWritingState
  recovery?: boolean
  readHistory?: (selection: BackupHistorySelection) => Promise<PortableProjectHistory>
  readBaseline?: () => Promise<string | undefined>
  onExport?: (receipt: RecoveryReceipt) => Promise<void>
  onRestore: (project: ProjectFileSystem, writing?: PortableWritingState, history?: PortableProjectHistory) => Promise<boolean>
  onImportCopy?: (project: ProjectFileSystem, writing?: PortableWritingState, history?: PortableProjectHistory) => Promise<boolean>
  onClose: () => void
}

export function ProjectBackupDialog({ canvas, project, writing, recovery = false, readHistory, readBaseline, onExport, onRestore, onImportCopy, onClose }: ProjectBackupDialogProps) {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof decodeProjectBackup>>>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [includeDrafts, setIncludeDrafts] = useState(recovery)
  const [historyOptions, setHistoryOptions] = useState<BackupHistorySelection>({ publication: recovery && !!readHistory, snapshots: recovery && !!readHistory, ai: false })
  const fileInput = useRef<HTMLInputElement>(null)
  const draftCount = Object.keys(writing?.drafts ?? {}).length
  const complete = Boolean(writing && includeDrafts && historyOptions.publication && historyOptions.snapshots)

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

  async function downloadBackup(workingOnly = false) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const baseline = complete && !workingOnly ? await readBaseline?.().catch(() => undefined) : undefined
      const history = !workingOnly && Object.values(historyOptions).some(Boolean) ? await readHistory?.(historyOptions) : undefined
      const draftsIncluded = (workingOnly || includeDrafts) && writing
      const backup = await encodeProjectBackup(canvas, project, draftsIncluded || undefined, history)
      await decodeProjectBackup(backup)
      downloadFile(backup, projectBackupFilename(project.metadata.projectName))
      setMessage('Backup validated and sent to the browser for download.')
      if (onExport) {
        const scope = ['files and Canvas', draftsIncluded && 'local drafts', history?.publication && 'submissions and revisions',
          history?.snapshots && 'snapshots', history?.ai && 'AI history'].filter(Boolean).join(', ')
        const current = baseline && await readBaseline?.().catch(() => undefined)
        try { await onExport({ exportedAt: new Date().toISOString(), scope, baseline: current === baseline ? baseline : undefined }) }
        catch { setMessage('Backup validated and sent for download. The export could not be recorded in local storage.') }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export project backup.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreProject(asCopy: boolean) {
    if (!pending) return
    setError('')
    setBusy(true)
    try {
      const restore = asCopy ? onImportCopy : onRestore
      if (!restore || !await restore(pending.project, pending.writing, pending.history)) return
      setPending(undefined)
      setMessage(asCopy ? 'Project imported.' : 'Project restored.')
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
          {writing && readHistory && <Button variant={complete ? 'secondary' : 'outline'} size="sm" aria-pressed={complete}
            disabled={busy} onClick={() => {
              setIncludeDrafts(true)
              setHistoryOptions(current => ({ ...current, publication: true, snapshots: true }))
            }}>Complete recovery backup</Button>}
          {writing ? <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeDrafts} disabled={busy} onChange={event => setIncludeDrafts(event.target.checked)} />
            Include {draftCount} local {draftCount === 1 ? 'draft' : 'drafts'}
          </label> : <p className="text-muted-foreground">Local drafts are unavailable for export.</p>}
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
            {historyOptions.ai && <p className="text-xs text-muted-foreground">
              Includes claim reviews and verified PDFs waiting for archiving. Conversations and evidence may contain manuscript text.
              Restored AI sessions require fresh approval.{draftCount > 0 && ' Include local drafts to resume work that has not been saved to the project.'}
            </p>}
          </fieldset>}
        </div>
        {pending && (
          <div className="space-y-1 text-sm">
            <BackupContents backup={pending} />
            <p>{onImportCopy
              ? 'Import into the project list or explicitly replace the current project.'
              : 'This replaces the current Canvas, saved files, local drafts, and the included history categories.'}</p>
          </div>
        )}
        {busy && <p role="status">Processing project backup…</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <DialogFooter>
          {recovery && <Button variant="outline" onClick={() => void downloadBackup(true)} disabled={busy}>Download working copy only</Button>}
          <Button variant="outline" onClick={() => void downloadBackup()} disabled={busy}>Download Backup</Button>
          {pending ? (
            <>
              <Button variant="outline" onClick={() => setPending(undefined)} disabled={busy}>Cancel Restore</Button>
              <Button variant={onImportCopy ? 'outline' : 'destructive'} onClick={() => void restoreProject(false)}
                disabled={busy}>Replace Project</Button>
              {onImportCopy && <Button onClick={() => void restoreProject(true)} disabled={busy}>Import as new project</Button>}
            </>
          ) : (
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>Choose Backup</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
