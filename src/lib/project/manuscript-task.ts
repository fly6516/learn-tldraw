import { z } from 'zod'
import { isProjectPath } from './source-archive'
import { claimReviewSchema, writingClaimsSchema } from './writing-claims'
import { aiReadExclusionsSchema } from './ai-read-scope'

const path = z.string().max(500).refine(isProjectPath)
const notes = z.array(z.string().trim().min(1).max(450)).max(12)
export const manuscriptDataSchema = z.array(z.object({
  path: path.refine(value => /\.csv$/i.test(value)), startRow: z.number().int().min(1).max(24000),
  rowCount: z.number().int().min(1).max(12),
})).max(4)
const delivery = z.object({
  data: manuscriptDataSchema,
  submissionName: z.string().trim().min(1).max(100).optional(),
})

export const manuscriptPlanSchema = z.object({
  title: z.string().trim().min(1).max(100),
  files: z.array(path).min(1).max(49),
  decisions: notes,
  questions: notes,
  delivery: delivery.optional(),
})

export const manuscriptTaskSchema = manuscriptPlanSchema.extend({
  id: z.uuid(),
  example: z.boolean().optional(),
  readRules: aiReadExclusionsSchema.optional(),
  reviewCursor: z.object({ path, item: z.string().max(1200).optional() }).optional(),
  goal: z.string().trim().min(1).max(12000),
  batches: z.array(z.object({ run: z.uuid(), files: z.array(path).min(1).max(6), replaces: z.uuid().optional(),
    claims: writingClaimsSchema.optional(), sourceRevision: z.number().int().nonnegative().optional() })).max(120),
  claimReviews: z.record(z.string().regex(/^[\da-f-]{36}:\d{1,2}$/i), claimReviewSchema)
    .refine(reviews => Object.keys(reviews).length <= 120 * 24).optional(),
})

export const manuscriptContextSchema = z.object({
  mode: z.enum(['plan', 'batch', 'repair', 'context', 'evidence']),
  goal: manuscriptTaskSchema.shape.goal,
  files: z.array(path).max(49),
  completed: z.array(path).max(49).optional(),
  decisions: notes.optional(),
  questions: notes.optional(),
  data: manuscriptDataSchema.optional(),
  claim: writingClaimsSchema.element.pick({ path: true, quote: true, kind: true }).optional(),
})

export type ManuscriptTask = z.infer<typeof manuscriptTaskSchema>
export type ManuscriptContext = z.infer<typeof manuscriptContextSchema>

export function manuscriptProgress(task: ManuscriptTask, states: Readonly<Record<string, string | undefined>>,
  receipts: Readonly<Record<string, ReadonlyArray<{ kind: string; paths?: string[]; at?: number }> | undefined>>) {
  const done = new Set<string>()
  const active: { run: string; at: number }[] = []
  const superseded = new Set(task.batches.flatMap(batch => batch.replaces ? [batch.replaces] : []))
  let pending: ManuscriptTask['batches'][number] | undefined
  for (const batch of task.batches) {
    const state = states[batch.run]
    if (state === 'draft' || state === 'saved') {
      const writes = receipts[batch.run]?.filter(step => step.kind === 'draft' || step.kind === 'saved')
      for (const file of writes?.at(-1)?.paths ?? batch.files) done.add(file)
      active.push({ run: batch.run, at: writes?.[0]?.at ?? 0 })
    } else if (!state && !superseded.has(batch.run)) pending = batch
  }
  return { done, active: active.sort((left, right) => left.at - right.at).map(batch => batch.run),
    pending, remaining: task.files.filter(file => !done.has(file)) }
}
