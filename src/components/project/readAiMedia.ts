import type { AiMedia } from '@/lib/project/ai-media'

export async function readAiMedia(path: string, blob: Blob, page: number): Promise<AiMedia> {
  if (/\.pdf$/i.test(path)) {
    if (blob.size > 16 * 1024 * 1024) throw new Error('Choose a PDF smaller than 16 MB.')
    const { getDocument, PDFWorker } = await import('pdfjs-dist/build/pdf.min.mjs')
    const thread = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
    const worker = PDFWorker.create({ port: thread })
    const task = getDocument({ data: await blob.arrayBuffer(), worker, isEvalSupported: false, useWasm: false,
      cMapUrl: '/api/latex/pdf-cmaps/', cMapPacked: true })
    try {
      const pdf = await task.promise
      if (!Number.isInteger(page) || page < 1 || page > pdf.numPages) throw new Error('Choose a PDF page from 1 to ' + pdf.numPages + '.')
      const content = await (await pdf.getPage(page)).getTextContent()
      const text = content.items.flatMap(item => 'str' in item ? [item.str + (item.hasEOL ? '\n' : ' ')] : [])
        .join('').trim().slice(0, 8000)
      if (!text) throw new Error('This page has no selectable text. Share a PNG or JPEG of the page if you can inspect it visually.')
      return { kind: 'pdf_page', path, page, text }
    } finally {
      await task.destroy().catch(() => {})
      worker.destroy()
      thread.terminate()
    }
  }
  if (blob.size > 650 * 1024 || !/\.(png|jpe?g)$/i.test(path)) throw new Error('Choose a PNG or JPEG smaller than 650 KB.')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!png && !jpeg) throw new Error('The attachment is not a PNG or JPEG image.')
  const pieces: string[] = []
  for (let index = 0; index < bytes.length; index += 8192) pieces.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
  return { kind: 'image', path, mediaType: png ? 'image/png' : 'image/jpeg', data: btoa(pieces.join('')) }
}
