'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  applyChapterEdits, buildChapterContext, chapterAnswerSchema, maxChapterLength,
  type ChapterEditRequest,
} from '@/lib/project/ai-edit'
import type { ProjectFileSystem } from '@/lib/project/types'
import { findNewUnknownCitations, type BibliographyEntry } from '@/lib/project/references'
import type { z } from 'zod'

interface ChapterAiPanelProps {
  project: ProjectFileSystem
  path: string
  main: string
  source: string
  draft: string
  compiler: ChapterEditRequest['compiler']
  bibliography: BibliographyEntry[]
  disabled: boolean
  onApply: (text: string) => void
  onLocate: (path: string, line: number) => void
}

const toolLabels: Record<z.infer<typeof chapterAnswerSchema>['tools'][number], string> = {
  search_source: 'Cross-file search', read_source: 'Source read', query_references: 'Reference lookup', compile_diagnostics: 'Compiler diagnostics',
  read_csv_rows: 'CSV evidence',
}

export function ChapterAiPanel({ project, path, main, source, draft, compiler, bibliography, disabled, onApply, onLocate }: ChapterAiPanelProps) {
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<{ suggestion: z.infer<typeof chapterAnswerSchema>; draft: string; source: string; main: string;
    files: ProjectFileSystem['files'] }>()
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
          mode, path, main, source: draft, instruction, compiler,
          context: buildChapterContext(project, path, main),
        } satisfies ChapterEditRequest),
      })
      const answer = await response.json()
      if (!response.ok) throw new Error(answer.error || 'Could not request a suggestion.')
      const suggestion = chapterAnswerSchema.parse(answer)
      applyChapterEdits(draft, suggestion.edits)
      if (!controller.signal.aborted) setReview({ suggestion, draft, source, main, files: project.files })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not request a suggestion.')
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false) }
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
    <div className="space-y-3 p-3">
      <h2 className="break-all font-semibold">{path}</h2>
      <p className="text-sm text-muted-foreground">
        The configured AI provider receives this chapter and excerpts it requests from the current project.
      </p>
      <label className="grid gap-1 text-sm">
        Editing instruction (optional)
        <Textarea value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={1000} disabled={busy} />
      </label>
      {draft.length > maxChapterLength && <p className="text-sm">For files over {maxChapterLength.toLocaleString()} characters, use Writing AI and select a passage or name a section.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => requestSuggestion('review')} disabled={busy || disabled || !draft.trim() || draft.length > maxChapterLength}>Review Chapter</Button>
        <Button variant="outline" onClick={() => requestSuggestion('rewrite')} disabled={busy || disabled || !draft.trim() || draft.length > maxChapterLength}>Rewrite Chapter</Button>
      </div>
      {busy && <div className="flex items-center justify-between gap-2"><p role="status" className="text-sm">Preparing a suggestion…</p>
        <Button size="sm" variant="ghost" onClick={() => requestRef.current?.abort()}>Cancel request</Button></div>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {review && (
        <div className="space-y-3 border-t pt-3">
          <h3 className="font-semibold">Proposed Changes</h3>
          <p className="whitespace-pre-wrap text-sm">{review.suggestion.summary}</p>
          {review.suggestion.tools.length > 0 && <details open className="space-y-2 rounded border p-2 text-sm">
            <summary className="cursor-pointer font-medium">Project evidence · {review.suggestion.tools.length} tool calls</summary>
            <p className="text-xs text-slate-600">{[...new Set(review.suggestion.tools)].map(kind =>
              `${toolLabels[kind]} (${review.suggestion.tools.filter(call => call === kind).length})`).join(' · ')}</p>
            <ul className="max-h-60 divide-y overflow-auto">
              {review.suggestion.evidence.filter(item => item.text.trim()).map(item => {
                const before = review.files.get(item.path)
                const now = project.files.get(item.path)
                const available = Boolean(before && now && 'content' in before && 'content' in now && before.content === now.content)
                return <li key={`${item.kind}:${item.path}:${item.line}`} className="py-1">
                  <button type="button" disabled={!available} onClick={() => onLocate(item.path, item.line)}
                    className="break-all text-left font-mono text-xs underline disabled:no-underline disabled:opacity-60">{item.path}:{item.line}</button>
                  <p className="break-words text-xs text-slate-600">{item.text}{!available && ' · Source changed'}</p>
                </li>
              })}
            </ul>
          </details>}
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
    </div>
  )
}
