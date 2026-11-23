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
import { readChatCheckpoints, readChatHistory, writeChatHistory } from '@/lib/project/storage'
import { chatEditSchema, writingWorkflows, type ChatCheckpoint, type ChatConversation, type ChatHistory, type ChatRun, type ChatWorkflow, type WritingChatMessage } from '@/lib/project/writing-chat'
import type { ChatAction } from '@/lib/project/writing-chat-actions'
import { editableSource, type WritingDrafts, type WritingKey } from '@/lib/project/writing-drafts'
import type { ProjectFileSystem } from '@/lib/project/types'
import { collectBibliography, findNewUnknownCitations } from '@/lib/project/references'

const Diff = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })
type Approval = 'manual' | 'draft' | 'save'
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
  const [storageError, setStorageError] = useState('')
  const historyRef = useRef<ChatHistory | undefined>(undefined)
  const persistence = useRef(Promise.resolve())

  useEffect(() => {
    let active = true
    Promise.all([readChatHistory(storage, [workspace, projectId]), readChatCheckpoints(storage, [workspace, projectId])]).then(([saved, states]) => {
      if (!active) return
      const initial = newConversation()
      historyRef.current = saved ?? { selected: initial.id, conversations: [initial] }
      setHistory(historyRef.current)
      setCheckpoints(states)
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
        void mutate(task.id, { kind: task.mode === 'save' ? 'apply-save' : 'apply', run, edits: proposal.edits })
      }
    },
  })
  const streaming = status === 'submitted' || status === 'streaming'
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
    // An explicit positive instruction is required in addition to the session grant.
    const requestsSave = /^(?:apply and save|apply & save|应用并保存)(?:[\s:：，,。]|$)/i.test(text)
    pending.current = { id, grant: grant.current?.id, mode: !authorized || approval === 'save' && !requestsSave ? 'manual' : approval }
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
            disabled={props.disabled || mutating} onAction={action => void mutate(runId, action)} />}
        </article>
      })}
      {streaming && <p role="status" className="text-xs text-slate-600">{status === 'submitted' ? 'Sending request…' : 'Assistant is responding…'}</p>}
      {anyError && <p role="alert" className="text-xs text-red-800">{anyError}</p>}
      {!streaming && (streamError || stopped || messages.at(-1)?.role === 'assistant' && !messages.at(-1)?.metadata?.complete) && lastPrompt
        && <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => submit(chatText(lastPrompt))}>Retry request</Button>}
    </div>
    <form className="shrink-0 space-y-1 border-t bg-white p-2" onSubmit={event => { event.preventDefault(); submit(prompt) }}>
      <Textarea aria-label="Message Writing AI" className="min-h-8 max-h-24 resize-y px-2 py-1 text-sm" value={prompt} maxLength={12_000}
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
          <option value="save" disabled={!targets.length}>Auto draft and save</option>
        </select>
        {workflow === 'diagnostics' && <Button type="button" size="sm" variant="outline" disabled={props.disabled || streaming} onClick={props.onCompile}>Compile PDF</Button>}
        {streaming ? <Button className="ml-auto" type="button" size="sm" variant="outline" onClick={() => {
          pending.current = null
          setStopped(true)
          void stop()
        }}>Stop</Button> : <Button className="ml-auto" size="sm" type="submit" disabled={!prompt.trim() || props.disabled || mutating}>Send</Button>}
      </div>
      {approval === 'save' && granted && props.active && <p className="text-xs text-slate-600">Start a request with “Apply and save” to authorize saving that turn.</p>}
    </form>
    <Dialog open={consent !== null} onOpenChange={open => { if (!open) setConsent(null) }}>
      <DialogContent>
        <DialogTitle>{consent === 'save' ? 'Allow automatic draft and save?' : 'Allow automatic local drafts?'}</DialogTitle>
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

function Proposal({ proposal, run, state, disabled, onAction, project }: {
  proposal: NonNullable<ReturnType<typeof editProposal>>; run: ChatRun; state?: ChatCheckpoint['state']
  disabled: boolean; onAction: (action: ChatAction) => void; project: ProjectFileSystem
}) {
  const [checked, setChecked] = useState(() => new Set(proposal.edits.map((_, index) => index)))
  const [preview, setPreview] = useState('')
  const base = useMemo(() => new Map(Object.entries(run.sources).map(([path, source]) => [path, source.draft?.text ?? source.saved])), [run])
  const changes = proposal.edits.filter((_, index) => checked.has(index))
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
        <Button size="sm" variant="ghost" onClick={() => setChecked(new Set(proposal.edits.map((_, index) => index)))}>Select all</Button>
        <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Clear selection</Button>
      </div>
      {paths.map(path => <div key={path} className="rounded border px-2 py-1">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="min-w-0 break-all font-mono text-xs">{path}</span>
          <Button size="sm" variant="ghost" disabled={!after.has(path)} onClick={() => setPreview(path)}>View diff</Button>
        </div>
        {proposal.edits.map((edit, index) => edit.path === path && <label className="flex items-start gap-2 py-1 text-xs" key={index}>
          <Checkbox checked={checked.has(index)} onCheckedChange={value => setChecked(current => {
            const next = new Set(current)
            if (value === true) next.add(index)
            else next.delete(index)
            return next
          })} /><span className="min-w-0 truncate">{edit.before.trim().slice(0, 100)}</span>
        </label>)}
      </div>)}
      {unknown.size > 0 && <p role="status" className="break-words text-xs text-amber-800">New unknown citations: {[...unknown].join(', ')}</p>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={disabled || !valid || !checked.size} onClick={() => onAction({ kind: 'apply', run, edits: changes })}>Apply to drafts</Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAction({ kind: 'reject' })}>Reject proposal</Button>
      </div>
    </>}
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
