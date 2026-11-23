'use client'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { manuscriptProgress, type ManuscriptTask } from '@/lib/project/manuscript-task'
import type { ChatCheckpoint, ChatTaskStep, WritingChatMessage } from '@/lib/project/writing-chat'

export function ManuscriptTaskCard({ task, states, receipts, messages, running, busy, onRun, onPause, onNotes, onReview, onUndoSave, onUndo }: {
  task: ManuscriptTask
  states: Record<string, ChatCheckpoint['state']>
  receipts: Record<string, ChatTaskStep[]>
  messages: WritingChatMessage[]
  running: boolean
  busy: boolean
  onRun: () => void
  onPause: () => void
  onNotes: (field: 'decisions' | 'questions', notes: string[]) => void
  onReview: () => void
  onUndoSave: () => void
  onUndo: (ids: string[]) => void
}) {
  const progress = manuscriptProgress(task, states, receipts)
  const saved = states[task.id] === 'saved'
  const savedFiles = receipts[task.id]?.findLast(step => step.kind === 'saved')?.paths?.length
  return <section aria-label="Manuscript task" className="mx-2 my-1 max-h-[45%] shrink-0 space-y-2 overflow-auto rounded border border-indigo-200 p-2 text-xs">
    <h3 className="font-semibold">{task.title}</h3>
    <p role="status">{progress.done.size} of {task.files.length} files applied · {running
      ? progress.pending ? 'Review the current batch to continue' : 'Running' : progress.remaining.length ? 'Paused' : 'All planned files applied'}</p>
    {saved && <p className="text-emerald-800">{savedFiles ? `${savedFiles} task files saved together.` : 'Task files saved together.'}</p>}
    <div className="flex flex-wrap gap-1">
      {running ? <Button type="button" size="sm" variant="outline" onClick={onPause}>Pause task</Button>
        : <Button type="button" size="sm" disabled={busy || Boolean(progress.pending) || !progress.remaining.length} onClick={onRun}>Continue task</Button>}
      {!saved && <Button type="button" size="sm" variant="outline" disabled={busy || running || Boolean(progress.pending) || !progress.active.length}
        onClick={onReview}>Review and save task</Button>}
      {saved && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onUndoSave}>Undo manuscript save</Button>}
      <Button type="button" size="sm" variant="outline" disabled={busy || running || saved || !progress.active.length}
        onClick={() => onUndo(progress.active.slice(-1))}>Undo latest batch</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || running || saved || !progress.active.length}
        onClick={() => onUndo(progress.active)}>Undo task batches</Button>
    </div>
    <details>
      <summary>Task goal</summary>
      <p className="whitespace-pre-wrap break-words">{task.goal}</p>
    </details>
    {!!progress.remaining.length && <details>
      <summary>Remaining files · {progress.remaining.length}</summary>
      <ul className="max-h-36 list-inside list-disc overflow-auto break-all font-mono">
        {progress.remaining.map(path => <li key={path}>{path}</li>)}
      </ul>
    </details>}
    {!!task.batches.length && <details>
      <summary>Batches · {task.batches.length}</summary>
      <ul className="max-h-48 space-y-1 overflow-auto">
        {task.batches.map((batch, index) => {
          const message = messages.find(item => item.role === 'assistant' && item.metadata?.run === batch.run)
          const state = states[batch.run]
          const result = receipts[batch.run]?.findLast(step => step.kind === 'passed' || step.kind === 'failed')
          return <li key={batch.run} className="break-all">
            {message ? <a className="underline" href={`#writing-ai-message-${message.id}`}>Batch {index + 1}</a> : `Batch ${index + 1}`}
            {' · '}{state === 'draft' ? 'Working drafts' : state ?? (progress.pending?.run === batch.run ? 'Awaiting review' : 'Superseded')}
            {result && ` · last verification ${result.kind}`}
            <p className="text-slate-600">{batch.files.join(', ')}</p>
          </li>
        })}
      </ul>
    </details>}
    <details>
      <summary>Author decisions and open questions</summary>
      {(['decisions', 'questions'] as const).map(field => <label key={field} className="mt-1 block">
        {field === 'decisions' ? 'Author decisions, one per line' : 'Open questions, one per line'}
        <Textarea key={task.id} aria-label={field === 'decisions' ? 'Task author decisions' : 'Task open questions'}
          defaultValue={task[field].join('\n')} maxLength={5400}
          onBlur={event => onNotes(field, event.target.value.split(/\r?\n/).map(note => note.trim().slice(0, 450)).filter(Boolean).slice(0, 12))} />
      </label>)}
    </details>
  </section>
}
