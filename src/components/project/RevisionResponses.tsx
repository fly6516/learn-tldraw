'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { buildRevisionLetter, type RevisionResponse, type RevisionRound, type RevisionFile } from '@/lib/project/revision-rounds'
import type { SubmissionVersionInfo } from '@/lib/project/submission'
import { archiveReplyEvidence, revisionDraftSchema } from '@/lib/project/ai-revision'

export function RevisionResponses({ round, baseline, versions, files, reportError, paths, busy, onLink, onSave }: {
  round: RevisionRound; baseline: string; versions: SubmissionVersionInfo[]; files?: RevisionFile[]; reportError?: string
  paths: string[]; busy: boolean; onLink: (id?: string) => void
  onSave: (commentId: string, response?: RevisionResponse) => Promise<boolean>
}) {
  const [selected, setSelected] = useState(round.comments[0]?.id ?? '')
  const [preview, setPreview] = useState(false)
  const comment = round.comments.find(item => item.id === selected)
  const revised = versions.find(version => version.id === round.revisedSubmissionId)
  const letter = files && revised ? buildRevisionLetter(round, baseline, revised.name, files) : undefined
  const unresolved = letter?.unresolved.length ?? round.comments.filter(item => !item.response).length
  const draft = unresolved > 0

  function downloadLetter() {
    if (!letter) return
    const url = URL.createObjectURL(new Blob([letter.markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    const safeName = round.name.replace(/[^\p{L}\p{N}_. -]+/gu, '-').trim().replace(/[. ]+$/, '') || 'revision'
    link.download = `${safeName}${draft ? '-draft' : ''}-response.md`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  return <section aria-label="Revision responses" className="space-y-3">
    <label className="grid gap-1 text-sm font-medium">Revised submission
      <select className="max-w-full rounded border p-1.5" disabled={busy} value={round.revisedSubmissionId ?? ''}
        onChange={event => { setPreview(false); onLink(event.target.value || undefined) }}>
        <option value="">Choose an archived revised version</option>
        {versions.map(item => <option key={item.id} value={item.id}>{item.name} · {new Date(item.createdAt).toLocaleString()}</option>)}
      </select>
    </label>
    {!versions.length && <p className="text-sm text-slate-600">Save the revised manuscript in Prepare submission to verify evidence and export the letter.</p>}
    {round.comments.length > 0 && <label className="grid gap-1 text-sm font-medium">Comment to answer
      <select className="max-w-full rounded border p-1.5" value={selected} onChange={event => setSelected(event.target.value)}>
        {round.comments.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.reviewer || 'Reviewer'} · {item.response ? 'Answered' : 'Awaiting response'}</option>)}
      </select>
    </label>}
    {comment && <>
      <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{comment.text}</blockquote>
      <ResponseForm key={comment.id} initial={comment.response} paths={paths} files={files} busy={busy}
        archive={revised ? { original: baseline, revised: revised.name, id: revised.id } : undefined} comment={comment.text}
        onSave={response => onSave(comment.id, response)} />
    </>}
    {reportError && <p role="alert" className="text-sm text-red-800">{reportError}</p>}
    {revised && !letter && !reportError && <p role="status" className="text-sm">Comparing the archived submission ZIPs…</p>}
    {draft && <p role="status" className="text-sm text-amber-800">{unresolved} {unresolved === 1 ? 'comment needs' : 'comments need'} a response or verified evidence.</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!letter || !round.comments.length} onClick={() => setPreview(value => !value)}>{preview ? 'Hide response letter' : 'Preview response letter'}</Button>
      <Button size="sm" disabled={!letter || !round.comments.length} onClick={downloadLetter}>{draft ? 'Download Markdown draft' : 'Download response Markdown'}</Button>
    </div>
    {preview && letter && <pre aria-label="Response letter preview" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border bg-slate-50 p-3 text-xs">{letter.markdown}</pre>}
  </section>
}

function ResponseForm({ initial, paths, files, busy, onSave, archive, comment }: {
  initial?: RevisionResponse; paths: string[]; files?: RevisionFile[]; busy: boolean
  onSave: (response?: RevisionResponse) => Promise<boolean>
  archive?: { original: string; revised: string; id: string }; comment: string
}) {
  const [kind, setKind] = useState<RevisionResponse['kind']>(initial?.kind ?? 'changed')
  const [text, setText] = useState(initial?.text ?? '')
  const [selected, setSelected] = useState(initial?.paths ?? [])
  const [saved, setSaved] = useState(false)
  const [query, setQuery] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [proposal, setProposal] = useState<{ key: string; draft: string }>()
  const aiRequest = useRef<AbortController | null>(null)
  useEffect(() => () => aiRequest.current?.abort(), [])
  const states = new Map(files?.map(file => [file.path, file.status]))
  const options = [...new Set([...selected, ...paths])].sort().filter(path => selected.includes(path) || path.toLowerCase().includes(query.toLowerCase().trim()))
  const key = JSON.stringify([archive?.id, kind, text, selected, comment])
  const eligible = Boolean(archive && files && (kind === 'retained' ? text.trim() : selected.some(path => states.has(path) && states.get(path) !== 'Unchanged')))
  useEffect(() => {
    if (!saved) return
    const timeout = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timeout)
  }, [saved])

  async function generateReply() {
    if (!eligible || !files || !archive || aiBusy) return
    const controller = new AbortController()
    aiRequest.current = controller
    setAiBusy(true); setAiError(''); setProposal(undefined)
    try {
      const changes = kind === 'changed' ? await archiveReplyEvidence(files, selected) : []
      const response = await fetch('/api/latex/revision-response', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, comment, original: archive.original,
          revised: archive.revised, changes, authorNote: text.slice(0, 1500) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not draft a response.')
      if (!controller.signal.aborted) setProposal({ key, ...revisionDraftSchema.parse(data) })
    } catch (cause) {
      if (!controller.signal.aborted) setAiError(cause instanceof Error ? cause.message : 'Could not draft a response.')
    } finally {
      if (aiRequest.current === controller) { aiRequest.current = null; setAiBusy(false) }
    }
  }
  return <form className="space-y-2 rounded border p-2" onSubmit={async event => {
    event.preventDefault()
    if (busy || !text.trim() || (kind === 'changed' && !selected.length)) return
    if (await onSave({ kind, text: text.trim(), paths: kind === 'changed' ? selected : [] })) setSaved(true)
  }}>
    <fieldset disabled={busy} className="space-y-2">
      <label className="grid gap-1 text-sm font-medium">Disposition
        <select className="rounded border p-1.5" value={kind} onChange={event => { setKind(event.target.value === 'retained' ? 'retained' : 'changed'); setSaved(false) }}>
          <option value="changed">Manuscript revised</option><option value="retained">Text retained</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">{kind === 'changed' ? 'Response' : 'Reason for keeping the text'}
        <Textarea value={text} onChange={event => { setText(event.target.value); setSaved(false) }} maxLength={12000} />
      </label>
      {kind === 'changed' && <details className="rounded border p-2 text-sm" open>
        <summary className="cursor-pointer font-medium">Evidence files · {selected.length} selected</summary>
        <label className="mt-2 grid gap-1">Filter evidence files<input className="rounded border px-2 py-1" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <ul className="mt-2 max-h-36 overflow-auto">
          {options.map(path => <li key={path}><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={selected.includes(path)}
            onChange={event => { setSelected(previous => event.target.checked ? [...previous, path] : previous.filter(item => item !== path)); setSaved(false) }} />
            <span className="break-all">{path}{files && ` · ${states.get(path) ?? 'Outside both ZIPs'}`}</span></label></li>)}
        </ul>
      </details>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" disabled={busy || !text.trim() || (kind === 'changed' && !selected.length)}>Save response</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || aiBusy || !eligible} onClick={() => void generateReply()}>
        {aiBusy ? 'Drafting with AI…' : 'Draft response with AI'}
      </Button>
      {aiBusy && <Button type="button" size="sm" variant="ghost" onClick={() => aiRequest.current?.abort()}>Cancel draft</Button>}
      {initial && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
        if (await onSave()) { setText(''); setSelected([]); setSaved(false) }
      }}>Mark awaiting response</Button>}
      {saved && <span role="status" className="text-sm">Response saved.</span>}
    </div>
    {aiError && <p role="alert" className="text-sm text-red-800">{aiError}</p>}
    {proposal?.key === key && <section aria-label="AI response draft" className="space-y-2 rounded border bg-slate-50 p-2 text-sm">
      <p className="whitespace-pre-wrap break-words">{proposal.draft}</p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setText(proposal.draft); setProposal(undefined); setSaved(false) }}>Use AI draft</Button>
    </section>}
  </form>
}
