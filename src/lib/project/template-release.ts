import type { LocalPaperTemplate } from './template-catalog'
import type { ProjectFileSystem } from './types'
import { attachmentManifestDigest, officialAttachment, verifyAttachment, type AttachmentRole, type OfficialAttachment } from './official-attachments'
import { templateDigest } from './paper-templates'

export type TemplateOrigin = NonNullable<ProjectFileSystem['metadata']['templateOrigin']>
export type SwitchAcceptance = {
  protocol: 1; pdfSha256: string; anchors: { path: string; line: number; page: number }[]
}
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
export const wordVersionSchema = z.string().trim().regex(/^\d+(?:\.\d+){1,3}(?: \([\d.]+\))?$/)
export const wordAcceptanceSchema = z.object({
  protocol: z.literal(1), result: z.literal('passed'), software: z.literal('Microsoft Word'),
  version: wordVersionSchema, checkedAt: z.string().datetime(), manifestSha256: sha256Schema,
  generatedSha256: sha256Schema, finalSha256: sha256Schema,
}).refine(record => record.generatedSha256 !== record.finalSha256)
export type WordAcceptance = z.infer<typeof wordAcceptanceSchema>
type ReleaseBase = TemplateOrigin & { sourceName: string; publishedAt: string; sourceUrl: string; previewSha256: string;
  switchAcceptance?: SwitchAcceptance; attachments?: OfficialAttachment[]; wordAcceptance?: WordAcceptance }
export type OfficialTemplateRelease =
  | (ReleaseBase & { kind: 'word'; layout: LocalPaperTemplate; original?: Blob; attachmentFiles?: Partial<Record<AttachmentRole, Blob>> })
  | (ReleaseBase & { kind: 'zip'; archive: Blob })
  | (ReleaseBase & { kind: 'word-import'; archive: Blob })

export function sameTemplateOrigin(a: TemplateOrigin | undefined, b: TemplateOrigin) {
  return a?.id === b.id && a.version === b.version && a.sha256 === b.sha256 && a.manifestSha256 === b.manifestSha256
}

export function projectBoundReleaseOrigins(project: ProjectFileSystem) {
  const origins = [project.metadata.activeTemplate?.origin, project.metadata.templateOrigin]
  return origins.filter((origin, index): origin is TemplateOrigin => Boolean(origin?.manifestSha256 &&
    !origins.slice(0, index).some(other => sameTemplateOrigin(other, origin))))
}

export function validateReleaseCandidate(current: TemplateOrigin, version: string, sha256: string, manifestSha256?: string) {
  if (!/^[a-z\d][a-z\d.\-]{0,47}$/i.test(version.trim())) throw new Error('请输入可识别的发布版本。')
  if (!/^[a-f\d]{64}$/.test(sha256)) throw new Error('候选原件缺少有效的 SHA-256。')
  if (version.trim() === current.version) throw new Error('候选版本必须使用新的版本号。')
  if (manifestSha256 && !/^[a-f\d]{64}$/.test(manifestSha256)) throw new Error('候选附件清单校验值无效。')
  if (manifestSha256 && manifestSha256 === current.manifestSha256 ||
      sha256 === current.sha256 && !manifestSha256) throw new Error('候选原件与当前发布版相同。')
}

export async function readCandidateOrigin(parent: TemplateOrigin, version: string, file: File): Promise<TemplateOrigin> {
  const sha256 = await templateDigest(await file.arrayBuffer())
  const trimmed = version.trim()
  validateReleaseCandidate(parent, trimmed, sha256)
  return { id: parent.id, version: trimmed, sha256 }
}

export async function validateReleaseAttachments(release: OfficialTemplateRelease) {
  if (release.wordAcceptance && (release.kind !== 'word' ||
      wordAcceptanceSchema.parse(release.wordAcceptance).manifestSha256 !== release.manifestSha256)) {
    throw new Error('Word 实机验收结果与附件发布版不匹配。')
  }
  if (!release.attachments && !release.manifestSha256) return
  if (!release.attachments || await attachmentManifestDigest(release.attachments) !== release.manifestSha256 ||
      officialAttachment(release.attachments, 'original')?.sha256 !== release.sha256) throw new Error('官方版本附件清单与校验值不一致。')
  await Promise.all(release.attachments.map(async item => {
    if (release.kind === 'word' && item.role !== 'original') {
      const bytes = release.attachmentFiles?.[item.role]
      if (!bytes) throw new Error('选定版本缺少已核验的官方附件（' + item.role + '）。')
      await verifyAttachment(bytes, item)
    } else if (item.role === 'original') {
      const bytes = release.kind === 'word' ? release.original : release.archive
      if (!bytes) throw new Error('选定版本缺少主原件。')
      await verifyAttachment(bytes, item)
    }
  }))
}
import { z } from 'zod'
