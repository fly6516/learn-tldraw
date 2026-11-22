import JSZip from 'jszip'
import type { ProjectFileSystem } from './types'

export const projectTextExtension = /\.(tex|bib|cls|sty|bst|bbl|cfg|def|ltx|tikz|txt|md|csv|tsv|jsonl?|toml)$/i
const imageTypes: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
}

export function isProjectPath(path: string): boolean {
  return path.split('/').every(part =>
    part && part !== '.' && part !== '..' && !/[<>:"\\|?*\x00-\x1f]/.test(part)
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)
  )
}

export async function importSourceArchive(file: File, maxBytes = 128 * 1024 * 1024): Promise<ProjectFileSystem> {
  if (file.size > maxBytes) throw new Error('Project ZIP exceeds the size limit.')
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const files: ProjectFileSystem['files'] = new Map()
  const occupied = new Set<string>()
  let size = 0
  for (const entry of Object.values(archive.files)) {
    const path = entry.dir ? entry.name.replace(/\/$/, '') : entry.name
    if (!isProjectPath(path) || (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)) {
      throw new Error(`Unsupported ZIP path: ${entry.unsafeOriginalName ?? entry.name}`)
    }
    if (occupied.has(path.toLowerCase())) throw new Error(`Conflicting ZIP paths: ${path}`)
    occupied.add(path.toLowerCase())
    const name = path.split('/').at(-1)!
    if (entry.dir) {
      files.set(entry.name, { path: entry.name, name, type: 'directory', files: [] })
      continue
    }
    const bytes = await entry.async('arraybuffer')
    size += bytes.byteLength
    if (size > maxBytes) throw new Error('Extracted project exceeds the size limit.')
    const editable = projectTextExtension.test(name)
    const extension = name.split('.').at(-1)!.toLowerCase()
    const mimeType = editable ? 'text/plain' : imageTypes[extension] ?? 'application/octet-stream'
    const blob = new Blob([bytes], { type: mimeType })
    files.set(path, {
      path, name, blob, mimeType, size: blob.size,
      type: editable ? 'editable' : 'asset',
      content: editable ? new TextDecoder().decode(bytes) : undefined,
      metadata: { editable },
    })
  }

  const entries = [...files.values()].filter(entry => entry.type !== 'directory' && /\.tex$/i.test(entry.path))
  if (!entries.length) throw new Error('This ZIP does not contain a .tex file.')
  const roots = entries.filter(entry => 'content' in entry && /\\documentclass\b/.test(entry.content ?? ''))
  const mainFile = roots.find(entry => entry.name.toLowerCase() === 'main.tex')?.path
    ?? roots[0]?.path ?? entries[0].path
  const now = new Date().toISOString()
  return {
    files,
    template: { documentClass: 'article', packages: [], preamble: '', metadata: {} },
    metadata: {
      projectName: file.name.replace(/\.zip$/i, ''), version: '1.0.0',
      createdAt: now, updatedAt: now, sourceMode: 'archive', mainFile,
    },
  }
}

export async function exportSourceArchive(project: ProjectFileSystem): Promise<Blob> {
  const archive = new JSZip()
  for (const entry of project.files.values()) {
    if (entry.type === 'directory') archive.file(entry.path, '', { dir: true, createFolders: false })
    else if ('blob' in entry && entry.blob) archive.file(entry.path, await entry.blob.arrayBuffer(), { createFolders: false })
    else if ('content' in entry && entry.content !== undefined) archive.file(entry.path, entry.content, { createFolders: false })
  }
  return archive.generateAsync({ type: 'blob' })
}
