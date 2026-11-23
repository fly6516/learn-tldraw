'use client'

import { useEffect, useMemo, useState } from 'react'
import { readSubmissionEvidence } from '@/lib/project/storage'
import { assessSubmissionEvidence, assessSubmissionZip, type SubmissionEvidence,
  type SubmissionEvidenceFinding, type SubmissionEvidenceLedger } from '@/lib/project/submission-evidence'
import type { SubmissionBuild } from '@/lib/project/submission'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { WritingKey } from '@/lib/project/writing-drafts'

type Check = Awaited<ReturnType<typeof assessSubmissionZip>>
const labels: Record<SubmissionEvidenceFinding['reasons'][number], string> = {
  wording_changed: 'Reviewed wording is absent from this ZIP',
  wording_ambiguous: 'Reviewed wording appears more than once in this ZIP',
  file_missing: 'Reviewed source file is absent from this ZIP',
  evidence_changed: 'Linked evidence changed or cannot be located reliably',
  evidence_missing: 'Evidence file is absent from this ZIP',
  unconfirmed: 'Author review no longer matches this ZIP',
}

export function useSubmissionEvidence(database: IDBDatabase | null, key: WritingKey | undefined, target: ProjectFileSystem, build?: SubmissionBuild) {
  const [loaded, setLoaded] = useState<{ target: ProjectFileSystem; ledger: SubmissionEvidenceLedger }>()
  const [verified, setVerified] = useState<{ zip: Blob; ledger: SubmissionEvidenceLedger; check: Check }>()
  const [accepted, setAccepted] = useState<Check>()
  const [error, setError] = useState<{ target: ProjectFileSystem; message: string }>()
  const ledger = loaded?.target === target ? loaded.ledger : undefined
  const exact = verified?.zip === build?.zip && verified?.ledger === ledger ? verified?.check : undefined
  const preview = useMemo(() => ledger?.entries.length ? assessSubmissionEvidence(target, ledger) : undefined, [ledger, target])
  const message = error?.target === target ? error.message : undefined

  useEffect(() => {
    if (!database || !key) return
    let current = true
    void readSubmissionEvidence(database, key).then(ledger => { if (current) setLoaded({ target, ledger }) })
      .catch(() => { if (current) setError({ target, message: 'Could not read saved claim reviews. Reopen this submission to try again.' }) })
    return () => { current = false }
  }, [database, key, target])

  useEffect(() => {
    if (!ledger?.entries.length || !build) return
    let current = true
    void assessSubmissionZip(build.zip, build.sourceChecksum, ledger).then(check => {
      if (current) setVerified({ zip: build.zip, ledger, check })
    }).catch(cause => {
      if (current) setError({ target, message: cause instanceof Error ? cause.message : 'Could not check the final ZIP.' })
    })
    return () => { current = false }
  }, [build, ledger, target])

  async function archiveRecord(): Promise<SubmissionEvidence | undefined> {
    if (!build || !database || !key || !ledger) throw new Error('Wait until the final evidence check is ready.')
    const latest = await readSubmissionEvidence(database, key)
    if (JSON.stringify(latest) !== JSON.stringify(ledger)) {
      setLoaded({ target, ledger: latest })
      throw new Error('Saved claim reviews changed. Review the final evidence check again.')
    }
    if (!ledger.entries.length) return
    if (!exact || exact.findings.length && exact !== accepted) throw new Error('Review and confirm the final ZIP evidence findings.')
    return { ...exact, exceptionAccepted: Boolean(exact.findings.length) }
  }

  return { check: exact ?? preview, exact: Boolean(exact), message, waiting: Boolean(database && key && !message
    && (!ledger || build && ledger.entries.length && !exact)), canArchive: Boolean(ledger && !message
    && (!ledger.entries.length || exact && (!exact.findings.length || exact === accepted))),
    accepted: Boolean(exact && exact === accepted), onAccept: (value: boolean) => setAccepted(value ? exact : undefined), archiveRecord }
}

export function SubmissionEvidencePanel({ review, working, onLocate, disabled }: {
  review: ReturnType<typeof useSubmissionEvidence>; working: ProjectFileSystem; disabled?: boolean
  onLocate: (finding: SubmissionEvidenceFinding) => void
}) {
  if (!review.check && !review.waiting && !review.message) return null
  return <section aria-label="Submission evidence check" className="space-y-1 rounded border p-2 text-xs">
    <h3 className="font-semibold">Evidence in the final ZIP</h3>
    {review.waiting && <p>Checking saved claim reviews…</p>}
    {review.message && <p role="alert" className="text-red-800">{review.message}</p>}
    {review.check && <>
      <p>{review.check.checked} saved claims checked · {review.exact ? 'Final ZIP' : 'ZIP manifest preview'}</p>
      <SubmissionEvidenceFindings findings={review.check.findings} working={working} onLocate={onLocate} disabled={disabled} />
    </>}
    {review.exact && Boolean(review.check?.findings.length) && <label className="flex items-start gap-2 text-amber-900">
      <input type="checkbox" checked={review.accepted} disabled={disabled} onChange={event => review.onAccept(event.target.checked)} />
      Accept evidence exceptions for this ZIP
    </label>}
  </section>
}

export function SubmissionEvidenceFindings({ findings, working, onLocate, disabled }: {
  findings: readonly SubmissionEvidenceFinding[]; working?: ProjectFileSystem; disabled?: boolean
  onLocate?: (finding: SubmissionEvidenceFinding) => void
}) {
  if (!findings.length) return <p>No evidence differences found.</p>
  return <ul className="max-h-40 space-y-1 overflow-auto break-words text-amber-900">
    {findings.map((item, index) => <li key={index}>
      {working?.files.has(item.path) && onLocate ? <button type="button" className="break-all text-left underline" disabled={disabled}
        onClick={() => onLocate(item)}>{item.path} · {item.quote}</button> : <p>{item.path} · {item.quote}</p>}
      <p>{item.reasons.map(reason => labels[reason]).join(' · ')}{item.dependencies.length > 0 && ` · ${item.dependencies.join(', ')}`}</p>
    </li>)}
  </ul>
}
