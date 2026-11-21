'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  applyChapterEdits, buildChapterContext, maxChapterLength, suggestionSchema,
  type ChapterEditRequest, type ChapterSuggestion,
} from '@/lib/project/ai-edit'
import type { ProjectFileSystem } from '@/lib/project/types'
import { findNewUnknownCitations, type BibliographyEntry } from '@/lib/project/references'

interface ChapterAiPanelProps {
  project: ProjectFileSystem
  path: string
  main: string
  source: string
  draft: string
  log: string
  bibliography: BibliographyEntry[]
  disabled: boolean
  onApply: (text: string) => void
}

export function ChapterAiPanel({ project, path, main, source, draft, log, bibliography, disabled, onApply }: ChapterAiPanelProps) {
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<{ suggestion: ChapterSuggestion; draft: string; source: string; main: string }>()
  const requestRef = useRef<AbortController | null>(null)
  const stale = review && (review.draft !== draft || review.source !== source || review.main !== main)
  const unknown = review ? findNewUnknownCitations(path, review.draft,
    applyChapterEdits(review.draft, review.suggestion.edits), bibliography) : []

  useEffect(() => () => requestRef.current?.abort(), [])

  async function requestSuggestion(mode: ChapterEditRequest['mode']) {
    const controller = new AbortController()
    requestRef.current = controller
    setBusy(true)
    setError('')
    setReview(undefined)
    try {
      const response = await fetch('/api/latex/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({
          mode, path, main, source: draft, instruction, log: log.slice(-4000),
          context: buildChapterContext(project, path, main),
        } satisfies ChapterEditRequest),
      })
      const answer = await response.json()
      if (!response.ok) throw new Error(answer.error || 'Could not request a suggestion.')
      const suggestion = suggestionSchema.parse(answer)
      applyChapterEdits(draft, suggestion.edits)
      setReview({ suggestion, draft, source, main })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not request a suggestion.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function apply() {
    if (!review || stale) return
    try {
      onApply(applyChapterEdits(draft, review.suggestion.edits))
      setReview(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the suggestion.')
    }
  }

  return (
    <section aria-label="Chapter AI" className="space-y-3 p-3">
      <h2 className="break-all font-semibold">{path}</h2>
      <p className="text-sm text-muted-foreground">
        Review and rewrite send this chapter, related source excerpts and recent compiler errors to the configured AI provider.
      </p>
      <label className="grid gap-1 text-sm">
        Editing instruction (optional)
        <Textarea value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={1000} disabled={busy} />
      </label>
      {draft.length > maxChapterLength && <p className="text-sm">Chapter AI supports up to {maxChapterLength.toLocaleString()} characters per file.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => requestSuggestion('review')} disabled={busy || disabled || !draft.trim() || draft.length > maxChapterLength}>Review Chapter</Button>
        <Button variant="outline" onClick={() => requestSuggestion('rewrite')} disabled={busy || disabled || !draft.trim() || draft.length > maxChapterLength}>Rewrite Chapter</Button>
      </div>
      {busy && <p role="status">Preparing a suggestion…</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {review && (
        <div className="space-y-3 border-t pt-3">
          <h3 className="font-semibold">Proposed Changes</h3>
          <p className="whitespace-pre-wrap text-sm">{review.suggestion.summary}</p>
          {unknown.length > 0 && <div role="alert" className="rounded border border-amber-500 p-2 text-sm">
            <p className="font-semibold">New unknown citations in the proposed source</p>
            <ul className="list-disc pl-5">
              {unknown.map(item => <li key={item.start}><code>{item.key}</code> · line {item.line}</li>)}
            </ul>
          </div>}
          {review.suggestion.edits.map((edit, index) => (
            <div key={index} className="overflow-hidden rounded border text-xs">
              <div className="bg-red-100 p-2 text-red-950">
                <span className="font-semibold">Before</span>
                <pre className="whitespace-pre-wrap break-words">{edit.before}</pre>
              </div>
              <div className="bg-green-100 p-2 text-green-950">
                <span className="font-semibold">After</span>
                <pre className="whitespace-pre-wrap break-words">{edit.after || '(Removed)'}</pre>
              </div>
            </div>
          ))}
          {stale && <p role="status">The source or main file changed. Request a new suggestion before applying.</p>}
          {review.suggestion.edits.length === 0 && <p className="text-sm">No source changes proposed.</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReview(undefined)}>Discard Suggestion</Button>
            <Button onClick={apply} disabled={Boolean(stale) || disabled || review.suggestion.edits.length === 0}>Apply to Source</Button>
          </div>
        </div>
      )}
    </section>
  )
}
