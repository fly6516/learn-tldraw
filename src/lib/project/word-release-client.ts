import { officialAttachment, verifyAttachment, type AttachmentRole } from './official-attachments'
import { fetchOfficialFile } from './official-template-client'
import type { OfficialTemplateRelease } from './template-release'
import { catalogWordAttachments } from './word-release-attachments'

export async function wordReleaseFile(id: string, role: AttachmentRole, signal?: AbortSignal,
  release?: OfficialTemplateRelease, uploaded?: File) {
  const item = officialAttachment(release?.attachments ?? catalogWordAttachments(id), role)
  if (!item) throw new Error('所选版本缺少官方附件（' + role + '）。')
  const stored = release?.kind === 'word' && release.attachments
    ? role === 'original' ? release.original : release.attachmentFiles?.[role] : undefined
  const file = uploaded ?? stored
  if (!file) {
    if (release?.attachments) throw new Error('此发布版的本机附件缺失。请恢复版本包或手动上传对应原件。')
    return fetchOfficialFile(id, item.sha256, role === 'original' || role === 'cover' || role === 'body' ? undefined : role, signal)
  }
  await verifyAttachment(file, item)
  signal?.throwIfAborted()
  const name = file instanceof File ? file.name : role === 'original' && release?.sourceName
    ? release.sourceName : role + (role === 'guideline' ? '.pdf' : '.doc')
  return new File([file], name)
}
