'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { planReferenceOperation, type ReferenceOperation } from '@/lib/project/reference-refactor'
import type { ProjectFileSystem } from '@/lib/project/types'
import { editableSource, type PortableWritingState } from '@/lib/project/writing-drafts'

export type ReferenceRequest = { kind: 'citation' | 'label'; from: string } | { kind: 'merge' }
type Plan = ReturnType<typeof planReferenceOperation>

export function ReferenceOperationDialog({ request, project, writing, onClose, onApply }: {
  request: ReferenceRequest
  project: ProjectFileSystem
  writing: PortableWritingState
  onClose: () => void
  onApply: (plan: Plan, before: ProjectFileSystem, prior: PortableWritingState) => Promise<void>
}) {
  const choices = [...project.files.keys()].filter(path => /\.bib$/i.test(path) && editableSource(project, path) !== undefined)
  const [target, setTarget] = useState(choices[0] ?? '')
  const [file, setFile] = useState<File>()
  const [key, setKey] = useState('')
  const [preview, setPreview] = useState<{ plan: Plan; before: ProjectFileSystem; prior: PortableWritingState }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = request.kind === 'merge' ? 'Merge bibliography' : request.kind === 'citation' ? 'Rename citation key' : 'Rename LaTeX label'
  const result = preview?.plan

  async function getOperation(): Promise<ReferenceOperation> {
    if (request.kind !== 'merge') return { ...request, to: key.trim() }
    if (!file || !/\.bib$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error('Choose a .bib file up to 5 MB.')
    return { kind: 'merge', path: target, name: file.name, source: await file.text() }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription className="break-words">{request.kind === 'merge'
        ? 'Add new entries to an editable bibliography draft. Existing keys are kept.'
        : `Preview changes to ${request.from} across project files, local drafts and linked cards.`}</DialogDescription>
      <form className="space-y-3" onSubmit={async event => {
        event.preventDefault()
        if (busy) return
        setError('')
        setBusy(true)
        try {
          if (preview) {
            await onApply(preview.plan, preview.before, preview.prior)
            onClose()
          } else {
            setPreview({ plan: planReferenceOperation(project, writing, await getOperation()), before: project, prior: writing })
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not apply the reference changes.')
        } finally {
          setBusy(false)
        }
      }}>
        {!result && (request.kind === 'merge' ? <>
          <label className="grid gap-1 text-sm">Bibliography file to import
            <Input type="file" accept=".bib" required onChange={event => setFile(event.currentTarget.files?.[0])} />
          </label>
          <label className="grid gap-1 text-sm">Destination bibliography
            <select value={target} required onChange={event => setTarget(event.target.value)} className="rounded border bg-background p-2">
              {choices.map(path => <option key={path}>{path}</option>)}
            </select>
          </label>
        </> : <label className="grid gap-1 text-sm">New key
          <Input value={key} required onChange={event => setKey(event.target.value)} className="font-mono" autoFocus />
        </label>)}
        {result && <div className="space-y-2 break-words text-sm">
          {result.added.length > 0 && <p>Entries to add to the local draft ({result.added.length}) · {result.added.join(', ')}</p>}
          {result.skipped.length > 0 && <p className="text-amber-900">Existing keys kept ({result.skipped.length}) · {result.skipped.join(', ')}</p>}
          {request.kind !== 'merge' && <details open><summary>Source changes ({result.changes.length})</summary>
            <ul className="space-y-1 pl-3">{result.changes.map((item, index) => <li key={index}>
              {item.path}:{item.line} · {item.layer} · {item.from} → {item.to}
            </li>)}</ul>
          </details>}
          {result.draftPaths.length > 0 && <p>Local drafts affected · {result.draftPaths.join(', ')}</p>}
          {result.bindings.length > 0 && <details open><summary>Canvas and review bindings ({result.bindings.length})</summary>
            <ul className="space-y-1 pl-3">{result.bindings.map((item, index) => <li key={index}>{item.page} · {item.title} · {item.kind}</li>)}</ul>
          </details>}
          {result.warnings.length > 0 && <ul className="space-y-1 rounded bg-amber-50 p-2 text-amber-950">
            {result.warnings.map(warning => <li key={warning}>{warning}</li>)}
          </ul>}
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => {
            if (preview) { setPreview(undefined); setFile(undefined); setError('') }
            else onClose()
          }}>{preview ? 'Back' : 'Cancel'}</Button>
          <Button type="submit" disabled={busy || (request.kind === 'merge' && !target)}>
            {preview ? 'Apply reference changes' : 'Preview changes'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
