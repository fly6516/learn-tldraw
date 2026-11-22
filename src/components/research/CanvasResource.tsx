'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { ImageIcon, Table2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import { latexBlockTitle, imageAttachment, type LatexBlock } from '@/lib/project/latex-blocks'
import type { ResearchNode } from '@/lib/project/research-graph'
import type { BibliographyEntry } from '@/lib/project/references'
import { renderLatexMath } from '@/lib/project/latex-math-preview'
import 'katex/dist/katex.min.css'

type NodeData = ResearchNode['data']
export const CanvasBlockContext = createContext<ReadonlyMap<NodeData, LatexBlock>>(new Map())
export const CanvasBibliographyContext = createContext<ReadonlyMap<NodeData, BibliographyEntry>>(new Map())

export function useCanvasBlock(data: NodeData) {
  return useContext(CanvasBlockContext).get(data)
}

function AttachmentImage({ blob, title }: { blob: Blob; title: string }) {
  const [source, setSource] = useState<{ blob: Blob; url: string }>()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    // Associate the URL with the Blob so replacement never renders the previous attachment.
    const frame = requestAnimationFrame(() => setSource({ blob, url }))
    return () => { cancelAnimationFrame(frame); URL.revokeObjectURL(url) }
  }, [blob])
  const url = source?.blob === blob ? source.url : undefined
  if (!url) return <p className="p-3 text-xs text-muted-foreground">Loading image…</p>
  return <>
    <button type="button" aria-label={`Enlarge ${title}`} className="nodrag nopan block w-full bg-muted/40 p-2" onClick={() => setOpen(true)}>
      {/* Blob URLs belong to this browser and bypass image optimization. */}
      {/* eslint-disable @next/next/no-img-element */}
      <img src={url} alt={title} className="mx-auto h-28 max-w-full object-contain" />
    </button>
    {open && <Dialog open onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-4xl">
        <DialogTitle className="break-words pr-6">{title}</DialogTitle>
        <img src={url} alt={title} className="mx-auto max-h-[72dvh] max-w-full object-contain" />
      </DialogContent>
    </Dialog>}
  </>
}

export function CanvasResource({ data, title }: { data: NodeData; title: string }) {
  const { fileSystem } = useProjectFileSystem()
  const block = useCanvasBlock(data)
  const reference = useContext(CanvasBibliographyContext).get(data)
  if (!data.resource) return null
  if (data.resource.kind === 'research') return null
  if (data.resource.kind === 'bibliography') return <div className="space-y-1 break-words border-b px-3 py-2 text-xs text-muted-foreground">
    {reference ? <>
      {reference.title !== title && <p>{reference.title}</p>}
      <p>{[reference.author, reference.year].filter(Boolean).join(' · ')}</p>
      <p className="break-all font-mono">{reference.key} · {reference.path}:{reference.line}</p>
    </> : <p role="status">Bibliography entry missing or ambiguous · {data.resource.key}</p>}
  </div>
  if (data.resource.kind === 'dataset' || data.resource.kind === 'attachment') {
    const path = data.resource.path
    const file = fileSystem?.files.get(path)
    const blob = file?.type !== 'directory' ? file?.blob : undefined
    const content = file?.type !== 'directory' ? file?.content : undefined
    return <div className="space-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
      <p className="break-all font-mono">{path}</p>
      {content !== undefined && data.resource.kind === 'dataset' && (
        <pre className="nodrag nopan nowheel max-h-20 overflow-auto whitespace-pre-wrap break-words">{content.slice(0, 360)}{content.length > 360 ? '…' : ''}</pre>
      )}
      {(blob || content !== undefined) ? <button type="button" className="nodrag nopan underline" onClick={() => {
        const url = URL.createObjectURL(blob ?? new Blob([content ?? ''], { type: 'text/plain' }))
        const link = document.createElement('a')
        link.href = url
        link.download = file!.name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>Download file</button> : <p role="status">Project file unavailable</p>}
    </div>
  }
  const path = data.resource.kind === 'image' ? (data.figureAnchor ? block?.imagePath : data.resource.path) : undefined
  const image = path ? fileSystem?.files.get(path) : undefined
  return <div className="space-y-1 border-b text-xs text-muted-foreground">
    {data.resource.kind === 'image' && (imageAttachment(image) ? <AttachmentImage blob={image.blob} title={title} />
      : <p className="flex items-center gap-2 px-3 pt-2"><ImageIcon className="size-4" />{data.figureAnchor && !block ? 'Figure source unavailable' : 'Image attachment unavailable'}</p>)}
    <div className="space-y-1 break-words px-3 py-2">
      {data.resource.kind === 'table' && <p className="flex items-center gap-2"><Table2 className="size-4" /> LaTeX table</p>}
      {block?.caption && <p className="line-clamp-3" title={latexBlockTitle(block)}>{latexBlockTitle(block)}</p>}
      {path && <p className="line-clamp-2 break-all font-mono" title={path}>{path}</p>}
      {'environment' in data.resource && (
        <p className="break-all font-mono">{block?.environment ?? data.resource.environment}</p>
      )}
      {block?.preview && <div className="nodrag nopan nowheel max-h-28 overflow-auto">
        {block.kind === 'equation'
          ? (block.equations ?? [{ source: block.preview, environment: block.environment }]).map((equation, index) => {
            const html = renderLatexMath(equation)
            return html ? <div key={index} dangerouslySetInnerHTML={{ __html: html }} />
              : <pre key={index} className="whitespace-pre-wrap break-words font-mono">{equation.source}</pre>
          })
          : <pre className="whitespace-pre-wrap break-words font-mono">{block.preview}</pre>}
      </div>}
      {(block?.label || data.figureAnchor?.label) && <p className="break-all font-mono">{block?.labels.join(', ') ?? data.figureAnchor?.label}</p>}
      {data.figureAnchor && !block && data.resource.kind !== 'image' && (
        <p role="status">{data.resource.kind === 'table' ? 'Table source unavailable' : 'Source location is unavailable'}</p>
      )}
    </div>
  </div>
}
