'use client'

import { useState } from 'react'
import { Ellipsis, LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { RESEARCH_NODE_META } from '@/app/research/research-node'
import type { SourceLocation } from '@/lib/project/latex-source'
import type { OutlineHeading } from '@/lib/project/outline'
import type { CanvasLocation } from '@/lib/project/canvas-search'
import type { ResearchCanvas } from '@/lib/project/research-graph'
import { headingKey } from '@/lib/project/section-links'
import { latexBlockTitle, type LatexBlock } from '@/lib/project/latex-blocks'
import { latexBlockNames } from '@/lib/project/latex-block-kinds'

export interface OutlineCanvasActions {
  canvas: ResearchCanvas
  linked: (heading: OutlineHeading) => CanvasLocation | undefined
  canLink: (heading: OutlineHeading) => boolean
  canBindNode: (pageId: string, nodeId: string) => boolean
  onLocate: (location: CanvasLocation) => void
  onLink: (heading: OutlineHeading, pageId: string, nodeId?: string) => void
  linkedBlock: (block: LatexBlock) => CanvasLocation | undefined
  canLinkBlock: (block: LatexBlock) => boolean
  onLinkBlock: (block: LatexBlock, pageId: string) => void
}

type LinkRequest = { heading: OutlineHeading; mode: 'add' | 'bind' }

function LinkSectionDialog({ request, actions, onClose }: {
  request: LinkRequest
  actions: OutlineCanvasActions
  onClose: () => void
}) {
  const [pageId, setPageId] = useState(actions.canvas.activePageId)
  const [choice, setChoice] = useState('')
  const adding = request.mode === 'add'
  const groups = actions.canvas.pages.map(page => ({
    ...page, nodes: page.nodes.filter(node => actions.canBindNode(page.id, node.id)),
  })).filter(page => page.nodes.length)
  const [targetPage, targetNode] = choice ? JSON.parse(choice) as [string, string] : []
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent>
        <DialogTitle>{adding ? 'Add section to Canvas' : 'Bind section to a Canvas node'}</DialogTitle>
        <DialogDescription className="break-words">{request.heading.title} · {request.heading.path}</DialogDescription>
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault()
          if (adding) actions.onLink(request.heading, pageId)
          else if (targetPage && targetNode) actions.onLink(request.heading, targetPage, targetNode)
          onClose()
        }}>
          {adding ? <label className="grid min-w-0 gap-1 text-sm">Canvas page
            <select className="w-full rounded border bg-background p-2" value={pageId} onChange={event => setPageId(event.target.value)}>
              {actions.canvas.pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
            </select>
          </label> : groups.length ? <label className="grid min-w-0 gap-1 text-sm">Canvas node
            <select className="w-full rounded border bg-background p-2" value={choice} onChange={event => setChoice(event.target.value)}>
              <option value="" disabled>Choose a node</option>
              {groups.map(page => <optgroup key={page.id} label={page.name}>
                {page.nodes.map(node => <option key={node.id} value={JSON.stringify([page.id, node.id])}>
                  {node.data.customLabel?.trim() || RESEARCH_NODE_META[node.data.section].label} · {page.nodes.indexOf(node) + 1}
                </option>)}
              </optgroup>)}
            </select>
          </label> : <p className="text-sm text-muted-foreground">There are no available nodes. Add a node on the Canvas or create one from this section.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!adding && !choice}>{adding ? 'Add to Canvas' : 'Bind node'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HeadingList({ headings, onLocate, canvas, onLinkRequest }: {
  headings: OutlineHeading[]
  onLocate: (location: SourceLocation) => void
  canvas: OutlineCanvasActions
  onLinkRequest: (request: LinkRequest) => void
}) {
  return (
    <ul className="space-y-1">
      {headings.map((heading, index) => {
        const linked = canvas.linked(heading)
        const pageName = linked && canvas.canvas.pages.find(page => page.id === linked.pageId)?.name
        return (
          <li key={`${headingKey(heading)}:${index}`}>
            <div className="flex items-start gap-1">
              <button type="button" onClick={() => onLocate(heading)}
                className="block min-w-0 flex-1 rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span className="block break-words text-sm font-medium">{heading.title}</span>
                <span className="block break-all text-xs text-muted-foreground">
                  {heading.appendix ? 'Appendix · ' : ''}{heading.command} · {heading.path}:{heading.line}
                </span>
              </button>
              {linked ? <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0"
                title={`Locate on Canvas${pageName ? ` · ${pageName}` : ''}`} aria-label={`Locate ${heading.title} on Canvas`}
                onClick={() => canvas.onLocate(linked)}><LocateFixed /></Button>
                : canvas.canLink(heading) && <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0"
                      aria-label={`Canvas actions for ${heading.title}`} title="Canvas actions"><Ellipsis /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onLinkRequest({ heading, mode: 'add' })}>Add to Canvas</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onLinkRequest({ heading, mode: 'bind' })}>Bind to existing node</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>}
            </div>
            {heading.children.length > 0 && (
              <div className="ml-2 border-l pl-3">
                <HeadingList headings={heading.children} onLocate={onLocate} canvas={canvas} onLinkRequest={onLinkRequest} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function OutlinePanel({ headings, blocks, main, onLocate, canvas }: {
  headings: OutlineHeading[]
  blocks: LatexBlock[]
  main: string
  onLocate: (location: SourceLocation) => void
  canvas: OutlineCanvasActions
}) {
  const [request, setRequest] = useState<LinkRequest>()
  const [blockPage, setBlockPage] = useState<string>()
  const [onlyAppendix, setOnlyAppendix] = useState(false)
  const shownHeadings = onlyAppendix ? headings.filter(heading => heading.appendix) : headings
  const targetPage = canvas.canvas.pages.some(page => page.id === blockPage) ? blockPage! : canvas.canvas.activePageId
  return (
    <nav aria-label="Section outline" className="space-y-2 p-3">
      <h2 className="font-semibold">Section Outline</h2>
      <p className="break-all text-xs text-muted-foreground">{main}</p>
      {headings.some(heading => heading.appendix) && <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={onlyAppendix} onChange={event => setOnlyAppendix(event.target.checked)} />
        Appendix headings only
      </label>}
      {shownHeadings.length
        ? <HeadingList headings={shownHeadings} onLocate={onLocate} canvas={canvas} onLinkRequest={setRequest} />
        : <p className="text-sm text-muted-foreground">No LaTeX headings found in the selected document.</p>}
      {request && <LinkSectionDialog request={request} actions={canvas} onClose={() => setRequest(undefined)} />}
      {!onlyAppendix && blocks.length > 0 && <section aria-label="LaTeX blocks" className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-semibold">LaTeX blocks</h3>
        <label className="grid gap-1 text-xs">Canvas page for new cards
          <select className="min-w-0 rounded border bg-background p-1" value={targetPage} onChange={event => setBlockPage(event.target.value)}>
            {canvas.canvas.pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
          </select>
        </label>
        <ul className="space-y-2">
          {blocks.map(block => {
            const linked = canvas.linkedBlock(block)
            return <li className="rounded border p-2" key={`${block.path}:${block.start}`}>
              <button type="button" className="block w-full break-words text-left text-sm hover:underline" onClick={() => onLocate(block)}>{latexBlockTitle(block)}</button>
              <p className="break-all text-xs text-muted-foreground">{latexBlockNames[block.kind]} · {block.path}:{block.line}</p>
              {linked ? <Button variant="ghost" size="sm" onClick={() => canvas.onLocate(linked)}>Locate on Canvas</Button>
                : canvas.canLinkBlock(block)
                  ? <Button variant="ghost" size="sm" onClick={() => canvas.onLinkBlock(block, targetPage)}>Add to Canvas</Button>
                  : <p className="text-xs text-muted-foreground">Add a unique LaTeX label to link this block.</p>}
            </li>
          })}
        </ul>
      </section>}
    </nav>
  )
}
