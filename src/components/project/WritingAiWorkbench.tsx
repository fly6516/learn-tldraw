'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { applyProjectEdits, buildChapterContext, maxChapterLength, type ChapterEditRequest } from '@/lib/project/ai-edit'
import { confirmChatReply, listRevisionRounds, readChatCheckpoints, readChatHistory, readChatTaskSteps, readChatVerifications, recordChatTaskStep, writeChatHistory, writeChatVerification } from '@/lib/project/storage'
import { chatEditSchema, replyChatSchema, submissionChatSchema, writingWorkflows, type ChatCheckpoint, type ChatCompileFeedback, type ChatConversation, type ChatHistory, type ChatRevisionSetup, type ChatRun, type ChatTaskStep, type ChatWorkflow, type ReplyChatRequest, type SubmissionChatRequest, type WritingChatMessage } from '@/lib/project/writing-chat'
import type { ChatAction } from '@/lib/project/writing-chat-actions'
import { validateChatProposal, verificationBaseline, type ChatVerification } from '@/lib/project/writing-chat-validation'
import { editableSource, type WritingDrafts, type WritingKey } from '@/lib/project/writing-drafts'
import type { ProjectFileSystem } from '@/lib/project/types'
import { locateEvidence, type SourceMove } from '@/lib/project/writing-ai-evidence'
import { collectBibliography, findNewUnknownCitations } from '@/lib/project/references'
import { confirmChatRevisionSetup, prepareChatLetter, prepareChatReply, prepareChatRevisionSetup } from '@/lib/project/chat-revision'
import { revisionDraftSchema } from '@/lib/project/ai-revision'
import type { SubmissionBuild, SubmissionSelection } from '@/lib/project/submission'
import { ChatSubmissionCard } from './ChatSubmissionCard'
import { download, submissionFilename } from './SubmissionDialog'

const Diff = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })
type Approval = 'manual' | 'draft'
type SourceWorkflow = Exclude<ChatWorkflow, 'revision'>
type Checkpoints = Record<string, ChatCheckpoint['state']>
type WorkbenchProps = {
  storage: IDBDatabase; projectKey: WritingKey; project: ProjectFileSystem; working: ProjectFileSystem; saved: ProjectFileSystem
  drafts: WritingDrafts; sourceMoves?: SourceMove[]; selected: string; main?: string; active: boolean; disabled: boolean
  compiler: ChapterEditRequest['compiler']; onLocate: (path: string, line: number) => void
  selection: () => { path: string; start: number; end: number } | undefined
  onAction: (run: string, action: ChatAction) => Promise<ChatCheckpoint['state']>
  onCompile: (signal: AbortSignal) => Promise<{ feedback: ChatCompileFeedback } | undefined>
  onBuildSubmission: (selection: SubmissionSelection, signal: AbortSignal) => Promise<{ feedback: ChatCompileFeedback; submission?: SubmissionBuild } | undefined>
  onExternalSubmission: (include: boolean, excluded: string[]) => void
  onLayout: (placement: 'docked' | 'floating' | undefined) => void
  onRevision: () => void
}

const toolLabels: Record<string, string> = {
  search_source: 'Search source', read_source: 'Read source', query_references: 'Check references',
  compile_diagnostics: 'Read diagnostics', propose_edits: 'Validate edits', request_preview_compile: 'Request preview compile',
  read_archived_changes: 'Read archived ZIP changes', propose_reply: 'Stage reply',
  prepare_submission: 'Prepare submission checklist', request_reviewer_reply: 'Find archived reply evidence',
}

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
      .map(message => ({ role: message.role, text: chatText(message).slice(0, 12_000) }))
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

export function WritingAiWorkbench(props: WorkbenchProps) {
  const { storage, projectKey, onAction } = props
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
    tasks={tasks} onRefreshTasks={refreshTasks} onTaskStep={async (id, step) => {
      await recordChatTaskStep(storage, [workspace, projectId], id, { ...step, at: Date.now() })
      await refreshTasks()
    }}
    verifications={verifications} onVerification={async (id, report, record) => {
      await writeChatVerification(storage, [workspace, projectId], id, report, record)
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
      const retained = messages.slice(-30)
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
  verifications: Record<string, ChatVerification>; onVerification: (id: string, report: ChatVerification, record?: boolean) => Promise<void>
  tasks: Record<string, ChatTaskStep[]>; onTaskStep: (id: string, step: Omit<ChatTaskStep, 'at'>) => Promise<void>
  onRefreshTasks: () => Promise<void>
  onSelect: (id: string) => void; onNew: () => void; onDelete: () => void
  onPersist: (messages: WritingChatMessage[], runs: Record<string, ChatRun>) => void
}) {
  const [workflow, setWorkflow] = useState<SourceWorkflow>('auto')
  const [approval, setApproval] = useState<Approval>('manual')
  const [consent, setConsent] = useState<Approval | null>(null)
  const [scope, setScope] = useState<string[]>()
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [stopped, setStopped] = useState(false)
  const localOperation = useRef<AbortController>(null)
  const replyInProgress = useRef(false)
  const [letters, setLetters] = useState<Record<string, Awaited<ReturnType<typeof prepareChatLetter>>>>({})
  const files = [...props.project.files.keys()].filter(path => /\.tex$/i.test(path)
    && (editableSource(props.working, path)?.length ?? Infinity) <= maxChapterLength)
  const targets = scope ? scope.filter(path => files.includes(path)) : files.includes(props.selected) ? [props.selected] : []
  const grant = useRef<{ id: string; mode: Approval; paths: string[] } | null>(null)
  const [granted, setGranted] = useState(false)
  const [wasActive, setWasActive] = useState(props.active)
  if (wasActive !== props.active) {
    setWasActive(props.active)
    if (!props.active) setGranted(false)
  }
  const pending = useRef<{ id: string; mode: Approval; grant?: string } | null>(null)
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
        return
      }
      latest.current.onPersist(messages, runs.current)
      const task = pending.current
      pending.current = null
      if (!task || message.metadata?.run !== task.id || task.mode === 'manual'
        || grant.current?.id !== task.grant || grant.current?.mode !== task.mode || !latest.current.active) return
      const proposal = editProposal(message)
      const run = runs.current[task.id]
      const evidence = message.metadata.evidence ?? []
      if (proposal && run && !message.metadata.missing?.length && proposal.edits.every(edit => grant.current?.paths.includes(edit.path)
        && evidence.some(item => item.path === edit.path && item.kind === 'read_source'))) {
        void mutate(task.id, { kind: 'apply', run, edits: proposal.edits, automatic: true })
      }
    },
  })
  const streaming = status === 'submitted' || status === 'streaming'
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
    if (!props.active) grant.current = null
    return () => {
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
    try { await latest.current.onAction(id, action) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change the source.') }
    finally { setMutating(false) }
  }

  function updateScope(path: string, checked: boolean) {
    grant.current = null
    setGranted(false)
    setApproval('manual')
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
      default: setError('Available commands: /layout, /submission, /newround, /comment, /revisions, /reply, /letter.')
    }
  }

  function submit(value: string, repair?: { report: ChatVerification; proposal: NonNullable<ReturnType<typeof editProposal>> }) {
    const text = value.trim()
    if (!text || streaming || props.disabled || mutating) return
    setError('')
    atBottom.current = true
    const command = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text)
    const layout = /^(?:把\s*AI\s*面板切到|AI\s*面板切到)\s*(同层|浮层|上层)[。！]?$/i.exec(text)
    if (command) {
      void runLocalCommand(command[1].toLowerCase(), command[2]?.trim() ?? '')
      return
    }
    if (layout) {
      void runLocalCommand('layout', layout[1] === '同层' ? 'docked' : 'floating')
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
    const context = buildChapterContext(props.working, primary, props.main, [
      ...targets, ...files.filter(path => text.includes(path) || text.includes(path.split('/').at(-1)!)),
    ])
    const completeFiles = new Set([primary, ...context.filter(entry => !entry.truncated).map(entry => entry.path)])
    const automaticScope = workflow === 'auto' && !scope && !grant.current
    const editPaths = (automaticScope ? files : targets).filter(path => completeFiles.has(path))
    const sources = Object.fromEntries(editPaths.flatMap(path => {
      const saved = editableSource(props.project, path)
      return saved === undefined ? [] : [[path, { saved, draft: props.drafts[path] }] as const]
    }))
    runs.current = { ...runs.current, [id]: { main: props.project.metadata.mainFile, pathRevision: props.sourceMoves?.length, sources } }
    setRunSnapshots(runs.current)
    const authorized = grant.current && targets.length && targets.every(path => grant.current?.paths.includes(path))
    pending.current = { id, grant: grant.current?.id, mode: authorized ? approval : 'manual' }
    const source: ChapterEditRequest = { mode: 'rewrite', path: primary, main: props.main, source: file.content,
      instruction: '', compiler: props.compiler, context }
    setPrompt('')
    const selection = repair ? undefined : props.selection()
    const resultMessage = [...messages].reverse().find(message => message.role === 'assistant' && message.metadata
      && (message.metadata.feedback || props.verifications[message.metadata.run]))
    const resultId = resultMessage?.metadata?.run
    const report = repair?.report ?? (resultId ? props.verifications[resultId] : undefined)
    const previousProposal = resultMessage && editProposal(resultMessage)
    const checkpoint = !repair && resultId ? props.checkpoints[resultId] : undefined
    const receipt = checkpoint ? ` Source proposal state: ${checkpoint}.` : ' This result is from a temporary snapshot.'
    const feedback = report ? { status: report.status, message: (report.message + receipt).slice(0, 1000),
      diagnostics: report.diagnostics.slice(0, 40).map(issue => ({ ...issue, message: issue.message.slice(0, 500) })),
      log: report.log.slice(-4000) } : resultMessage?.metadata?.feedback
    const failedProposal = repair?.proposal ?? (previousProposal && report?.status === 'failed' && !checkpoint
      ? { summary: previousProposal.summary, edits: report.selected.map(index => previousProposal.edits[index]).filter(Boolean) }
      : undefined)
    void sendMessage({ text, metadata: { run: id, selection } }, {
      body: { run: id, workflow, scope: editPaths, source, selection, feedback, previousProposal: failedProposal },
    })
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
        const replyRequest = toolResult(message, 'tool-request_reviewer_reply', replyChatSchema)
        const reply = run?.reply && toolResult(message, 'tool-propose_reply', revisionDraftSchema)
        const steps = runId ? props.tasks[runId] : undefined
        const archived = steps?.find(step => step.kind === 'archived')?.detail
        const replySaved = steps?.some(step => step.kind === 'reply-saved')
        const setup = message.metadata?.revisionSetup
        const setupSaved = steps?.some(step => step.kind === 'revision-created' || step.kind === 'comment-added')
        const feedback = message.metadata?.feedback
        const letter = letters[message.id]
        return <article key={message.id} aria-label={message.role === 'user' ? 'You' : 'Assistant'}
          className={message.role === 'user' ? 'rounded-md bg-indigo-50 px-2 py-1.5' : 'space-y-2'}>
          <p className="mb-1 text-xs font-semibold">{message.role === 'user' ? 'You' : 'Assistant'}</p>
          <ChatToolProgress message={message} />
          <ChatMessageText text={chatText(message)} />
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
            <p className="whitespace-pre-wrap break-words">{reply.draft}</p>
            {run.reply.paths.length > 0 && <p className="break-all">Archived evidence · {run.reply.paths.join(', ')}</p>}
            {replySaved ? <p role="status">Reply saved.</p> : <Button size="sm" disabled={props.disabled || streaming || mutating}
              onClick={() => void saveReply(runId, run.reply!, reply.draft)}>
              {run.reply.previous ? 'Confirm replacement reply' : run.reply.previousRevisedId ? 'Confirm and save reply' : 'Confirm archive link and save reply'}
            </Button>}
          </section>}
          {letter && <section className="space-y-1 rounded border p-2" aria-label="Response letter">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{letter.markdown}</pre>
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
            disabled={props.disabled || mutating} onAction={action => mutate(runId, action)} active={props.active}
            input={input} baseline={baseline?.input === input ? baseline : undefined} verification={props.verifications[runId]}
            onVerification={(report, record) => props.onVerification(runId, report, record)} onLocate={props.onLocate}
            onUseDiagnostics={report => submit('Repair the selected changes in the previous proposal using the temporary compile diagnostics.',
              { report, proposal: { summary: proposal.summary, edits: report.selected.map(index => proposal.edits[index]).filter(Boolean) } })}
            onTaskStep={step => props.onTaskStep(runId, step)} />}
            </section>
          ) : null}
        </article>
      })}
      {streaming && <p role="status" className="text-xs text-slate-600">{status === 'submitted' ? 'Sending request…' : 'Assistant is responding…'}</p>}
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
          <summary className="cursor-pointer rounded border p-1">Scope · {workflow === 'auto' && !scope && !granted ? 'Automatic' : targets.length}</summary>
          <div className="absolute bottom-full left-0 z-30 mb-1 max-h-36 w-56 max-w-[80vw] overflow-auto rounded border bg-white p-2 shadow">
            <p className="pb-1 text-slate-600">Limit proposals to these files. Automatic proposals show the actual files before approval.</p>
            {scope && <button type="button" className="underline" disabled={streaming} onClick={() => {
              setScope(undefined); grant.current = null; setGranted(false); setApproval('manual')
            }}>Reset scope</button>}
            {files.map(path => <label className="flex items-start gap-1 break-all py-1" key={path}>
              <Checkbox checked={targets.includes(path)} disabled={streaming || targets.length >= 6 && !targets.includes(path)}
                onCheckedChange={value => updateScope(path, value === true)} />{path}
            </label>)}
          </div>
        </details>
        <select aria-label="Approval mode" className="min-w-0 rounded border bg-white p-1 text-xs" value={props.active && granted ? approval : 'manual'}
          onChange={event => {
            const value = event.target.value as Approval
            if (value === 'manual') { grant.current = null; setGranted(false); setApproval(value) }
            else setConsent(value)
          }}>
          <option value="manual">Review first</option>
          <option value="draft" disabled={!targets.length}>Auto draft</option>
        </select>
        {workflow === 'diagnostics' && <Button type="button" size="sm" variant="outline" disabled={props.disabled || streaming || mutating}
          onClick={() => { const id = localMessage('Preview compile requested.'); void compilePreview({ id, role: 'assistant', parts: [], metadata: { run: id } }) }}>Compile PDF</Button>}
        {streaming ? <Button className="ml-auto" type="button" size="sm" variant="outline" onClick={() => {
          pending.current = null
          setStopped(true)
          void stop()
        }}>Stop</Button> : <Button className="ml-auto" size="sm" type="submit" disabled={!prompt.trim() || props.disabled || mutating}>Send</Button>}
      </div>
    </form>
    <Dialog open={consent !== null} onOpenChange={open => { if (!open) setConsent(null) }}>
      <DialogContent>
        <DialogTitle>Allow automatic local drafts?</DialogTitle>
        <DialogDescription>Applies to these files in this conversation until you change scope, switch conversations, leave Writing, or reload.</DialogDescription>
        <ul className="max-h-48 list-inside list-disc overflow-auto break-all text-sm">{targets.map(path => <li key={path}>{path}</li>)}</ul>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConsent(null)}>Cancel</Button>
          <Button disabled={!consent || !targets.length} onClick={() => {
            if (!consent) return
            grant.current = { id: crypto.randomUUID(), mode: consent, paths: targets }
            setGranted(true)
            setApproval(consent)
            setConsent(null)
          }}>Approve this scope</Button>
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

function ChatMessageText({ text }: { text: string }) {
  return <div className="space-y-2 break-words [overflow-wrap:anywhere]">
    {text.split('\n\n').map((paragraph, index) => <p key={index} className="whitespace-pre-wrap">
      {paragraph.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((piece, segment) =>
        piece.startsWith('**') && piece.endsWith('**') && piece.length > 4 ? <strong key={segment}>{piece.slice(2, -2)}</strong>
          : piece.startsWith('`') && piece.endsWith('`') && piece.length > 2 ? <code key={segment} className="rounded bg-slate-100 px-0.5 text-xs">{piece.slice(1, -1)}</code>
            : piece)}
    </p>)}
  </div>
}

const taskLabels: Record<ChatTaskStep['kind'], string> = {
  verify: 'Verification requested', 'authorize-save': 'Save after verification approved',
  passed: 'Verification passed', failed: 'Verification failed', cancelled: 'Verification cancelled',
  blocked: 'Action blocked', draft: 'Applied to local drafts', saved: 'Saved to project',
  undone: 'Changes undone', rejected: 'Proposal rejected',
  'preview-compile': 'Preview compile approved', archived: 'Submission archived', 'reply-saved': 'Reviewer reply saved',
  'revision-created': 'Revision round created', 'comment-added': 'Reviewer comment added',
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

function Proposal({ proposal, run, state, disabled, onAction, project, input, verification, baseline, active, onVerification, onLocate, onUseDiagnostics, onTaskStep }: {
  proposal: NonNullable<ReturnType<typeof editProposal>>; run: ChatRun; state?: ChatCheckpoint['state']
  disabled: boolean; onAction: (action: ChatAction) => Promise<void>; project: ProjectFileSystem
  input: Pick<Parameters<typeof validateChatProposal>[0], 'project' | 'working' | 'drafts' | 'main'>
  verification?: ChatVerification; baseline?: { raw: string; working: string }; active: boolean
  onUseDiagnostics: (report: ChatVerification) => void
  onVerification: (report: ChatVerification, record?: boolean) => Promise<void>
  onTaskStep: (step: Omit<ChatTaskStep, 'at'>) => Promise<void>
  onLocate: (path: string, line: number) => void
}) {
  const [checked, setChecked] = useState(() => new Set(verification?.currentSelection ?? verification?.selected ?? proposal.edits.map((_, index) => index)))
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

  async function verify(save: boolean) {
    if (request.current || !input.main || !changes.length) return
    const controller = new AbortController()
    request.current = controller
    const { signal } = controller
    setValidationError('')
    setChecking(true)
    let recorded = false
    try {
      await onTaskStep({ kind: save ? 'authorize-save' : 'verify', selected: selected.length, selection: selected,
        paths: [...new Set(changes.map(edit => edit.path))] })
      const report = await validateChatProposal({ ...input, run, edits: changes, selected, signal })
      if (signal.aborted) return
      await onVerification(report, true)
      recorded = true
      if (save && report.status === 'passed' && !signal.aborted && current.current.active) {
        const latest = current.current.input
        if (latest.main !== report.main || await verificationBaseline(latest.project, latest.drafts) !== report.baseline) {
          throw new Error('The verification is out of date. Verify the selected changes again.')
        }
        if (current.current.input !== latest) throw new Error('The source changed during verification. Verify the selected changes again.')
        if (!signal.aborted && current.current.active) {
          await onAction({ kind: 'apply-save', run, edits: changes, signal })
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
  const unknown = new Set([...after].flatMap(([path, text]) => findNewUnknownCitations(path, base.get(path) ?? '', text, bibliography)))
  return <section aria-label="Source change proposal" className="space-y-2 rounded-md border border-indigo-200 p-2">
    <p className="font-medium">Proposed source changes</p>
    <p className="break-words text-xs">{proposal.summary}</p>
    {state ? <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="text-xs">{state === 'draft' ? 'Applied to local drafts' : state === 'saved' ? 'Saved to project' : state === 'undone' ? 'Undone' : 'Rejected'}</span>
      {state === 'draft' && <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAction({ kind: 'save' })}>Save to project</Button>}
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
        <Button size="sm" variant="outline" disabled={disabled || checking || !valid || !checked.size || !input.main}
          onClick={() => void verify(false)}>Verify selected changes</Button>
        <Button size="sm" disabled={disabled || checking || !valid || !checked.size || !input.main}
          onClick={() => void verify(true)}>Save if verification passes</Button>
        <Button size="sm" variant="outline" disabled={disabled || checking || !valid || !checked.size}
          onClick={() => void onAction({ kind: 'apply', run, edits: changes, selection: selected })}>Apply to drafts</Button>
        <Button size="sm" variant="ghost" disabled={disabled || checking} onClick={() => void onAction({ kind: 'reject' })}>Reject proposal</Button>
      </div>
    </>}
    {checking && <div className="flex flex-wrap items-center gap-1">
      <p className="text-xs" role="status">Compiling the temporary snapshot…</p>
      <Button size="sm" variant="ghost" onClick={() => request.current?.abort()}>Cancel verification</Button>
    </div>}
    {validationError && <p className="text-xs text-red-800" role="alert">{validationError}</p>}
    {verification && <section aria-label="Patch verification" className="space-y-1 rounded border p-2 text-xs">
      <p className={stale || pendingBaseline ? 'text-amber-800' : verification.status === 'failed' ? 'text-red-800' : 'text-emerald-800'} role="status">
        {stale ? 'Verification is out of date.' : pendingBaseline ? 'Checking verification freshness…'
          : verification.status === 'passed' ? 'Verification passed.' : 'Verification failed.'} {!stale && !pendingBaseline && verification.message}
      </p>
      <p className="break-all">Temporary snapshot · {verification.main} · {verification.selected.length} selected {verification.selected.length === 1 ? 'change' : 'changes'}</p>
      {verification.diagnostics.map((issue, index) => <div key={index} className="break-words py-1">
        <p>{issue.severity === 'error' ? 'Error' : 'Warning'} · {issue.message}</p>
        {issue.sourceLine && !stale && !pendingBaseline
          ? <button type="button" onClick={() => onLocate(issue.path, applied ? issue.line : issue.sourceLine!)}
            className="break-all text-left text-indigo-700 underline" title="Open the corresponding line in the current source">
            {issue.path}:{issue.line}
          </button> : <p className="break-all text-slate-600">{issue.path}:{issue.line}</p>}
      </div>)}
      {verification.status === 'failed' && !stale && !pendingBaseline && <Button size="sm" variant="ghost"
        onClick={() => onUseDiagnostics(verification)}>Use diagnostics in chat</Button>}
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
