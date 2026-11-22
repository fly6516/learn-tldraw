import type { ProjectDirectory, ProjectFile, ProjectFileSystem } from './types'

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

export async function describeSnapshotRestore(current: ProjectFileSystem, target: ProjectFileSystem) {
  const paths = [...new Set([...current.files.keys(), ...target.files.keys()])].sort()
  const files: string[] = []
  for (const path of paths) {
    const before = current.files.get(path)
    const after = target.files.get(path)
    if (before?.type === 'directory' && after?.type === 'directory') continue
    if (!before) files.push(`Add ${path}`)
    else if (!after) files.push(`Remove ${path}`)
    else if (!await sameFile(before, after)) files.push(`Restore ${path}`)
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
      || current.metadata.sourceMode !== target.metadata.sourceMode
      || projectValue(current.template) !== projectValue(target.template),
  }
}
