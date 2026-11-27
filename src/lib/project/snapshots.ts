import type { ProjectDirectory, ProjectFile, ProjectFileSystem } from './types'
import { rebuildProjectDirectories } from './file-system'

export interface ProjectSnapshotInfo {
  id: string
  name: string
  createdAt: string
}

export interface ProjectSnapshot extends ProjectSnapshotInfo {
  project: ProjectFileSystem
}

async function sameAttachment(a?: Blob, b?: Blob) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size || a.type !== b.type) return false
  const [first, second] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()])
  const bytes = new Uint8Array(second)
  return new Uint8Array(first).every((byte, index) => byte === bytes[index])
}

async function sameFile(a: ProjectFile | ProjectDirectory, b: ProjectFile | ProjectDirectory) {
  if (a.type === 'directory' || b.type === 'directory') return a.type === b.type
  const { blob: first, ...before } = a
  const { blob: second, ...after } = b
  return before.name === after.name && before.type === after.type && before.content === after.content
    && before.mimeType === after.mimeType && before.metadata?.editable === after.metadata?.editable
    && before.metadata?.description === after.metadata?.description && await sameAttachment(first, second)
}

function projectValue(value: unknown) {
  return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([first], [second]) => first.localeCompare(second))) : item)
}

export type SnapshotFileChange = { path: string; action: 'Add' | 'Remove' | 'Restore'; current?: ProjectFile; saved?: ProjectFile }

export async function compareSnapshotFiles(current: ProjectFileSystem, target: ProjectFileSystem): Promise<SnapshotFileChange[]> {
  const paths = [...new Set([...current.files.keys(), ...target.files.keys()])].sort()
  const changes: SnapshotFileChange[] = []
  for (const path of paths) {
    const before = current.files.get(path)
    const after = target.files.get(path)
    if (before?.type === 'directory' || after?.type === 'directory') continue
    if (!before && after) changes.push({ path, action: 'Add', saved: after })
    else if (before && !after) changes.push({ path, action: 'Remove', current: before })
    else if (before && after && !await sameFile(before, after)) changes.push({ path, action: 'Restore', current: before, saved: after })
  }
  return changes
}

export function restoreSnapshotFiles(current: ProjectFileSystem, target: ProjectFileSystem, paths: readonly string[]) {
  const files = new Map(current.files)
  for (const path of paths) {
    const before = files.get(path)
    const after = target.files.get(path)
    if ([before?.type, after?.type].some(type => type === 'directory' || type === 'generated')) {
      throw new Error(`This file cannot be restored individually: ${path}`)
    }
    if (after) files.set(path, after)
    else if (path === current.metadata.mainFile) throw new Error('Choose a different main file before removing the current entry.')
    else files.delete(path)
  }
  const occupied = new Map<string, string>()
  for (const [path, entry] of files) {
    const parts = path.replace(/\/$/, '').split('/')
    let stem = ''
    for (const [index, part] of parts.entries()) {
      stem += part
      if (index < parts.length - 1 || entry.type === 'directory') stem += '/'
      const key = stem.replace(/\/$/, '').toLowerCase()
      const other = occupied.get(key)
      if (other && other !== stem) throw new Error(`Conflicting project paths: ${other} and ${stem}`)
      occupied.set(key, stem)
    }
  }
  return { ...current, files: rebuildProjectDirectories(files), metadata: { ...current.metadata, updatedAt: new Date().toISOString() } }
}

export async function describeSnapshotRestore(current: ProjectFileSystem, target: ProjectFileSystem,
  changes?: readonly SnapshotFileChange[]) {
  const paths = [...new Set([...current.files.keys(), ...target.files.keys()])].sort()
  const changed = new Map((changes ?? await compareSnapshotFiles(current, target)).map(change => [change.path, change.action]))
  const files: string[] = []
  for (const path of paths) {
    const before = current.files.get(path)
    const after = target.files.get(path)
    const action = changed.get(path) ?? (before?.type === 'directory' || after?.type === 'directory'
      ? !before ? 'Add' : !after ? 'Remove' : before.type !== after.type ? 'Restore' : undefined : undefined)
    if (action) files.push(`${action} ${path}`)
  }
  const beforePages = new Map(current.canvas?.pages.map(page => [page.id, page]))
  const afterPages = new Map(target.canvas?.pages.map(page => [page.id, page]))
  const pages: string[] = []
  for (const id of new Set([...beforePages.keys(), ...afterPages.keys()])) {
    const before = beforePages.get(id)
    const after = afterPages.get(id)
    if (!before && after) pages.push(`Add ${after.name}`)
    else if (before && !after) pages.push(`Remove ${before.name}`)
    else if (before && after && projectValue(before) !== projectValue(after)) pages.push(`Restore ${after.name}`)
  }
  return {
    files, pages,
    mainChanged: current.metadata.mainFile !== target.metadata.mainFile,
    activePageChanged: current.canvas?.activePageId !== target.canvas?.activePageId,
    crossPageEdgesChanged: projectValue(current.canvas?.crossPageEdges ?? []) !== projectValue(target.canvas?.crossPageEdges ?? []),
    settingsChanged: current.metadata.projectName !== target.metadata.projectName
      || projectValue(current.metadata.information) !== projectValue(target.metadata.information)
      || current.metadata.sourceMode !== target.metadata.sourceMode
      || projectValue(current.template) !== projectValue(target.template),
  }
}
