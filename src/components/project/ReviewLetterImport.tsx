'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { maxReviewCommentLength, maxReviewLetterComments, splitReviewLetter, type ReviewLetterComment } from '@/lib/project/review-letter'
import type { RevisionComment, RevisionCommentTarget } from '@/lib/project/revision-rounds'

type Draft = ReviewLetterComment & { id: string; source: string }

function makeDraft(comment: ReviewLetterComment): Draft {
  return { ...comment, id: crypto.randomUUID(), source: '' }
}

export function ReviewLetterImport({ targets, busy, onImport }: {
  targets: { title: string; target: RevisionCommentTarget }[]
  busy: boolean
  onImport: (comments: RevisionComment[]) => Promise<boolean>
}) {
  const [letter, setLetter] = useState('')
  const [preview, setPreview] = useState<{ source: string; rows: Draft[] }>()
  const [error, setError] = useState('')
  const choices = targets.map(item => ({ ...item, value: JSON.stringify(item.target) }))
  const rows = preview?.rows ?? []
  const dirty = preview && preview.source !== letter
  const invalid = rows.some(row => !row.text.trim() || row.text.trim().length > maxReviewCommentLength || row.reviewer.trim().length > 100)

  function previewLetter() {
    setError('')
    try { setPreview({ source: letter, rows: splitReviewLetter(letter).map(makeDraft) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not preview the review letter.') }
  }

  function changeRow(id: string, change: Partial<Omit<Draft, 'id'>>) {
    setError('')
    setPreview(current => current && { ...current, rows: current.rows.map(row => row.id === id ? { ...row, ...change } : row) })
  }

  async function addComments() {
    if (!rows.length || busy || dirty || invalid) return
    setError('')
    const comments: RevisionComment[] = []
    for (const row of rows) {
      const target: RevisionCommentTarget | undefined = row.source ? choices.find(item => item.value === row.source)?.target : { type: 'manuscript' }
      if (!target) { setError('A selected source target has changed. Choose it again before adding the comments.'); return }
      comments.push({ id: row.id, kind: 'comment', reviewer: row.reviewer.trim(), text: row.text.trim(), target })
    }
    await onImport(comments)
  }

  return <div className="grid items-start gap-3 md:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
    <div className="min-w-0 space-y-2">
      <label className="block space-y-1 text-sm font-medium">Review letter
        <Textarea value={letter} rows={12} disabled={busy} onChange={event => { setLetter(event.target.value); setError('') }}
          placeholder={'Editor:\n…\n\nReviewer 1:\n1. …\n\nReviewer 2:\n1. …'} />
      </label>
      <Button type="button" size="sm" variant="outline" disabled={busy || !letter.trim()} onClick={previewLetter}>Preview comments</Button>
      {dirty && <p role="status" className="text-xs text-muted-foreground">Preview again to use the changes in the pasted letter.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
    {preview && <section aria-label="Review letter preview" className="min-w-0 space-y-2 rounded border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <h3 className="text-sm font-medium">Preview · {rows.length} {rows.length === 1 ? 'comment' : 'comments'}</h3>
        <Button type="button" variant="outline" size="sm" disabled={busy || rows.length >= maxReviewLetterComments}
          onClick={() => setPreview(current => current && { ...current, rows: [...current.rows, makeDraft({ reviewer: '', text: '' })] })}>Add a comment</Button>
      </div>
      <div className="divide-y md:max-h-[46dvh] md:overflow-y-auto">
        {rows.map((row, index) => <fieldset key={row.id} aria-label={`Comment ${index + 1}`} disabled={busy} className="min-w-0 space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-primary">Comment {index + 1}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(current => current && {
              ...current, rows: current.rows.filter(item => item.id !== row.id),
            })}>Remove</Button>
          </div>
          <label className="block space-y-1 text-xs font-medium">Reviewer or editor
            <Input value={row.reviewer} placeholder="Unassigned" maxLength={100} onChange={event => changeRow(row.id, { reviewer: event.target.value })} />
          </label>
          <label className="block space-y-1 text-xs font-medium">Comment text
            <Textarea value={row.text} rows={3} onChange={event => changeRow(row.id, { text: event.target.value })} />
          </label>
          <label className="block space-y-1 text-xs font-medium">Source target
            <select className="block w-full rounded border bg-background p-1.5 text-sm" value={row.source} onChange={event => changeRow(row.id, { source: event.target.value })}>
              <option value="">Whole manuscript</option>
              {choices.map(item => <option key={item.value} value={item.value}>{item.title}</option>)}
            </select>
          </label>
        </fieldset>)}
        {!rows.length && <p className="p-3 text-sm text-muted-foreground">Preview a letter or add a comment.</p>}
      </div>
      <div className="space-y-2 border-t p-3">
        {invalid && <p className="text-xs text-muted-foreground">Enter text for every comment. Each comment can have up to 12,000 characters.</p>}
        <Button type="button" size="sm" disabled={busy || Boolean(dirty) || invalid || !rows.length} onClick={() => void addComments()}>
          Add {rows.length} {rows.length === 1 ? 'comment' : 'comments'} to the round
        </Button>
      </div>
    </section>}
  </div>
}
