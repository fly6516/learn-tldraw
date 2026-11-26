import { createHash } from 'node:crypto'
import { catalogReleaseSource, templateCatalog } from '@/lib/project/template-catalog'
import { wordImportLimit } from '@/lib/project/word-import'

export const runtime = 'nodejs'

async function* chunksOf(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  let done = false
  try {
    while (!done) {
      const result = await reader.read()
      done = result.done
      if (!result.done) yield result.value
    }
  } finally {
    if (!done) await reader.cancel()
    reader.releaseLock()
  }
}

async function officialResponse(url: URL, signal: AbortSignal, redirectHosts: readonly string[] = []) {
  const hosts = new Set([url.hostname, ...redirectHosts])
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password) break
    const response = await fetch(url, { redirect: 'manual', signal, cache: 'no-store' })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      url = new URL(location, url)
      continue
    }
    if (response.ok && response.body) return response.body
    await response.body?.cancel()
    break
  }
  throw new Error('官方站点暂时无法读取。')
}

export async function POST(request: Request) {
  const host = request.headers.get('host') ?? ''
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || request.headers.get('origin') !== `http://${host}`) {
    return Response.json({ error: '请从本机工作台获取官方原件。' }, { status: 403 })
  }
  const params = new URL(request.url).searchParams
  const id = params.get('id')
  const expected = params.get('sha256')
  const asset = params.get('asset')
  const entry = templateCatalog.find(item => item.id === id)
  const source = entry && catalogReleaseSource(entry)
  if (!source) return Response.json({ error: '该模板尚无可检查的来源。' }, { status: 404 })
  if (expected !== null && !/^[a-f\d]{64}$/.test(expected)) {
    return Response.json({ error: '请求缺少有效的 SHA-256。' }, { status: 400 })
  }
  const guideline = asset === 'guideline' && source.kind === 'word' ? source.guideline : undefined
  const declaration = asset === 'declaration' && source.kind === 'word' ? source.declaration : undefined
  const blindCover = asset === 'blind-cover' && source.kind === 'word' ? source.blindCover : undefined
  const attachment = guideline ?? declaration ?? blindCover
  if (asset !== null && (!attachment || expected !== attachment.sha256)) {
    return Response.json({ error: '所选模板未登记此校验值的官方附件。' }, { status: 400 })
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
  try {
    const pinnedUrl = source.kind === 'zip' && expected === source.baseline.sha256 ? source.pinnedUrl : undefined
    let url = new URL(attachment?.url ?? pinnedUrl ?? source.url)
    if (!attachment && source.updateLink && expected !== source.baseline.sha256) {
      const page = new URL(source.sourceUrl)
      const stream = await officialResponse(page, signal)
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of chunksOf(stream)) {
        size += chunk.byteLength
        if (size > 1024 * 1024) throw new Error('发布页超过大小限制。')
        chunks.push(chunk)
      }
      const html = Buffer.concat(chunks).toString('utf8')
      const anchor = new RegExp(source.updateLink)
      const matches = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]*)<\/a>/gi)]
        .filter(match => anchor.test(match[2]))
      if (matches.length !== 1) throw new Error('发布页上的模板链接已变动，请查看官方发布页。')
      url = new URL(matches[0][1], page)
      if (url.origin !== page.origin || !/^\/(?:_upload\/article\/files|static\/upload\/article\/file)\/.+\.docx?$/i.test(url.pathname)) {
        throw new Error('发布页上的附件地址已变动，请查看官方发布页。')
      }
    }
    const stream = await officialResponse(url, signal, source.kind === 'zip' ? source.redirectHosts : undefined)
    const hash = createHash('sha256')
    const magic = Buffer.alloc(8)
    const limit = source.kind === 'word' && expected ? wordImportLimit : 128 * 1024 * 1024
    const file: Uint8Array[] = []
    let size = 0
    for await (const chunk of chunksOf(stream)) {
      if (size < magic.length) magic.set(chunk.subarray(0, magic.length - size), size)
      size += chunk.byteLength
      if (size > limit) return Response.json({ error: '官方原件超过大小限制。' }, { status: 413 })
      hash.update(chunk)
      if (expected) file.push(chunk)
    }
    const signature = magic.toString('hex')
    const isTemplate = guideline ? signature.startsWith('255044462d') // %PDF-
      : signature.startsWith('504b0304') || source.kind === 'word' && signature === 'd0cf11e0a1b11ae1'
    if (!isTemplate) {
      return Response.json({ error: '官方原件校验失败，发布方返回了非模板文件。请查看发布页。' }, { status: 422 })
    }
    const sha256 = hash.digest('hex')
    if (!expected) return Response.json({ sha256, url: url.href, scope: source.updateLink ? 'listing' : 'file',
      matchesBaseline: sha256 === source.baseline.sha256 || source.kind === 'zip' && sha256 === source.equivalentBranchSha256 })
    if (sha256 !== expected) {
      return Response.json({ error: '官方原件 SHA-256 校验失败，文件已与所选版本或检查结果不同。请重新检查更新，或上传对应版本的原件。' }, { status: 409 })
    }
    const suffix = guideline ? '-guidelines.pdf' : source.kind === 'zip' ? '.zip' : signature.startsWith('504b0304') ? '.docx' : '.doc'
    return new Response(new Uint8Array(Buffer.concat(file, size)), { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + source.baseline.id + suffix + '"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    return Response.json({ error: signal.aborted ? '获取官方原件超时。请重试或手动上传原件。' :
      error instanceof Error && !(error instanceof TypeError) ? error.message : '官方站点暂时无法读取。' }, { status: 502 })
  }
}
