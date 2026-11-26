import type { LocalPaperTemplate } from './template-catalog'
import type { ProjectFileSystem } from './types'
import { templateDigest } from './paper-templates'

export type TemplateOrigin = NonNullable<ProjectFileSystem['metadata']['templateOrigin']>
export type SwitchAcceptance = {
  protocol: 1; pdfSha256: string; anchors: { path: string; line: number; page: number }[]
}
type ReleaseBase = TemplateOrigin & { sourceName: string; publishedAt: string; sourceUrl: string; previewSha256: string;
  switchAcceptance?: SwitchAcceptance }
export type OfficialTemplateRelease =
  | (ReleaseBase & { kind: 'word'; layout: LocalPaperTemplate; original?: Blob })
  | (ReleaseBase & { kind: 'zip'; archive: Blob })

export function validateReleaseCandidate(current: TemplateOrigin, version: string, sha256: string) {
  if (!/^[a-z\d][a-z\d.\-]{0,47}$/i.test(version.trim())) throw new Error('请输入可识别的发布版本。')
  if (!/^[a-f\d]{64}$/.test(sha256)) throw new Error('候选原件缺少有效的 SHA-256。')
  if (version.trim() === current.version) throw new Error('候选版本必须使用新的版本号。')
  if (sha256 === current.sha256) throw new Error('候选原件与当前发布版相同。')
}

export async function readCandidateOrigin(parent: TemplateOrigin, version: string, file: File): Promise<TemplateOrigin> {
  const sha256 = await templateDigest(await file.arrayBuffer())
  const trimmed = version.trim()
  validateReleaseCandidate(parent, trimmed, sha256)
  return { id: parent.id, version: trimmed, sha256 }
}
