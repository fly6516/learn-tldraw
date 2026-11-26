import JSZip, { type JSZipObject, type JSZipStreamHelper } from 'jszip'
import { z } from 'zod'
import { templateDigest } from './paper-templates'
import type { OfficialTemplateRelease, TemplateOrigin } from './template-release'
import { importWordTemplateArchive } from './word-conversion-client'

const maxPayload = 128 * 1024 * 1024
const digest = z.string().regex(/^[a-f\d]{64}$/)
const manifestSchema = z.object({
  format: z.literal('official-template-release-v1'),
  id: z.string().min(1).max(80),
  kind: z.enum(['word', 'zip']),
  version: z.string().regex(/^[a-z\d][a-z\d.\-]{0,47}$/i),
  sha256: digest,
  payloadSha256: digest,
  originalSha256: digest.optional(),
  previewSha256: digest,
  publishedAt: z.string().datetime(),
  sourceName: z.string().min(1).max(255).regex(/^[^/\\\p{Cc}]+$/u),
}).strict()

export async function exportRelease(release: OfficialTemplateRelease) {
  const zip = new JSZip()
  const payload = await (release.kind === 'word' ? release.layout.archive : release.archive).arrayBuffer()
  const { id, kind, version, sha256, previewSha256, publishedAt, sourceName } = release
  const original = release.kind === 'word' && release.original ? await release.original.arrayBuffer() : undefined
  const originalSha256 = original && await templateDigest(original)
  if (originalSha256 && originalSha256 !== sha256) throw new Error('Word 原件校验失败。')
  const manifest = manifestSchema.parse({ format: 'official-template-release-v1', id, kind, version, sha256,
    previewSha256, publishedAt, sourceName, payloadSha256: await templateDigest(payload), originalSha256 })
  zip.file('release.json', JSON.stringify(manifest, null, 2))
  zip.file('payload.zip', payload)
  if (original) zip.file('original.docx', original)
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

export async function importRelease(file: File, source: { baseline: TemplateOrigin; kind: 'word' | 'zip'; sourceUrl: string }): Promise<OfficialTemplateRelease> {
  if (file.size > maxPayload + 8192) throw new Error('版本包超过大小限制。')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const descriptor = zip.file('release.json')
  const asset = zip.file('payload.zip')
  const original = zip.file('original.docx')
  if (!descriptor || !asset || Object.keys(zip.files).length !== (original ? 3 : 2)
      || [descriptor, asset, original].some(item => item?.unsafeOriginalName && item.unsafeOriginalName !== item.name)) {
    throw new Error('请选择导出的官方模板版本包。')
  }
  const manifest = manifestSchema.parse(
    JSON.parse(new TextDecoder().decode(await readLimited(descriptor, 4096))))
  const { id, version, sha256, kind, payloadSha256, previewSha256, publishedAt, sourceName, originalSha256 } = manifest
  if (id !== source.baseline.id || kind !== source.kind || version === source.baseline.version) {
    throw new Error('版本包与当前模板目录项不匹配。')
  }
  const bytes = await readLimited(asset, kind === 'word' ? 17 * 1024 * 1024 : maxPayload)
  if (await templateDigest(bytes.buffer) !== payloadSha256 || (kind === 'zip' && sha256 !== payloadSha256)) {
    throw new Error('版本包内容校验失败。')
  }
  if (Boolean(original) !== Boolean(originalSha256) || original && (kind !== 'word' || originalSha256 !== sha256)) {
    throw new Error('版本包中的 Word 原件记录不一致。')
  }
  const wordBytes = original ? await readLimited(original, 16 * 1024 * 1024) : undefined
  if (wordBytes && await templateDigest(wordBytes.buffer) !== sha256) throw new Error('版本包中的 Word 原件校验失败。')
  const base = { id, version, sha256, previewSha256, publishedAt, sourceName, sourceUrl: source.sourceUrl }
  const archive = new File([bytes], sourceName, { type: 'application/zip' })
  if (kind === 'zip') return { ...base, kind, archive }
  const layout = await importWordTemplateArchive(archive)
  if (!layout || layout.origin?.id !== id || layout.origin.version !== version || layout.origin.sha256 !== sha256) {
    throw new Error('Word 版式与版本包的来源记录不一致。')
  }
  return { ...base, kind, layout, ...(wordBytes && { original: new Blob([wordBytes]) }) }
}
