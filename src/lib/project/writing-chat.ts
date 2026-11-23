import type { UIMessage } from 'ai'
import { z } from 'zod'
import { chapterAnswerSchema, editRequestSchema, projectSuggestionSchema } from './ai-edit'
import { revisionDraftRequestSchema } from './ai-revision'
import type { WritingDraft } from './writing-drafts'

export const writingWorkflows = {
  chapter: { name: 'Chapter', instruction: 'Use read_source for the relevant chapter lines. Verify any new citations or labels with query_references.' },
  project: { name: 'Across files', instruction: 'Use search_source and read_source to verify consistency across relevant files. Identify any files you could not check.' },
  diagnostics: { name: 'Compiler problems', instruction: 'Call compile_diagnostics before diagnosing. If diagnostics are stale or unavailable, ask the author to compile again. Use read_source to inspect implicated lines.' },
  revision: { name: 'Reviewer reply', instruction: 'Use read_archived_changes for the selected reviewer comment. Distinguish archived changes from author rationale. Return reply wording through propose_reply for author review.' },
} as const

export const chatWorkflowSchema = z.enum(['chapter', 'project', 'diagnostics', 'revision'])
export type ChatWorkflow = z.infer<typeof chatWorkflowSchema>
export const workflowVersion = 1
export const chatEditSchema = z.object({ summary: projectSuggestionSchema.shape.summary, edits: projectSuggestionSchema.shape.edits.min(1) })
export const chatRequestSchema = z.object({
  run: z.uuid(), workflow: chatWorkflowSchema, source: editRequestSchema.optional(),
  scope: z.array(z.string().max(500)).max(6),
  revision: revisionDraftRequestSchema.optional(),
  selection: z.object({ path: z.string().max(500), start: z.number().int().positive(), end: z.number().int().positive() }).refine(range => range.start <= range.end).optional(),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']), text: z.string().min(1).max(12_000),
  })).min(1).max(24),
}).refine(value => value.workflow === 'revision' ? Boolean(value.revision) && value.scope.length === 0 : Boolean(value.source))

export type WritingChatMessage = UIMessage<{
  run: string
  complete?: boolean
  selection?: { path: string; start: number; end: number }
  workflow?: ChatWorkflow
  evidence?: z.infer<typeof chapterAnswerSchema>['evidence']
  missing?: string[]
}>
export type ChatSource = { saved: string; draft?: WritingDraft }
export type ChatRun = { main?: string; sources: Record<string, ChatSource> }
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
}
export type ChatHistory = { selected: string; conversations: ChatConversation[] }
