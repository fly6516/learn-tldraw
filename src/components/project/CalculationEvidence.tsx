import { assessCsvCalculation, type CsvCalculation } from '@/lib/project/csv-calculation'
import type { ProjectFileSystem } from '@/lib/project/types'
import type { SourceMove } from '@/lib/project/writing-ai-evidence'

const labels = {
  mean: 'Mean',
  difference: 'Difference',
  percent_change: 'Percent change',
}

export function CalculationEvidence({ calculation, project, moves, revision, onLocate }: {
  calculation: CsvCalculation; project: ProjectFileSystem; moves: readonly SourceMove[]; revision?: number
  onLocate: (path: string, line: number) => void
}) {
  const assessed = assessCsvCalculation(calculation, project, moves, revision)
  const values = calculation.inputs.map(input => input.value)
  const formula = calculation.operation === 'mean' ? `(${values.join(' + ')}) / ${values.length}`
    : calculation.operation === 'difference' ? `${values[0]} − ${values[1]}`
      : `(${values[1]} − ${values[0]}) / ${values[0]} × 100`
  const suffix = calculation.operation === 'percent_change' ? '%' : ''
  return <section aria-label={`CSV calculation ${calculation.id}`} className="space-y-1 rounded border bg-slate-50 p-2 text-xs">
    <p className="font-semibold">{labels[calculation.operation]} · {calculation.result}{suffix}</p>
    <p className="break-words font-mono">{formula} = {calculation.result}{suffix} · {calculation.decimals} decimal places</p>
    {!assessed.current && <p className="text-amber-800">
      Calculation out of date.{assessed.result === undefined ? ' Check the missing or ambiguous cells.' : ` Current inputs yield ${assessed.result}${suffix}.`}
    </p>}
    <ul className="space-y-0.5">
      {calculation.inputs.map((input, index) => {
        const location = assessed.inputs[index]?.location
        return <li key={index} className="break-all">
          {location ? <button type="button" className="text-left text-indigo-700 underline" onClick={() => onLocate(location.path, location.line)}>
            {location.path}:{location.line}
          </button> : <span>{calculation.path}:{input.line}</span>}
          {' · '}{input.column} = {input.raw}
        </li>
      })}
    </ul>
  </section>
}
