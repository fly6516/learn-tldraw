'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { planFileOperation, type FileOperation } from '@/lib/project/file-refactor'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { PortableWritingState } from '@/lib/project/writing-drafts'

export type FileOperationPlan = ReturnType<typeof planFileOperation>

export function FileOperationDialog({ request, project, writing, main, onClose, onApply }: {
  request: FileOperation
  project: ProjectFileSystem
  writing: PortableWritingState
  main: string
  onClose: () => void
  onApply: (plan: FileOperationPlan, previous: ProjectFileSystem, beforeWriting: PortableWritingState, destination: string) => Promise<void>
}) {
  const [path, setPath] = useState(request.to)
  const [title, setTitle] = useState(request.kind === 'chapter' ? request.title : '')
  const [preview, setPreview] = useState<{ result: FileOperationPlan; project: ProjectFileSystem; writing: PortableWritingState }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const creating = request.kind === 'chapter'
  const result = preview?.result

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle>{creating ? 'New chapter' : 'Rename or move file'}</DialogTitle>
      <DialogDescription className="break-all">{creating ? `Insert an input in ${request.parent}.` : request.from}</DialogDescription>
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault()
        setError('')
        if (busy) return
        try {
          if (preview) {
            setBusy(true)
            await onApply(preview.result, preview.project, preview.writing, path.trim())
            onClose()
          } else {
            const operation = request.kind === 'chapter' ? { ...request, to: path.trim(), title } : { ...request, to: path.trim() }
            setPreview({ result: planFileOperation(project, writing, main, operation), project, writing })
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not change the file structure.')
        } finally {
          setBusy(false)
        }
      }}>
        {!result ? <>
          {creating && <label className="grid gap-1 text-sm">Chapter title
            <Input value={title} onChange={event => setTitle(event.target.value)} required />
          </label>}
          <label className="grid gap-1 text-sm">Project-relative path
            <Input className="font-mono" value={path} onChange={event => setPath(event.target.value)} required />
          </label>
        </> : <div className="space-y-2 text-sm">
          <p className="break-all font-mono">{path}</p>
          {result.mainChanged && <p>Update the compile entry to {result.project.metadata.mainFile}.</p>}
          <details open><summary>Source references ({result.changes.length})</summary>
            <ul className="space-y-1 pl-3">{result.changes.map((item, index) => <li className="break-all" key={index}>
              {item.path}:{item.line} · {item.layer} · {item.from && <>{item.from} → </>}{item.to}
            </li>)}</ul>
          </details>
          <details open><summary>Local drafts ({result.draftPaths.length})</summary>
            <ul className="pl-3">{result.draftPaths.map(file => <li className="break-all" key={file}>{file}</li>)}</ul>
          </details>
          <details open><summary>Canvas and review bindings ({result.bindings.length})</summary>
            <ul className="pl-3">{result.bindings.map((item, index) => <li className="break-words" key={index}>
              {item.page} · {item.title} · {item.kind}
            </li>)}</ul>
          </details>
          {result.warnings.length > 0 && <details open className="rounded bg-amber-50 p-2 text-amber-950">
            <summary>References to review manually ({result.warnings.length})</summary>
            <ul className="pl-3">{result.warnings.map(item => <li className="break-all" key={JSON.stringify(item)}>
              {item.path}:{item.line} · {item.command}
            </li>)}</ul>
          </details>}
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy}
            onClick={() => { if (preview) { setPreview(undefined); setError('') } else onClose() }}>
            {preview ? 'Back' : 'Cancel'}
          </Button>
          <Button type="submit" disabled={busy}>{preview ? 'Apply file changes' : 'Preview changes'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
