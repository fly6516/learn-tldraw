import { catalogReleaseSource, templateCatalog } from './template-catalog'
import { attachmentManifestDigest, officialAttachment, officialAttachmentsSchema, type AttachmentRole, type OfficialAttachment } from './official-attachments'
import { templateDigest } from './paper-templates'
import { validateReleaseCandidate, type OfficialTemplateRelease, type TemplateOrigin } from './template-release'

export const zjuAttachmentTemplate = 'zju-basic-medicine-undergraduate'
export const njuptAttachmentTemplate = 'njupt-professional-masters'

export function usesWordAttachmentRelease(id: string) {
  return id === zjuAttachmentTemplate || id === njuptAttachmentTemplate
}

export function catalogWordAttachments(id: string): OfficialAttachment[] | undefined {
  const entry = templateCatalog.find(item => item.id === id)
  const source = entry && catalogReleaseSource(entry)
  if (!source || source.kind !== 'word' || !usesWordAttachmentRelease(id)) return
  return officialAttachmentsSchema.parse([
    { role: 'original', url: source.url, sha256: source.baseline.sha256 },
    ...(['guideline', 'declaration', 'blind-cover'] as const).flatMap(role => {
      const entry = role === 'blind-cover' ? source.blindCover : source[role]
      return entry ? [{ role, url: entry.url, sha256: entry.sha256 }] : []
    }),
  ])
}

export async function readWordAttachmentCandidate(parent: TemplateOrigin, version: string,
  original: File, files: Partial<Record<AttachmentRole, File>>, parentAttachments?: OfficialAttachment[], candidateSources?: OfficialAttachment[]) {
  const registered = catalogWordAttachments(parent.id)
  if (!registered) throw new Error('此模板未登记官方附件。')
  const previous = parentAttachments ?? registered
  const attachments = await Promise.all(previous.map(async item => {
    const file = item.role === 'original' ? original : files[item.role]
    if (!file?.size) throw new Error('请选择本次验收的官方附件（' + item.role + '）。')
    const sha256 = await file.arrayBuffer().then(templateDigest)
    const actual = officialAttachment(candidateSources, item.role)
    return { ...item, url: actual?.sha256 === sha256 ? actual.url : item.url, sha256 }
  }))
  const manifestSha256 = await validateWordAttachmentManifest(parent.id, officialAttachment(attachments, 'original')!.sha256, attachments)
  const previousSha = await attachmentManifestDigest(previous)
  if (manifestSha256 === previousSha) throw new Error('候选的官方原件和附件均与当前版本相同。')
  const sha256 = officialAttachment(attachments, 'original')!.sha256
  const origin = { id: parent.id, version: version.trim(), sha256, manifestSha256 }
  validateReleaseCandidate(parent, origin.version, sha256, manifestSha256)
  return { origin, attachments, files }
}

export function matchingWordRelease(origin: TemplateOrigin | undefined, releases: OfficialTemplateRelease[]) {
  return releases.find(release => release.kind === 'word' && release.id === origin?.id && release.version === origin.version &&
    release.sha256 === origin.sha256 && release.manifestSha256 === origin.manifestSha256) as Extract<OfficialTemplateRelease, { kind: 'word' }> | undefined
}

export async function validateWordAttachmentManifest(id: string, sha256: string, attachments: OfficialAttachment[]) {
  const catalog = catalogWordAttachments(id)
  if (!catalog || attachments.length !== catalog.length || officialAttachment(attachments, 'original')?.sha256 !== sha256 ||
      attachments.some(item => !catalog.some(role => role.role === item.role && new URL(role.url).origin === new URL(item.url).origin))) {
    throw new Error('版本的附件角色、来源或主原件与学校配置不符。')
  }
  return attachmentManifestDigest(attachments)
}

export type WordReleaseAssets = { attachments: OfficialAttachment[]; files: Partial<Record<AttachmentRole, File>> }
