export async function* chunksOf(stream: ReadableStream<Uint8Array>) {
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

export async function officialResponse(url: URL, signal: AbortSignal, redirectHosts: readonly string[] = []) {
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
