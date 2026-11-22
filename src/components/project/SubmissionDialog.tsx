'use client'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Download } from 'lucide-react'

export type SubmissionFiles = { pdf: Blob; zip: Blob; warnings: boolean }

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function SubmissionDialog({ main, draftCount, includeDrafts, onDraftChoice, conflicting, citationCount, referenceCount,
  ready, busy, error, result, onClose, onCompile, onProblems }: {
  main: string
  draftCount: number
  includeDrafts: boolean
  onDraftChoice: (include: boolean) => void
  conflicting: boolean
  citationCount: number
  referenceCount: number
  ready: boolean
  busy: boolean
  error: string
  result?: SubmissionFiles
  onClose: () => void
  onCompile: () => void
  onProblems: () => void
}) {
  const name = main.split('/').at(-1)?.replace(/\.tex$/i, '') || 'project'
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-auto">
      <DialogTitle>Prepare submission</DialogTitle>
      <DialogDescription>The PDF is compiled from the exact source ZIP offered for download below.</DialogDescription>
      <dl className="space-y-3 text-sm">
        <div><dt className="font-medium">Compile entry</dt><dd className="break-all font-mono text-slate-700">{main}</dd></div>
        <div><dt className="font-medium">Source to submit</dt><dd>
          <fieldset disabled={busy} className="mt-1 space-y-1">
            <legend className="sr-only">Source to submit</legend>
            <label className="flex items-center gap-2"><input type="radio" name="submission-source" checked={!includeDrafts}
              onChange={() => onDraftChoice(false)} /> Saved project files{draftCount > 0 && ` · excludes ${draftCount} local ${draftCount === 1 ? 'draft' : 'drafts'}`}</label>
            {draftCount > 0 && <label className="flex items-center gap-2"><input type="radio" name="submission-source" checked={includeDrafts}
              onChange={() => onDraftChoice(true)} /> Include {draftCount} local {draftCount === 1 ? 'draft' : 'drafts'} in both downloads</label>}
          </fieldset>
          {conflicting && <p className="mt-1 text-amber-800">Compare conflicting drafts in Writing before including them.</p>}
        </dd></div>
        <div><dt className="font-medium">References</dt><dd className={citationCount || referenceCount ? 'text-amber-800' : 'text-slate-700'}>
          {citationCount || referenceCount ? `${citationCount} citation issues · ${referenceCount} LaTeX label issues` : 'No missing or duplicate keys found by the source checks.'}
        </dd></div>
        <div><dt className="font-medium">Compilation</dt><dd role="status" className={result?.warnings ? 'text-amber-800' : 'text-slate-700'}>
          {busy ? 'Compiling the confirmed source ZIP…' : result ? (result.warnings ? 'Compiled with warnings' : 'Compiled successfully') : error ? 'Compilation failed' : 'Ready to generate new submission files'}
        </dd></div>
      </dl>
      {error && <p role="alert" className="break-words text-sm text-red-800">{error}</p>}
      {(error || result?.warnings || (includeDrafts && (citationCount || referenceCount))) && <Button variant="link" className="w-fit px-0" onClick={onProblems}>
        Show Writing problems
      </Button>}
      <div className="flex flex-wrap justify-end gap-2">
        {result ? <>
          <Button variant="outline" onClick={() => download(result.zip, `${name}-source.zip`)}><Download /> Download source ZIP</Button>
          <Button onClick={() => download(result.pdf, `${name}.pdf`)}><Download /> Download submission PDF</Button>
        </> : <Button onClick={onCompile} disabled={busy || !ready || conflicting}>Compile submission files</Button>}
      </div>
    </DialogContent>
  </Dialog>
}
