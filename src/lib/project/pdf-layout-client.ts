import { getDocument, PDFWorker } from 'pdfjs-dist/build/pdf.min.mjs'
import type { PdfLayoutPage } from './layout-preflight'

const pageNumber = /^[-–—]?\s*(\d{1,5}|[IVXLCDM]{1,12}|[ivxlcdm]{1,12})\s*[-–—]?$/
const readNumber = (text: string) => pageNumber.exec(text.trim())?.[1]

export async function readPdfLayout(pdf: Blob, signal: AbortSignal, footerOffsetMm = 0, topMarginMm?: number): Promise<PdfLayoutPage[]> {
  const data = new Uint8Array(await pdf.arrayBuffer())
  signal.throwIfAborted()
  const thread = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
  const worker = PDFWorker.create({ port: thread })
  const task = getDocument({ data, worker, isEvalSupported: false, useWasm: false,
    cMapUrl: '/api/latex/pdf-cmaps/', cMapPacked: true })
  const cancel = () => { void task.destroy().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const doc = await task.promise
    const pages: PdfLayoutPage[] = []
    for (let number = 1; number <= doc.numPages; number++) {
      signal.throwIfAborted()
      const page = await doc.getPage(number)
      const viewport = page.getViewport({ scale: 1 })
      const { width, height } = viewport
      const { items } = await page.getTextContent()
      const text = items.flatMap(item => {
        if (!('str' in item) || !item.str.trim()) return []
        const { str, transform, width } = item
        const [x, y] = viewport.convertToViewportPoint(transform[4], transform[5])
        return [{ str, x, y, width }]
      })
      const footerBand = Math.max(height * 0.8, Math.min(height * 0.9, height - footerOffsetMm * 72 / 25.4 - 10))
      const foot = text.filter(item => item.y >= footerBand && item.x + item.width / 2 > width * 0.08
        && item.x + item.width / 2 < width * 0.92)
      const footLine = foot.length ? Math.max(...foot.map(item => item.y)) : -1
      const footerItems = foot.filter(item => Math.abs(item.y - footLine) < 3)
      const footer = readNumber(footerItems.map(item => item.str).join(' '))
      const footerCenter = footer && (Math.min(...footerItems.map(item => item.x))
        + Math.max(...footerItems.map(item => item.x + item.width))) / (2 * width)
      const footerPosition = typeof footerCenter === 'number' ? footerCenter < 0.42 ? 'left'
        : footerCenter > 0.58 ? 'right' : 'center' : undefined
      let toc = text.filter(item => item.y < height * 0.36).slice(0, 8)
        .some((item, index, leading) => /^(?:目\s*录|Table of Contents|Contents)$/i.test(item.str.trim())
          || item.str.trim() === '目' && leading[index + 1]?.str.trim() === '录')
      let links: PdfLayoutPage['links']
      // A continued TOC may have no title. Require multiple linked entries and
      // an observable Roman footer before treating a following page as such.
      const possibleContinuation = pages.at(-1)?.toc && footer && /^[ivxlcdm]+$/i.test(footer)
      if (toc || possibleContinuation) {
        links = []
        const linkedRows = new Set<number>()
        for (const annotation of await page.getAnnotations()) {
          if (annotation.subtype !== 'Link' || !annotation.dest) continue
          const [left, bottom, right, top] = annotation.rect as number[]
          const y = viewport.convertToViewportPoint((left + right) / 2, (bottom + top) / 2)[1]
          const entry = text.filter(item => Math.abs(item.y - y) < 8 && item.x > width * 0.60 && readNumber(item.str))
            .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y) || b.x - a.x)[0]
          const row = Math.round((entry?.y ?? y) / 4)
          if (linkedRows.has(row)) continue
          linkedRows.add(row)
          const explicit = typeof annotation.dest === 'string' ? await doc.getDestination(annotation.dest) : annotation.dest
          const ref = explicit?.[0]
          const target = typeof ref === 'number' ? ref + 1 : ref ? await doc.getPageIndex(ref).then(index => index + 1).catch(() => undefined) : undefined
          const printed = entry && readNumber(entry.str)
          const title = entry && text.filter(item => Math.abs(item.y - entry.y) < 3 && item.x < entry.x
            && !/^[.·⋅…\s]+$/.test(item.str)).map(item => item.str.trim()).join(' ').slice(0, 150)
          links.push({ printed, target, title })
        }
        const hasDottedLeader = (str: string) => /[.·⋅…]{2,}/.test(str.replace(/\s/g, ''))
        if (!toc) toc = links.filter(entry => entry.printed && entry.target !== undefined).length >= 2
          && text.some(item => hasDottedLeader(item.str))
        if (toc) {
          for (const item of text) {
            if (!hasDottedLeader(item.str) || [...linkedRows].some(row => Math.abs(row * 4 - item.y) < 5)) continue
            const printed = text.find(other => other.x > width * 0.60 && Math.abs(other.y - item.y) < 3 && readNumber(other.str))
            if (!printed) continue
            linkedRows.add(Math.round(item.y / 4))
            links.push({ printed: readNumber(printed.str) })
          }
        } else {
          links = undefined
        }
      }
      const header = topMarginMm === undefined ? undefined
        : text.filter(item => item.y < Math.min(height * 0.18, topMarginMm * 72 / 25.4))
          .map(item => item.str).join(' ')
      const bibliographyHeading = !toc && text.some(item => {
        if (!/^(?:参|References|Bibliography)/i.test(item.str.trim())) return false
        const line = text.filter(other => Math.abs(other.y - item.y) < 2)
          .sort((a, b) => a.x - b.x).map(other => other.str).join('').replace(/\s+/g, '')
        return /^(?:参考文献|References|Bibliography)$/i.test(line)
      })
      // Several overlapping rows of substantial text distinguish prose columns
      // from a running title, isolated captions or the text of a single row.
      const columnText = text.filter(item => item.y > height * 0.08 && item.y < height * 0.89
        && item.width >= width * 0.12 && item.str.trim().length >= 16)
      const left = columnText.filter(item => item.x + item.width < width * 0.51)
      const right = columnText.filter(item => item.x > width * 0.49)
      const matchedRows = new Set(left.filter(item => right.some(other => Math.abs(item.y - other.y) <= 7))
        .map(item => Math.round(item.y / 7)))
      const bodyInTwoColumns = !toc && matchedRows.size >= 5
      const figureCaption = text.some(item => /^Figure\s+\d+\s*[.:]/i.test(item.str.trim()))
      const tableCaption = text.some(item => /^Table\s+\d+\s*[.:]/i.test(item.str.trim()))
      const marginNumbers = new Set(text.filter(item => item.x + item.width < width * 0.14 &&
        item.y > height * 0.07 && item.y < height * 0.91 && /^\d{1,5}$/.test(item.str.trim())).map(item => Number(item.str)))
      const runningLineNumbers = [...marginNumbers].some(number => marginNumbers.has(number + 1) && marginNumbers.has(number + 2))
      pages.push({ width, height, runningLineNumbers, text: text.map(item => item.str).join(' '), footer, footerPosition, header, toc, links,
        bibliographyHeading, bodyInTwoColumns, figureCaption, tableCaption })
      page.cleanup()
    }
    return pages
  } finally {
    signal.removeEventListener('abort', cancel)
    await task.destroy().catch(() => {})
    worker.destroy()
    thread.terminate()
  }
}
