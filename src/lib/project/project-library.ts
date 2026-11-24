import type { ProjectFileSystem } from './types'

export const legacyStorageKey = 'research-flow-v2'
export const legacyProjectId = 'legacy'
export const libraryChangesChannel = 'research-canvas-project-library'

export type LibraryProjectState = 'active' | 'archived' | 'trash'
export type LibraryView = 'canvas' | 'write'
export type RecoveryReceipt = { exportedAt: string; scope: string; baseline?: string }
export type RecoveryStatus = { receipt?: RecoveryReceipt; changed: boolean }

export type LibraryProject = {
  id: string
  name: string
  state: LibraryProjectState
  view: LibraryView
  lastOpenedAt: string
  templateOrigin?: ProjectFileSystem['metadata']['templateOrigin']
}

export function libraryStorageKey(id: string) {
  return id === legacyProjectId ? legacyStorageKey : `research-project:${id}`
}

export function libraryProjectUrl(id: string, view: LibraryView) {
  const query = new URLSearchParams({ project: id })
  if (view === 'write') query.set('view', 'write')
  return `/research?${query}`
}
