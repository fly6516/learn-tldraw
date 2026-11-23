import { updateFileContent } from './file-system'
import type { ProjectFileSystem } from './types'
import type { ChatCheckpoint, ChatSource } from './writing-chat'
import { editableSource, sameDraft, type WritingDrafts } from './writing-drafts'

const text = (source: ChatSource) => source.draft?.text ?? source.saved

export function manuscriptReviewFiles(checkpoints: readonly ChatCheckpoint[], project: ProjectFileSystem, drafts: WritingDrafts) {
  const files = new Map<string, { before: ChatSource; expected: ChatSource;
    intervening?: { before: ChatSource; after: ChatSource } }>()
  for (const checkpoint of checkpoints) {
    if (checkpoint.state !== 'draft' && checkpoint.state !== 'saved') continue
    for (const [path, expected] of Object.entries(checkpoint.after)) {
      const prior = files.get(path)
      const before = checkpoint.before[path]
      const intervening = prior && !sameSource(prior.expected, before) ? { before: prior.expected, after: before } : prior?.intervening
      files.set(path, { before: prior?.before ?? before, expected, intervening })
    }
  }
  return [...files].map(([path, { before, expected, intervening }]) => {
    const saved = editableSource(project, path)
    const current = saved === undefined ? undefined : { saved, draft: drafts[path] }
    const available = Boolean(current && (!current.draft || current.draft.base === current.saved))
    return { path, before, expected, current, available, intervening, conflict: Boolean(intervening) || !current || !sameSource(expected, current),
      hasAuthorDraft: Boolean(before.draft), hasChangesToSave: Boolean(current?.draft && current.saved !== current.draft.text) }
  })
}

function sameSource(left: ChatSource, right: ChatSource) {
  return left.saved === right.saved && sameDraft(left.draft, right.draft)
}

export type ManuscriptReviewFile = ReturnType<typeof manuscriptReviewFiles>[number]

export function buildManuscriptSnapshot(project: ProjectFileSystem, drafts: WritingDrafts, checkpoints: readonly ChatCheckpoint[],
  paths: readonly string[], accepted: readonly string[]) {
  if (!project.metadata.mainFile || !paths.length || new Set(paths).size !== paths.length) {
    throw new Error('Select at least one manuscript file and a compile entry.')
  }
  const review = new Map(manuscriptReviewFiles(checkpoints, project, drafts).map(file => [file.path, file]))
  const before: Record<string, ChatSource> = Object.create(null)
  const after: Record<string, ChatSource> = Object.create(null)
  let candidate = project
  for (const path of paths) {
    const file = review.get(path)
    if (!file?.available || !file.current || !file.hasChangesToSave) throw new Error(`No current task draft can be saved in ${path}.`)
    if (file.conflict && !accepted.includes(path)) throw new Error(`Review the newer source or draft in ${path} before including it.`)
    before[path] = file.current
    after[path] = { saved: text(file.current) }
    candidate = updateFileContent(candidate, path, after[path].saved)
  }
  return { candidate, checkpoint: { state: 'saved', main: project.metadata.mainFile, before, after } satisfies ChatCheckpoint }
}
