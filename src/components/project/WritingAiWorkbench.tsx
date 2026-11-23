'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { applyProjectEdits, buildChapterContext, maxChapterLength, type ChapterEditRequest } from '@/lib/project/ai-edit'
import { confirmChatReply, listRevisionRounds, readChatCheckpoints, readChatHistory, readChatTaskSteps, readChatVerifications, recordChatTaskStep, writeChatHistory, writeChatVerification } from '@/lib/project/storage'
import { chatEditSchema, editPermissionRequestSchema, replyChatSchema, revisionRoundRequestSchema, reviewerCommentRequestSchema, submissionChatSchema, writingWorkflows, type ChatCheckpoint, type ChatCompileFeedback, type ChatConversation, type ChatHistory, type ChatRevisionSetup, type ChatRun, type ChatTaskStep, type ChatWorkflow, type ReplyChatRequest, type SubmissionChatRequest, type WritingChatMessage } from '@/lib/project/writing-chat'
import type { ChatAction } from '@/lib/project/writing-chat-actions'
import { validateChatProposal, verificationBaseline, type ChatVerification, type ManuscriptBuild } from '@/lib/project/writing-chat-validation'
import { editableSource, type WritingDrafts, type WritingKey } from '@/lib/project/writing-drafts'
import type { ProjectFileSystem } from '@/lib/project/types'
import { locateEvidence, type SourceMove } from '@/lib/project/writing-ai-evidence'
import { collectBibliography, findNewUnknownCitations } from '@/lib/project/references'
import { confirmChatRevisionSetup, prepareChatLetter, prepareChatReply, prepareChatRevisionSetup } from '@/lib/project/chat-revision'
import { revisionDraftSchema } from '@/lib/project/ai-revision'
import type { SubmissionBuild, SubmissionSelection } from '@/lib/project/submission'
import { ChatSubmissionCard } from './ChatSubmissionCard'
import { download, submissionFilename } from './SubmissionDialog'
import { ManuscriptTaskCard } from './ManuscriptTaskCard'
import { ManuscriptReviewDialog } from './ManuscriptReviewDialog'
import { manuscriptPlanSchema, manuscriptProgress, type ManuscriptContext, type ManuscriptTask } from '@/lib/project/manuscript-task'
import { buildAttachmentContext } from '@/lib/project/ai-attachments'
import { ClaimEvidence, type ReviewedClaim } from './ClaimEvidence'
import { WritingMarkdown } from './WritingMarkdown'
import { writingClaimsSchema, type ClaimReview } from '@/lib/project/writing-claims'

const Diff = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })
type DraftAccess = 'all' | string[]
type DraftGrant = { id: string; access: DraftAccess; controller: AbortController }
type SourceWorkflow = Exclude<ChatWorkflow, 'revision'>
type Checkpoints = Record<string, ChatCheckpoint['state']>
type WorkbenchProps = {
  storage: IDBDatabase; projectKey: WritingKey; project: ProjectFileSystem; working: ProjectFileSystem; saved: ProjectFileSystem
  drafts: WritingDrafts; sourceMoves?: SourceMove[]; selected: string; main?: string; active: boolean; disabled: boolean
  compiler: ChapterEditRequest['compiler']; onLocate: (path: string, line: number) => void
  selection: () => { path: string; start: number; end: number } | undefined
  onAction: (run: string, action: ChatAction) => Promise<ChatCheckpoint['state']>
  onUndoBatches: (runs: readonly string[]) => Promise<string[]>
  onSaveManuscript: (taskId: string, runs: readonly string[], report: ChatVerification) => Promise<void>
  onCompile: (signal: AbortSignal) => Promise<{ feedback: ChatCompileFeedback } | undefined>
  onBuildSubmission: (selection: SubmissionSelection, signal: AbortSignal) => Promise<{ feedback: ChatCompileFeedback; submission?: SubmissionBuild } | undefined>
  onExternalSubmission: (include: boolean, excluded: string[]) => void
  onLayout: (placement: 'docked' | 'floating' | undefined) => void
  onRevision: () => void
}

const toolLabels: Record<string, string> = {
  search_source: 'Search source', read_source: 'Read source', query_references: 'Check references',
  compile_diagnostics: 'Read diagnostics', propose_edits: 'Validate edits', request_preview_compile: 'Request preview compile',
  read_patch_verification: 'Read temporary patch diagnostics',
  request_edit_permission: 'Request draft edit permission',
  read_archived_changes: 'Read archived ZIP changes', propose_reply: 'Stage reply',
  prepare_submission: 'Prepare submission checklist', request_reviewer_reply: 'Find archived reply evidence',
  prepare_revision_round: 'Check revision baseline', prepare_reviewer_comment: 'Check reviewer comment target',
  plan_manuscript: 'Plan manuscript changes', list_attachments: 'List project attachments', read_csv_rows: 'Read CSV evidence',
  read_manuscript_data: 'Read planned CSV evidence',
  resolve_claim_evidence: 'Link fresh claim evidence',
}
const receiptKinds = new Set(['draft', 'saved', 'undone', 'rejected', 'archived', 'revision-created', 'comment-added', 'reply-saved',
  'permission-granted', 'permission-denied'])

function newConversation(): ChatConversation {
  return { id: crypto.randomUUID(), title: 'New conversation', messages: [], runs: {} }
}

export function chatText(message: UIMessage) {
  return message.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
}

export const chatTransport = new DefaultChatTransport<WritingChatMessage>({
  api: '/api/latex/chat',
  prepareSendMessagesRequest: ({ messages, body }) => ({ body: {
    ...body, messages: messages.filter(message => message.role !== 'system' && !message.metadata?.local)
      .map(message => ({ role: message.role, text: [chatText(message),
        message.metadata?.actionError && `Workspace validation: ${message.metadata.actionError}`].filter(Boolean).join('\n').slice(0, 12_000) }))
      .filter(message => message.text.trim()).slice(-24),
  } }),
})

export function ChatToolProgress({ message }: { message: WritingChatMessage }) {
  const tools = message.parts.flatMap(part => {
    if (!part.type.startsWith('tool-') || !('state' in part) || !('toolCallId' in part)) return []
    const tool = part.type.slice(5)
    const output = 'output' in part && part.output && typeof part.output === 'object' ? part.output : undefined
    const failure = output && ('error' in output || 'unavailable' in output || 'state' in output && output.state !== 'current')
    return <p key={part.toolCallId} className="text-xs text-slate-600">
      {toolLabels[tool] ?? tool} · {part.state === 'output-available' ? failure ? 'Unavailable' : 'Done'
        : part.state === 'output-error' ? 'Failed' : 'Running'}
    </p>
  })
  if (!tools.length) return null
  return <details className="rounded border px-2 py-1 text-xs">
    <summary className="cursor-pointer">Tool activity · {tools.length}</summary>
    {tools}
  </details>
}

function editProposal(message: WritingChatMessage) {
  if (!message.metadata?.complete) return
  for (const part of message.parts) {
    if (part.type !== 'tool-propose_edits' || !('output' in part)) continue
    const parsed = chatEditSchema.safeParse(part.output)
    if (parsed.success) return parsed.data
  }
}

function toolResult<T>(message: WritingChatMessage, type: `tool-${string}`, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }) {
  if (!message.metadata?.complete) return
  for (const part of message.parts) {
    if (part.type !== type || !('output' in part)) continue
    const result = schema.safeParse(part.output)
    if (result.success) return result.data
  }
}

function revisionSetupRequest(message: WritingChatMessage) {
  const round = toolResult(message, 'tool-prepare_revision_round', revisionRoundRequestSchema)
  if (round) return { action: 'newround' as const, args: [round.name, round.baseline] }
  const comment = toolResult(message, 'tool-prepare_reviewer_comment', reviewerCommentRequestSchema)
  if (comment) return { action: 'comment' as const, args: [comment.path, comment.text, comment.round ?? ''] }
}

export function WritingAiWorkbench(props: WorkbenchProps) {
  const { storage, projectKey, onAction, onUndoBatches } = props
  const workspace = projectKey[0], projectId = projectKey[1]
  const [history, setHistory] = useState<ChatHistory>()
  const [checkpoints, setCheckpoints] = useState<Checkpoints>({})
  const [verifications, setVerifications] = useState<Record<string, ChatVerification>>({})
  const [tasks, setTasks] = useState<Record<string, ChatTaskStep[]>>({})
  const [storageError, setStorageError] = useState('')
  const historyRef = useRef<ChatHistory | undefined>(undefined)
  const persistence = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    Promise.all([readChatHistory(storage, [workspace, projectId]), readChatCheckpoints(storage, [workspace, projectId]), readChatVerifications(storage, [workspace, projectId]), readChatTaskSteps(storage, [workspace, projectId])]).then(([saved, states, reports, steps]) => {
      if (!active) return
      const initial = newConversation()
      historyRef.current = saved ?? { selected: initial.id, conversations: [initial] }
      setHistory(historyRef.current)
      setCheckpoints(states)
      setVerifications(reports)
      setTasks(steps)
    }).catch(() => { if (active) setStorageError('Local AI conversations could not be loaded.') })
    return () => { active = false }
  }, [projectId, storage, workspace])

  const persist = useCallback((update: (history: ChatHistory) => ChatHistory, replace = false) => {
    if (!historyRef.current) return
    const value = update(historyRef.current)
    historyRef.current = value
    if (replace) setHistory(value)
    persistence.current = persistence.current.catch(() => {}).then(() => writeChatHistory(storage, [workspace, projectId], value))
    void persistence.current.catch(() => setStorageError('The conversation could not be saved locally.'))
  }, [projectId, storage, workspace])

  async function refreshTasks() {
    setTasks(await readChatTaskSteps(storage, [workspace, projectId]))
  }

  const conversation = history?.conversations.find(item => item.id === history.selected)
  if (!conversation) return <p className="p-3 text-sm" role="status">{storageError || 'Loading local conversations…'}</p>
  return <Conversation key={conversation.id} {...props} conversation={conversation} checkpoints={checkpoints} storageError={storageError}
    onManuscript={manuscript => persist(value => ({ ...value, conversations: value.conversations.map(item =>
      item.id === conversation.id ? { ...item, manuscript } : item) }))}
    onUndoBatches={async runs => {
      const undone = await onUndoBatches(runs)
      setCheckpoints(current => ({ ...current, ...Object.fromEntries(undone.map(id => [id, 'undone' as const])) }))
      await refreshTasks().catch(() => setStorageError('Could not reload the task record.'))
      return undone
    }}
    onSaveManuscript={async (id, runs, report) => {
      await props.onSaveManuscript(id, runs, report)
      setCheckpoints(current => ({ ...current, [id]: 'saved' }))
      await refreshTasks().catch(() => setStorageError('Could not reload the task record.'))
    }}
    tasks={tasks} onRefreshTasks={refreshTasks} onTaskStep={async (id, step) => {
      await recordChatTaskStep(storage, [workspace, projectId], id, { ...step, at: Date.now() })
      await refreshTasks()
    }}
    verifications={verifications} onVerification={async (id, report, record, build) => {
      await writeChatVerification(storage, [workspace, projectId], id, report, record, build)
      setVerifications(current => ({ ...current, [id]: report }))
      if (record) await refreshTasks()
    }}
    conversations={history!.conversations} onSelect={id => persist(value => ({ ...value, selected: id }), true)}
    onNew={() => persist(value => {
      const next = newConversation()
      return { selected: next.id, conversations: [next, ...value.conversations].slice(0, 12) }
    }, true)}
    onDelete={() => persist(value => {
      const remaining = value.conversations.filter(item => item.id !== conversation.id)
      if (!remaining.length) remaining.push(newConversation())
      return { selected: remaining[0].id, conversations: remaining }
    }, true)}
    onPersist={(messages, runs) => persist(value => ({ ...value, conversations: value.conversations.map(item => {
      if (item.id !== conversation.id) return item
      const activeRuns = item.manuscript?.batches.filter(batch => !checkpoints[batch.run]).slice(-2).map(batch => batch.run) ?? []
      const pinned = messages.filter(message => message.role === 'assistant' && message.metadata?.complete
        && activeRuns.includes(message.metadata.run))
      const retainedSet = new Set([...pinned, ...messages.slice(-(30 - pinned.length))])
      const retained = messages.filter(message => retainedSet.has(message))
      const retainedRuns = retained.flatMap(message => {
        const id = message.metadata?.run
        const run = id && runs[id]
        if (!id || !run || message.role !== 'assistant' || !message.metadata?.complete) return []
        const paths = new Set(editProposal(message)?.edits.map(edit => edit.path))
        const sources = Object.fromEntries(Object.entries(run.sources).filter(([path]) => paths.has(path)))
        return [[id, { ...run, sources }] as const]
      })
      return { ...item, title: chatText(messages.find(message => message.role === 'user') ?? { role: 'user', id: '', parts: [] }).slice(0, 52) || item.title,
        messages: retained, runs: Object.fromEntries(retainedRuns) }
    }) }))}
    onAction={async (run, action) => {
      try {
        const state = await onAction(run, action)
        setCheckpoints(current => ({ ...current, [run]: state }))
        return state
      } catch (cause) {
        await recordChatTaskStep(storage, [workspace, projectId], run, { kind: 'blocked', at: Date.now(),
          detail: cause instanceof Error ? cause.message : 'Could not change the source.' }).catch(() => {})
        throw cause
      } finally {
        await refreshTasks().catch(() => setStorageError('Could not reload the task record.'))
      }
    }} />
}

function Conversation(props: WorkbenchProps & {
  conversation: ChatConversation; conversations: ChatConversation[]; storageError: string; checkpoints: Checkpoints
  verifications: Record<string, ChatVerification>; onVerification: (id: string, report: ChatVerification, record?: boolean, build?: ManuscriptBuild) => Promise<void>
  tasks: Record<string, ChatTaskStep[]>; onTaskStep: (id: string, step: Omit<ChatTaskStep, 'at'>) => Promise<void>
  onRefreshTasks: () => Promise<void>
  onSelect: (id: string) => void; onNew: () => void; onDelete: () => void
  onPersist: (messages: WritingChatMessage[], runs: Record<string, ChatRun>) => void
  onManuscript: (task: ManuscriptTask) => void
}) {
  const [workflow, setWorkflow] = useState<SourceWorkflow>('auto')
  const [permission, setPermission] = useState<DraftAccess>()
  const [consent, setConsent] = useState<DraftAccess>()
  const [scope, setScope] = useState<string[]>()
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [manuscript, setManuscript] = useState(props.conversation.manuscript)
  const manuscriptRef = useRef(props.conversation.manuscript)
  const [reviewManuscript, setReviewManuscript] = useState(false)
  const [undoSave, setUndoSave] = useState(false)
  const taskProgress = useMemo(() => manuscript && manuscriptProgress(manuscript, props.checkpoints, props.tasks),
    [manuscript, props.checkpoints, props.tasks])
  const [runningManuscript, setRunningManuscript] = useState(false)
  const [undoBatches, setUndoBatches] = useState<string[]>()
  const [undoError, setUndoError] = useState('')
  const [repairBuild, setRepairBuild] = useState(false)
  const localOperation = useRef<AbortController>(null)
  const replyInProgress = useRef(false)
  const [letters, setLetters] = useState<Record<string, Awaited<ReturnType<typeof prepareChatLetter>>>>({})
  const files = [...props.project.files.keys()].filter(path => /\.tex$/i.test(path)
    && (editableSource(props.working, path)?.length ?? Infinity) <= maxChapterLength)
  const targets = (scope ?? (Array.isArray(permission) ? permission : [props.selected])).filter(path => files.includes(path))
  const grant = useRef<DraftGrant>(null)
  const [wasActive, setWasActive] = useState(props.active)
  if (wasActive !== props.active) {
    setWasActive(props.active)
    if (!props.active) { setPermission(undefined); setConsent(undefined); setRunningManuscript(false) }
  }
  const pending = useRef<{ id: string; grant?: string; manuscriptId?: string; claimId?: string } | null>(null)
  const [runSnapshots, setRunSnapshots] = useState(props.conversation.runs)
  const runs = useRef(props.conversation.runs)
  const latest = useRef(props)
  const scroll = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const atBottom = useRef(true)
  useEffect(() => { latest.current = props }, [props])

  const { messages, sendMessage, setMessages, status, stop, clearError, error: streamError } = useChat({
    id: props.conversation.id, transport: chatTransport, messages: props.conversation.messages,
    experimental_throttle: 50,
    onFinish: ({ message, messages, isAbort, isDisconnect, isError }) => {
      if (isAbort || isDisconnect || isError) {
        const interrupted = { ...message, metadata: message.metadata && { ...message.metadata, complete: false } }
        setMessages(messages.map(item => item.id === message.id ? interrupted : item))
        latest.current.onPersist(messages.map(item => item.id === message.id ? interrupted : item), runs.current)
        pending.current = null
        setRunningManuscript(false)
        return
      }
      if (revisionSetupRequest(message)) void resolveRevisionSetup(message)
      const task = pending.current
      pending.current = null
      const proposal = editProposal(message)
      const runId = message.metadata?.run
      const run = runId ? runs.current[runId] : undefined
      const plan = toolResult(message, 'tool-plan_manuscript', manuscriptPlanSchema)
      const original = messages.find(item => item.role === 'user' && item.metadata?.run === runId)
      if (plan && original && !manuscriptRef.current && latest.current.active) {
        updateManuscript({ ...plan, id: crypto.randomUUID(), goal: chatText(original).slice(0, 12000), batches: [] })
      }
      const projectTask = manuscriptRef.current
      if (runId && task?.claimId && task.id === runId && projectTask && run?.manuscriptId === projectTask.id && latest.current.active) {
        const evidence = toolResult(message, 'tool-resolve_claim_evidence', writingClaimsSchema.element)
        if (evidence) {
          updateManuscript({ ...projectTask, claimReviews: { ...projectTask.claimReviews,
            [task.claimId]: { decision: 'requested', evidence, revision: run.pathRevision ?? 0 } } })
          setReviewManuscript(true)
        } else setError('No fresh evidence was linked. The claim still needs review.')
      }
      if (runId && projectTask && run?.manuscriptId === projectTask.id && task?.id === runId && !task.claimId) {
        if (proposal && projectTask.batches.length < 120) {
          updateManuscript({ ...projectTask, batches: [...projectTask.batches, {
            run: runId, files: [...new Set(proposal.edits.map(edit => edit.path))], replaces: run.replacesBatch,
            claims: proposal.claims, sourceRevision: run.pathRevision ?? 0,
          }] })
        } else {
          setRunningManuscript(false)
          if (!toolResult(message, 'tool-request_edit_permission', editPermissionRequestSchema)) {
            setError('The task paused because this batch did not return an edit proposal.')
          }
        }
      }
      latest.current.onPersist(messages, runs.current)
      const approved = grant.current
      if (!task || !proposal || !run || runId !== task.id || !latest.current.active) return
      const read = new Set(message.metadata?.readPaths)
      const canApply = approved && !approved.controller.signal.aborted && approved.id === task.grant
        && !message.metadata?.missing?.length && proposal.edits.every(edit =>
          (approved.access === 'all' || approved.access.includes(edit.path)) && read.has(edit.path))
      if (run.verifyRepair) void verifyRepairedProposal(task.id, run, proposal, canApply ? approved : undefined)
      else if (canApply) void mutate(task.id, { kind: 'apply', run, edits: proposal.edits, automatic: true, signal: approved.controller.signal })
    },
  })
  const streaming = status === 'submitted' || status === 'streaming'
  function updateManuscript(value: ManuscriptTask) {
    manuscriptRef.current = value
    setManuscript(value)
    latest.current.onManuscript(value)
  }

  async function reviewClaim(item: ReviewedClaim, decision: 'confirmed' | 'requested' | 'excluded') {
    const task = manuscriptRef.current
    if (!task || !props.active || streaming || mutating) return
    const review: ClaimReview = { ...task.claimReviews?.[item.id], decision,
      fingerprint: decision === 'confirmed' ? item.assessment.fingerprint : undefined }
    let next = { ...task, claimReviews: { ...task.claimReviews, [item.id]: review } }
    if (decision === 'requested') {
      const { path, quote } = item.claim
      if (!submit(`Find verifiable evidence for this exact claim in ${path}: ${JSON.stringify(quote)}. Do not edit any files. Link the exact physical source lines with resolve_claim_evidence.`,
        undefined, [], 'evidence', item)) throw new Error('Could not start a read-only evidence request.')
      setReviewManuscript(false)
    }
    if (decision === 'excluded' && item.assessment.present) {
      const { path, exclusion } = item.claim
      const saved = editableSource(props.project, path)
      const text = editableSource(props.working, path)
      if (!exclusion || saved === undefined || text === undefined || task.batches.length >= 120) {
        throw new Error('This exact change cannot be reverted. Compare the current file or exclude it from the save.')
      }
      const edits = [{ path, ...exclusion }]
      const updated = applyProjectEdits(new Map([[path, text]]), edits).get(path)!
      if (updated.includes(item.claim.quote)) throw new Error('The claim also occurs elsewhere. Compare the current file before excluding it.')
      const run = crypto.randomUUID()
      const state = await props.onAction(run, { kind: 'apply', edits, run: {
        main: props.project.metadata.mainFile, sources: { [path]: { saved, draft: props.drafts[path] } },
      } })
      if (state !== 'draft') throw new Error('The draft could not be updated.')
      const removed = task.batches.flatMap(batch => (batch.claims ?? []).flatMap((claim, index) => claim.path === path
        && text.includes(claim.quote) && !updated.includes(claim.quote) ? [`${batch.run}:${index}`] : []))
      next = { ...next, batches: [...task.batches, { run, files: [path] }],
        claimReviews: { ...next.claimReviews, ...Object.fromEntries(removed.map(id => [id, { decision: 'excluded' } as const])) } }
    }
    updateManuscript(next)
  }

  async function verifyRepairedProposal(id: string, run: ChatRun, proposal: NonNullable<ReturnType<typeof editProposal>>, approved?: DraftGrant) {
    const work = latest.current
    if (!work.main || localOperation.current) return
    const controller = new AbortController()
    localOperation.current = controller
    setMutating(true)
    setRepairBuild(true)
    let recorded = false
    try {
      const selected = proposal.edits.map((_, index) => index)
      await work.onTaskStep(id, { kind: 'verify', selected: selected.length, selection: selected })
      const report = await validateChatProposal({ ...work, main: work.main, run, edits: proposal.edits, selected, signal: controller.signal })
      if (controller.signal.aborted) return
      await work.onVerification(id, report, true)
      recorded = true
      const current = latest.current
      if (approved && report.status === 'passed' && current.active && grant.current?.id === approved.id
        && !controller.signal.aborted && !approved.controller.signal.aborted
        && current.project === work.project && current.drafts === work.drafts && current.main === work.main) {
        await current.onAction(id, { kind: 'apply', run, edits: proposal.edits, automatic: true,
          signal: AbortSignal.any([controller.signal, approved.controller.signal]) })
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const detail = cause instanceof Error ? cause.message : 'Could not verify the repair.'
        setError(detail)
        await work.onTaskStep(id, { kind: 'blocked', detail }).catch(() => {})
      }
    } finally {
      if (!recorded && controller.signal.aborted) await work.onTaskStep(id, { kind: 'cancelled' }).catch(() => {})
      localOperation.current = null
      setRepairBuild(false)
      setMutating(false)
    }
  }
  const input = useMemo(() => ({ project: props.project, working: props.working, drafts: props.drafts, main: props.main ?? '' }),
    [props.project, props.working, props.drafts, props.main])
  const [baseline, setBaseline] = useState<{ input: typeof input; raw: string; working: string }>()
  useEffect(() => {
    let active = true
    void Promise.all([verificationBaseline(input.project, input.drafts), verificationBaseline(input.working, {})]).then(([raw, working]) => {
      if (active) setBaseline({ input, raw, working })
    }).catch(() => {})
    return () => { active = false }
  }, [input])
  useEffect(() => {
    return () => {
      grant.current?.controller.abort()
      grant.current = null
      pending.current = null
      localOperation.current?.abort()
    }
  }, [props.active])
  useEffect(() => {
    if (atBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
    if (!streaming) return
    const timer = setTimeout(() => latest.current.onPersist(messages, runs.current), 350)
    return () => clearTimeout(timer)
  }, [messages, streaming])

  async function mutate(id: string, action: ChatAction) {
    setError('')
    setMutating(true)
    if (runs.current[id]?.manuscriptId && (action.kind === 'reject' || action.kind === 'undo')) setRunningManuscript(false)
    try {
      await latest.current.onAction(id, action)
      if (action.kind === 'apply' && !action.automatic && manuscriptRef.current?.delivery
        && runs.current[id]?.manuscriptId === manuscriptRef.current.id) setRunningManuscript(true)
    }
    catch (cause) {
      if (runs.current[id]?.manuscriptId) setRunningManuscript(false)
      setError(cause instanceof Error ? cause.message : 'Could not change the source.')
    }
    finally { setMutating(false) }
  }

  function revokePermission() {
    grant.current?.controller.abort()
    grant.current = null
    setPermission(undefined)
  }

  function approvePermission(access: DraftAccess) {
    if (!latest.current.active) return
    revokePermission()
    grant.current = { id: crypto.randomUUID(), access, controller: new AbortController() }
    setPermission(access)
  }

  function updateScope(path: string, checked: boolean) {
    revokePermission()
    setScope(checked ? [...targets, path] : targets.filter(item => item !== path))
  }

  useEffect(() => {
    if (!streaming && messages.length) latest.current.onPersist(messages, runs.current)
  }, [messages, streaming])

  function localMessage(text: string, request?: { submission?: SubmissionChatRequest; letter?: string; revisionSetup?: ChatRevisionSetup }) {
    const id = crypto.randomUUID()
    setMessages(previous => [...previous, { id, role: 'assistant', metadata: { run: id, local: true, complete: true, ...request },
      parts: [{ type: 'text', text }] }])
    return id
  }

  async function startReply(request: ReplyChatRequest, text: string) {
    if (streaming || props.disabled || !props.active || replyInProgress.current) return
    const controller = new AbortController()
    if (localOperation.current) return
    localOperation.current = controller
    replyInProgress.current = true
    setError('')
    setMutating(true)
    try {
      const { reply, revision } = await prepareChatReply(props.storage, props.projectKey, request)
      if (controller.signal.aborted) return
      const id = crypto.randomUUID()
      runs.current = { ...runs.current, [id]: { sources: {}, reply } }
      setRunSnapshots(runs.current)
      pending.current = null
      clearError()
      setStopped(false)
      setPrompt('')
      atBottom.current = true
      await sendMessage({ text, metadata: { run: id } }, { body: { run: id, workflow: 'revision', scope: [], revision } })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not read the archived reply evidence.')
    } finally {
      replyInProgress.current = false
      localOperation.current = null
      setMutating(false)
    }
  }

  function saveFeedback(id: string, feedback: ChatCompileFeedback) {
    setMessages(previous => previous.map(message => message.id === id && message.metadata
      ? { ...message, metadata: { ...message.metadata, feedback } } : message))
  }

  async function compilePreview(message: WritingChatMessage) {
    if (localOperation.current || !message.metadata || !props.active) return
    const controller = new AbortController()
    localOperation.current = controller
    setMutating(true)
    setError('')
    try {
      await props.onTaskStep(message.metadata.run, { kind: 'preview-compile' })
      if (controller.signal.aborted) return
      const result = await props.onCompile(controller.signal)
      if (controller.signal.aborted) return
      if (!result) throw new Error('Compile is busy or the current source is unavailable.')
      saveFeedback(message.id, result.feedback)
      await props.onTaskStep(message.metadata.run, { kind: result.feedback.status, detail: result.feedback.message })
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not compile the preview.')
    } finally {
      localOperation.current = null
      setMutating(false)
    }
  }

  async function runLocalCommand(command: string, argument: string) {
    setPrompt('')
    switch (command) {
      case 'layout': {
        const value = { docked: 'docked', same: 'docked', floating: 'floating', overlay: 'floating', auto: undefined } as const
        if (!Object.hasOwn(value, argument)) { setError('Use /layout docked, /layout floating, or /layout auto.'); return }
        props.onLayout(value[argument as keyof typeof value])
        localMessage(argument === 'auto' ? 'Writing AI uses the responsive layout.' : `Writing AI is now ${value[argument as keyof typeof value]}.`)
        return
      }
      case 'submission': {
        const result = submissionChatSchema.safeParse({ name: argument || undefined })
        if (!result.success) { setError('Use a submission name of up to 100 characters.'); return }
        localMessage('Review the submission preflight and ZIP manifest.', { submission: result.data })
        return
      }
      case 'review':
        if (!taskProgress?.active.length || taskProgress.pending || runningManuscript || manuscript?.delivery && taskProgress.remaining.length
          || !manuscript || props.checkpoints[manuscript.id] === 'saved') {
          setError('Apply or resolve the task batches before opening manuscript review.')
        } else setReviewManuscript(true)
        return
      case 'reply': {
        const [number, round, revised] = argument.split('|').map(value => value.trim())
        const result = replyChatSchema.safeParse({ comment: Number(number), round: round || undefined, revised: revised || undefined })
        if (!result.success) { setError('Use /reply <comment number> | <round name> | <revised archive>. The names can be omitted when unambiguous.'); return }
        await startReply(result.data, `Draft an evidence-based reply to comment ${number}.`)
        return
      }
      case 'letter':
      case 'revisions':
      case 'newround':
      case 'comment': {
        setMutating(true)
        try {
          if (command === 'letter') {
            const letter = await prepareChatLetter(props.storage, props.projectKey, argument || undefined)
            const id = localMessage(`Response letter for ${letter.name}.`, { letter: letter.name })
            setLetters(previous => ({ ...previous, [id]: letter }))
          } else if (command === 'revisions') {
            const rounds = await listRevisionRounds(props.storage, props.projectKey)
            localMessage(rounds.length ? rounds.map(round => [round.name, ...round.comments.map((comment, index) =>
              `${index + 1}. ${comment.reviewer || 'Reviewer'} · ${comment.text.slice(0, 160)}`)].join('\n')).join('\n\n')
              : 'There are no revision rounds in this project.')
          } else {
            const setup = await prepareChatRevisionSetup(props.storage, props.projectKey, command, argument.split('|').map(value => value.trim()))
            if (setup.kind === 'comment' && !files.includes(setup.path)) throw new Error('Choose the exact path of an editable LaTeX source.')
            localMessage(setup.kind === 'round' ? 'Review the new revision round.' : 'Review the new reviewer comment.', { revisionSetup: setup })
          }
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the revision.') }
        finally { setMutating(false) }
        return
      }
      default: setError('Available commands: /layout, /review, /submission, /newround, /comment, /revisions, /reply, /letter.')
    }
  }

  async function resolveRevisionSetup(message: WritingChatMessage) {
    const request = revisionSetupRequest(message)
    if (!request) return
    let metadata: Pick<NonNullable<WritingChatMessage['metadata']>, 'revisionSetup' | 'actionError'>
    try {
      const setup = await prepareChatRevisionSetup(props.storage, props.projectKey, request.action, request.args)
      if (setup.kind === 'comment' && editableSource(latest.current.project, setup.path) === undefined) {
        throw new Error('Choose the exact path of an editable LaTeX source.')
      }
      metadata = { revisionSetup: setup, actionError: undefined }
    } catch (cause) {
      metadata = { actionError: (cause instanceof Error ? cause.message : 'Could not check the revision target.').slice(0, 1000) }
    }
    setMessages(previous => previous.map(item => item.id === message.id && item.metadata
      ? { ...item, metadata: { ...item.metadata, ...metadata } } : item))
  }

  function submit(value: string, repair?: { id: string; report: ChatVerification; proposal?: NonNullable<ReturnType<typeof editProposal>>;
    reverify?: boolean; manuscriptTask?: boolean },
    approvedScope?: string[], taskMode?: 'plan' | 'batch' | 'evidence', evidence?: ReviewedClaim) {
    const text = value.trim()
    if (!text || streaming || props.disabled || mutating || !props.active) return false
    setError('')
    atBottom.current = true
    const command = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text)
    const layout = /^(?:把\s*AI\s*面板切到|AI\s*面板切到)\s*(同层|浮层|上层)[。！]?$/i.exec(text)
    const reviewRequest = /^(?:(?:please\s+)?(?:review|verify|save) (?:the )?manuscript task|(?:审阅|验证|保存)(?:当前)?(?:论文|写作)任务)[.。!！]?$/i.test(text)
    if (command) {
      void runLocalCommand(command[1].toLowerCase(), command[2]?.trim() ?? '')
      return
    }
    if (layout) {
      void runLocalCommand('layout', layout[1] === '同层' ? 'docked' : 'floating')
      return
    }
    if (reviewRequest) {
      void runLocalCommand('review', '')
      return
    }
    const current = props.working.files.get(props.selected)
    const currentSource = current && 'content' in current && /\.tex$/i.test(current.path) && current.content
      && current.content.length <= maxChapterLength ? current : undefined
    const primary = currentSource?.path ?? targets[0] ?? props.main
    const file = primary && props.working.files.get(primary)
    if (!primary || !file || !('content' in file) || !file.content || file.content.length > maxChapterLength || !props.main) {
      setError('Open a complete LaTeX chapter before sending.')
      return
    }
    clearError()
    setError('')
    setStopped(false)
    const id = crypto.randomUUID()
    const access = grant.current?.access
    const requested = approvedScope ?? scope ?? (taskMode !== 'plan' && Array.isArray(access) ? access : undefined)
    const context = buildChapterContext(props.working, primary, props.main, [
      ...(requested ?? targets), ...files.filter(path => text.includes(path) || text.includes(path.split('/').at(-1)!)),
    ])
    const completeFiles = new Set([primary, ...context.filter(entry => !entry.truncated).map(entry => entry.path)])
    const turnWorkflow = taskMode || repair?.reverify || repair?.manuscriptTask ? 'auto' : workflow
    const automaticScope = !requested && (turnWorkflow === 'auto' || access === 'all')
    const editPaths = (requested ?? (automaticScope ? files : targets)).filter(path => files.includes(path) && completeFiles.has(path))
    const sources = Object.fromEntries(editPaths.flatMap(path => {
      const saved = editableSource(props.project, path)
      return saved === undefined ? [] : [[path, { saved, draft: props.drafts[path] }] as const]
    }))
    const task = manuscriptRef.current
    const manuscriptId = taskMode === 'batch' || taskMode === 'evidence' || repair?.manuscriptTask
      ? task?.id : repair ? runs.current[repair.id]?.manuscriptId : undefined
    pending.current = { id, grant: repair?.manuscriptTask ? undefined : grant.current?.id, manuscriptId, claimId: evidence?.id }
    const source: ChapterEditRequest = { mode: 'rewrite', path: primary, main: props.main, source: file.content,
      instruction: '', compiler: props.compiler, context }
    setPrompt('')
    const resultTime = (message: WritingChatMessage) => props.tasks[message.metadata!.run]?.findLast(step =>
      step.kind === 'passed' || step.kind === 'failed')?.at ?? 0
    const resultMessage = [...messages].reverse().filter(message => message.role === 'assistant' && message.metadata
      && (message.metadata.feedback || props.verifications[message.metadata.run]))
      .sort((left, right) => resultTime(right) - resultTime(left))[0]
    const resultId = resultMessage?.metadata?.run
    const report = repair?.report ?? (resultId ? props.verifications[resultId] : undefined)
    const previousProposal = resultMessage && editProposal(resultMessage)
    const checkpoint = !repair && resultId ? props.checkpoints[resultId] : undefined
    const receipt = checkpoint ? ` Source proposal state: ${checkpoint}.` : ' This result is from a temporary snapshot.'
    const feedback = report ? { status: report.status, message: (report.message + receipt).slice(0, 1000),
      diagnostics: report.diagnostics.slice(0, 40).map(issue => ({ ...issue, message: issue.message.slice(0, 500) })),
      log: report.log.slice(-4000) } : resultMessage?.metadata?.feedback
    const failedProposal = (repair?.report.working ? undefined : repair?.proposal) ?? (!repair && previousProposal && report?.status === 'failed' && !checkpoint
      && baseline?.input === input && baseline.raw === report.baseline && report.main === input.main
      ? { summary: previousProposal.summary, edits: report.selected.map(index => previousProposal.edits[index]).filter(Boolean) }
      : undefined)
    const previousRun = repair?.id ?? (failedProposal && /repair|fix|error|修复|修正|报错/i.test(text) ? resultId : undefined)
    const revisionOf = previousRun && (runs.current[previousRun]?.revisionOf ?? previousRun)
    runs.current = { ...runs.current, [id]: { main: props.project.metadata.mainFile, pathRevision: props.sourceMoves?.length, sources, revisionOf,
      manuscriptId, replacesBatch: repair && !repair.manuscriptTask && manuscriptId && !props.checkpoints[repair.id] ? repair.id : undefined,
      verifyRepair: repair?.reverify } }
    setRunSnapshots(runs.current)
    const selection = revisionOf || taskMode ? undefined : props.selection()
    const repairFiles = failedProposal ? [...new Set(failedProposal.edits.map(edit => edit.path))] : editPaths
    const taskContext: ManuscriptContext | undefined = taskMode === 'plan' ? { mode: 'plan', goal: text, files: editPaths }
      : taskMode === 'evidence' && task && evidence ? { mode: 'evidence', goal: task.goal, files: [], data: task.delivery?.data,
        claim: { path: evidence.claim.path, kind: evidence.claim.kind, quote: evidence.claim.quote } }
      : repair?.reverify || previousRun ? { mode: 'repair', goal: task?.goal ?? text, files: repairFiles, decisions: task?.decisions, questions: task?.questions }
      : task ? { mode: taskMode === 'batch' ? 'batch' : 'context', goal: task.goal, files: taskMode === 'batch' ? editPaths : task.files,
        completed: [...manuscriptProgress(task, props.checkpoints, props.tasks).done], decisions: task.decisions, questions: task.questions,
        data: taskMode === 'batch' ? task.delivery?.data : undefined } : undefined
    const workspaceActivity = messages.flatMap(message => {
      if (message.role !== 'assistant' || !message.metadata?.run) return []
      const step = props.tasks[message.metadata.run]?.findLast(item => receiptKinds.has(item.kind))
      return step ? [step] : []
    }).sort((left, right) => left.at - right.at).slice(-12).map(step => ({
      action: step.kind, paths: step.paths?.slice(0, 6), detail: step.detail?.slice(0, 300),
    }))
    void sendMessage({ text, metadata: { run: id, selection } }, {
      body: { run: id, workflow: turnWorkflow, scope: editPaths, source, selection, feedback, previousProposal: failedProposal,
        workspaceActivity, draftPermission: access, manuscript: taskContext, attachments: buildAttachmentContext(props.working,
          [text, taskContext?.goal, ...(taskContext?.data ?? []).map(file => file.path)].filter(Boolean).join('\n')) },
    })
    return true
  }

  const runNextBatch = useEffectEvent(() => {
    const task = manuscriptRef.current
    if (!task || !props.active || props.disabled || streaming || mutating || pending.current) return
    if (task.delivery && task.questions.length) { setRunningManuscript(false); return }
    const progress = manuscriptProgress(task, props.checkpoints, props.tasks)
    if (progress.pending) return
    if (!progress.remaining.length) {
      setRunningManuscript(false)
      if (task.delivery && props.checkpoints[task.id] !== 'saved') setReviewManuscript(true)
      return
    }
    if (task.batches.length >= 120 || progress.remaining.some(path => !files.includes(path))) {
      setRunningManuscript(false)
      setError('The task reached its batch limit or a remaining file changed. Review the remaining file list.')
      return
    }
    const batch = progress.remaining.slice(0, 3)
    if (!submit(`Continue the manuscript task with this batch. Read and edit only: ${batch.join(', ')}.`, undefined, batch, 'batch')) {
      setRunningManuscript(false)
    }
  })

  useEffect(() => {
    if (runningManuscript) runNextBatch()
  }, [runningManuscript, manuscript, props.checkpoints, props.tasks, props.working, props.disabled, props.active, streaming, mutating])

  function pauseManuscript() {
    setRunningManuscript(false)
    if (pending.current?.manuscriptId) { pending.current = null; void stop() }
    if (repairBuild) localOperation.current?.abort()
  }

  async function undoManuscript() {
    if (!undoBatches || mutating) return
    setUndoError('')
    setMutating(true)
    try {
      await props.onUndoBatches(undoBatches)
      setUndoBatches(undefined)
    } catch (cause) {
      setUndoError(cause instanceof Error ? cause.message : 'Could not undo the task batches.')
    } finally { setMutating(false) }
  }

  async function undoManuscriptSave() {
    if (!manuscript || mutating) return
    setUndoError('')
    setMutating(true)
    try {
      await props.onAction(manuscript.id, { kind: 'undo' })
      setUndoSave(false)
    } catch (cause) {
      setUndoError(cause instanceof Error ? cause.message : 'Could not undo the manuscript save.')
    } finally { setMutating(false) }
  }

  async function saveReply(id: string, reply: NonNullable<ChatRun['reply']>, draft: string) {
    if (mutating || !props.active) return
    setError('')
    setMutating(true)
    try {
      await confirmChatReply(props.storage, props.projectKey, reply, draft, id)
      await props.onRefreshTasks()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the reply.') }
    finally { setMutating(false) }
  }

  async function saveRevisionSetup(id: string, setup: ChatRevisionSetup) {
    if (mutating || !props.active) return
    setError('')
    setMutating(true)
    try {
      if (setup.kind === 'comment' && !files.includes(setup.path)) throw new Error('The selected source was moved or is no longer editable.')
      await confirmChatRevisionSetup(props.storage, props.projectKey, id, setup)
      await props.onRefreshTasks()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the revision round.') }
    finally { setMutating(false) }
  }

  const anyError = error || (streamError ? 'The request failed. Check the model configuration or retry.' : '') || props.storageError
  const lastPrompt = [...messages].reverse().find(message => message.role === 'user')
  const deliveryArchive = manuscript && props.tasks[manuscript.id]?.findLast(step => step.kind === 'archived')?.detail
  const deliveryName = manuscript?.delivery?.submissionName
  return <div className="flex size-full min-h-0 min-w-0 flex-col text-sm">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1">
      <select aria-label="AI conversation" className="min-w-0 flex-1 rounded border bg-white px-1 py-1 text-xs" value={props.conversation.id}
        disabled={streaming || mutating} onChange={event => props.onSelect(event.target.value)}>
        {props.conversations.map(item => <option key={item.id} value={item.id}>{item.id === props.conversation.id && messages.length
          ? chatText(messages.find(message => message.role === 'user') ?? messages[0]).slice(0, 52) || item.title : item.title}</option>)}
      </select>
      <Button size="sm" variant="ghost" disabled={streaming || mutating} onClick={props.onNew}>New</Button>
      <Button size="sm" variant="ghost" disabled={streaming || mutating} onClick={() => setDeleteOpen(true)}>Delete</Button>
    </div>
    {manuscript && <ManuscriptTaskCard task={manuscript} states={props.checkpoints} receipts={props.tasks} messages={messages}
        running={runningManuscript} busy={streaming || mutating || props.disabled || !props.active}
        onRun={() => setRunningManuscript(true)} onPause={pauseManuscript}
        onNotes={(field, notes) => updateManuscript({ ...manuscriptRef.current!, [field]: notes })}
        onReview={() => setReviewManuscript(true)}
        onUndoSave={() => { setUndoError(''); setUndoSave(true) }}
        onUndo={ids => { setUndoBatches(ids); setUndoError('') }} />}
    {manuscript && taskProgress && reviewManuscript && props.active && <ManuscriptReviewDialog
      storage={props.storage} projectKey={props.projectKey} runs={taskProgress.active} project={props.project}
      working={props.working} drafts={props.drafts} baseline={baseline?.input === input ? baseline.raw : undefined}
      report={props.verifications[manuscript.id]} disabled={props.disabled || streaming || mutating}
      generatedEntry={props.saved !== props.project}
      autoVerify={Boolean(manuscript.delivery)} taskBatches={manuscript.batches} sourceMoves={props.sourceMoves ?? []}
      claimReviews={manuscript.claimReviews} onClaimDecision={reviewClaim}
      onVerify={(report, build) => props.onVerification(manuscript.id, report, true, build)}
      onSave={report => props.onSaveManuscript(manuscript.id, taskProgress.active, report)}
      onClose={() => setReviewManuscript(false)}
      onLocate={(path, line) => { setReviewManuscript(false); props.onLocate(path, line) }}
      onRepair={(paths, report) => {
        if (submit('Repair the errors in the manuscript verification report. Edit only the affected files and keep the existing manuscript changes.', {
          id: manuscript.id, report, manuscriptTask: true,
        }, paths)) setReviewManuscript(false)
      }} />}
    <Dialog open={undoSave} onOpenChange={open => { if (!mutating) setUndoSave(open) }}>
      <DialogContent>
        <DialogTitle>Undo manuscript save?</DialogTitle>
        <DialogDescription>Restore the saved project sources and return the task files to their pre-save drafts.</DialogDescription>
        {undoError && <p role="alert" className="text-sm text-red-800">{undoError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={mutating} onClick={() => setUndoSave(false)}>Cancel</Button>
          <Button disabled={mutating || props.disabled} onClick={() => void undoManuscriptSave()}>Undo manuscript save</Button>
        </div>
      </DialogContent>
    </Dialog>
    {manuscript && deliveryName && (props.checkpoints[manuscript.id] === 'saved' || deliveryArchive) && <div className="max-h-[35%] shrink-0 overflow-auto border-b px-2 py-1">
      <ChatSubmissionCard runId={manuscript.id} request={{ name: deliveryName }} saved={props.saved} working={props.working}
        drafts={props.drafts} main={props.main ?? ''} active={props.active} disabled={props.disabled || streaming || mutating}
        storage={props.storage} projectKey={props.projectKey} archived={deliveryArchive} manuscriptReport={props.verifications[manuscript.id]}
        onLocate={props.onLocate} onBuild={props.onBuildSubmission} onExternal={props.onExternalSubmission}
        onResult={feedback => void props.onTaskStep(manuscript.id, { kind: feedback.status, detail: feedback.message }).catch(() => setError('Could not record the submission compile.'))}
        onArchive={props.onRefreshTasks} />
    </div>}
    <div ref={scroll} className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-2" onScroll={event => {
      const element = event.currentTarget
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    }} aria-label="Conversation messages">
      {!messages.length && <p className="text-slate-600">Ask for an edit, a PDF check, submission preflight, or a reviewer reply. Use /layout to switch panel placement.</p>}
      {messages.map(message => {
        const proposal = editProposal(message)
        const runId = message.metadata?.run
        const run = runId ? runSnapshots[runId] : undefined
        const compileRequest = message.metadata?.complete && message.parts.find(part => part.type === 'tool-request_preview_compile'
          && 'output' in part && part.output && typeof part.output === 'object' && 'requested' in part.output
          && part.output.requested === true)
        const submission = message.metadata?.submission ?? toolResult(message, 'tool-prepare_submission', submissionChatSchema)
        const editPermission = toolResult(message, 'tool-request_edit_permission', editPermissionRequestSchema)
        const replyRequest = toolResult(message, 'tool-request_reviewer_reply', replyChatSchema)
        const reply = run?.reply && toolResult(message, 'tool-propose_reply', revisionDraftSchema)
        const steps = runId ? props.tasks[runId] : undefined
        const permissionDecision = steps?.find(step => step.kind === 'permission-granted' || step.kind === 'permission-denied')
        const archived = steps?.find(step => step.kind === 'archived')?.detail
        const replySaved = steps?.some(step => step.kind === 'reply-saved')
        const setup = message.metadata?.revisionSetup
        const setupSaved = steps?.some(step => step.kind === 'revision-created' || step.kind === 'comment-added')
        const feedback = message.metadata?.feedback
        const letter = letters[message.id]
        const original = run?.revisionOf && messages.find(item => item.role === 'assistant' && item.metadata?.run === run.revisionOf)
        const revisions = runId && messages.filter(item => item.role === 'assistant' && item.metadata && runSnapshots[item.metadata.run]?.revisionOf === runId && editProposal(item))
        return <article key={message.id} id={`writing-ai-message-${message.id}`} aria-label={message.role === 'user' ? 'You' : 'Assistant'}
          className={message.role === 'user' ? 'rounded-md bg-indigo-50 px-2 py-1.5' : 'space-y-2'}>
          <p className="mb-1 text-xs font-semibold">{message.role === 'user' ? 'You' : 'Assistant'}</p>
          <ChatToolProgress message={message} />
          {message.role === 'assistant' ? <WritingMarkdown text={chatText(message)} />
            : <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{chatText(message)}</p>}
          {runId && editPermission && <section aria-label="Draft permission request" className="space-y-2 rounded border border-indigo-200 p-2 text-xs">
            <h3 className="font-semibold">AI requests permission to edit working drafts</h3>
            <p className="break-words">{editPermission.reason}</p>
            <ul className="max-h-28 list-inside list-disc overflow-auto break-all font-mono">
              {editPermission.paths.map(path => <li key={path}>{path}</li>)}
            </ul>
            {permissionDecision ? <p role="status">{permissionDecision.kind === 'permission-granted'
              ? 'Approved for this session. See the current permission below.' : 'Request denied.'}</p>
              : <div className="flex flex-wrap gap-1">
                <Button size="sm" disabled={streaming || mutating || !props.active || props.disabled || editPermission.paths.some(path => !files.includes(path))}
                  onClick={() => {
                    const original = messages.find(item => item.role === 'user' && item.metadata?.run === runId)
                    approvePermission(editPermission.paths)
                    setScope(undefined)
                    void props.onTaskStep(runId, { kind: 'permission-granted', paths: editPermission.paths })
                      .catch(() => setError('Could not record the permission decision.'))
                    if (original) {
                      const batch = run?.manuscriptId === manuscriptRef.current?.id && Boolean(run?.manuscriptId)
                      if (batch) setRunningManuscript(true)
                      submit(chatText(original), undefined, editPermission.paths, batch ? 'batch' : undefined)
                    }
                  }}>Approve and continue</Button>
                <Button variant="outline" size="sm" disabled={streaming || mutating} onClick={() => void props.onTaskStep(runId,
                  { kind: 'permission-denied', paths: editPermission.paths }).catch(() => setError('Could not record the permission decision.'))}>
                  Deny request
                </Button>
              </div>}
          </section>}
          {message.role === 'user' && message.metadata?.selection && <p className="break-all text-xs text-slate-600">
            {message.metadata.selection.path} · Lines {message.metadata.selection.start}–{message.metadata.selection.end}
          </p>}
          {message.metadata?.missing?.length ? <p className="text-xs text-amber-800">Checks not completed: {message.metadata.missing.map(name => toolLabels[name] ?? name).join(', ')}.</p> : null}
          {!streaming && message.role === 'assistant' && !message.metadata?.complete && <p className="text-xs text-amber-800">This response did not finish. Any edits from it are unavailable.</p>}
          {compileRequest && !streaming && <Button size="sm" variant="outline" disabled={props.disabled || mutating || !props.main}
            onClick={() => void compilePreview(message)}>Approve preview compile</Button>}
          {feedback && <details open className="rounded border px-2 py-1 text-xs" aria-label="Chat compiler result">
            <summary>{feedback.status === 'failed' ? 'Compile failed' : 'Compile passed'} · {feedback.message}</summary>
            {feedback.diagnostics.map((issue, index) => <p className="break-all" key={index}>
              {issue.path}:{issue.line} · {issue.message}
            </p>)}
            {feedback.log && <details><summary>Compiler log</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{feedback.log}</pre></details>}
          </details>}
          {runId && submission && <ChatSubmissionCard runId={runId} request={submission} saved={props.saved} working={props.working}
            drafts={props.drafts} main={props.main ?? ''} active={props.active} disabled={props.disabled || streaming || mutating}
            storage={props.storage} projectKey={props.projectKey} archived={archived}
            onLocate={props.onLocate} onBuild={props.onBuildSubmission} onExternal={props.onExternalSubmission}
            onResult={feedback => {
              saveFeedback(message.id, feedback)
              void props.onTaskStep(runId, { kind: feedback.status, detail: feedback.message }).catch(() => setError('Could not record the submission compile.'))
            }} onArchive={props.onRefreshTasks} />}
          {replyRequest && <Button size="sm" variant="outline" disabled={streaming || mutating || props.disabled}
            onClick={() => void startReply(replyRequest, `Draft an evidence-based reply to comment ${replyRequest.comment}.`)}>
            Draft reply from archived changes
          </Button>}
          {message.metadata?.actionError && <p role="alert" className="break-words text-xs text-amber-800">{message.metadata.actionError}</p>}
          {!setup && !message.metadata?.actionError && !streaming && revisionSetupRequest(message) && <Button size="sm" variant="ghost"
            onClick={() => void resolveRevisionSetup(message)}>Check revision details</Button>}
          {runId && setup && <section className="space-y-1 rounded border border-indigo-200 p-2 text-xs" aria-label="Revision setup">
            <h3 className="font-semibold">{setup.kind === 'round' ? setup.name : setup.roundName}</h3>
            {setup.kind === 'round' ? <p>Baseline · {setup.baseline}</p>
              : <><p className="break-all">{setup.path}</p><blockquote className="whitespace-pre-wrap break-words">{setup.text}</blockquote></>}
            {setupSaved ? <p role="status">{setup.kind === 'round' ? 'Revision round created.' : 'Reviewer comment added.'}</p>
              : <Button size="sm" disabled={props.disabled || mutating || streaming}
                onClick={() => void saveRevisionSetup(runId, setup)}>{setup.kind === 'round' ? 'Confirm revision round' : 'Confirm reviewer comment'}</Button>}
          </section>}
          {runId && reply && run?.reply && <section className="space-y-1 rounded border border-indigo-200 p-2 text-xs" aria-label="Reviewer reply proposal">
            <h3 className="font-semibold">{run.reply.roundName} · Reviewer reply</h3>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-2">{run.reply.commentText}</blockquote>
            <WritingMarkdown text={reply.draft} />
            {run.reply.paths.length > 0 && <p className="break-all">Archived evidence · {run.reply.paths.join(', ')}</p>}
            {replySaved ? <p role="status">Reply saved.</p> : <Button size="sm" disabled={props.disabled || streaming || mutating}
              onClick={() => void saveReply(runId, run.reply!, reply.draft)}>
              {run.reply.previous ? 'Confirm replacement reply' : run.reply.previousRevisedId ? 'Confirm and save reply' : 'Confirm archive link and save reply'}
            </Button>}
          </section>}
          {letter && <section className="space-y-1 rounded border p-2" aria-label="Response letter">
            <div className="max-h-48 overflow-auto text-xs"><WritingMarkdown text={letter.markdown} /></div>
            <Button size="sm" onClick={() => download(new Blob([letter.markdown], { type: 'text/markdown;charset=utf-8' }),
              `${submissionFilename(letter.name)}${letter.unresolved.length ? '-draft' : ''}-response.md`)}>
              {letter.unresolved.length ? 'Download response draft' : 'Download response letter'}
            </Button>
          </section>}
          {!letter && message.metadata?.letter && <Button size="sm" variant="outline" disabled={mutating || streaming}
            onClick={() => void runLocalCommand('letter', message.metadata!.letter!)}>Reopen response letter</Button>}
          {runId && message.role === 'assistant' && message.metadata?.complete && !streaming && (proposal || message.metadata.evidence?.length || steps?.length) ? (
            <section aria-label="AI task record" className="space-y-2 rounded-md border border-indigo-200 bg-white p-2">
              <h3 className="text-xs font-semibold">AI task record</h3>
              {original && <a className="text-xs text-indigo-700 underline" href={`#writing-ai-message-${original.id}`}>Original proposal and compiler result</a>}
              {revisions && revisions.map((item, index) => <a key={item.id} className="block text-xs text-indigo-700 underline"
                href={`#writing-ai-message-${item.id}`}>Revised proposal {index + 1}</a>)}
              {proposal && <p className="text-xs text-slate-600">
                Proposed {proposal.edits.length} {proposal.edits.length === 1 ? 'change' : 'changes'} across {new Set(proposal.edits.map(edit => edit.path)).size} {new Set(proposal.edits.map(edit => edit.path)).size === 1 ? 'file' : 'files'}.
                {!props.checkpoints[runId] && ' Awaiting a decision.'}
              </p>}
              <TaskTimeline steps={steps} />
              {message.metadata.evidence?.length ? <EvidenceList evidence={message.metadata.evidence} project={props.working}
                moves={props.sourceMoves} revision={run?.pathRevision} onLocate={props.onLocate}
                onRefresh={path => {
                  setPrompt(previous => [previous, `Find fresh source evidence in the current project for the earlier reference to ${path}. Report reliable file and line locations.`].filter(Boolean).join('\n\n').slice(0, 12_000))
                  composer.current?.focus()
                }} /> : null}
              {proposal && run && runId && <Proposal proposal={proposal} run={run} state={props.checkpoints[runId]} project={props.working}
            disabled={props.disabled || mutating} onAction={action => mutate(runId, action)} active={props.active} sourceMoves={props.sourceMoves}
            input={input} baseline={baseline?.input === input ? baseline : undefined} verification={props.verifications[runId]}
            appliedSelection={steps?.find(step => step.kind === 'draft')?.selection}
            onVerification={(report, record) => props.onVerification(runId, report, record)} onLocate={props.onLocate}
            onUseDiagnostics={(report, reverify) => {
              const selected = report.selected.map(index => proposal.edits[index]).filter(Boolean)
              submit(report.working ? 'Help repair the current working drafts using their latest verification diagnostics.'
                : 'Repair the selected changes in the previous proposal using the temporary compile diagnostics.',
              { id: runId, report, proposal: { summary: proposal.summary, edits: selected }, reverify },
              reverify ? [...new Set(selected.map(edit => edit.path))] : undefined)
            }}
            onTaskStep={step => props.onTaskStep(runId, step)} />}
            </section>
          ) : null}
        </article>
      })}
      {streaming && <p role="status" className="text-xs text-slate-600">{status === 'submitted' ? 'Sending request…' : 'Assistant is responding…'}</p>}
      {repairBuild && <p role="status" className="text-xs text-slate-600">Verifying the repaired proposal…</p>}
      {mutating && !streaming && localOperation.current && <Button size="sm" variant="ghost"
        onClick={() => localOperation.current?.abort()}>Cancel local operation</Button>}
      {anyError && <p role="alert" className="text-xs text-red-800">{anyError}</p>}
      {!streaming && (streamError || stopped || messages.at(-1)?.role === 'assistant' && !messages.at(-1)?.metadata?.complete) && lastPrompt
        && <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => submit(chatText(lastPrompt))}>Retry request</Button>}
    </div>
    <form className="shrink-0 space-y-1 border-t bg-white p-2" onSubmit={event => { event.preventDefault(); submit(prompt) }}>
      <Textarea ref={composer} aria-label="Message Writing AI" className="min-h-8 max-h-24 resize-y px-2 py-1 text-sm" value={prompt} maxLength={12_000}
        placeholder={workflow === 'diagnostics' ? 'What is causing these compiler diagnostics?' : 'Ask or request an edit…'}
        onChange={event => setPrompt(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(prompt) }
        }} />
      <div className="flex flex-wrap items-center gap-1">
        <select aria-label="Writing workflow" className="min-w-0 rounded border bg-white p-1 text-xs" value={workflow}
          onChange={event => { if (event.target.value === 'revision') props.onRevision(); else setWorkflow(event.target.value as SourceWorkflow) }} disabled={streaming}>
          {(['auto', 'chapter', 'project', 'diagnostics'] as const).map(item => <option key={item} value={item}>{writingWorkflows[item].name}</option>)}
          <option value="revision">Reviewer reply…</option>
        </select>
        <details className="relative text-xs" title={targets.join(", ")}>
          <summary className="cursor-pointer rounded border p-1">Scope · {!scope && Array.isArray(permission)
            ? permission.length : !scope && (workflow === 'auto' || permission === 'all') ? 'Automatic' : targets.length}</summary>
          <div className="absolute bottom-full left-0 z-30 mb-1 max-h-36 w-56 max-w-[80vw] overflow-auto rounded border bg-white p-2 shadow">
            <p className="pb-1 text-slate-600">Limit proposals to these files. Automatic proposals show the actual files before approval.</p>
            {scope && <button type="button" className="underline" disabled={streaming} onClick={() => {
              setScope(undefined); revokePermission()
            }}>Reset scope</button>}
            {files.map(path => <label className="flex items-start gap-1 break-all py-1" key={path}>
              <Checkbox checked={targets.includes(path)} disabled={streaming || targets.length >= 6 && !targets.includes(path)}
                onCheckedChange={value => updateScope(path, value === true)} />{path}
            </label>)}
          </div>
        </details>
        <select aria-label="Approval mode" className="min-w-0 rounded border bg-white p-1 text-xs" value={permission === 'all' ? 'full' : permission ? 'draft' : 'manual'}
          onChange={event => {
            const value = event.target.value
            if (value === 'manual') revokePermission()
            else setConsent(value === 'full' ? 'all' : targets)
          }}>
          <option value="manual">Review first</option>
          <option value="draft" disabled={!targets.length}>Auto draft</option>
          <option value="full" disabled={!files.length}>Full draft access</option>
        </select>
        {workflow === 'diagnostics' && <Button type="button" size="sm" variant="outline" disabled={props.disabled || streaming || mutating}
          onClick={() => { const id = localMessage('Preview compile requested.'); void compilePreview({ id, role: 'assistant', parts: [], metadata: { run: id } }) }}>Compile PDF</Button>}
        {streaming ? <Button className="ml-auto" type="button" size="sm" variant="outline" onClick={() => {
          pending.current = null
          setStopped(true)
          setRunningManuscript(false)
          void stop()
        }}>Stop</Button> : <Button className="ml-auto" size="sm" type="submit" disabled={!prompt.trim() || props.disabled || mutating}>Send</Button>}
        {!manuscript && !streaming && <Button size="sm" variant="outline" type="button" disabled={!prompt.trim() || props.disabled || mutating}
          onClick={() => submit(prompt, undefined, undefined, 'plan')}>Plan writing task</Button>}
      </div>
      {permission && <div className="flex items-center justify-between gap-2 rounded border border-indigo-200 px-2 text-xs">
        <span role="status" className="min-w-0 break-words">{permission === 'all' ? 'Full draft access · This project and conversation'
          : `Automatic edits · ${permission.length} approved ${permission.length === 1 ? 'file' : 'files'}`}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          revokePermission()
          if (manuscriptRef.current?.delivery) setRunningManuscript(false)
        }}>Revoke access</Button>
      </div>}
    </form>
    <Dialog open={Boolean(undoBatches)} onOpenChange={open => { if (!open && !mutating) setUndoBatches(undefined) }}>
      <DialogContent>
        <DialogTitle>Undo {undoBatches?.length === 1 ? 'this batch' : 'task batches'}?</DialogTitle>
        <DialogDescription>Restores the files and drafts from before the selected batches, newest first. If a later edit conflicts, the entire undo stops.</DialogDescription>
        {undoError && <p role="alert" className="break-words text-sm text-red-800">{undoError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={mutating} onClick={() => setUndoBatches(undefined)}>Cancel</Button>
          <Button disabled={mutating || props.disabled} onClick={() => void undoManuscript()}>Confirm undo</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={consent !== undefined} onOpenChange={open => { if (!open) setConsent(undefined) }}>
      <DialogContent>
        <DialogTitle>{consent === 'all' ? 'Grant full draft access?' : 'Allow automatic local drafts?'}</DialogTitle>
        <DialogDescription>AI can edit {consent === 'all' ? 'all editable LaTeX drafts in this project' : 'the listed working drafts'} in this conversation.
          Saving to project files and archiving still require your confirmation. Access ends when revoked, on a scope change, when leaving Writing or changing conversations, or on reload.</DialogDescription>
        {Array.isArray(consent) && <ul className="max-h-48 list-inside list-disc overflow-auto break-all text-sm">{consent.map(path => <li key={path}>{path}</li>)}</ul>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConsent(undefined)}>Cancel</Button>
          <Button disabled={!consent || (Array.isArray(consent) && !consent.length)} onClick={() => {
            if (!consent) return
            if (consent === 'all') setScope(undefined)
            approvePermission(consent)
            setConsent(undefined)
          }}>{consent === 'all' ? 'Grant full draft access' : 'Approve this scope'}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent>
        <DialogTitle>Delete this conversation?</DialogTitle>
        <DialogDescription>The chat and its proposal controls will be removed from this browser. Previously applied changes stay in the project.</DialogDescription>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={props.onDelete}>Delete conversation</Button></div>
      </DialogContent>
    </Dialog>
  </div>
}

const taskLabels: Record<ChatTaskStep['kind'], string> = {
  verify: 'Verification requested', 'authorize-save': 'Save after verification approved',
  passed: 'Verification passed', failed: 'Verification failed', cancelled: 'Verification cancelled',
  blocked: 'Action blocked', draft: 'Applied to local drafts', saved: 'Saved to project',
  undone: 'Changes undone', rejected: 'Proposal rejected',
  'preview-compile': 'Preview compile approved', archived: 'Submission archived', 'reply-saved': 'Reviewer reply saved',
  'revision-created': 'Revision round created', 'comment-added': 'Reviewer comment added',
  'permission-granted': 'Draft access approved', 'permission-denied': 'Draft access denied',
}

function TaskTimeline({ steps }: { steps?: ChatTaskStep[] }) {
  if (!steps?.length) return null
  return <details className="rounded border px-2 py-1 text-xs">
    <summary className="cursor-pointer">Task activity · {steps.length}</summary>
    <ol className="mt-1 space-y-1">
      {steps.map((step, index) => <li key={index} className="break-words border-l pl-2">
        <span className="font-medium">{taskLabels[step.kind]}</span>
        {step.selected !== undefined && ` · ${step.selected} selected`}
        <time className="ml-1 text-slate-600" dateTime={new Date(step.at).toISOString()}>{new Date(step.at).toLocaleString()}</time>
        {step.selection && <p>Changes {step.selection.map(index => index + 1).join(', ')}</p>}
        {Boolean(step.paths?.length) && <p className="break-all font-mono">{step.paths?.join(', ')}</p>}
        {step.detail && <p>{step.detail}</p>}
      </li>)}
    </ol>
  </details>
}

function EvidenceList({ evidence, project, moves, revision, onLocate, onRefresh }: {
  evidence: NonNullable<NonNullable<WritingChatMessage['metadata']>['evidence']>
  project: ProjectFileSystem; moves?: SourceMove[]; revision?: number
  onLocate: WorkbenchProps['onLocate']; onRefresh: (path: string) => void
}) {
  const locations = useMemo(() => evidence.map(item => moves ? locateEvidence(project, item, moves, revision) : undefined),
    [evidence, project, moves, revision])
  return <details className="rounded border px-2 py-1 text-xs">
    <summary className="cursor-pointer">Source evidence · {evidence.length}</summary>
    <ul className="divide-y">
      {evidence.map((item, index) => {
        const location = locations[index]
        return <li key={`${item.kind}:${item.path}:${item.line}`} className="break-all py-1">
          {location ? <button type="button" onClick={() => onLocate(location.path, location.line)}
            className="block w-full text-left text-indigo-700 hover:underline">{location.path}:{location.line} · {item.text}</button>
            : <><p>{item.path}:{item.line} · {item.text}</p>
              <button type="button" className="text-amber-800 underline" onClick={() => onRefresh(item.path)}>
                Location unverified. Find fresh evidence
              </button></>}
        </li>
      })}
    </ul>
  </details>
}

function Proposal({ proposal, run, state, disabled, onAction, project, input, verification, baseline, active, appliedSelection, onVerification, onLocate, onUseDiagnostics, onTaskStep, sourceMoves }: {
  proposal: NonNullable<ReturnType<typeof editProposal>>; run: ChatRun; state?: ChatCheckpoint['state']
  disabled: boolean; onAction: (action: ChatAction) => Promise<void>; project: ProjectFileSystem
  input: Pick<Parameters<typeof validateChatProposal>[0], 'project' | 'working' | 'drafts' | 'main'>
  verification?: ChatVerification; baseline?: { raw: string; working: string }; active: boolean
  appliedSelection?: number[]
  sourceMoves?: SourceMove[]
  onUseDiagnostics: (report: ChatVerification, reverify?: boolean) => void
  onVerification: (report: ChatVerification, record?: boolean) => Promise<void>
  onTaskStep: (step: Omit<ChatTaskStep, 'at'>) => Promise<void>
  onLocate: (path: string, line: number) => void
}) {
  const [checked, setChecked] = useState(() => new Set(appliedSelection ?? verification?.currentSelection ?? verification?.selected ?? proposal.edits.map((_, index) => index)))
  const request = useRef<AbortController>(null)
  const current = useRef({ input, active })
  const [checking, setChecking] = useState(false)
  const [validationError, setValidationError] = useState('')
  useEffect(() => {
    current.current = { input, active }
    if (!active) request.current?.abort()
  }, [input, active])
  useEffect(() => () => request.current?.abort(), [])

  function select(next: Set<number>) {
    request.current?.abort()
    setChecked(next)
    if (verification) {
      const currentSelection = proposal.edits.flatMap((_, index) => next.has(index) ? [index] : [])
      void onVerification({ ...verification, currentSelection }).catch(() => setValidationError('Could not save the selected changes locally.'))
    }
  }
  const [preview, setPreview] = useState('')
  const base = useMemo(() => new Map(Object.entries(run.sources).map(([path, source]) => [path, source.draft?.text ?? source.saved])), [run])
  const selected = proposal.edits.flatMap((_, index) => checked.has(index) ? [index] : [])
  const changes = selected.map(index => proposal.edits[index])
  const applied = state === 'draft' || state === 'saved'
  const fingerprint = applied ? baseline?.working : baseline?.raw
  const verified = applied ? verification?.compiledBaseline : verification?.baseline
  const stale = verification && (verification.main !== input.main
    || verification.selected.join(',') !== selected.join(',') || (fingerprint !== undefined && verified !== fingerprint))
  const pendingBaseline = verification && !stale && baseline === undefined
  const reuseVerification = !applied && verification?.status === 'passed' && !verification.working && !stale && !pendingBaseline
  const dependencyFailure = verification?.status === 'failed' && !verification.diagnostics.some(issue => issue.severity === 'error')
    && /could not load a font|physical.*font for PDF output|missing bundle|Tectonic executable not found|enable Tectonic|timed out|Another compile is in progress/i.test(
      verification.message + '\n' + verification.log)

  async function verify(save: boolean) {
    if (request.current || !input.main || !changes.length || (save && applied)) return
    const controller = new AbortController()
    request.current = controller
    const { signal } = controller
    setValidationError('')
    setChecking(true)
    let recorded = false
    try {
      await onTaskStep({ kind: save ? 'authorize-save' : 'verify', selected: selected.length, selection: selected,
        paths: [...new Set(changes.map(edit => edit.path))] })
      const reusable = save && reuseVerification
      const report = reusable ? verification : await validateChatProposal({ ...input, run, edits: changes, selected, signal, verifyWorking: applied })
      if (signal.aborted) return
      if (!reusable) await onVerification(report, true)
      recorded = true
      if (save && report.status === 'passed' && !signal.aborted && current.current.active) {
        const latest = current.current.input
        if (latest.main !== report.main || await verificationBaseline(latest.project, latest.drafts) !== report.baseline) {
          throw new Error('The verification is out of date. Verify the selected changes again.')
        }
        if (current.current.input !== latest) throw new Error('The source changed during verification. Verify the selected changes again.')
        if (!signal.aborted && current.current.active) {
          await onAction({ kind: 'apply-save', run, edits: changes, signal, selection: selected })
        }
      }
    } catch (cause) {
      if (!signal.aborted) {
        const detail = cause instanceof Error ? cause.message : 'Could not verify the selected changes.'
        setValidationError(detail)
        await onTaskStep({ kind: 'blocked', detail }).catch(() => {})
      }
    } finally {
      if (!recorded && signal.aborted) await onTaskStep({ kind: 'cancelled' }).catch(() => {})
      request.current = null
      setChecking(false)
    }
  }
  let after = new Map<string, string>()
  let valid = true
  try { after = applyProjectEdits(base, changes) } catch { valid = false }
  const paths = [...new Set(proposal.edits.map(edit => edit.path))]
  const previewText = after.get(preview)
  const bibliography = useMemo(() => collectBibliography(project), [project])
  const unknown = new Set([...after].flatMap(([path, text]) => findNewUnknownCitations(path, base.get(path) ?? '', text, bibliography)
    .map(issue => issue.key)))
  const claims = (proposal.claims ?? []).filter(claim => changes.some(edit => edit.path === claim.path
    && edit.after.includes(claim.quote) && !edit.before.includes(claim.quote))).map(claim => ({ claim, revision: run.pathRevision ?? 0 }))
  return <section aria-label="Source change proposal" className="space-y-2 rounded-md border border-indigo-200 p-2">
    <p className="font-medium">Proposed source changes</p>
    <p className="break-words text-xs">{proposal.summary}</p>
    <ClaimEvidence claims={claims} project={project} moves={sourceMoves ?? []} onLocate={onLocate} />
    {state ? <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="text-xs">{state === 'draft' ? 'Applied to local drafts' : state === 'saved' ? 'Saved to project' : state === 'undone' ? 'Undone' : 'Rejected'}</span>
      {state === 'draft' && <p className="w-full text-xs text-slate-600">These working drafts are kept in this browser. Project save and PDF verification are separate actions.</p>}
      {applied && [...after.keys()].map(path => <Button key={path} size="sm" variant="ghost" className="h-auto max-w-full whitespace-normal break-all"
        onClick={() => setPreview(path)}>Review AI diff · {path}</Button>)}
      {applied && <Button size="sm" variant="outline" disabled={disabled || checking || !input.main}
        onClick={() => void verify(false)}>Verify working drafts</Button>}
      {state === 'draft' && <Button size="sm" variant="outline" disabled={disabled || checking} onClick={() => onAction({ kind: 'save' })}>
        {verification?.status === 'passed' && !stale && !pendingBaseline ? 'Save to project' : 'Save to project without verification'}
      </Button>}
      {(state === 'draft' || state === 'saved') && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction({ kind: 'undo' })}>Undo AI changes</Button>}
    </div> : <>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => select(new Set(proposal.edits.map((_, index) => index)))}>Select all</Button>
        <Button size="sm" variant="ghost" onClick={() => select(new Set())}>Clear selection</Button>
      </div>
      {paths.map(path => <div key={path} className="rounded border px-2 py-1">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="min-w-0 break-all font-mono text-xs">{path}</span>
          <Button size="sm" variant="ghost" disabled={!after.has(path)} onClick={() => setPreview(path)}>View diff</Button>
        </div>
        {proposal.edits.map((edit, index) => edit.path === path && <label className="flex items-start gap-2 py-1 text-xs" key={index}>
          <Checkbox checked={checked.has(index)} onCheckedChange={value => {
            const next = new Set(checked)
            if (value === true) next.add(index)
            else next.delete(index)
            select(next)
          }} /><span className="min-w-0 truncate">{index + 1}. {edit.before.trim().slice(0, 100)}</span>
        </label>)}
      </div>)}
      {unknown.size > 0 && <p role="status" className="break-words text-xs text-amber-800">New unknown citations: {[...unknown].join(', ')}</p>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={disabled || checking || !valid || !checked.size}
          onClick={() => void onAction({ kind: 'apply', run, edits: changes, selection: selected })}>Apply to drafts</Button>
        <Button size="sm" variant="outline" disabled={disabled || checking || !valid || !checked.size || !input.main}
          onClick={() => void verify(false)}>Verify selected changes</Button>
        <Button size="sm" variant="outline" disabled={disabled || checking || !valid || !checked.size || !input.main}
          onClick={() => void verify(true)}>{reuseVerification ? 'Save verified changes' : 'Save if verification passes'}</Button>
        <Button size="sm" variant="ghost" disabled={disabled || checking} onClick={() => void onAction({ kind: 'reject' })}>Reject proposal</Button>
      </div>
    </>}
    {checking && <div className="flex flex-wrap items-center gap-1">
      <p className="text-xs" role="status">{reuseVerification ? 'Checking verified changes…' : applied ? 'Compiling working drafts…' : 'Compiling the temporary snapshot…'}</p>
      <Button size="sm" variant="ghost" onClick={() => request.current?.abort()}>Cancel verification</Button>
    </div>}
    {validationError && <p className="text-xs text-red-800" role="alert">{validationError}</p>}
    {verification && <section aria-label="Patch verification" className="space-y-1 rounded border p-2 text-xs">
      <p className={stale || pendingBaseline ? 'text-amber-800' : verification.status === 'failed' ? 'text-red-800' : 'text-emerald-800'} role="status">
        {stale ? 'Verification is out of date.' : pendingBaseline ? 'Checking verification freshness…'
          : verification.status === 'passed' ? 'Verification passed.' : 'Verification failed.'} {!stale && !pendingBaseline && verification.message}
      </p>
      <p className="break-all">{verification.working ? 'Working snapshot' : 'Temporary snapshot'} · {verification.main} · {verification.selected.length} selected {verification.selected.length === 1 ? 'change' : 'changes'}</p>
      {verification.diagnostics.map((issue, index) => <div key={index} className="break-words py-1">
        <p>{issue.severity === 'error' ? 'Error' : 'Warning'} · {issue.message}</p>
        {issue.sourceLine && !stale && !pendingBaseline
          ? <button type="button" onClick={() => onLocate(issue.path, applied ? issue.line : issue.sourceLine!)}
            className="break-all text-left text-indigo-700 underline" title="Open the corresponding line in the current source">
            {issue.path}:{issue.line}
          </button> : <p className="break-all text-slate-600">{issue.path}:{issue.line}</p>}
      </div>)}
      {verification.status === 'failed' && !stale && !pendingBaseline && (dependencyFailure
        ? <p className="text-amber-800">Resolve the compiler or resource issue and verify the same sources again.</p>
        : <div className="flex flex-wrap gap-1">
          <Button size="sm" disabled={disabled || checking} onClick={() => onUseDiagnostics(verification, true)}>Repair and reverify</Button>
          <Button size="sm" variant="ghost" disabled={disabled || checking} onClick={() => onUseDiagnostics(verification)}>Use diagnostics in chat</Button>
        </div>)}
      {verification.log && <details><summary>Compiler log</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{verification.log}</pre></details>}
    </section>}
    <Dialog open={Boolean(previewText !== undefined)} onOpenChange={open => { if (!open) setPreview('') }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-none sm:max-w-4xl">
        <DialogTitle className="break-all">{preview}</DialogTitle>
        <DialogDescription>Compare the source at request time with the selected changes.</DialogDescription>
        {previewText !== undefined && <div className="h-[min(58dvh,34rem)] min-w-0">
          <Diff path={preview} original={base.get(preview) ?? ''} modified={previewText} originalLabel="Source at request time" modifiedLabel="Selected AI changes" />
        </div>}
      </DialogContent>
    </Dialog>
  </section>
}
