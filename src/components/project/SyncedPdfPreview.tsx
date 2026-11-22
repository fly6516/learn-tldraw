'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Minus, Plus } from 'lucide-react'
// The minified distribution avoids a collision between Webpack's export variables
// and the export variables embedded in the unminified PDF.js bundle.
import { getDocument, PDFWorker, TextLayer } from 'pdfjs-dist/build/pdf.min.mjs'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'
import { Button } from '@/components/ui/button'
import { findSourceRegion, type SyncRegion } from '@/lib/project/source-sync'
import styles from './SyncedPdfPreview.module.css'

export function SyncedPdfPreview({ url, page, onPage, regions, target, onLocate }: {
  url: string
  page: number
  onPage: (page: number) => void
  regions: SyncRegion[]
  target: SyncRegion | null
  onLocate: (location: SyncRegion | undefined) => void
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [pdfPage, setPdfPage] = useState<PDFPageProxy>()
  const [renderedPage, setRenderedPage] = useState(0)
  const [error, setError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const highlight = useRef<HTMLDivElement>(null)
  const pageView = useRef<PageViewport>(null)
  const total = pdf?.numPages ?? 0
  const loading = renderedPage !== page && !error
  const viewport = useMemo(() => {
    if (pdfPage?.pageNumber !== page || !width) return
    const base = pdfPage.getViewport({ scale: 1 })
    return pdfPage.getViewport({ scale: width / base.width * zoom })
  }, [page, pdfPage, width, zoom])

  useEffect(() => {
    const node = scroll.current
    if (!node) return
    const resize = new ResizeObserver(entries => setWidth(Math.max(1, entries[0].contentRect.width)))
    resize.observe(node)
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    let active = true
    const thread = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
    const failed = () => { if (active) setError('PDF preview could not be loaded. Use Download PDF to open it.') }
    thread.addEventListener('error', failed)
    const worker = PDFWorker.create({ port: thread })
    const task = getDocument({ url, worker, isEvalSupported: false, useWasm: false })
    task.promise.then(document => { if (active) setPdf(document) })
      .catch(failed)
    return () => {
      active = false
      thread.removeEventListener('error', failed)
      void task.destroy().catch(() => {}).finally(() => { worker.destroy(); thread.terminate() })
    }
  }, [url])

  useEffect(() => {
    if (!pdf) return
    let active = true
    const validPage = Math.min(page, pdf.numPages)
    pdf.getPage(validPage).then(source => {
      if (!active) return
      if (validPage !== page) onPage(validPage)
      setPdfPage(source)
    })
      .catch(() => { if (active) setError('This PDF page could not be loaded.') })
    return () => { active = false }
  }, [pdf, page, onPage])

  useEffect(() => {
    const surface = canvas.current
    const container = text.current
    if (!pdfPage || !viewport || !surface || !container) return
    const view = viewport
    const ratio = Math.min(window.devicePixelRatio || 1, 2, 2400 / Math.max(view.width, view.height))
    surface.width = Math.max(1, Math.ceil(view.width * ratio))
    surface.height = Math.max(1, Math.ceil(view.height * ratio))
    const drawing = pdfPage.render({ canvas: surface, viewport: view, transform: [ratio, 0, 0, ratio, 0, 0] })
    const textLayer = new TextLayer({ textContentSource: pdfPage.streamTextContent(), container, viewport: view })
    let active = true
    textLayer.render().catch(() => {})
    drawing.promise.then(() => {
      if (!active) return
      pageView.current = view
      setRenderedPage(pdfPage.pageNumber)
    }).catch(() => { if (active) setError('This PDF page could not be rendered.') })
    return () => {
      active = false
      pageView.current = null
      drawing.cancel()
      textLayer.cancel()
      container.replaceChildren()
    }
  }, [pdfPage, viewport])

  useEffect(() => {
    if (target && !loading) highlight.current?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [target, loading, viewport])

  function changePage(next: number) {
    setError('')
    scroll.current?.scrollTo({ top: 0, left: 0 })
    onPage(next)
  }

  const box = target && target.page === page && viewport
    ? viewport.convertToViewportRectangle([
      viewport.viewBox[0] + target.x, viewport.viewBox[3] - target.y,
      viewport.viewBox[0] + target.x + target.width, viewport.viewBox[3] - target.y - target.height,
    ]) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-white px-2 py-1">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Previous PDF page" disabled={page <= 1 || loading} onClick={() => changePage(page - 1)}><ArrowLeft /></Button>
          <span className="min-w-12 text-center text-xs tabular-nums text-slate-600" aria-live="polite">Page {page} of {total || '–'}</span>
          <Button size="icon-sm" variant="ghost" aria-label="Next PDF page" disabled={page >= total || loading} onClick={() => changePage(page + 1)}><ArrowRight /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out PDF" disabled={zoom <= 0.75} onClick={() => setZoom(value => value - 0.25)}><Minus /></Button>
          <Button size="sm" variant="ghost" aria-label="Fit PDF to width" onClick={() => setZoom(1)}>{zoom === 1 ? 'Fit width' : `${zoom * 100}%`}</Button>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in PDF" disabled={zoom >= 2} onClick={() => setZoom(value => value + 0.25)}><Plus /></Button>
        </div>
      </div>
      <div ref={scroll} className="relative min-h-0 flex-1 overflow-auto bg-slate-200 p-3">
        {(error || loading) && <p role={error ? 'alert' : 'status'} className="p-3 text-sm text-slate-600">{error || 'Loading PDF page…'}</p>}
        <div aria-label={`Compiled PDF, page ${page}`} role="region" className="relative mx-auto bg-white shadow-sm"
          style={{ width: viewport?.width ?? 0, height: viewport?.height ?? 0, '--total-scale-factor': viewport?.scale ?? 1 } as CSSProperties}
          onClick={event => {
            const view = pageView.current
            if (!view || !regions.length || !window.getSelection()?.isCollapsed) return
            const rect = event.currentTarget.getBoundingClientRect()
            const [x, y] = view.convertToPdfPoint(event.clientX - rect.left, event.clientY - rect.top)
            onLocate(findSourceRegion(regions, page, x - view.viewBox[0], view.viewBox[3] - y))
          }}>
          <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
          <div ref={text} className={`${styles.text} ${regions.length ? 'cursor-crosshair' : ''}`} />
          {box && <div ref={highlight} aria-hidden className="pointer-events-none absolute z-10 rounded-sm border border-indigo-600 bg-indigo-400/25"
            style={{ left: Math.min(box[0], box[2]), top: Math.min(box[1], box[3]), width: Math.abs(box[2] - box[0]), height: Math.abs(box[3] - box[1]) }} />}
        </div>
      </div>
    </div>
  )
}
