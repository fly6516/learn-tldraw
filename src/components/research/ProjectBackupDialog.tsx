"use client"

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  decodeProjectBackup, encodeProjectBackup, projectBackupExtension,
} from '@/lib/project/backup'
import type { ResearchCanvas } from '@/lib/project/research-graph'
import type { ProjectFileSystem } from '@/lib/project/types'

interface ProjectBackupDialogProps {
  canvas: ResearchCanvas
  project: ProjectFileSystem
  onRestore: (project: ProjectFileSystem) => Promise<boolean>
  onClose: () => void
}

export function ProjectBackupDialog({ canvas, project, onRestore, onClose }: ProjectBackupDialogProps) {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof decodeProjectBackup>>>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

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
      const backup = await encodeProjectBackup(canvas, project)
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
      if (!await onRestore(pending.project)) return
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
      <DialogContent showCloseButton={!busy}>
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
        {pending && (
          <p>
            Restore <strong>{pending.project.metadata.projectName}</strong>?
            This replaces the current canvas and project files. You can download a backup of
            your current project first.
          </p>
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
