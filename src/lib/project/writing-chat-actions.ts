import { applyProjectEdits, type ProjectSuggestion } from './ai-edit'
import type { ChatCheckpoint, ChatRun, ChatSource } from './writing-chat'
import { sameDraft } from './writing-drafts'

export type ChatAction =
  | { kind: 'apply'; run: ChatRun; edits: ProjectSuggestion['edits']; selection?: number[]; automatic?: boolean }
  | { kind: 'apply-save'; run: ChatRun; edits: ProjectSuggestion['edits']; signal: AbortSignal }
  | { kind: 'save' | 'undo' | 'reject' }

export function chatActionPaths(action: ChatAction, checkpoint?: ChatCheckpoint) {
  return action.kind === 'apply' || action.kind === 'apply-save'
    ? [...new Set(action.edits.map(edit => edit.path))]
    : Object.keys(checkpoint?.after ?? {})
}

export function nextChatCheckpoint(action: ChatAction, current: Record<string, ChatSource>, main?: string,
  checkpoint?: ChatCheckpoint): ChatCheckpoint | undefined {
  if (action.kind === 'reject') return checkpoint ? undefined : { state: 'rejected', before: {}, after: {} }
  if (action.kind === 'apply' || action.kind === 'apply-save') {
    if (checkpoint || !action.edits.length) return
    if (action.run.main !== main) throw new Error('The compile entry changed. Request a new proposal.')
    const before = Object.fromEntries(chatActionPaths(action).map(path => [path, action.run.sources[path]]))
    assertChatSources(before, current)
    const edited = applyProjectEdits(new Map(Object.entries(before).map(([path, source]) => [path, source.draft?.text ?? source.saved])), action.edits)
    const after = Object.fromEntries([...edited].map(([path, text]) => {
      const { saved } = before[path]
      return [path, action.kind === 'apply-save' ? { saved: text } : { saved, draft: saved === text ? undefined : { base: saved, text } }]
    }))
    return { main, state: action.kind === 'apply-save' ? 'saved' : 'draft', before, after }
  }
  if (!checkpoint || checkpoint.state === 'rejected' || checkpoint.state === 'undone'
    || action.kind === 'save' && checkpoint.state !== 'draft') return
  if (action.kind === 'save' && main !== checkpoint.main) throw new Error('The compile entry changed. Request a new proposal.')
  assertChatSources(checkpoint.after, current)
  if (action.kind === 'undo') return { ...checkpoint, state: 'undone', after: checkpoint.before }
  return { ...checkpoint, state: 'saved',
    after: Object.fromEntries(Object.entries(current).map(([path, source]) => [path, { saved: source.draft?.text ?? source.saved }])) }
}

function assertChatSources(expected: Record<string, ChatSource>, current: Record<string, ChatSource>) {
  for (const [path, source] of Object.entries(expected)) {
    if (!source || !Object.hasOwn(current, path) || current[path].saved !== source.saved
      || !sameDraft(current[path].draft, source.draft)) {
      throw new Error(`Source or local draft changed in ${path}. Request a new proposal or keep your newer changes.`)
    }
  }
}
