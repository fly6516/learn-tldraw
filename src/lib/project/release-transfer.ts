import JSZip, { type JSZipObject, type JSZipStreamHelper } from 'jszip'
import { z } from 'zod'
import { templateDigest } from './paper-templates'
import { validateReleaseAttachments, wordAcceptanceSchema, type OfficialTemplateRelease, type TemplateOrigin } from './template-release'
import { officialAttachmentsSchema, type AttachmentRole } from './official-attachments'
import { importWordTemplateArchive } from './word-conversion-client'

const maxPayload = 128 * 1024 * 1024
const digest = z.string().regex(/^[a-f\d]{64}$/)
const manifestSchema = z.object({
  format: z.literal('official-template-release-v1'),
  id: z.string().min(1).max(80),
  kind: z.enum(['word', 'zip', 'word-import']),
  version: z.string().regex(/^[a-z\d][a-z\d.\-]{0,47}$/i),
  sha256: digest,
  payloadSha256: digest,
  originalSha256: digest.optional(),
  manifestSha256: digest.optional(),
  attachments: officialAttachmentsSchema.optional(),
  wordAcceptance: wordAcceptanceSchema.optional(),
  switchAcceptance: z.object({ protocol: z.literal(1), pdfSha256: digest, anchors: z.array(z.object({
    path: z.string(), line: z.number().int().positive(), page: z.number().int().positive(),
  })).max(32) }).optional(),
  previewSha256: digest,
  publishedAt: z.string().datetime(),
  sourceName: z.string().min(1).max(255).regex(/^[^/\\\p{Cc}]+$/u),
}).strict()

export async function exportRelease(release: OfficialTemplateRelease) {
  await validateReleaseAttachments(release)
  const zip = new JSZip()
  const payload = await (release.kind === 'word' ? release.layout.archive : release.archive).arrayBuffer()
  const { id, kind, version, sha256, previewSha256, publishedAt, sourceName } = release
  const original = release.kind === 'word' && release.original ? await release.original.arrayBuffer() : undefined
  const originalSha256 = original && await templateDigest(original)
  if (originalSha256 && originalSha256 !== sha256) throw new Error('Word 原件校验失败。')
  const manifest = manifestSchema.parse({ format: 'official-template-release-v1', id, kind, version, sha256,
    previewSha256, publishedAt, sourceName, payloadSha256: await templateDigest(payload), originalSha256,
    manifestSha256: release.manifestSha256, attachments: release.attachments, switchAcceptance: release.switchAcceptance,
    wordAcceptance: release.wordAcceptance })
  zip.file('release.json', JSON.stringify(manifest, null, 2))
  zip.file('payload.zip', payload)
  if (original) zip.file('original.docx', original)
  if (release.kind === 'word') for (const item of release.attachments ?? []) {
    if (item.role !== 'original') zip.file('attachment-' + item.role, await release.attachmentFiles![item.role]!.arrayBuffer())
  }
  return zip.generateAsync({ type: 'blob' })
}

function readLimited(entry: JSZipObject, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    const stream = (entry as JSZipObject & {
      internalStream(type: 'uint8array'): JSZipStreamHelper<Uint8Array>
    }).internalStream('uint8array')
    stream.on('data', chunk => {
      size += chunk.byteLength
      if (size > limit) {
        stream.pause()
        reject(new Error('版本包超过大小限制。'))
        return
      }
      chunks.push(chunk)
    }).on('error', reject).on('end', () => {
      const result = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(result)
    }).resume()
  })
}

export async function importRelease(file: File, source: { baseline: TemplateOrigin; kind: OfficialTemplateRelease['kind']; sourceUrl: string }): Promise<OfficialTemplateRelease> {
  if (file.size > maxPayload + 8192) throw new Error('版本包超过大小限制。')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const descriptor = zip.file('release.json')
  const asset = zip.file('payload.zip')
  const original = zip.file('original.docx')
  if (!descriptor || !asset || Object.values(zip.files).some(item => item.unsafeOriginalName && item.unsafeOriginalName !== item.name)) {
    throw new Error('请选择导出的官方模板版本包。')
  }
  const manifest = manifestSchema.parse(
    JSON.parse(new TextDecoder().decode(await readLimited(descriptor, 24 * 1024))))
  const { id, version, sha256, kind, payloadSha256, previewSha256, publishedAt, sourceName, originalSha256,
    manifestSha256, attachments, switchAcceptance, wordAcceptance } = manifest
  const supplemental = kind === 'word' ? (attachments ?? []).filter(item => item.role !== 'original') : []
  if (Object.keys(zip.files).length !== (original ? 3 : 2) + supplemental.length) throw new Error('官方版本包包含未登记的附件。')
  if (id !== source.baseline.id || kind !== source.kind || version === source.baseline.version) {
    throw new Error('版本包与当前模板目录项不匹配。')
  }
  const bytes = await readLimited(asset, kind === 'zip' ? maxPayload : 17 * 1024 * 1024)
  if (await templateDigest(bytes.buffer) !== payloadSha256 || (kind !== 'word' && sha256 !== payloadSha256)) {
    throw new Error('版本包内容校验失败。')
  }
  if (Boolean(original) !== Boolean(originalSha256) || original && (kind !== 'word' || originalSha256 !== sha256)) {
    throw new Error('版本包中的 Word 原件记录不一致。')
  }
  const wordBytes = original ? await readLimited(original, 16 * 1024 * 1024) : undefined
  if (wordBytes && await templateDigest(wordBytes.buffer) !== sha256) throw new Error('版本包中的 Word 原件校验失败。')
  const base = { id, version, sha256, previewSha256, publishedAt, sourceName, sourceUrl: source.sourceUrl,
    ...(manifestSha256 && { manifestSha256 }), ...(attachments && { attachments }), ...(switchAcceptance && { switchAcceptance }),
    ...(wordAcceptance && { wordAcceptance }) }
  const archive = new File([bytes], sourceName, { type: kind === 'word-import' ? 'application/vnd.rar' : 'application/zip' })
  if (kind !== 'word') {
    const release = { ...base, kind, archive } as OfficialTemplateRelease
    await validateReleaseAttachments(release)
    return release
  }
  const layout = await importWordTemplateArchive(archive)
  if (!layout || layout.origin?.id !== id || layout.origin.version !== version || layout.origin.sha256 !== sha256 || layout.origin.manifestSha256 !== manifestSha256) {
    throw new Error('Word 版式与版本包的来源记录不一致。')
  }
  const attachmentFiles: Partial<Record<AttachmentRole, Blob>> = {}
  let total = 0
  for (const item of supplemental) {
    const member = zip.file('attachment-' + item.role)
    if (!member) throw new Error('版本包缺少附件（' + item.role + '）。')
    const content = await readLimited(member, 16 * 1024 * 1024 - total)
    total += content.byteLength
    attachmentFiles[item.role] = new Blob([content])
  }
  const release = { ...base, kind, layout, ...(wordBytes && { original: new Blob([wordBytes]) }),
    ...(supplemental.length > 0 && { attachmentFiles }) }
  await validateReleaseAttachments(release)
  return release
}
