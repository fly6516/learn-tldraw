import type { UIMessage } from 'ai'
import { z } from 'zod'
import { chapterAnswerSchema, editRequestSchema, projectSuggestionSchema } from './ai-edit'
import { revisionDraftRequestSchema } from './ai-revision'
import type { EvidenceQuote } from './writing-ai-evidence'
import type { WritingDraft } from './writing-drafts'
import { manuscriptContextSchema, type ManuscriptTask } from './manuscript-task'
import { attachmentContextSchema } from './ai-attachments'
import { writingClaimsSchema } from './writing-claims'
import type { AiContextReceipt } from './ai-read-scope'
import { maxSourceRanges, sourceRangeSchema } from './ai-source-ranges'
import { aiMediaSchema } from './ai-media'

export const writingWorkflows = {
  auto: { name: 'Auto', instruction: 'Infer whether to review, compare, edit, compile, prepare a submission, start a revision round, record a reviewer comment, or draft a reply. Search for relevant files when the file is unclear or the request spans files.' },
  chapter: { name: 'Chapter', instruction: 'Use read_source for the relevant chapter lines. Verify any new citations or labels with query_references.' },
  project: { name: 'Across files', instruction: 'Use search_source and read_source to verify consistency across relevant files. Identify any files you could not check.' },
  diagnostics: { name: 'Compiler problems', instruction: 'Call compile_diagnostics before diagnosing. If diagnostics are stale or unavailable, ask the author to compile again. Use read_source to inspect implicated lines.' },
  revision: { name: 'Reviewer reply', instruction: 'Use read_archived_changes for the selected reviewer comment. Distinguish archived changes from author rationale. Return reply wording through propose_reply for author review.' },
} as const

export const chatWorkflowSchema = z.enum(['auto', 'chapter', 'project', 'diagnostics', 'revision'])
export type ChatWorkflow = z.infer<typeof chatWorkflowSchema>
export const workflowVersion = 1
export const chatEditSchema = z.object({ summary: projectSuggestionSchema.shape.summary, edits: projectSuggestionSchema.shape.edits.min(1),
  claims: writingClaimsSchema.optional() })
export const editPermissionRequestSchema = z.object({
  paths: z.array(z.string().min(1).max(500)).min(1).max(6),
  reason: z.string().trim().min(1).max(600),
}).strict()
export const submissionChatSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  includeDrafts: z.boolean().optional(),
  excluded: z.array(z.string().min(1).max(500)).max(100).optional(),
}).strict()
export const replyChatSchema = z.object({
  round: z.string().trim().min(1).max(100).optional(),
  comment: z.number().int().positive(),
  revised: z.string().trim().min(1).max(100).optional(),
  authorNote: z.string().trim().max(1500).optional(),
})
export const compileFeedbackSchema = z.object({
  status: z.enum(['passed', 'failed']),
  message: z.string().max(1000),
  diagnostics: editRequestSchema.shape.compiler.shape.diagnostics,
  log: z.string().max(4000).optional(),
})
export type ChatCompileFeedback = z.infer<typeof compileFeedbackSchema>
export type ReplyChatRequest = z.infer<typeof replyChatSchema>
export type SubmissionChatRequest = z.infer<typeof submissionChatSchema>
export const revisionSetupSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('round'), name: z.string().trim().min(1).max(100), baseline: z.string().min(1).max(100), baselineId: z.string().min(1).max(500) }),
  z.object({ kind: z.literal('comment'), round: z.string().min(1).max(500), roundName: z.string().min(1).max(100),
    path: z.string().min(1).max(500), text: z.string().trim().min(1).max(12000) }),
])
export type ChatRevisionSetup = z.infer<typeof revisionSetupSchema>
export const revisionRoundRequestSchema = revisionSetupSchema.options[0].pick({ name: true, baseline: true })
export const reviewerCommentRequestSchema = revisionSetupSchema.options[1].pick({ path: true, text: true }).extend({
  round: z.string().trim().min(1).max(100).optional(),
})

export const chatRequestSchema = z.object({
  run: z.uuid(), workflow: chatWorkflowSchema, source: editRequestSchema.optional(),
  excerpts: z.array(sourceRangeSchema).max(maxSourceRanges).optional(),
  media: aiMediaSchema.optional(),
  scope: z.array(z.string().max(500)).max(49),
  revision: revisionDraftRequestSchema.optional(),
  feedback: compileFeedbackSchema.optional(),
  previousProposal: chatEditSchema.optional(),
  manuscript: manuscriptContextSchema.optional(),
  writingExample: z.boolean().optional(),
  latestMessageOnly: z.boolean().optional(),
  expectedRecipient: z.string().min(1).max(300).optional(),
  attachments: attachmentContextSchema.optional(),
  draftPermission: z.union([z.literal('all'), z.array(z.string().min(1).max(500)).max(6)]).optional(),
  workspaceActivity: z.array(z.object({
    action: z.enum(['draft', 'saved', 'undone', 'rejected', 'archived', 'revision-created', 'comment-added', 'reply-saved',
      'permission-granted', 'permission-denied']),
    paths: z.array(z.string().max(500)).max(6).optional(), detail: z.string().max(300).optional(),
  })).max(12).optional(),
  selection: z.object({ path: z.string().max(500), start: z.number().int().positive(), end: z.number().int().positive() }).refine(range => range.start <= range.end).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']), text: z.string().min(1).max(12_000),
  })).min(1).max(24),
}).refine(value => value.workflow === 'revision' ? Boolean(value.revision) && value.scope.length === 0
  : Boolean(value.source) && (value.workflow === 'auto' || value.draftPermission === 'all' || value.scope.length <= 6))

export type WritingChatMessage = UIMessage<{
  run: string
  complete?: boolean
  selection?: { path: string; start: number; end: number }
  workflow?: ChatWorkflow
  feedback?: ChatCompileFeedback
  local?: boolean
  submission?: SubmissionChatRequest
  letter?: string
  revisionSetup?: ChatRevisionSetup
  actionError?: string
  evidence?: (z.infer<typeof chapterAnswerSchema>['evidence'][number] & { anchor?: EvidenceQuote })[]
  missing?: string[]
  readPaths?: string[]
  modelRecipient?: string
  historyCount?: number
}>
export type ChatSource = { saved: string; draft?: WritingDraft }
export type ChatReplyTarget = {
  round: string; roundName: string; comment: string; commentText: string; originalId: string; revisedId: string
  commentEditId?: string
  previousRevisedId?: string
  previous?: import('./revision-rounds').RevisionResponse; paths: string[]; kind: 'changed' | 'retained'
}
export type ChatRun = { main?: string; pathRevision?: number; sources: Record<string, ChatSource>; context?: AiContextReceipt; reply?: ChatReplyTarget; revisionOf?: string;
  manuscriptId?: string; replacesBatch?: string; verifyRepair?: boolean }
export type ChatTaskStep = {
  kind: 'verify' | 'authorize-save' | 'passed' | 'failed' | 'cancelled' | 'blocked' | 'draft' | 'saved' | 'undone' | 'rejected'
    | 'preview-compile' | 'archived' | 'reply-saved' | 'revision-created' | 'comment-added' | 'permission-granted' | 'permission-denied'
  at: number
  selected?: number
  selection?: number[]
  paths?: string[]
  detail?: string
}
export type ChatCheckpoint = {
  state: 'draft' | 'saved' | 'undone' | 'rejected'
  main?: string
  before: Record<string, ChatSource>
  after: Record<string, ChatSource>
}
export type ChatConversation = {
  id: string
  title: string
  messages: WritingChatMessage[]
  runs: Record<string, ChatRun>
  manuscript?: ManuscriptTask
}
export type ChatHistory = { selected: string; conversations: ChatConversation[] }
