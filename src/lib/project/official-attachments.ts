import { z } from 'zod'
import { templateDigest } from './paper-templates'

export const attachmentRole = z.enum(['original', 'guideline', 'declaration', 'blind-cover', 'cover', 'body'])
export type AttachmentRole = z.infer<typeof attachmentRole>
export const officialAttachmentSchema = z.object({
  role: attachmentRole,
  url: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  member: z.string().min(1).max(240).optional(),
})
export const officialAttachmentsSchema = z.array(officialAttachmentSchema).min(1).max(6).refine(items =>
  new Set(items.map(item => item.role)).size === items.length && items.some(item => item.role === 'original'))
export type OfficialAttachment = z.infer<typeof officialAttachmentSchema>

export async function attachmentManifestDigest(items: readonly OfficialAttachment[]) {
  const ordered = [...officialAttachmentsSchema.parse(items)].sort((a, b) => a.role.localeCompare(b.role))
  return templateDigest(new TextEncoder().encode(JSON.stringify(ordered)).buffer)
}

export function officialAttachment(items: readonly OfficialAttachment[] | undefined, role: AttachmentRole) {
  return items?.find(item => item.role === role)
}

export async function verifyAttachment(file: Blob, attachment: OfficialAttachment) {
  if (!file.size || await file.arrayBuffer().then(templateDigest) !== attachment.sha256) {
    throw new Error('官方附件 SHA-256 校验失败（' + attachment.role + '）。')
  }
}
