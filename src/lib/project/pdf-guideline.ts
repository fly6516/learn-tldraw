import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export type GuidelinePage = { page?: number; text: string }

const maxCharacters = 260_000
const maxPages = 180

export async function readGuidelinePdf(data: Buffer, requestSignal: AbortSignal): Promise<GuidelinePage[]> {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(30_000)])
  signal.throwIfAborted()
  const root = join(process.cwd(), 'node_modules', 'pdfjs-dist')
  // Keep the Node PDF.js entry point and its worker separate from the browser bundle.
  const modulePath = pathToFileURL(join(root, 'legacy', 'build', 'pdf.mjs')).href
  const { getDocument }: typeof import('pdfjs-dist/legacy/build/pdf.mjs') = await import(/* webpackIgnore: true */ modulePath)
  const task = getDocument({
    data: new Uint8Array(data), cMapUrl: join(root, 'cmaps') + sep, cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + sep, useWasm: false, isEvalSupported: false,
  })
  const cancel = () => { void task.destroy().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const pdf = await task.promise
    if (pdf.numPages > maxPages) throw new Error(`规范 PDF 最多支持 ${maxPages} 页。可上传包含排版要求的页面。`)
    const pages: GuidelinePage[] = []
    let characters = 0
    for (let n = 1; n <= pdf.numPages; n++) {
      signal.throwIfAborted()
      const page = await pdf.getPage(n)
      const { items } = await page.getTextContent()
      const text = items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : '') : '').join('')
      characters += text.length
      if (characters > maxCharacters) throw new Error('规范 PDF 文字超过读取限制。可上传包含排版要求的页面。')
      if (text.trim()) pages.push({ page: n, text })
      page.cleanup()
    }
    return pages
  } finally {
    signal.removeEventListener('abort', cancel)
    await task.destroy().catch(() => {})
  }
}
