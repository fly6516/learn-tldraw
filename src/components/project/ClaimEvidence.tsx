import type { ProjectFileSystem } from '@/lib/project/types'
import { locateEvidence, type SourceMove } from '@/lib/project/writing-ai-evidence'
import type { WritingClaims } from '@/lib/project/writing-claims'
import type { assessClaim, ClaimReview } from '@/lib/project/writing-claims'
import { Button } from '@/components/ui/button'
import { CalculationEvidence } from './CalculationEvidence'

export type ReviewedClaim = { id: string; claim: WritingClaims[number]; revision?: number; review?: ClaimReview
  assessment: ReturnType<typeof assessClaim> }

export function ClaimEvidence({ claims, project, moves, onLocate, disabled, onDecision, selected }: {
  claims: { claim: WritingClaims[number]; revision?: number; assessment?: ReviewedClaim['assessment']; id?: string; review?: ClaimReview }[]
  project: ProjectFileSystem
  moves: readonly SourceMove[]; onLocate: (path: string, line: number, claimId?: string) => void
  selected?: string
  disabled?: boolean
  onDecision?: (id: string, decision: 'confirmed' | 'requested' | 'excluded') => void
}) {
  if (!claims.length) return null
  return <section aria-label="Evidence for proposed changes" className="space-y-1 rounded border px-2 py-1.5 text-xs">
    <h4 className="font-semibold">Evidence for proposed changes</h4>
    <ul className="space-y-2">
      {claims.map(({ claim, revision, assessment, review, id }, index) => {
        const locations = assessment?.locations ?? claim.references.map(reference => locateEvidence(project, reference, moves, revision))
        const hasEvidence = locations.some(Boolean)
        return <li className={`space-y-1 border-t pt-1.5 ${id && id === selected ? 'rounded bg-indigo-50 ring-1 ring-indigo-400' : ''}`}
          key={id ?? index} aria-label={claim.quote} tabIndex={-1} data-review-claim={id}>
          <p className="break-all font-mono text-slate-600">{claim.path}</p>
          <blockquote className="break-words">{claim.kind === 'citation' && 'Citation · '}{claim.quote}</blockquote>
          {assessment?.confirmed && <p className="font-medium text-emerald-800">Confirmed</p>}
          {assessment?.excluded && <p className="font-medium text-slate-700">Excluded from draft</p>}
          {(assessment?.needsReview ?? ((!hasEvidence && !claim.calculations?.length) || claim.needsConfirmation)) && <p className="font-medium text-amber-800">
            {review?.decision === 'confirmed' ? 'Evidence or wording changed. Review again.'
              : review?.decision === 'requested' ? 'Evidence requested. Review the available sources.' : 'Needs author confirmation'}
          </p>}
          {assessment && !assessment.present && !assessment.excluded && <p className="text-amber-800">Original wording has changed or was removed.</p>}
          {hasEvidence && <p className="text-slate-600">{claim.kind === 'citation' ? 'Bibliography entry found' : 'Evidence linked for author review'}</p>}
          {claim.references.map((reference, index) => {
            const match = locations[index]
            const label = reference.kind === 'data' ? 'CSV' : reference.kind === 'table' ? 'Table source' : 'Bibliography'
            return <div key={index} className="break-words">
              {match ? <button type="button" className="break-all text-left text-indigo-800 underline"
                onClick={() => onLocate(match.path, match.line, id)}>{label} · {match.path}:{match.line}</button>
                : <span className="text-amber-800">{label} · {reference.path}:{reference.line} needs fresh evidence</span>}
              {match && reference.text && <p className="font-mono text-slate-600">{reference.text}</p>}
            </div>
          })}
          {claim.calculations?.map(calculation => <CalculationEvidence key={calculation.id} calculation={calculation}
            project={project} moves={moves} revision={revision} onLocate={(path, line) => onLocate(path, line, id)} />)}
          {onDecision && id && assessment && !assessment.excluded && <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" disabled={disabled || assessment.confirmed || !assessment.present}
              onClick={() => onDecision(id, 'confirmed')}>Confirm claim</Button>
            <Button size="sm" variant="ghost" disabled={disabled || !assessment.present}
              onClick={() => onDecision(id, 'requested')}>Request evidence</Button>
            <Button size="sm" variant="ghost" disabled={disabled || assessment.present && !claim.exclusion}
              onClick={() => onDecision(id, 'excluded')}>{assessment.present ? 'Exclude change' : 'Mark as excluded'}</Button>
            {assessment.present && claim.exclusion && <p className="w-full text-slate-600">Excluding a change reverts the linked text in the local draft.</p>}
          </div>}
        </li>
      })}
    </ul>
  </section>
}
