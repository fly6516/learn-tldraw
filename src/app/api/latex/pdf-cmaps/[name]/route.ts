import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  if (!/^[a-z0-9-]+\.bcmap$/i.test(name)) return new Response(null, { status: 404 })
  try {
    const bytes = await readFile(join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps', name))
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' },
    })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 })
    throw cause
  }
}
