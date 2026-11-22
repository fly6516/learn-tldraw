'use client'

import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { searchCanvasNodes, type CanvasLocation } from '@/lib/project/canvas-search'
import type { CanvasSourceCatalog } from '@/lib/project/canvas-source-links'
import type { LatexBlock } from '@/lib/project/latex-blocks'
import type { SourceLocation } from '@/lib/project/latex-source'
import type { OutlineHeading } from '@/lib/project/outline'
import { indexSearchLinks, searchBibliography, type SearchSourceLink } from '@/lib/project/project-search'
import type { BibliographyEntry } from '@/lib/project/references'
import type { ResearchNode, ResearchPage } from '@/lib/project/research-graph'
import { searchProjectSources } from '@/lib/project/source-search'

type NodeData = ResearchNode['data']

function Result({ title, detail, preview, onActivate, children }: {
  title: string
  detail: string
  preview?: ReactNode
  onActivate: () => void
  children?: ReactNode
}) {
  return <li className="rounded border">
    <button type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onActivate}>
      <span className="block break-words text-sm font-semibold">{title}</span>
      <span className="block break-all text-xs text-muted-foreground">{detail}</span>
      {preview && <span className="mt-1 block break-words whitespace-pre-wrap text-xs">{preview}</span>}
    </button>
    {children && <div className="flex flex-wrap gap-1 px-2 pb-1">{children}</div>}
  </li>
}

function Highlight({ hit }: { hit: { before: string; match: string; after: string } }) {
  return <>{hit.before}<mark className="rounded-sm bg-amber-200 text-amber-950">{hit.match}</mark>{hit.after}</>
}

function Group({ name, count, limited, children }: { name: string; count: number; limited: boolean; children: ReactNode }) {
  return <section aria-label={name} className="space-y-2">
    <h3 className="text-sm font-semibold">{name} <span className="text-xs font-normal text-muted-foreground">{count}{limited ? '+' : ''}</span></h3>
    {count > 0 ? <ul className="space-y-1">{children}</ul> : <p className="text-xs text-muted-foreground">No matches.</p>}
  </section>
}

export function ProjectSearchDialog({ pages, catalog, blocks, bibliography, headings, links, onClose, onCanvas, onSource }: {
  pages: ResearchPage[]
  catalog?: CanvasSourceCatalog
  blocks: ReadonlyMap<NodeData, LatexBlock>
  bibliography: ReadonlyMap<NodeData, BibliographyEntry>
  headings: ReadonlyMap<NodeData, OutlineHeading>
  links: SearchSourceLink[]
  onClose: () => void
  onCanvas: (location: CanvasLocation) => void
  onSource: (location: SourceLocation) => void
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const ready = query.trim() === deferredQuery
  const indexedLinks = useMemo(() => indexSearchLinks(links), [links])
  const results = useMemo(() => ({
    canvas: searchCanvasNodes(pages, deferredQuery, blocks, bibliography, headings),
    sources: catalog && searchProjectSources(catalog.files, deferredQuery),
    bibliography: searchBibliography(catalog, deferredQuery),
  }), [pages, catalog, blocks, bibliography, headings, deferredQuery])

  function canvasActions(source: SourceLocation) {
    return indexedLinks.forSource(source).map(link => <Button key={link.nodeId} size="sm" variant="ghost"
      className="max-w-full"
      onClick={() => onCanvas(link)} title={`${link.title} · ${link.pageName}`}
      aria-label={`Locate ${link.title} on Canvas · ${link.pageName}`}>
      <span className="truncate">Canvas · {link.title}</span>
    </Button>)
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[85dvh] min-h-0 flex-col gap-3 sm:max-w-2xl">
      <DialogTitle>Project search</DialogTitle>
      <DialogDescription>Search Canvas cards, Writing files and the bibliography. Source results include local drafts.</DialogDescription>
      <Input aria-label="Search this project" type="search" maxLength={256} placeholder="Text, title, label, or citation key"
        value={query} onChange={event => setQuery(event.target.value)} />
      {query.trim() && <p role="status" className="text-xs text-muted-foreground">
        {!ready ? 'Searching…' : !catalog ? 'Indexing Writing sources…' : results.canvas.limited || results.sources?.limited || results.bibliography.limited
          ? 'Some groups show only the first matches. Refine your search to see more.' : 'Search results by type.'}
      </p>}
      {deferredQuery && ready && <div className="min-h-0 space-y-4 overflow-y-auto p-1">
        <Group name="Canvas cards" count={results.canvas.matches.length} limited={results.canvas.limited}>
          {results.canvas.matches.map(hit => {
            const linked = indexedLinks.byNode.get(hit.nodeId)
            return <Result key={hit.nodeId} title={hit.title} detail={hit.pageName} preview={<Highlight hit={hit} />} onActivate={() => onCanvas(hit)}>
              {linked && <Button size="sm" variant="ghost" onClick={() => onSource(linked.source)}>Open source</Button>}
            </Result>
          })}
        </Group>
        {results.sources && <Group name="Writing source" count={results.sources.matches.length} limited={results.sources.limited}>
          {results.sources.matches.map(hit => <Result key={JSON.stringify([hit.path, hit.start])}
            title={`${hit.name}:${hit.line}`} detail={hit.path} preview={<Highlight hit={hit} />} onActivate={() => onSource(hit)}>
            {canvasActions(hit)}
          </Result>)}
        </Group>}
        {catalog && <Group name="Bibliography" count={results.bibliography.matches.length} limited={results.bibliography.limited}>
          {results.bibliography.matches.map(entry => <Result key={JSON.stringify([entry.path, entry.start])}
            title={entry.title || entry.key} detail={`${entry.key} · ${entry.path}:${entry.line}`}
            preview={[entry.author, entry.year].filter(Boolean).join(' · ')} onActivate={() => onSource(entry)}>
            {canvasActions(entry)}
          </Result>)}
        </Group>}
      </div>}
    </DialogContent>
  </Dialog>
}
