import { z } from 'zod'
import { templateDigest } from './paper-templates'

const maxMaterialBytes = 32 * 1024 * 1024
const maxTotalBytes = 64 * 1024 * 1024
const maxMaterials = 24

export const submissionMaterialSchema = z.object({
  slot: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
  name: z.string().min(1).max(160).regex(/^[^/\\:\p{Cc}]+$/u).refine(name => name !== '.' && name !== '..'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(maxMaterialBytes),
  mime: z.string().max(120),
})

export const submissionMaterialsSchema = z.array(submissionMaterialSchema).max(maxMaterials)
  .refine(items => items.reduce((total, item) => total + item.bytes, 0) <= maxTotalBytes)

export type SubmissionMaterial = z.infer<typeof submissionMaterialSchema>
export type SubmissionMaterialSlot = { id: string; label: string; extensions: string[]; multiple?: boolean; required?: true | 'when-figures'; rule?: string }
export type AttachedSubmissionMaterial = { metadata: SubmissionMaterial; blob: Blob }

export async function readSubmissionMaterials(slot: SubmissionMaterialSlot, files: File[]) {
  if (files.length > (slot.multiple ? maxMaterials : 1)) throw new Error('请选择允许数量的附件。')
  if (files.some(file => !slot.extensions.includes(file.name.split('.').at(-1)?.toLowerCase() ?? ''))) throw new Error('附件格式与该项要求不符。')
  if (files.some(file => file.size < 1 || file.size > maxMaterialBytes) ||
    files.reduce((total, file) => total + file.size, 0) > maxTotalBytes) throw new Error('单个附件上限为 32 MB，全部附件上限为 64 MB。')
  return Promise.all(files.map(async file => ({
    metadata: submissionMaterialSchema.parse({ slot: slot.id, name: file.name.normalize('NFC'), bytes: file.size, mime: file.type,
      sha256: await templateDigest(await file.arrayBuffer()) }),
    blob: file as Blob,
  })))
}

export function submissionMaterialPath(item: SubmissionMaterial, index: number) {
  return 'materials/' + item.slot + '/' + (index + 1) + '-' + item.name
}

export async function verifySubmissionMaterials(metadata: readonly SubmissionMaterial[] = [], blobs: readonly Blob[] = []) {
  if (metadata.length !== blobs.length) return false
  const matches = await Promise.all(metadata.map(async (item, index) =>
    blobs[index] instanceof Blob && blobs[index].size === item.bytes && await templateDigest(await blobs[index].arrayBuffer()) === item.sha256))
  return matches.every(Boolean)
}
