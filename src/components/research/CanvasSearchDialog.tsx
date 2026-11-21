'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { canvasSearchLimit, searchCanvasNodes, type CanvasLocation } from '@/lib/project/canvas-search'
import type { ResearchPage } from '@/lib/project/research-graph'

export function CanvasSearchDialog({ pages, onOpenChange, onLocate }: {
  pages: ResearchPage[]
  onOpenChange: (open: boolean) => void
  onLocate: (location: CanvasLocation) => void
}) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const { matches, limited } = useMemo(() => searchCanvasNodes(pages, deferredQuery), [pages, deferredQuery])
  const searching = deferredQuery !== query
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] min-h-0 flex-col gap-3">
        <DialogTitle>Search canvas</DialogTitle>
        <DialogDescription>Find nodes across all canvas pages.</DialogDescription>
        <Input aria-label="Search canvas nodes" type="search" maxLength={256} placeholder="Title, content, or tag"
          value={query} onChange={event => setQuery(event.target.value)} />
        {query.trim() && <p role="status" className="text-xs text-muted-foreground">
          {searching ? 'Searching…' : limited ? `Showing first ${canvasSearchLimit} matches. Refine your search to see more.`
            : `${matches.length} ${matches.length === 1 ? 'node' : 'nodes'}`}
        </p>}
        {!searching && matches.length > 0 && (
          <ul aria-label="Matching canvas nodes" className="min-h-0 space-y-1 overflow-auto p-1">
            {matches.map(hit => (
              <li key={JSON.stringify([hit.pageId, hit.nodeId])}>
                <button type="button" onClick={() => onLocate(hit)}
                  className="block w-full rounded-md border px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block text-sm font-semibold [overflow-wrap:anywhere]">{hit.title}</span>
                  <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{hit.pageName}</span>
                  <span className="mt-1 block text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {hit.before}<mark className="rounded-sm bg-amber-200 text-amber-950">{hit.match}</mark>{hit.after}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
