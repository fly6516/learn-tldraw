import JSZip from 'jszip'
import { z } from 'zod'
import type { Editor, TLEditorSnapshot } from 'tldraw'
import type { ProjectDirectory, ProjectFile, ProjectFileSystem } from './types'

const format = 'research-canvas'
export const projectBackupExtension = '.research-canvas'
const manifestName = 'project.json'

const fileEntry = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['generated', 'editable', 'asset', 'directory']),
  content: z.string().optional(),
  size: z.number().optional(),
  mimeType: z.string().optional(),
  metadata: z.object({
    editable: z.boolean(),
    description: z.string().optional(),
    lastModified: z.string().optional(),
  }).optional(),
  attachment: z.object({ entry: z.string().regex(/^attachments\/\d+$/), type: z.string() }).optional(),
})

const manifestSchema = z.object({
  format: z.literal(format),
  version: z.literal(1),
  canvas: z.object({
    document: z.object({ schema: z.object({}).passthrough(), store: z.record(z.string(), z.object({
      id: z.string(),
      typeName: z.string(),
    }).passthrough()) }).passthrough(),
    session: z.object({}).passthrough(),
  }),
  project: z.object({
    metadata: z.object({
      projectName: z.string(),
      version: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      sourceMode: z.literal('archive').optional(),
      mainFile: z.string().optional(),
    }),
    template: z.object({
      documentClass: z.string(),
      documentClassOptions: z.array(z.string()).optional(),
      preamble: z.string(),
      packages: z.array(z.object({ name: z.string(), options: z.array(z.string()).optional() })),
      bibliographyFiles: z.string().optional(),
      bibliography: z.object({ style: z.string(), command: z.string() }).optional(),
      customCommands: z.array(z.string()).optional(),
      metadata: z.object({
        title: z.string().optional(),
        author: z.string().optional(),
        date: z.string().optional(),
        language: z.enum(['en', 'zh', 'auto']).optional(),
        imported: z.boolean().optional(),
        importSource: z.string().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      }),
    }),
    files: z.array(fileEntry),
  }),
})

export async function captureBackupCanvas(editor: Editor): Promise<TLEditorSnapshot> {
  const snapshot = structuredClone(editor.getSnapshot())
  const records = Object.values(snapshot.document.store)
  await Promise.all(records.map(async record => {
    if (record.typeName !== 'asset' || record.type === 'bookmark') return
    const src = record.props.src
    if (!src || src.startsWith('data:')) return

    try {
      const url = await editor.resolveAssetUrl(record.id, { shouldResolveToOriginal: true })
      if (!url) throw new Error('Missing asset URL')
      const response = await fetch(url)
      if (!response.ok) throw new Error('Asset request failed')
      const blob = await response.blob()
      const media = new Blob([blob], { type: record.props.mimeType ?? blob.type })
      record.props.src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(media)
      })
    } catch (cause) {
      throw new Error(`Could not include canvas attachment: ${record.props.name}`, { cause })
    }
  }))
  return snapshot
}

export async function encodeProjectBackup(canvas: TLEditorSnapshot, project: ProjectFileSystem): Promise<Blob> {
  const archive = new JSZip()
  const files = await Promise.all([...project.files.values()].map(async (entry, index) => {
    if (entry.type === 'directory') return { type: entry.type, path: entry.path, name: entry.name }
    const { blob, ...file } = entry
    if (!blob) return file
    const attachment = { entry: `attachments/${index}`, type: blob.type }
    archive.file(attachment.entry, await blob.arrayBuffer())
    return { ...file, attachment }
  }))
  archive.file(manifestName, JSON.stringify({
    format,
    version: 1,
    canvas,
    project: { ...project, files },
  }))
  return archive.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function decodeProjectBackup(file: Blob) {
  const archive = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true })
  const manifestFile = archive.file(manifestName)
  if (!manifestFile) throw new Error('This file is not a Research Canvas backup.')
  const manifest = manifestSchema.safeParse(JSON.parse(await manifestFile.async('text')))
  if (!manifest.success) throw new Error('The project backup is invalid or uses an unsupported version.')

  const { canvas, project } = manifest.data
  const files: ProjectFileSystem['files'] = new Map()
  for (const { attachment, ...file } of project.files) {
    if (files.has(file.path)) throw new Error(`Duplicate project path: ${file.path}`)
    if (file.type === 'directory') {
      files.set(file.path, { name: file.name, path: file.path, type: 'directory', files: [] })
      continue
    }
    const entry = attachment && archive.file(attachment.entry)
    if (attachment && !entry) throw new Error(`Missing project attachment: ${file.path}`)
    const blob = entry && new Blob([await entry.async('arraybuffer')], { type: attachment?.type })
    files.set(file.path, { ...file, blob: blob || undefined })
  }

  for (const item of files.values()) {
    const path = item.path.replace(/\/$/, '')
    const parent = files.get(path.slice(0, path.lastIndexOf('/') + 1))
    if (parent?.type === 'directory' && 'files' in parent) {
      parent.files.push(item as ProjectFile | ProjectDirectory)
    }
  }

  return {
    canvas: canvas as unknown as TLEditorSnapshot,
    project: { ...project, files } satisfies ProjectFileSystem,
  }
}
