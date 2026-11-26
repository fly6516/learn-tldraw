import { loadSuepBundle, suepPin } from '@/lib/project/suep-bundle-server'
import { chunksOf } from '@/lib/project/official-template-fetch'
import { wordImportLimit } from '@/lib/project/word-import'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const host = request.headers.get('host') ?? ''
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || request.headers.get('origin') !== `http://${host}`) {
    return Response.json({ error: '请从本机工作台获取上电官方原件。' }, { status: 403 })
  }
  const params = new URL(request.url).searchParams
  try {
    const pin = suepPin(params.get('version'), params.get('sha256'))
    const size = Number(request.headers.get('content-length'))
    if (size > wordImportLimit) return Response.json({ error: '官方附件包不得超过 16 MB。' }, { status: 413 })
    const parts: Uint8Array[] = []
    let bytes = 0
    if (request.body) for await (const chunk of chunksOf(request.body)) {
      bytes += chunk.length
      if (bytes > wordImportLimit) return Response.json({ error: '官方附件包不得超过 16 MB。' }, { status: 413 })
      parts.push(chunk)
    }
    const upload = bytes ? new Blob([new Uint8Array(Buffer.concat(parts, bytes))]) : undefined
    const { manifest, status } = await loadSuepBundle(pin, { signal: request.signal, upload })
    return Response.json({ manifest, status }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : '无法获取上电官方附件。' }, { status: 422 })
  }
}
