import type { ProjectFileSystem } from './types'
import { updateFileContent } from './file-system'

export type WritingDraft = { base: string; text: string }
export type WritingDrafts = Record<string, WritingDraft>
export type WritingView = { path: string; lineNumber: number; column: number }
export type WritingKey = [workspace: string, project: string]
export type PortableWritingState = { drafts: WritingDrafts; view?: WritingView }

export function editableSource(project: ProjectFileSystem, path: string) {
  const file = project.files.get(path)
  return file?.type === 'editable' && file.metadata?.editable && typeof file.content === 'string' ? file.content : undefined
}

export function sameDraft(a: WritingDraft | undefined, b: WritingDraft | undefined) {
  return a?.base === b?.base && a?.text === b?.text
}

export function draftConflicts(project: ProjectFileSystem, drafts: WritingDrafts) {
  return Object.entries(drafts).filter(([path, draft]) => {
    const source = editableSource(project, path)
    return source !== draft.base && source !== draft.text
  }).map(([path]) => path)
}

export function applyWritingDrafts(project: ProjectFileSystem, drafts: WritingDrafts) {
  return Object.entries(drafts).reduce((updated, [path, draft]) =>
    editableSource(updated, path) === draft.base && draft.text !== draft.base
      ? updateFileContent(updated, path, draft.text) : updated, project)
}
