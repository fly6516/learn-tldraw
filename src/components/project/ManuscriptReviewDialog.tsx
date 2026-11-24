'use client'

import dynamic from 'next/dynamic'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { buildManuscriptSnapshot, manuscriptReviewFiles, type ManuscriptReviewFile } from '@/lib/project/manuscript-review'
import { prepareSubmission } from '@/lib/project/submission'
import { readManuscriptBatches } from '@/lib/project/storage'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { ChatCheckpoint, ChatSource } from '@/lib/project/writing-chat'
import { externalManuscriptVerification, validateManuscript, type ChatVerification, type ManuscriptBuild } from '@/lib/project/writing-chat-validation'
import { sameDraft, type WritingDrafts, type WritingKey } from '@/lib/project/writing-drafts'
import type { ManuscriptTask } from '@/lib/project/manuscript-task'
import type { SourceMove } from '@/lib/project/writing-ai-evidence'
import { assessClaim, claimPresent, claimSourceLine } from '@/lib/project/writing-claims'
import { ClaimEvidence, type ReviewedClaim } from './ClaimEvidence'
import { ChatExternalBuild } from './ChatExternalBuild'
import { needsExternalCompile } from '@/lib/project/compile-compatibility'

const Diff = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })
const text = (source: ChatSource) => source.draft?.text ?? source.saved
const compilerItem = (issue: ChatVerification['diagnostics'][number], index: number) =>
  `compile:${issue.path}:${issue.line}:${index}:${issue.message.slice(0, 100)}`

export function ManuscriptReviewDialog(props: {
  storage: IDBDatabase; projectKey: WritingKey; runs: string[]; project: ProjectFileSystem; working: ProjectFileSystem; drafts: WritingDrafts
  baseline?: string; report?: ChatVerification; disabled: boolean; generatedEntry: boolean
  autoVerify?: boolean; taskBatches: ManuscriptTask['batches']; sourceMoves: readonly SourceMove[]; claimReviews: ManuscriptTask['claimReviews']
  open: boolean; cursor?: ManuscriptTask['reviewCursor']; onCursor: (value: NonNullable<ManuscriptTask['reviewCursor']>) => void
  onVerify: (report: ChatVerification, build?: ManuscriptBuild) => Promise<void>; onSave: (report: ChatVerification) => Promise<void>
  onLocate: (path: string, line: number) => void; onRepair: (paths: string[], report: ChatVerification) => void; onClose: () => void
  onClaimDecision: (claim: ReviewedClaim, decision: 'confirmed' | 'requested' | 'excluded') => Promise<void>
}) {
  const { storage, projectKey, runs, project, working, drafts, report } = props
  const [batches, setBatches] = useState<ChatCheckpoint[]>()
  const [choices, setChoices] = useState<string[]>()
  const [accepted, setAccepted] = useState<Record<string, ChatSource>>({})
  const [operation, setOperation] = useState<'verify' | 'save' | 'claim'>()
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const automaticAttempt = useRef(false)
  const reviewBody = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let mounted = true
    readManuscriptBatches(storage, projectKey, runs).then(checkpoints => {
      if (!mounted) return
      if (checkpoints.length !== runs.length) setError('Some task batches are no longer available.')
      else setBatches(checkpoints)
    }).catch(() => { if (mounted) setError('Could not load the manuscript batches.') })
    return () => { mounted = false; controller.current?.abort() }
  }, [storage, projectKey, runs])

  const files = useMemo(() => batches ? manuscriptReviewFiles(batches, project, drafts) : [], [batches, project, drafts])
  const reviewed = (file: ManuscriptReviewFile) => {
    const seen = accepted[file.path]
    return file.available && file.hasChangesToSave && (!file.conflict || Boolean(seen && file.current
      && seen.saved === file.current.saved && sameDraft(seen.draft, file.current.draft)))
  }
  const chosen = choices ?? report?.manuscript?.paths
  const { paths, acceptedPaths } = useMemo(() => {
    const paths = files.filter(file => {
      const seen = accepted[file.path]
      return file.available && file.hasChangesToSave && (!file.conflict || Boolean(seen && file.current
        && seen.saved === file.current.saved && sameDraft(seen.draft, file.current.draft)))
        && (chosen?.includes(file.path) ?? !file.hasAuthorDraft)
    }).map(file => file.path)
    return { paths, acceptedPaths: files.filter(file => file.conflict && paths.includes(file.path)).map(file => file.path) }
  }, [accepted, chosen, files])
  const candidate = useMemo(() => batches && paths.length && project.metadata.mainFile && !props.generatedEntry
    ? buildManuscriptSnapshot(project, drafts, batches, paths, acceptedPaths).candidate : undefined,
  [acceptedPaths, batches, drafts, paths, project, props.generatedEntry])
  const compatibility = useMemo(() => prepareSubmission(candidate ?? project, project.metadata.mainFile ?? '', new Set()).compatibility,
    [candidate, project])
  const requiresExternal = needsExternalCompile(compatibility)
  const current = report?.manuscript && Boolean(props.baseline) && report.baseline === props.baseline
    && report.manuscript.paths.join('\n') === paths.join('\n') && report.manuscript.accepted.join('\n') === acceptedPaths.join('\n')
  const failed = current && report?.status === 'failed'
  const repairFiles = [...new Set(failed ? report.diagnostics.filter(issue => issue.severity === 'error'
    && issue.sourceLine && paths.includes(issue.path)).map(issue => issue.path) : [])].slice(0, 6)
  const displayed = files.find(file => file.path === props.cursor?.path) ?? files[0]
  const busy = props.disabled || Boolean(operation)
  const claims = useMemo(() => {
    const found = new Map<string, ReviewedClaim>()
    for (const batch of props.taskBatches) {
      const checkpoint = batches?.[runs.indexOf(batch.run)]
      if (!checkpoint) continue
      batch.claims?.forEach((original, index) => {
        const applied = checkpoint.after[original.path]
        if (!applied || !claimPresent(original, text(applied))) return
        const id = `${batch.run}:${index}`
        const review = props.claimReviews?.[id]
        const claim = review?.evidence ? { ...original, references: review.evidence.references, calculations: review.evidence.calculations,
          needsConfirmation: review.evidence.needsConfirmation } : original
        const revision = review?.revision ?? batch.sourceRevision
        const assessment = assessClaim(claim, working, props.sourceMoves, revision, review)
        found.set(JSON.stringify([claim.path, claim.kind, claim.quote]), { id, claim, revision, review, assessment })
      })
    }
    return [...found.values()]
  }, [batches, props.claimReviews, props.sourceMoves, props.taskBatches, runs, working])
  const needsClaimReview = claims.some(item => paths.includes(item.claim.path) && item.assessment.needsReview)
  const queue = [
    ...claims.filter(item => item.assessment.needsReview).map(({ id, claim, review, assessment }) => ({ id, path: claim.path,
      category: review?.decision === 'confirmed' ? 'Evidence or wording changed' : 'Claim needs review', message: claim.quote,
      line: assessment.present ? claimSourceLine(claim, working) : undefined, blocking: paths.includes(claim.path) })),
    ...files.filter(file => file.conflict && file.hasChangesToSave && !acceptedPaths.includes(file.path)).map(file => ({
      id: `draft:${file.path}`, path: file.path, category: 'Author draft conflict', message: 'Compare the current draft with the task version.',
      line: undefined, blocking: false,
    })),
    ...(failed ? report.diagnostics.flatMap((issue, index) => issue.severity === 'error' ? [{
      id: compilerItem(issue, index), path: issue.path, category: 'Compile error', message: issue.message, line: issue.sourceLine, blocking: true,
    }] : []) : []),
  ]
  const currentIndex = queue.findIndex(item => item.id === props.cursor?.item)
  const currentItem = queue[currentIndex]
  const saveHint = !paths.length ? 'Select files to verify and save.'
    : needsClaimReview ? 'Resolve the flagged claims in selected files before saving.'
      : failed ? 'Fix the compiler errors and verify again.'
        : !current || report?.status !== 'passed' ? 'Verify the selected files before saving.' : 'The selected files are ready to save.'

  useEffect(() => {
    const selected = props.cursor?.item
    if (!props.open || !selected) return
    const frame = requestAnimationFrame(() => {
      const target = Array.from(reviewBody.current?.querySelectorAll<HTMLElement>('[data-review-claim]') ?? [])
        .find(element => element.dataset.reviewClaim === selected) ?? Array.from(reviewBody.current?.querySelectorAll<HTMLElement>('[data-review-item]') ?? [])
        .find(element => element.dataset.reviewItem === selected)
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [batches, props.cursor?.item, props.open])

  function locate(path: string, line: number, claimId?: string) {
    const claim = claims.find(item => item.id === claimId)
    if (claim) props.onCursor({ path: claim.claim.path, item: claim.id })
    props.onLocate(path, line)
  }

  function selectItem(item: typeof queue[number]) {
    const path = item.path && project.files.has(item.path) ? item.path : displayed?.path
    if (path) props.onCursor({ path, item: item.id })
  }

  async function decide(id: string, decision: 'confirmed' | 'requested' | 'excluded') {
    const claim = claims.find(item => item.id === id)
    if (busy || !claim) return
    setOperation('claim')
    setError('')
    try { await props.onClaimDecision(claim, decision) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the claim review.') }
    finally { setOperation(undefined) }
  }

  async function verify() {
    if (!batches || busy || !paths.length) return
    const request = new AbortController()
    controller.current = request
    setOperation('verify')
    setError('')
    try {
      const { report, build } = await validateManuscript({ project, working, drafts, checkpoints: batches,
        paths, accepted: acceptedPaths, signal: request.signal })
      if (!request.signal.aborted) await props.onVerify(report, build)
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not verify the manuscript.')
    } finally { controller.current = null; setOperation(undefined) }
  }

  const autoVerify = useEffectEvent(() => {
    if (props.open && props.autoVerify && !automaticAttempt.current && batches && props.baseline && !busy && candidate
      && !requiresExternal && paths.length === files.filter(file => file.hasChangesToSave).length && !current) {
      automaticAttempt.current = true
      void verify()
    }
  })
  useEffect(() => { autoVerify() }, [batches, busy, candidate, current, props.baseline, props.autoVerify, props.open])

  async function save() {
    if (busy || !current || report?.status !== 'passed' || needsClaimReview) return
    setOperation('save')
    setError('')
    try { await props.onSave(report); props.onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the manuscript.') }
    finally { setOperation(undefined) }
  }

  return <Dialog open={props.open} onOpenChange={open => { if (!open && operation !== 'save') props.onClose() }}>
    <DialogContent className="grid max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-5xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 p-4 sm:max-w-5xl sm:p-6">
      <DialogTitle>Review manuscript task</DialogTitle>
      <DialogDescription>Verify and save selected task files together. Unselected files use saved project source in the compile.</DialogDescription>
      <div ref={reviewBody} className="min-h-0 space-y-3 overflow-auto pr-1">
        {batches && <section aria-label="Manuscript review queue" className="space-y-2 rounded border bg-slate-50 p-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Review queue · {queue.length} pending</h3>
          </div>
          {queue.length > 0 && <ul className="max-h-36 space-y-1 overflow-auto" aria-label="Pending review items">
            {queue.map(item => <li key={item.id} className="min-w-0">
              <button type="button" data-review-item={item.id} aria-pressed={item.id === props.cursor?.item}
                className="w-full break-words rounded px-1 py-0.5 text-left hover:bg-indigo-50 aria-pressed:bg-indigo-100"
                onClick={() => selectItem(item)}>
                <span className="font-medium">{item.category}</span> · {item.path || 'Compiler log'} · {item.message}
                {item.blocking && <span className="font-medium text-amber-900"> · Blocks save</span>}
              </button>
            </li>)}
          </ul>}
          {currentItem?.line && <Button size="sm" variant="outline" onClick={() => locate(currentItem.path, currentItem.line!)}>
            Open source for selected item
          </Button>}
          <p>{saveHint}</p>
        </section>}
        {files.length > 0 && <div className="grid gap-3 md:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)]">
          <ul aria-label="Task files for review" className="max-h-48 min-w-0 space-y-1 overflow-auto md:max-h-80">
            {files.map(file => <li key={file.path} className="rounded border p-2">
              <div className="flex items-center gap-2">
                <Checkbox aria-label={`Include ${file.path}`} checked={paths.includes(file.path)} disabled={busy || !reviewed(file)}
                  onCheckedChange={checked => setChoices(checked ? [...paths, file.path] : paths.filter(path => path !== file.path))} />
                <button type="button" aria-pressed={displayed?.path === file.path}
                  className="min-w-0 break-all rounded text-left font-mono text-xs underline hover:text-indigo-700"
                  onClick={() => props.onCursor({ path: file.path })}>{file.path}</button>
              </div>
              {file.conflict && <p className="text-xs text-amber-800">Author or project changes need review.</p>}
              {claims.some(item => item.claim.path === file.path && item.assessment.needsReview)
                && <p className="text-xs text-amber-800">Claims need review.</p>}
              {file.hasAuthorDraft && <p className="text-xs text-slate-600">Includes an existing author draft if selected.</p>}
              {!file.hasChangesToSave && <p className="text-xs text-slate-600">No pending draft to save.</p>}
            </li>)}
          </ul>
          {displayed?.current && <div key={displayed.path} className="min-w-0 space-y-2">
            <div className="text-xs font-semibold">Project source → draft to save</div>
            <Diff path={displayed.path} original={displayed.current.saved} modified={text(displayed.current)}
              modifiedLabel="Draft to save" />
            {displayed.hasAuthorDraft && <details className="text-xs">
              <summary>Existing author draft</summary>
              <Diff path={displayed.path} original={displayed.before.saved} modified={text(displayed.before)}
                modifiedLabel="Original author draft" />
            </details>}
            <details className="text-xs">
              <summary>Changes from task batches</summary>
              <Diff path={displayed.path} original={text(displayed.before)} modified={text(displayed.expected)}
                originalLabel="Working source before task" modifiedLabel="Last task draft" />
            </details>
            <ClaimEvidence claims={claims.filter(item => item.claim.path === displayed.path)} project={working}
              moves={props.sourceMoves} onLocate={locate} disabled={busy} selected={props.cursor?.item}
              onDecision={(id, decision) => void decide(id, decision)} />
            {displayed.conflict && <section aria-label="Author changes conflict" className="space-y-2 rounded border border-amber-300 p-2 text-xs">
              <p>Compare the last task version with the current version. Keep this file excluded or approve the current draft for this save.</p>
              {text(displayed.expected) !== text(displayed.current) && <Diff path={displayed.path}
                original={text(displayed.expected)} modified={text(displayed.current)}
                originalLabel="Last task draft" modifiedLabel="Current author version" />}
              {displayed.intervening && <details open className="text-xs">
                <summary>Author changes between batches</summary>
                <Diff path={displayed.path} original={text(displayed.intervening.before)} modified={text(displayed.intervening.after)}
                  originalLabel="Earlier task draft" modifiedLabel="Version before the next batch" />
              </details>}
              <Button size="sm" variant="outline" disabled={busy || !displayed.available || !displayed.hasChangesToSave || reviewed(displayed)}
                onClick={() => {
                  setAccepted({ ...accepted, [displayed.path]: displayed.current! })
                  setChoices([...paths, displayed.path])
                }}>Include current author version</Button>
            </section>}
          </div>}
        </div>}
        {props.generatedEntry && <p role="alert">The generated compile entry needs to match the saved project before an entire task can be verified.</p>}
        {((requiresExternal && !current) || (compatibility.configuredEngine && failed)) && <ChatExternalBuild target={candidate} main={project.metadata.mainFile ?? ''}
          compatibility={compatibility} busy={busy} ready={Boolean(candidate)}
          onAttach={async (pdf, engine, _zip, checksum) => {
            if (!candidate) return
            const { report, build } = await externalManuscriptVerification(project, drafts, candidate, paths, acceptedPaths, pdf, checksum, engine)
            await props.onVerify(report, build)
          }} />}
        {report?.manuscript && <section aria-label="Manuscript verification" className="space-y-2 rounded border p-2">
          <p role="status" className={current && report.status === 'failed' ? 'text-red-800' : undefined}>
            {current ? `Manuscript verification ${report.status}. ${report.message}` : 'Manuscript verification is out of date.'}</p>
          {report.diagnostics.length > 0 && <ul className="space-y-1">
            {report.diagnostics.map((issue, index) => <li key={index} className="break-all text-xs">
              {current && issue.sourceLine
                ? <button type="button" className="text-left underline" onClick={() => {
                  props.onCursor({ path: issue.path, item: compilerItem(issue, index) })
                  locate(issue.path, issue.sourceLine!)
                }}>{issue.path}:{issue.line}</button>
                : <span>{issue.path}:{issue.line}</span>}
              {' · '}{issue.severity} · {issue.message}
            </li>)}
          </ul>}
          {repairFiles.length > 0 && <Button size="sm" variant="outline" disabled={busy}
            onClick={() => props.onRepair(repairFiles, report)}>Repair affected files with AI</Button>}
          {report.log && <details className="text-xs"><summary>Compiler log</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{report.log}</pre></details>}
        </section>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-slate-600">{paths.length} files selected</span>
        {queue.length > 0 && <Button size="sm" variant="ghost" onClick={() => selectItem(queue[(currentIndex + 1) % queue.length])}>
          Next review item
        </Button>}
        {!requiresExternal && <Button size="sm" variant="outline" disabled={busy || !candidate} onClick={() => void verify()}>
          {operation === 'verify' ? 'Verifying…' : 'Verify manuscript'}
        </Button>}
        <Button size="sm" disabled={busy || props.generatedEntry || !current || report?.status !== 'passed' || Boolean(needsClaimReview)}
          onClick={() => void save()}>{operation === 'save' ? 'Saving…' : 'Save verified files'}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
