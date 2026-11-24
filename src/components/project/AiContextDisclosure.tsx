'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { aiReadExclusionsSchema, type AiContextReceipt } from '@/lib/project/ai-read-scope'

const kinds = { saved: 'Saved source', draft: 'Local draft', csv: 'CSV source', csv_draft: 'CSV draft',
  attachment: 'Attachment name and size', archive: 'Archived source excerpts', pdf_page: 'PDF page text', image: 'Image content' }

export function AiContextDetails({ receipt, recipient, historyCount }: {
  receipt: AiContextReceipt; recipient?: string; historyCount?: number
}) {
  return <div className="space-y-2 break-words text-xs">
    <p><strong>Model:</strong> {recipient ?? 'Awaiting model information'}</p>
    {receipt.confirmation && <p>{({ approved: 'Context confirmed for this request.', reused: 'Existing context approval reused.',
      local: 'Processed by the local example or test model.' })[receipt.confirmation]}</p>}
    <p>Includes the current prompt{receipt.taskNotes && ', the current manuscript task notes'}{receipt.reviewerComment && ', the selected reviewer comment and author note'}.</p>
    <p>{historyCount !== undefined ? `${historyCount} earlier chat messages sent.`
      : receipt.restricted ? 'Earlier chat messages withheld.' : 'Up to 23 earlier messages may be included.'} {receipt.diagnostics ? 'Compiler diagnostics or logs included.' : 'No compiler diagnostics included.'}</p>
    {receipt.files.length > 0 && <ul aria-label="Model context files" className="max-h-52 space-y-1 overflow-auto">
      {receipt.files.map(file => <li key={`${file.kind}:${file.path}:${file.lines?.start ?? ''}`} className="break-all">
        <span className="font-mono">{file.path}</span> · {kinds[file.kind]}{file.lines
          ? ` · Lines ${file.lines.start}–${file.lines.end}` : file.partial && ' · Excerpt'}{file.page && ` · Page ${file.page}`}
      </li>)}
    </ul>}
  </div>
}

export function AiContextPreview({ receipt, recipient, purpose, onSend, onClose }: {
  receipt: AiContextReceipt; recipient: string; purpose: string; onSend: () => void; onClose: () => void
}) {
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-auto">
      <DialogTitle>Review model context</DialogTitle>
      <DialogDescription className="break-words">{purpose}. These files and excerpts are available to tools during this request. Editing permissions are set separately.</DialogDescription>
      <AiContextDetails receipt={receipt} recipient={recipient} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={onSend}>Send reviewed request</Button>
      </div>
    </DialogContent>
  </Dialog>
}

export function AiReadExclusionsDialog({ rules, onClose, onSave }: { rules: readonly string[]; onClose: () => void; onSave: (rules: string[]) => void }) {
  const [value, setValue] = useState(rules.join('\n'))
  const [error, setError] = useState('')
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent>
      <DialogTitle>Project AI read exclusions</DialogTitle>
      <DialogDescription>Enter one project-relative file path per line. End a folder name with / to withhold its contents.
        When exclusions are active, earlier chat messages and compiler logs are withheld too.
        Text typed in the current prompt and references inside shared files can still reach the model.</DialogDescription>
      <Textarea aria-label="Excluded project paths" value={value} onChange={event => setValue(event.target.value)}
        placeholder={'private/\nsections/unpublished.tex'} className="min-h-36 font-mono text-xs" />
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          const parsed = aiReadExclusionsSchema.safeParse([...new Set(value.split(/\r?\n/).map(path => path.trim()).filter(Boolean))])
          if (!parsed.success) { setError('Enter up to 512 valid project-relative paths.'); return }
          onSave(parsed.data)
        }}>Save read exclusions</Button>
      </div>
    </DialogContent>
  </Dialog>
}
