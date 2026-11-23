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
import { readChatCheckpoints, readChatHistory, readChatVerifications, writeChatHistory, writeChatVerification } from '@/lib/project/storage'
import { chatEditSchema, writingWorkflows, type ChatCheckpoint, type ChatConversation, type ChatHistory, type ChatRun, type ChatWorkflow, type WritingChatMessage } from '@/lib/project/writing-chat'
import type { ChatAction } from '@/lib/project/writing-chat-actions'
import { validateChatProposal, verificationBaseline, type ChatVerification } from '@/lib/project/writing-chat-validation'
import { editableSource, type WritingDrafts, type WritingKey } from '@/lib/project/writing-drafts'
import type { ProjectFileSystem } from '@/lib/project/types'
import { collectBibliography, findNewUnknownCitations } from '@/lib/project/references'

const Diff = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })
type Approval = 'manual' | 'draft'
type SourceWorkflow = Exclude<ChatWorkflow, 'revision'>
type Checkpoints = Record<string, ChatCheckpoint['state']>
type WorkbenchProps = {
  storage: IDBDatabase; projectKey: WritingKey; project: ProjectFileSystem; working: ProjectFileSystem
  drafts: WritingDrafts; selected: string; main?: string; active: boolean; disabled: boolean
  compiler: ChapterEditRequest['compiler']; onLocate: (path: string, line: number) => void
  selection: () => { path: string; start: number; end: number } | undefined
  onAction: (run: string, action: ChatAction) => Promise<ChatCheckpoint['state']>
  onCompile: () => void
  onRevision: () => void
}

const toolLabels: Record<string, string> = {
  search_source: 'Search source', read_source: 'Read source', query_references: 'Check references',
  compile_diagnostics: 'Read diagnostics', propose_edits: 'Validate edits', request_preview_compile: 'Request preview compile',
  read_archived_changes: 'Read archived ZIP changes', propose_reply: 'Stage reply',
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
    ...body, messages: messages.filter(message => message.role !== 'system')
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

export function WritingAiWorkbench(props: WorkbenchProps) {
  const { storage, projectKey, onAction } = props
  const workspace = projectKey[0], projectId = projectKey[1]
  const [history, setHistory] = useState<ChatHistory>()
  const [checkpoints, setCheckpoints] = useState<Checkpoints>({})
  const [verifications, setVerifications] = useState<Record<string, ChatVerification>>({})
  const [storageError, setStorageError] = useState('')
  const historyRef = useRef<ChatHistory | undefined>(undefined)
  const persistence = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    Promise.all([readChatHistory(storage, [workspace, projectId]), readChatCheckpoints(storage, [workspace, projectId]), readChatVerifications(storage, [workspace, projectId])]).then(([saved, states, reports]) => {
      if (!active) return
      const initial = newConversation()
      historyRef.current = saved ?? { selected: initial.id, conversations: [initial] }
      setHistory(historyRef.current)
      setCheckpoints(states)
      setVerifications(reports)
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

  const conversation = history?.conversations.find(item => item.id === history.selected)
  if (!conversation) return <p className="p-3 text-sm" role="status">{storageError || 'Loading local conversations…'}</p>
  return <Conversation key={conversation.id} {...props} conversation={conversation} checkpoints={checkpoints} storageError={storageError}
    verifications={verifications} onVerification={async (id, report) => {
      await writeChatVerification(storage, [workspace, projectId], id, report)
      setVerifications(current => ({ ...current, [id]: report }))
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
      const ids = new Set(retained.flatMap(message => message.metadata?.run ? [message.metadata.run] : []))
      return { ...item, title: chatText(messages.find(message => message.role === 'user') ?? { role: 'user', id: '', parts: [] }).slice(0, 52) || item.title,
        messages: retained, runs: Object.fromEntries(Object.entries(runs).filter(([id]) => ids.has(id))) }
    }) }))}
    onAction={async (run, action) => {
      const state = await onAction(run, action)
      setCheckpoints(current => ({ ...current, [run]: state }))
      return state
    }} />
}

function Conversation(props: WorkbenchProps & {
  conversation: ChatConversation; conversations: ChatConversation[]; storageError: string; checkpoints: Checkpoints
  verifications: Record<string, ChatVerification>; onVerification: (id: string, report: ChatVerification) => Promise<void>
  onSelect: (id: string) => void; onNew: () => void; onDelete: () => void
  onPersist: (messages: WritingChatMessage[], runs: Record<string, ChatRun>) => void
}) {
  const [workflow, setWorkflow] = useState<SourceWorkflow>('chapter')
  const [approval, setApproval] = useState<Approval>('manual')
  const [consent, setConsent] = useState<Approval | null>(null)
  const [scope, setScope] = useState<string[]>()
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [stopped, setStopped] = useState(false)
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
        void mutate(task.id, { kind: 'apply', run, edits: proposal.edits })
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

  function submit(value: string) {
    const text = value.trim()
    if (!text || streaming || props.disabled || mutating) return
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
    const sources = Object.fromEntries(targets.flatMap(path => {
      const saved = editableSource(props.project, path)
      return saved === undefined ? [] : [[path, { saved, draft: props.drafts[path] }] as const]
    }))
    runs.current = { ...runs.current, [id]: { main: props.project.metadata.mainFile, sources } }
    setRunSnapshots(runs.current)
    const authorized = grant.current && targets.length && targets.every(path => grant.current?.paths.includes(path))
    pending.current = { id, grant: grant.current?.id, mode: authorized ? approval : 'manual' }
    const source: ChapterEditRequest = { mode: 'rewrite', path: primary, main: props.main, source: file.content,
      instruction: '', compiler: props.compiler, context: buildChapterContext(props.working, primary, props.main, targets) }
    setPrompt('')
    atBottom.current = true
    const selection = props.selection()
    void sendMessage({ text, metadata: { run: id, selection } }, { body: { run: id, workflow, scope: targets, source, selection } })
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
      {!messages.length && <p className="text-slate-600">Ask about this chapter, compare sections, or investigate compiler problems.</p>}
      {messages.map(message => {
        const proposal = editProposal(message)
        const runId = message.metadata?.run
        const run = runId ? runSnapshots[runId] : undefined
        const compileRequest = message.metadata?.complete && message.parts.find(part => part.type === 'tool-request_preview_compile'
          && 'output' in part && part.output && typeof part.output === 'object' && 'requested' in part.output)
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
          {message.metadata?.evidence?.length ? <details className="rounded border px-2 py-1">
            <summary>Source evidence · {message.metadata.evidence.length}</summary>
            {message.metadata.evidence.map(item => <button key={`${item.kind}:${item.path}:${item.line}`} type="button"
              onClick={() => props.onLocate(item.path, item.line)} className="block w-full break-all py-1 text-left text-xs text-indigo-700 hover:underline">
              {item.path}:{item.line} · {item.text}
            </button>)}
          </details> : null}
          {compileRequest && !streaming && <Button size="sm" variant="outline" disabled={props.disabled || !props.main}
            onClick={props.onCompile}>Approve preview compile</Button>}
          {proposal && run && runId && !streaming && <Proposal proposal={proposal} run={run} state={props.checkpoints[runId]} project={props.working}
            disabled={props.disabled || mutating} onAction={action => mutate(runId, action)} active={props.active}
            input={input} baseline={baseline?.input === input ? baseline : undefined} verification={props.verifications[runId]}
            onVerification={report => props.onVerification(runId, report)} onLocate={props.onLocate}
            onUseDiagnostics={report => {
              const locations = report.diagnostics.slice(0, 12).map(issue => `${issue.path}:${issue.line} · ${issue.message.slice(0, 240)}`)
              const notes = ['Help fix this proposal using the following diagnostics from its temporary LaTeX snapshot.',
                report.message, ...locations].join('\n')
              setPrompt(previous => [previous, notes].filter(Boolean).join('\n\n').slice(0, 12_000))
              composer.current?.focus()
            }} />}
        </article>
      })}
      {streaming && <p role="status" className="text-xs text-slate-600">{status === 'submitted' ? 'Sending request…' : 'Assistant is responding…'}</p>}
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
          {(['chapter', 'project', 'diagnostics'] as const).map(item => <option key={item} value={item}>{writingWorkflows[item].name}</option>)}
          <option value="revision">Reviewer reply…</option>
        </select>
        <details className="relative text-xs" title={targets.join(", ")}>
          <summary className="cursor-pointer rounded border p-1">Scope · {targets.length}</summary>
          <div className="absolute bottom-full left-0 z-30 mb-1 max-h-36 w-56 max-w-[80vw] overflow-auto rounded border bg-white p-2 shadow">
            <p className="pb-1 text-slate-600">Files AI may propose editing</p>
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
        {workflow === 'diagnostics' && <Button type="button" size="sm" variant="outline" disabled={props.disabled || streaming} onClick={props.onCompile}>Compile PDF</Button>}
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

function Proposal({ proposal, run, state, disabled, onAction, project, input, verification, baseline, active, onVerification, onLocate, onUseDiagnostics }: {
  proposal: NonNullable<ReturnType<typeof editProposal>>; run: ChatRun; state?: ChatCheckpoint['state']
  disabled: boolean; onAction: (action: ChatAction) => Promise<void>; project: ProjectFileSystem
  input: Pick<Parameters<typeof validateChatProposal>[0], 'project' | 'working' | 'drafts' | 'main'>
  verification?: ChatVerification; baseline?: { raw: string; working: string }; active: boolean
  onUseDiagnostics: (report: ChatVerification) => void
  onVerification: (report: ChatVerification) => Promise<void>
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
    try {
      const report = await validateChatProposal({ ...input, run, edits: changes, selected, signal })
      if (signal.aborted) return
      await onVerification(report)
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
      if (!signal.aborted) setValidationError(cause instanceof Error ? cause.message : 'Could not verify the selected changes.')
    } finally {
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
          }} /><span className="min-w-0 truncate">{edit.before.trim().slice(0, 100)}</span>
        </label>)}
      </div>)}
      {unknown.size > 0 && <p role="status" className="break-words text-xs text-amber-800">New unknown citations: {[...unknown].join(', ')}</p>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={disabled || checking || !valid || !checked.size || !input.main}
          onClick={() => void verify(false)}>Verify selected changes</Button>
        <Button size="sm" disabled={disabled || checking || !valid || !checked.size || !input.main}
          onClick={() => void verify(true)}>Save if verification passes</Button>
        <Button size="sm" variant="outline" disabled={disabled || checking || !valid || !checked.size}
          onClick={() => void onAction({ kind: 'apply', run, edits: changes })}>Apply to drafts</Button>
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
