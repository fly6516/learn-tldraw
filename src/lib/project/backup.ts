import JSZip from 'jszip'
import { z } from 'zod'
import { researchCanvasSchema, type ResearchCanvas } from './research-graph'
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
  version: z.literal(2),
  canvas: researchCanvasSchema,
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

export async function encodeProjectBackup(canvas: ResearchCanvas, project: ProjectFileSystem): Promise<Blob> {
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
    version: 2,
    canvas,
    project: { template: project.template, metadata: project.metadata, files },
  }))
  return archive.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function decodeProjectBackup(file: Blob) {
  const archive = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true })
  const manifestFile = archive.file(manifestName)
  if (!manifestFile) throw new Error('This file is not a Research Canvas backup.')
  const data: unknown = JSON.parse(await manifestFile.async('text'))
  const header = z.object({ format: z.literal(format), version: z.number() }).safeParse(data)
  if (header.success && header.data.version !== 2) {
    throw new Error('The project backup uses an unsupported version. This workspace supports version 2.')
  }
  const manifest = manifestSchema.safeParse(data)
  if (!manifest.success) throw new Error('The project backup is invalid.')

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
    canvas: canvas,
    project: { ...project, files, canvas } satisfies ProjectFileSystem,
  }
}
