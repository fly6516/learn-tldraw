import { z } from 'zod'
import { templateDigest } from './paper-templates'
import { isProjectPath, projectTextExtension } from './source-archive'
import type { RevisionFile } from './revision-rounds'

const range = z.object({ start: z.number().int().positive(), end: z.number().int().positive() })
  .refine(value => value.end >= value.start)
const reference = z.object({ path: z.string().refine(isProjectPath), before: range.optional(), after: range.optional() })
  .refine(value => Boolean(value.before || value.after))
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const revisionEvidenceSchema = z.object({
  originalId: z.string().min(1), revisedId: z.string().min(1), originalSha256: hash, revisedSha256: hash,
  changes: z.array(reference).min(1).max(100),
})
export type RevisionEvidence = z.infer<typeof revisionEvidenceSchema>
export type RevisionEvidenceBinding = Omit<RevisionEvidence, 'changes'>
export type RevisionChange = z.infer<typeof reference> & { beforeText: string; afterText: string }

export function revisionChangeKey({ path, before, after }: z.infer<typeof reference>) {
  return JSON.stringify([path, before?.start, before?.end, after?.start, after?.end])
}

export function sameRevisionEvidenceBinding(left: RevisionEvidenceBinding, right: RevisionEvidenceBinding) {
  return left.originalId === right.originalId && left.revisedId === right.revisedId &&
    left.originalSha256 === right.originalSha256 && left.revisedSha256 === right.revisedSha256
}

export async function checkedRevisionZipDigest(zip: Blob, expected?: string) {
  const digest = await templateDigest(await zip.arrayBuffer())
  if (expected && digest !== expected) throw new Error('The archived source ZIP failed its checksum.')
  return digest
}

function changedLines(path: string, before: string[], after: string[]): RevisionChange[] {
  let start = 0
  let endBefore = before.length
  let endAfter = after.length
  while (start < endBefore && start < endAfter && before[start] === after[start]) start++
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter-- }

  const result: RevisionChange[] = []
  function add(from: number, to: number, newFrom: number, newTo: number) {
    if (from === to && newFrom === newTo) return
    result.push({ path,
      ...(from < to && { before: { start: from + 1, end: to } }),
      ...(newFrom < newTo && { after: { start: newFrom + 1, end: newTo } }),
      beforeText: before.slice(from, to).join('\n'), afterText: after.slice(newFrom, newTo).join('\n'),
    })
  }
  if (start === endBefore || start === endAfter) { add(start, endBefore, start, endAfter); return result }
  const rows = endBefore - start + 1
  const columns = endAfter - start + 1
  // Bound the matrix so a large source file cannot stall the browser. No broad fallback is treated as evidence.
  if (rows * columns > 2_000_000) return result
  const lengths = new Uint32Array(rows * columns)
  for (let i = rows - 2; i >= 0; i--) for (let j = columns - 2; j >= 0; j--) {
    const at = i * columns + j
    lengths[at] = before[start + i] === after[start + j] ? 1 + lengths[at + columns + 1]
      : Math.max(lengths[at + 1], lengths[at + columns])
  }
  let i = start
  let j = start
  let from = i
  let newFrom = j
  while (i < endBefore && j < endAfter) {
    if (before[i] === after[j]) {
      add(from, i, newFrom, j)
      from = ++i
      newFrom = ++j
    } else {
      const at = (i - start) * columns + j - start
      if (lengths[at + columns] >= lengths[at + 1]) i++
      else j++
    }
  }
  add(from, endBefore, newFrom, endAfter)
  return result
}

export async function compareRevisionChanges(files: RevisionFile[]) {
  const asLines = async (entry?: string | Blob) => {
    const text = typeof entry === 'string' ? entry : entry ? await entry.text() : ''
    return text ? text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n') : []
  }
  const changed = files.filter(file => file.status !== 'Unchanged' && projectTextExtension.test(file.path))
  return (await Promise.all(changed.map(async file => changedLines(file.path, await asLines(file.baseline), await asLines(file.current))))).flat()
}

export function revisionChangeLocation(change: z.infer<typeof reference>) {
  const lines = (span: z.infer<typeof range>) => span.start === span.end ? `L${span.start}` : `L${span.start}–${span.end}`
  return [change.before && `original ${lines(change.before)}`, change.after && `revised ${lines(change.after)}`].filter(Boolean).join(', ')
}
