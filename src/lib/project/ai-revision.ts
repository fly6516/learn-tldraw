import { z } from 'zod'
import { projectTextExtension } from './source-archive'
import type { RevisionFile } from './revision-rounds'

export const revisionDraftRequestSchema = z.object({
  comment: z.string().trim().min(1).max(12000),
  original: z.string().min(1).max(100), revised: z.string().min(1).max(100),
  kind: z.enum(['changed', 'retained']),
  authorNote: z.string().trim().max(1500),
  changes: z.array(z.object({ path: z.string().min(1).max(500), status: z.enum(['Added', 'Removed', 'Modified']),
    before: z.string().max(1500), after: z.string().max(1500) })).max(6),
}).refine(value => value.kind === 'changed' ? value.changes.length > 0 : Boolean(value.authorNote))

export const revisionDraftSchema = z.object({ draft: z.string().trim().min(1).max(3500) })

export async function archiveReplyEvidence(files: RevisionFile[], paths: readonly string[]) {
  const selected = new Set(paths)
  const read = (entry?: string | Blob) => typeof entry === 'string' ? entry : entry?.text() ?? ''
  return Promise.all(files.filter(file => file.status !== 'Unchanged' && selected.has(file.path))
    .slice(0, 6).map(async file => {
      const status = file.status as 'Added' | 'Removed' | 'Modified'
      if (!projectTextExtension.test(file.path)) return { path: file.path, status, before: '', after: '' }
      const [before, after] = await Promise.all([read(file.baseline), read(file.current)])
      let offset = 0
      while (offset < Math.min(before.length, after.length) && before[offset] === after[offset]) offset++
      const start = Math.max(0, offset - 250)
      return { path: file.path, status, before: before.slice(start, start + 1500), after: after.slice(start, start + 1500) }
    }))
}
