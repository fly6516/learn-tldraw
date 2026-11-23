import { z } from 'zod'
import { isProjectPath } from './source-archive'
import type { ProjectFileSystem } from './types'
import type { SourceMove } from './writing-ai-evidence'

const path = z.string().max(500).refine(isProjectPath)
export const aiReadExclusionsSchema = z.array(z.string().max(500).refine(value => isProjectPath(value.replace(/\/$/, '')))).max(512)
export const aiContextReceiptSchema = z.object({
  files: z.array(z.object({ path, kind: z.enum(['saved', 'draft', 'csv', 'csv_draft', 'attachment', 'archive']),
    partial: z.boolean().optional() })).max(400),
  diagnostics: z.boolean(), taskNotes: z.boolean(), reviewerComment: z.boolean().optional(), restricted: z.boolean(),
  confirmation: z.enum(['approved', 'reused', 'local']).optional(),
})
export type AiContextReceipt = z.infer<typeof aiContextReceiptSchema>

export function aiReadScope(rules: readonly string[], moves: readonly SourceMove[] = []) {
  const excluded = new Set(rules)
  const denies = (path: string) => excluded.has(path) || [...excluded].some(rule => rule.endsWith('/') && path.startsWith(rule))
  // Historical snapshots can use any prior path in the rename journal.
  if (excluded.size) {
    let size = -1
    while (size !== excluded.size) {
      size = excluded.size
      for (const { from, to } of moves) {
        if (denies(from)) excluded.add(to)
        if (denies(to)) excluded.add(from)
      }
    }
  }
  return { denies, restricted: excluded.size > 0 }
}

export function restrictAiProject(project: ProjectFileSystem, scope: ReturnType<typeof aiReadScope>) {
  return scope.restricted ? { ...project, files: new Map([...project.files].filter(([path]) => !scope.denies(path))) } : project
}
