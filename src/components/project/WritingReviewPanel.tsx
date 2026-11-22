'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { researchCardNames, researchCardStatuses } from '@/lib/project/canvas-card-kinds'
import { researchNodeTitle, type CanvasLocation } from '@/lib/project/canvas-search'
import type { CanvasSourceCatalog } from '@/lib/project/canvas-source-links'
import type { SourceLocation } from '@/lib/project/latex-source'
import type { ResearchCanvas } from '@/lib/project/research-graph'
import { reviewTarget, reviewTargetChoices, type ReviewItem, type ReviewRole, type ReviewStatus, type ReviewTarget } from '@/lib/project/review-links'

export interface WritingReviewActions {
  items: ReviewItem[]
  bind: (location: CanvasLocation | undefined, pageId: string, role: ReviewRole, note: string, target: ReviewTarget) => boolean
  status: (item: CanvasLocation, status: ReviewStatus) => void
  locateCanvas: (item: CanvasLocation) => void
}

export function WritingReviewPanel({ path, line, catalog, canvas, actions, canSelect, readSelection, onLocate }: {
  path: string
  line: number
  catalog: CanvasSourceCatalog
  canvas: ResearchCanvas
  actions: WritingReviewActions
  canSelect: boolean
  readSelection: () => ReviewTarget | undefined
  onLocate: (location: SourceLocation) => void
}) {
  const [scope, setScope] = useState('section')
  const [card, setCard] = useState('review')
  const [target, setTarget] = useState('')
  const [selection, setSelection] = useState<ReviewTarget>()
  const [page, setPage] = useState(canvas.activePageId)
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState<{ text: string; error?: true }>()
  const choices = useMemo(() => reviewTargetChoices(catalog, path), [catalog, path])
  const headings = catalog.index.entries.filter(heading => heading.path === path).sort((first, second) => first.start - second.start)
  const section = headings.findLast(heading => heading.line <= line)
  const nextSection = section && headings[headings.indexOf(section) + 1]
  const visible = actions.items.filter(item => scope === 'all' || (item.source?.path === path
    && (scope === 'file' || !section || (item.source.line >= section.line && (!nextSection || item.source.line < nextSection.line)))))
  const existing = actions.items.find(item => item.nodeId === card)
  const role = existing?.resource.role ?? (card === 'task' ? 'task' : 'review')
  const destination = canvas.pages.some(item => item.id === page) ? page : canvas.activePageId
  const chosen = target === 'selection' ? selection : choices.find(choice => JSON.stringify(choice.target) === target)?.target

  return <section aria-label="Writing review" className="space-y-3 p-3">
    <form className="space-y-2 rounded border p-3" onSubmit={event => {
      event.preventDefault()
      if (!chosen || (!existing && !note.trim())) return
      if (!actions.bind(existing, destination, role, note.trim(), chosen)) {
        setFeedback({ text: 'The source target is unavailable. Choose or capture it again.', error: true })
        return
      }
      setNote('')
      setFeedback({ text: existing ? 'Canvas card linked.' : 'Linked Canvas card created.' })
    }}>
      <h3 className="text-sm font-medium">Link a review card</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-xs">Review card
          <select className="min-w-0 rounded border bg-background p-1.5" value={card} onChange={event => setCard(event.target.value)}>
            <option value="review">New review comment</option>
            <option value="task">New to-do</option>
            <optgroup label="Existing Canvas cards">
              {actions.items.map(item => <option key={item.nodeId} value={item.nodeId}>
                {researchNodeTitle(item.data)} · {item.pageName}
              </option>)}
            </optgroup>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs">Source target
          <select className="min-w-0 rounded border bg-background p-1.5" value={target} onChange={event => {
            setTarget(event.target.value)
            setFeedback(undefined)
          }}>
            <option value="">Choose a source target</option>
            {canSelect && <option value="selection">Selected source text</option>}
            {choices.map(choice => {
              const value = JSON.stringify(choice.target)
              return <option key={value} value={value}>
                {choice.target.type === 'section' ? 'Section' : 'Formula'} · {choice.title} · line {choice.source.line}
              </option>
            })}
          </select>
        </label>
      </div>
      {target === 'selection' && <div className="space-y-1">
        <Button type="button" size="sm" variant="outline" onClick={() => {
          const captured = readSelection()
          setSelection(captured)
          setFeedback(captured ? undefined : { text: 'Select identifiable text in the editor, then capture it again.', error: true })
        }}>Capture editor selection</Button>
        {selection?.type === 'selection' && <p className="line-clamp-2 break-words font-mono text-xs">{selection.anchor.quote}</p>}
      </div>}
      {!existing && <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="grid content-start gap-1 text-xs">Canvas page
          <select className="min-w-0 rounded border bg-background p-1.5" value={destination} onChange={event => setPage(event.target.value)}>
            {canvas.pages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs">Comment or task
          <Textarea rows={2} value={note} onChange={event => setNote(event.target.value)} />
        </label>
      </div>}
      <Button size="sm" type="submit" disabled={!chosen || (!existing && !note.trim())}>
        {existing ? 'Link existing card' : 'Add linked card'}
      </Button>
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-xs text-destructive' : 'text-xs'}>{feedback.text}</p>}
    </form>
    <label className="flex flex-wrap items-center gap-2 text-sm">Show review cards
      <select className="rounded border bg-background p-1 text-xs" value={scope} onChange={event => setScope(event.target.value)}>
        <option value="section">Current section</option>
        <option value="file">Current file</option>
        <option value="all">All Canvas pages</option>
      </select>
    </label>
    {scope === 'section' && section && <p className="break-words text-xs text-muted-foreground">{section.title}</p>}
    {!visible.length && <p className="text-sm text-muted-foreground">No review cards in this scope.</p>}
    <ul className="space-y-2">
      {visible.map(item => <li key={item.nodeId} className="space-y-1 rounded border p-2">
        <p className="break-words text-sm font-medium">{researchNodeTitle(item.data)}</p>
        <p className="break-words text-xs text-muted-foreground">{researchCardNames[item.resource.role]} · {item.pageName}</p>
        {item.data.content && <p className="whitespace-pre-wrap break-words text-sm">{item.data.content}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">Status
            <select aria-label={`Status for ${researchNodeTitle(item.data)}`} className="rounded border bg-background p-1 capitalize"
              value={item.resource.status ?? 'open'} onChange={event => {
                const status = researchCardStatuses.find(value => value === event.target.value)
                if (status) actions.status(item, status)
              }}>
              {researchCardStatuses.map(status => <option key={status}>{status}</option>)}
            </select>
          </label>
          {item.source
            ? <button type="button" className="break-all text-left font-mono text-xs underline" onClick={() => { if (item.source) onLocate(item.source) }}>
              {item.source.path}:{item.source.line}
            </button>
            : <span className="text-xs text-muted-foreground">{reviewTarget(item.data) ? 'Source link unavailable' : 'No source link'}</span>}
          <Button size="sm" variant="ghost" onClick={() => actions.locateCanvas(item)}>Locate on Canvas</Button>
        </div>
      </li>)}
    </ul>
  </section>
}
