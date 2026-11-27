'use client'

import { useEffect, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { chatText, chatTransport, ChatToolProgress } from './WritingAiWorkbench'
import { WritingMarkdown } from './WritingMarkdown'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { buildRevisionLetter, type RevisionResponse, type RevisionRound, type RevisionFile } from '@/lib/project/revision-rounds'
import type { SubmissionVersionInfo } from '@/lib/project/submission'
import { revisionDraftSchema } from '@/lib/project/ai-revision'
import { revisionChangeKey, revisionChangeLocation, sameRevisionEvidenceBinding, type RevisionChange, type RevisionEvidenceBinding } from '@/lib/project/revision-evidence'

export function RevisionResponses({ round, baseline, versions, files, changes, binding, reportError, busy, onLink, onSave, onDownloadPackage }: {
  round: RevisionRound; baseline: string; versions: SubmissionVersionInfo[]; files?: RevisionFile[]; reportError?: string
  changes?: RevisionChange[]; binding?: RevisionEvidenceBinding; busy: boolean; onLink: (id?: string) => void
  onSave: (commentId: string, response?: RevisionResponse) => Promise<boolean>
  onDownloadPackage: () => Promise<boolean>
}) {
  const [selected, setSelected] = useState(round.comments[0]?.id ?? '')
  const [preview, setPreview] = useState(false)
  const [exporting, setExporting] = useState(false)
  const comment = round.comments.find(item => item.id === selected)
  const revised = versions.find(version => version.id === round.revisedSubmissionId)
  const letter = files && revised && binding && changes ? buildRevisionLetter(round, baseline, revised.name, files, binding, changes) : undefined
  const unresolved = letter?.unresolved.length ?? round.comments.filter(item => item.response?.kind !== 'retained').length
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
        {round.comments.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.reviewer || 'Reviewer'} · {item.response
          ? item.response.kind === 'changed' && (!letter || letter.unresolved.includes(index + 1)) ? 'Evidence needs review' : 'Answered'
          : 'Awaiting response'}</option>)}
      </select>
    </label>}
    {comment && <>
      <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">{comment.text}</blockquote>
      <ResponseForm key={comment.id} initial={comment.response} changes={changes} binding={binding} busy={busy}
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
    <div className="space-y-2 rounded border p-3 text-sm">
      <p>{revised ? `Use the PDF and source ZIP archived as ${revised.name}, along with the response letter and version manifest.`
        : 'Choose a revised submission to assemble its PDF, source ZIP, and response letter.'}</p>
      {draft && revised && <p className="text-amber-800">Resolve the remaining replies and evidence before exporting the final package.</p>}
      <Button size="sm" disabled={busy || exporting || !letter || draft || !round.comments.length} onClick={async () => {
        setExporting(true)
        try { await onDownloadPackage() }
        finally { setExporting(false) }
      }}>{exporting ? 'Preparing revision package…' : 'Download revision package'}</Button>
    </div>
    {preview && letter && <section aria-label="Response letter preview" className="max-h-64 overflow-auto rounded border bg-slate-50 p-3 text-xs">
      <WritingMarkdown text={letter.markdown} />
    </section>}
  </section>
}

function ResponseForm({ initial, changes, binding, busy, onSave, archive, comment }: {
  initial?: RevisionResponse; changes?: RevisionChange[]; binding?: RevisionEvidenceBinding; busy: boolean
  onSave: (response?: RevisionResponse) => Promise<boolean>
  archive?: { original: string; revised: string; id: string }; comment: string
}) {
  const [kind, setKind] = useState<RevisionResponse['kind']>(initial?.kind ?? 'changed')
  const [text, setText] = useState(initial?.text ?? '')
  const [selection, setSelection] = useState(() => ({ binding: initial?.evidence as RevisionEvidenceBinding | undefined,
    keys: initial?.evidence?.changes.map(revisionChangeKey) ?? [] }))
  const [saved, setSaved] = useState(false)
  const [query, setQuery] = useState('')
  const [aiError, setAiError] = useState('')
  const [proposal, setProposal] = useState<{ key: string; draft: string }>()
  const [preparing, setPreparing] = useState(false)
  const { messages, sendMessage, stop, status, setMessages, clearError } = useChat({
    transport: chatTransport, onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError || !message.metadata?.complete) return
      for (const part of message.parts) {
        if (part.type !== 'tool-propose_reply' || !('output' in part)) continue
        const parsed = revisionDraftSchema.safeParse(part.output)
        if (parsed.success) setProposal({ key, ...parsed.data })
      }
    },
    onError: () => setAiError('Could not stream a draft response. Retry the request.'),
  })
  const aiBusy = preparing || status === 'submitted' || status === 'streaming'
  const streamingReply = messages.at(-1)?.role === 'assistant' ? messages.at(-1) : undefined
  const keys = binding && selection.binding && sameRevisionEvidenceBinding(selection.binding, binding) ? selection.keys : []
  const options = (changes ?? []).filter(change => keys.includes(revisionChangeKey(change)) || change.path.toLowerCase().includes(query.toLowerCase().trim()))
  const picked = (changes ?? []).filter(change => keys.includes(revisionChangeKey(change)))
  const key = JSON.stringify([binding, kind, text, keys, comment])
  const eligible = Boolean(archive && binding && (kind === 'retained' ? text.trim() : picked.length && picked.length <= 6))
  const canSave = !busy && Boolean(text.trim() && (kind === 'retained' || binding && picked.length))
  useEffect(() => {
    if (!saved) return
    const timeout = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timeout)
  }, [saved])

  async function generateReply() {
    if (!eligible || !archive || aiBusy) return
    setPreparing(true)
    setAiError('')
    clearError()
    setMessages([])
    setProposal(undefined)
    try {
      const changes = kind === 'changed' ? picked.map(change => ({ path: change.path,
        status: !change.before ? 'Added' as const : !change.after ? 'Removed' as const : 'Modified' as const,
        before: change.beforeText.slice(0, 1500), after: change.afterText.slice(0, 1500) })) : []
      await sendMessage({ text: 'Draft a reply to this reviewer using only the attached archive evidence and author note.' }, {
        body: { run: crypto.randomUUID(), workflow: 'revision', scope: [], revision: { kind, comment,
          original: archive.original, revised: archive.revised, changes, authorNote: text.slice(0, 1500) } },
      })
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'Could not draft a response.')
    } finally { setPreparing(false) }
  }
  return <form className="space-y-2 rounded border p-2" onSubmit={async event => {
    event.preventDefault()
    if (!canSave) return
    const evidence = kind === 'changed' && binding ? { ...binding, changes: picked.map(({ path, before, after }) => ({ path, before, after })) } : undefined
    if (await onSave({ kind, text: text.trim(), paths: evidence ? [...new Set(picked.map(change => change.path))] : [], evidence })) setSaved(true)
  }}>
    <fieldset disabled={busy || aiBusy} className="space-y-2">
      <label className="grid gap-1 text-sm font-medium">Disposition
        <select className="rounded border p-1.5" value={kind} onChange={event => { setKind(event.target.value === 'retained' ? 'retained' : 'changed'); setSaved(false) }}>
          <option value="changed">Manuscript revised</option><option value="retained">Text retained</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">{kind === 'changed' ? 'Response' : 'Reason for keeping the text'}
        <Textarea value={text} onChange={event => { setText(event.target.value); setSaved(false) }} maxLength={12000} />
      </label>
      {kind === 'changed' && <details className="rounded border p-2 text-sm" open>
        <summary className="cursor-pointer font-medium">Evidence changes · {picked.length} selected</summary>
        {initial?.kind === 'changed' && !initial.evidence && <p className="mt-2 text-amber-800">Review the change locations for this saved reply.</p>}
        {changes?.length ? <label className="mt-2 grid gap-1">Filter changed files<input className="rounded border px-2 py-1" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          : <p className="mt-2 text-muted-foreground">{changes ? 'No text changes are available to select in these archives.' : 'Choose a revised submission to select exact changes.'}</p>}
        <ul className="mt-2 max-h-64 divide-y overflow-auto">
          {options.map(change => {
            const id = revisionChangeKey(change)
            return <li key={id} className="space-y-1 py-2"><label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={keys.includes(id)} disabled={keys.length >= 100 && !keys.includes(id)}
                onChange={event => { setSelection({ binding, keys: event.target.checked ? [...keys, id] : keys.filter(item => item !== id) }); setSaved(false) }} />
              <span className="break-all">{change.path} · {revisionChangeLocation(change)}</span></label>
              <details className="pl-5"><summary className="cursor-pointer text-muted-foreground">View changed text</summary>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="min-w-0">Original<pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-1 text-xs">{change.beforeText || '—'}</pre></div>
                  <div className="min-w-0">Revised<pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-1 text-xs">{change.afterText || '—'}</pre></div>
                </div>
              </details>
            </li>
          })}
        </ul>
      </details>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" disabled={!canSave || aiBusy}>Save response</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || aiBusy || !eligible} onClick={() => void generateReply()}>
        {aiBusy ? 'Drafting with AI…' : 'Draft response with AI'}
      </Button>
      {aiBusy && <Button type="button" size="sm" variant="ghost" disabled={status !== 'streaming' && status !== 'submitted'} onClick={() => void stop()}>Cancel draft</Button>}
      {initial && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={async () => {
        if (await onSave()) { setText(''); setSelection({ binding, keys: [] }); setSaved(false) }
      }}>Mark awaiting response</Button>}
      {saved && <span role="status" className="text-sm">Response saved.</span>}
    </div>
    {streamingReply && aiBusy && <div aria-label="Reply progress" className="space-y-1 rounded border p-2 text-sm">
      <ChatToolProgress message={streamingReply} />
      <p className="whitespace-pre-wrap break-words">{chatText(streamingReply)}</p>
    </div>}
    {aiError && <p role="alert" className="text-sm text-red-800">{aiError}</p>}
    {proposal?.key === key && <section aria-label="AI response draft" className="space-y-2 rounded border bg-slate-50 p-2 text-sm">
      <p className="whitespace-pre-wrap break-words">{proposal.draft}</p>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setText(proposal.draft); setProposal(undefined); setSaved(false) }}>Use AI draft</Button>
    </section>}
  </form>
}
