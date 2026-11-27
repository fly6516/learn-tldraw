'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { researchNodeTitle } from '@/lib/project/canvas-search'
import type { CanvasSourceCatalog } from '@/lib/project/canvas-source-links'
import type { SourceLocation } from '@/lib/project/latex-source'
import { resolveReviewTarget, reviewTargetChoices, type ReviewItem } from '@/lib/project/review-links'
import { compareRevisionFiles, readRevisionBaseline, type RevisionComment, type RevisionFile, type RevisionRound } from '@/lib/project/revision-rounds'
import { addRevisionComments, createRevisionRound, linkRevisedSubmission, listRevisionRounds, listSubmissionVersions, readRevisionPackage, readSubmissionFiles, saveRevisionResponse } from '@/lib/project/storage'
import { buildRevisionPackage } from '@/lib/project/revision-package'
import { checkedRevisionZipDigest, compareRevisionChanges, type RevisionChange, type RevisionEvidenceBinding } from '@/lib/project/revision-evidence'
import type { SubmissionVersionInfo } from '@/lib/project/submission'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { WritingKey } from '@/lib/project/writing-drafts'
import { RevisionFileComparison } from './RevisionFileComparison'
import { RevisionResponses } from './RevisionResponses'
import { ReviewLetterImport } from './ReviewLetterImport'
import { download, submissionFilename } from './SubmissionDialog'

export function RevisionRoundsDialog({ database, storageKey, initialSubmission, roundId, onSelectRound, current,
  catalog, cards, drafts, conflicts, openSource, openCanvas, onClose }: {
  database: IDBDatabase; storageKey: WritingKey; initialSubmission?: string; roundId?: string
  onSelectRound: (id: string) => void; current: ProjectFileSystem; catalog: CanvasSourceCatalog
  cards: ReviewItem[]; drafts: ReadonlySet<string>; conflicts: readonly string[]
  openSource: (path: string, location?: SourceLocation) => void; openCanvas: (card: ReviewItem) => void; onClose: () => void
}) {
  const [library, setLibrary] = useState<{ rounds: RevisionRound[]; versions: SubmissionVersionInfo[] }>()
  const [submissionId, setSubmissionId] = useState(initialSubmission ?? '')
  const [showCreate, setShowCreate] = useState(Boolean(initialSubmission))
  const [name, setName] = useState('')
  const [tab, setTab] = useState<'comments' | 'files' | 'responses'>('comments')
  const [compareArchived, setCompareArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState<{ id: string; baseline?: ProjectFileSystem; sha256?: string; error?: string }>()
  const [revised, setRevised] = useState<{ id: string; baseline: ProjectFileSystem; project?: ProjectFileSystem; files?: RevisionFile[];
    binding?: RevisionEvidenceBinding; changes?: RevisionChange[]; error?: string }>()
  const round = library?.rounds.find(item => item.id === roundId) ?? library?.rounds[0]
  const version = library?.versions.find(item => item.id === round?.submissionId)
  const createVersion = submissionId || library?.versions[0]?.id || ''

  useEffect(() => {
    let active = true
    void Promise.all([listRevisionRounds(database, storageKey), listSubmissionVersions(database, storageKey)])
      .then(([rounds, versions]) => { if (active) setLibrary({ rounds, versions }) })
      .catch(() => { if (active) setError('Could not load revision rounds and submissions.') })
    return () => { active = false }
  }, [database, storageKey])

  const baselineId = tab !== 'comments' ? round?.submissionId : undefined
  const revisedId = tab !== 'comments' ? round?.revisedSubmissionId : undefined
  const baselineChecksum = version?.sourceChecksum
  const revisedVersion = library?.versions.find(item => item.id === revisedId)
  const revisedChecksum = revisedVersion?.sourceChecksum
  useEffect(() => {
    if (!baselineId) return
    let active = true
    void readSubmissionFiles(database, storageKey, baselineId).then(async files => {
      if (!files) throw new Error('The archived source ZIP is unavailable.')
      const [baseline, sha256] = await Promise.all([readRevisionBaseline(files.zip), checkedRevisionZipDigest(files.zip, baselineChecksum)])
      if (active) setLoaded({ id: baselineId, baseline, sha256 })
    })
      .catch(cause => { if (active) setLoaded({ id: baselineId, error: cause instanceof Error ? cause.message : 'Could not read the archived source ZIP.' }) })
    return () => { active = false }
  }, [baselineId, baselineChecksum, database, storageKey])

  const baseline = loaded?.id === baselineId ? loaded?.baseline : undefined
  const baselineSha256 = loaded?.id === baselineId ? loaded?.sha256 : undefined
  useEffect(() => {
    if (!revisedId || !baseline || !baselineId || !baselineSha256) return
    let active = true
    void readSubmissionFiles(database, storageKey, revisedId).then(async files => {
      if (!files) throw new Error('The revised source ZIP is unavailable.')
      const [project, revisedSha256] = await Promise.all([readRevisionBaseline(files.zip), checkedRevisionZipDigest(files.zip, revisedChecksum)])
      const compared = await compareRevisionFiles(baseline, project)
      return { id: revisedId, baseline, project, files: compared, changes: await compareRevisionChanges(compared),
        binding: { originalId: baselineId, revisedId, originalSha256: baselineSha256, revisedSha256 } }
    }).then(result => { if (active) setRevised(result) })
      .catch(cause => { if (active) setRevised({ id: revisedId, baseline, error: cause instanceof Error ? cause.message : 'Could not compare the revised ZIP.' }) })
    return () => { active = false }
  }, [baseline, baselineId, baselineSha256, revisedChecksum, revisedId, database, storageKey])

  const revisedArchive = revised?.id === revisedId && revised?.baseline === baseline ? revised : undefined
  const updateRound = (updated: RevisionRound) => setLibrary(previous => previous && {
    ...previous, rounds: previous.rounds.map(item => item.id === updated.id ? updated : item),
  })

  async function perform(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action(); return true }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the revision round.'); return false }
    finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent showCloseButton={!busy} className="max-h-[92dvh] overflow-auto sm:max-w-[min(90vw,62rem)]">
      <DialogTitle>Revision rounds</DialogTitle>
      <DialogDescription>Collect reviewer comments and compare the manuscript with the source ZIP saved at submission.</DialogDescription>
      {!library && !error && <p role="status">Loading revision rounds…</p>}
      {library && <>
        <div className="flex flex-wrap items-end gap-2">
          {library.rounds.length > 0 && <label className="grid gap-1 text-sm font-medium">Revision round
            <select className="max-w-full rounded border p-1.5 text-sm" value={round?.id} disabled={busy} onChange={event => {
              onSelectRound(event.target.value); setShowCreate(false); setCompareArchived(false); setTab('comments')
            }}>{library.rounds.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>}
          {!showCreate && library.versions.length > 0 && <Button type="button" size="sm" variant="outline" disabled={busy}
            onClick={() => setShowCreate(true)}>New revision round</Button>}
        </div>
        {!library.versions.length && <p className="text-sm text-muted-foreground">Save a submission version in Prepare submission to start a revision round.</p>}
        {showCreate && library.versions.length > 0 && <form className="flex flex-wrap items-end gap-2 rounded border p-2" onSubmit={event => {
          event.preventDefault()
          if (busy || !name.trim() || !createVersion) return
          void perform(async () => {
            const item = { id: crypto.randomUUID(), name: name.trim(), submissionId: createVersion, createdAt: new Date().toISOString(), comments: [] }
            await createRevisionRound(database, storageKey, item)
            setLibrary(previous => previous && { ...previous, rounds: [item, ...previous.rounds] })
            onSelectRound(item.id)
            setShowCreate(false)
            setName('')
            setCompareArchived(false)
            setTab('comments')
          })
        }}>
          <label className="grid gap-1 text-sm font-medium">Archived submission
            <select className="max-w-full rounded border p-1.5 text-sm" value={createVersion} disabled={busy} onChange={event => setSubmissionId(event.target.value)}>
              {library.versions.map(item => <option key={item.id} value={item.id}>{item.name} · {new Date(item.createdAt).toLocaleString()}</option>)}
            </select>
          </label>
          <label className="grid flex-1 gap-1 text-sm font-medium">Round name<Input value={name} onChange={event => setName(event.target.value)} maxLength={100} disabled={busy} /></label>
          <Button type="submit" disabled={busy || !name.trim()}>Create revision round</Button>
          <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
        </form>}
      </>}
      {round && <>
        <p className="break-words text-sm">Submission baseline <strong>{version?.name ?? 'Archive unavailable'}</strong>
          {version && <span> · {new Date(version.createdAt).toLocaleString()} · <code>{version.main}</code></span>}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Revision view">
          <Button size="sm" variant={tab === 'comments' ? 'default' : 'outline'} aria-pressed={tab === 'comments'} onClick={() => setTab('comments')}>Reviewer comments</Button>
          <Button size="sm" variant={tab === 'files' ? 'default' : 'outline'} aria-pressed={tab === 'files'} onClick={() => setTab('files')}>Compare files</Button>
          <Button size="sm" variant={tab === 'responses' ? 'default' : 'outline'} aria-pressed={tab === 'responses'} onClick={() => setTab('responses')}>Responses and letter</Button>
        </div>
        {tab === 'comments' && <RoundComments key={round.id} round={round} current={current} catalog={catalog} cards={cards} busy={busy}
          openSource={openSource} openCanvas={openCanvas} onAdd={comments => perform(async () => {
            updateRound(await addRevisionComments(database, storageKey, round.id, comments))
          })} />}
        {tab === 'files' && <>
          {revisedVersion && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compareArchived}
            onChange={event => setCompareArchived(event.target.checked)} /> Compare the revised submission ZIP</label>}
          {baseline && (!compareArchived || !revisedVersion || revisedArchive?.project)
            ? <RevisionFileComparison key={`${round.id}:${compareArchived && revisedVersion?.id || 'current'}`} baseline={baseline}
              current={(compareArchived && revisedArchive?.project) || current} baselineName={version?.name ?? 'Submission'}
              revisedName={compareArchived && revisedArchive?.project ? revisedVersion?.name : undefined}
              drafts={drafts} conflicts={conflicts} openSource={path => openSource(path)} />
            : (loaded?.id === baselineId && loaded?.error) || revisedArchive?.error
              ? <p role="alert">{loaded?.error || revisedArchive?.error}</p> : <p role="status">Reading the archived source ZIP…</p>}
        </>}
        {tab === 'responses' && <RevisionResponses key={round.id} round={round} baseline={version?.name ?? 'Original submission'} busy={busy}
          versions={(library?.versions ?? []).filter(item => item.id !== round.submissionId && (!version || item.createdAt >= version.createdAt))}
          files={revisedArchive?.files} changes={revisedArchive?.changes} binding={revisedArchive?.binding}
          reportError={(loaded?.id === baselineId ? loaded?.error : undefined) ?? revisedArchive?.error}
          onDownloadPackage={() => perform(async () => {
            const input = await readRevisionPackage(database, storageKey, round)
            const bundle = await buildRevisionPackage(input)
            download(bundle, `${submissionFilename(round.name)}-revision.zip`)
          })}
          onLink={id => void perform(async () => { updateRound(await linkRevisedSubmission(database, storageKey, round.id, id)) })}
          onSave={(commentId, response) => perform(async () => { updateRound(await saveRevisionResponse(database, storageKey, round.id, commentId, response)) })} />}
      </>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </DialogContent>
  </Dialog>
}

function RoundComments({ round, current, catalog, cards, busy, openSource, openCanvas, onAdd }: {
  round: RevisionRound; current: ProjectFileSystem; catalog: CanvasSourceCatalog; cards: ReviewItem[]; busy: boolean
  openSource: (path: string, location?: SourceLocation) => void; openCanvas: (card: ReviewItem) => void; onAdd: (comments: RevisionComment[]) => Promise<boolean>
}) {
  const [mode, setMode] = useState<'comment' | 'canvas' | 'letter'>('comment')
  const [importedCount, setImportedCount] = useState(0)
  const [reviewer, setReviewer] = useState('')
  const [text, setText] = useState('')
  const [targetId, setTargetId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'awaiting' | 'answered'>('all')
  const targets = useMemo(() => [...current.files].flatMap(([path, file]) => {
    if (!('content' in file) || typeof file.content !== 'string' || !/\.(tex|bib)$/i.test(path)) return []
    return [{ title: path, target: { type: 'file' as const, path } }, ...reviewTargetChoices(catalog, path).map(choice => ({
      title: `${choice.title} · ${path}:${choice.source.line}`, target: choice.target,
    }))]
  }), [current.files, catalog])
  const linked = new Set(round.comments.flatMap(item => item.kind === 'canvas' ? [item.nodeId] : []))
  const available = cards.filter(card => card.resource.role === 'review' && !linked.has(card.nodeId))
  const target = targetId === '' ? undefined : targets[Number(targetId)]?.target
  const card = available.find(item => item.nodeId === targetId)
  const visible = round.comments.flatMap((comment, index) => {
    const linkedCard = comment.kind === 'canvas' ? cards.find(item => item.nodeId === comment.nodeId) : undefined
    const wholeManuscript = comment.kind === 'comment' && comment.target.type === 'manuscript'
    const location = comment.kind === 'canvas' ? linkedCard?.source
      : comment.target.type === 'file' || comment.target.type === 'manuscript' ? undefined : resolveReviewTarget(catalog, comment.target)
    const path = location?.path ?? (comment.kind === 'comment' && comment.target.type === 'file' && current.files.has(comment.target.path) ? comment.target.path : undefined)
    const matches = [comment.reviewer || 'Reviewer', comment.text, path].join(' ').toLowerCase().includes(search.trim().toLowerCase())
    return matches && (status === 'all' || (status === 'answered') === Boolean(comment.response))
      ? [{ comment, index, linkedCard, location, path, wholeManuscript }] : []
  })
  return <section aria-label="Round reviewer comments" className="space-y-3">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Comment source">
      {([['comment', 'Enter comment'], ['canvas', 'Link Canvas card'], ['letter', 'Paste review letter']] as const).map(([value, label]) =>
        <Button key={value} type="button" size="sm" variant={mode === value ? 'default' : 'outline'} aria-pressed={mode === value} disabled={busy}
          onClick={() => { setMode(value); setTargetId(''); setImportedCount(0) }}>{label}</Button>)}
    </div>
    {mode === 'letter' ? <ReviewLetterImport busy={busy} targets={targets} onImport={async comments => {
      if (!await onAdd(comments)) return false
      setImportedCount(comments.length)
      setSearch('')
      setStatus('all')
      setMode('comment')
      return true
    }} /> : <form className="space-y-2 rounded border p-2" onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      const common = { id: crypto.randomUUID(), reviewer: reviewer.trim() }
      let saved: boolean
      if (mode === 'comment' && target && text.trim()) saved = await onAdd([{ ...common, kind: 'comment', text: text.trim(), target }])
      else if (mode === 'canvas' && card) saved = await onAdd([{ ...common, kind: 'canvas', nodeId: card.nodeId, text: card.data.content || researchNodeTitle(card.data) }])
      else return
      if (saved) { setText(''); setTargetId('') }
    }}>
      <label className="grid gap-1 text-sm font-medium">Reviewer<Input value={reviewer} onChange={event => setReviewer(event.target.value)} placeholder="Optional" maxLength={100} /></label>
      {mode === 'comment' && <label className="grid gap-1 text-sm font-medium">Reviewer comment
        <Textarea value={text} onChange={event => setText(event.target.value)} maxLength={12000} />
      </label>}
      <label className="grid gap-1 text-sm font-medium">{mode === 'comment' ? 'Source target' : 'Canvas review card'}
        <select className="min-w-0 rounded border p-1.5 text-sm" value={targetId} onChange={event => setTargetId(event.target.value)}>
          <option value="">Choose {mode === 'comment' ? 'a file or heading' : 'a review card'}</option>
          {mode === 'comment' ? targets.map((item, index) => <option key={index} value={index}>{item.title}</option>)
            : available.map(item => <option key={item.nodeId} value={item.nodeId}>{researchNodeTitle(item.data)} · {item.pageName}</option>)}
        </select>
      </label>
      <Button type="submit" size="sm" disabled={busy || (mode === 'comment' ? !target || !text.trim() : !card)}>{mode === 'comment' ? 'Add reviewer comment' : 'Add Canvas card to round'}</Button>
    </form>}
    {importedCount > 0 && <p role="status" className="text-sm">Added {importedCount} {importedCount === 1 ? 'comment' : 'comments'} to the round.</p>}
    {round.comments.length ? <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-44 flex-1 gap-1 text-sm font-medium">Filter comments
          <Input type="search" placeholder="Reviewer, file, or comment" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm font-medium">Response status
          <select className="rounded border p-1.5" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
            <option value="all">All comments</option><option value="awaiting">Awaiting response</option><option value="answered">Answered</option>
          </select>
        </label>
      </div>
      {visible.length ? <ol className="space-y-2">
      {visible.map(({ comment, index, linkedCard, location, path, wholeManuscript }) => <li key={comment.id} className="space-y-1 rounded border p-2 text-sm">
          <p className="font-medium">{index + 1}. {comment.reviewer || 'Reviewer'}{comment.kind === 'canvas' && ' · Canvas review card'}</p>
          <p className="whitespace-pre-wrap break-words">{comment.text}</p>
          <p className="text-xs text-muted-foreground">{comment.response ? 'Answered' : 'Awaiting response'}</p>
          <div className="flex flex-wrap items-center gap-2">
            {path ? <Button size="sm" variant="link" className="h-auto break-all p-0" onClick={() => openSource(path, location)}>{path}{location && `:${location.line}`}</Button>
              : wholeManuscript ? <span className="text-xs text-muted-foreground">Whole manuscript</span>
                : <span className="text-xs text-amber-800">Source link unavailable</span>}
            {linkedCard && <Button size="sm" variant="ghost" onClick={() => openCanvas(linkedCard)}>Locate on Canvas</Button>}
            {comment.kind === 'canvas' && !linkedCard && <span className="text-xs text-amber-800">Canvas card unavailable</span>}
          </div>
        </li>)}
      </ol> : <p className="text-sm text-muted-foreground">No comments match these filters.</p>}
    </> : <p className="text-sm text-muted-foreground">No reviewer comments in this round.</p>}
  </section>
}
