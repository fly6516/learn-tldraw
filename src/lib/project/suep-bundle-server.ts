import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { chunksOf, officialResponse } from './official-template-fetch'
import { suepDocxMembers, suepMemberRoles, suepUndergraduateId, suepUndergraduateOrigin, suepUndergraduateSource,
  type SuepBundleManifest, type SuepBundlePin, type SuepBundleReceipt, type SuepMember } from './suep-undergraduate-source'
import { wordImportLimit } from './word-import'

const exec = promisify(execFile)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const rarSignature = Buffer.from('526172211a07', 'hex')
const docSignature = Buffer.from('d0cf11e0a1b11ae1', 'hex')
const docxSignature = Buffer.from('504b0304', 'hex')
const officialRar = suepUndergraduateSource.officialFiles[0].url
type Members = Record<SuepMember, Buffer>
type Bundle = SuepBundleReceipt & { rar: Buffer; members: Members }
type SavedBundle = { manifest: SuepBundleManifest; rar: string; members: Record<SuepMember, string> }

export function suepPin(version: unknown, sha256: unknown): SuepBundlePin {
  if (typeof version !== 'string' || !/^[a-z\d][a-z\d.-]{0,47}$/i.test(version) ||
      typeof sha256 !== 'string' || !/^[a-f\d]{64}$/.test(sha256) ||
      (version === suepUndergraduateOrigin.version) !== (sha256 === suepUndergraduateOrigin.sha256)) {
    throw new Error('上电官方附件的版本和 SHA-256 不匹配。')
  }
  return { id: suepUndergraduateId, version, sha256 }
}

function cachePath(pin: SuepBundlePin) {
  const directory = process.env.SUEP_TEMPLATE_CACHE_DIR || join(process.cwd(), '.cache', 'official-templates')
  return join(directory, pin.id, pin.version, pin.sha256 + '.json')
}

function verifyRar(rar: Buffer, pin: SuepBundlePin) {
  if (rar.length > wordImportLimit || !rar.subarray(0, rarSignature.length).equals(rarSignature) || hash(rar) !== pin.sha256) {
    throw new Error('上电官方附件包的 SHA-256 与所选版本不一致，或不是有效的 RAR。')
  }
}

function verifyMember(bytes: Buffer, role: SuepMember, sha256: string, baseline: boolean) {
  const signature = role === 'guide' ? docxSignature : docSignature
  if (!bytes.subarray(0, signature.length).equals(signature) || hash(bytes) !== sha256 ||
      baseline && sha256 !== suepDocxMembers[role].sha256) {
    throw new Error(suepDocxMembers[role].name + ' 的格式或 SHA-256 校验失败。')
  }
}

async function readCache(path: string, pin: SuepBundlePin): Promise<Bundle | undefined> {
  try {
    if ((await stat(path)).size > wordImportLimit * 3) return
    const saved = JSON.parse(await readFile(path, 'utf8')) as SavedBundle
    const { manifest } = saved
    if (manifest.id !== pin.id || manifest.version !== pin.version || manifest.sha256 !== pin.sha256 ||
        manifest.sourceUrl !== (pin.version === suepUndergraduateOrigin.version ? officialRar : suepUndergraduateSource.page)) return
    const rar = Buffer.from(saved.rar, 'base64')
    verifyRar(rar, pin)
    const members = {} as Members
    for (const role of suepMemberRoles) {
      const member = manifest.members[role]
      if (member.path.split('/').at(-1) !== suepDocxMembers[role].name) return
      members[role] = Buffer.from(saved.members[role], 'base64')
      verifyMember(members[role], role, member.sha256, pin.version === suepUndergraduateOrigin.version)
    }
    return { manifest, rar, members, status: 'cache' }
  } catch {
    return
  }
}

async function extract(rar: Buffer, pin: SuepBundlePin, signal: AbortSignal) {
  const work = await mkdtemp(join(tmpdir(), 'research-suep-'))
  try {
    const archive = join(work, 'official.rar')
    await writeFile(archive, rar)
    const tar = process.env.BSDTAR_BIN || 'bsdtar'
    const { stdout } = await exec(tar, ['-tf', archive], { signal, timeout: 15_000, maxBuffer: 256 * 1024 })
    const paths = stdout.split(/\r?\n/)
    const members = {} as Members
    const manifest: SuepBundleManifest = { ...pin, sourceUrl: pin.version === suepUndergraduateOrigin.version ? officialRar : suepUndergraduateSource.page,
      members: {} as SuepBundleManifest['members'] }
    let total = 0
    for (const role of suepMemberRoles) {
      const entry = suepDocxMembers[role]
      const matching = paths.filter(path => path.split('/').at(-1) === entry.name)
      const path = matching[0]
      if (matching.length !== 1 || path.startsWith('/') || /[\\*?\[\]]/.test(path) || path.split('/').includes('..')) {
        throw new Error('上电 RAR 缺少唯一可识别的附件：' + entry.name)
      }
      const { stdout: bytes } = await exec(tar, ['-xOf', archive, '--', path],
        { signal, encoding: 'buffer', timeout: 15_000, maxBuffer: wordImportLimit })
      total += bytes.length
      if (total > wordImportLimit) throw new Error('上电官方附件解包后超过 16 MB。')
      const sha256 = hash(bytes)
      verifyMember(bytes, role, sha256, pin.version === suepUndergraduateOrigin.version)
      members[role] = bytes
      manifest.members[role] = { path, sha256 }
    }
    return { manifest, rar, members }
  } finally { await rm(work, { recursive: true, force: true }) }
}

export async function loadSuepBundle(pin: SuepBundlePin, opts: { signal: AbortSignal; upload?: Blob }): Promise<Bundle> {
  suepPin(pin.version, pin.sha256)
  const path = cachePath(pin)
  if (opts.upload && opts.upload.size > wordImportLimit) throw new Error('上电官方附件包不得超过 16 MB。')
  const supplied = opts.upload && Buffer.from(await opts.upload.arrayBuffer())
  if (supplied) verifyRar(supplied, pin)
  const cached = await readCache(path, pin)
  if (cached) return cached
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(35_000)])
  let rar = supplied
  if (!rar) {
    if (pin.version !== suepUndergraduateOrigin.version) throw new Error('本机缺少所选发布版的附件包。请导入该版本包或手动上传对应的官方 RAR。')
    const parts: Uint8Array[] = []
    let size = 0
    for await (const chunk of chunksOf(await officialResponse(new URL(officialRar), signal))) {
      size += chunk.length
      if (size > wordImportLimit) throw new Error('上电官方附件包超过 16 MB。')
      parts.push(chunk)
    }
    rar = Buffer.concat(parts, size)
    verifyRar(rar, pin)
  }
  const bundle = await extract(rar, pin, signal)
  signal.throwIfAborted()
  const saved: SavedBundle = { manifest: bundle.manifest, rar: rar.toString('base64'), members: {} as SavedBundle['members'] }
  for (const role of suepMemberRoles) saved.members[role] = bundle.members[role].toString('base64')
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(saved), { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
  return { ...bundle, status: supplied ? 'upload' : 'download' }
}
