import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chunksOf, officialResponse } from './official-template-fetch'
import type { OfficialAttachment } from './official-attachments'
import { wordImportLimit } from './word-import'

export function verifyOfficialAttachmentBytes(bytes: Buffer, item: OfficialAttachment) {
  const signature = bytes.subarray(0, 8).toString('hex')
  if (item.role === 'guideline' ? !signature.startsWith('255044462d')
    : !signature.startsWith('504b0304') && signature !== 'd0cf11e0a1b11ae1') {
    throw new Error('官方附件格式校验失败（' + item.role + '）。')
  }
  if (bytes.length > wordImportLimit || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    throw new Error('官方附件 SHA-256 校验失败（' + item.role + '）。')
  }
}

export async function cachedOfficialAttachment(item: OfficialAttachment, signal: AbortSignal) {
  const directory = process.env.OFFICIAL_ATTACHMENT_CACHE_DIR || join(process.cwd(), '.cache', 'official-templates', 'attachments')
  const path = join(directory, item.sha256.slice(0, 2), item.sha256)
  try {
    if ((await stat(path)).size <= wordImportLimit) {
      const bytes = await readFile(path)
      verifyOfficialAttachmentBytes(bytes, item)
      return { bytes, status: 'cache' as const }
    }
  } catch { /* Misses and damaged entries use the pinned source. */ }
  const parts: Uint8Array[] = []
  let length = 0
  for await (const chunk of chunksOf(await officialResponse(new URL(item.url), signal))) {
    length += chunk.byteLength
    if (length > wordImportLimit) throw new Error('官方附件超过 16 MB。')
    parts.push(chunk)
  }
  const bytes = Buffer.concat(parts, length)
  verifyOfficialAttachmentBytes(bytes, item)
  signal.throwIfAborted()
  await mkdir(dirname(path), { recursive: true })
  const intermediate = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(intermediate, bytes, { flag: 'wx', mode: 0o600 })
    await rename(intermediate, path)
  } finally { await rm(intermediate, { force: true }) }
  return { bytes, status: 'download' as const }
}
