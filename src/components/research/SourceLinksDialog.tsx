'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  sourceLinkIdentity, sourceLinkKey, sourceLinkNames, sourceLinkTargets,
  type CanvasSourceCatalog, type SourceLinkIssue, type SourceLinkTarget,
} from '@/lib/project/canvas-source-links'
import type { ResearchCanvas } from '@/lib/project/research-graph'

function issueKey(issue: SourceLinkIssue) {
  return JSON.stringify([issue.pageId, issue.nodeId, sourceLinkKey(issue.link)])
}

function targetKey(target: SourceLinkTarget) {
  return JSON.stringify([sourceLinkKey(target.link), target.location.path, target.location.start, target.title])
}

export function SourceLinksDialog({ canvas, catalog, issues, initialNode, onLocate, onRepair, onUndo, onClose }: {
  canvas: ResearchCanvas
  catalog?: CanvasSourceCatalog
  issues: SourceLinkIssue[]
  initialNode?: string
  onLocate: (issue: SourceLinkIssue) => void
  onRepair: (issue: SourceLinkIssue, target: SourceLinkTarget) => boolean
  onUndo: () => void
  onClose: () => void
}) {
  const initialIssue = initialNode && issues.find(issue => issue.nodeId === initialNode)
  const [editing, setEditing] = useState(initialIssue ? issueKey(initialIssue) : '')
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const issue = issues.find(item => issueKey(item) === editing)
  const targets = useMemo(() => issue && catalog ? sourceLinkTargets(canvas, catalog, issue) : [], [canvas, catalog, issue])
  const selected = targets.find(item => targetKey(item) === selection)
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const matches = targets.filter(target => {
    const text = [target.title, sourceLinkIdentity(target.link), target.location.path].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  })

  function edit(next: string) {
    setEditing(next)
    setQuery('')
    setSelection('')
    setMessage('')
    setError('')
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Source link check</DialogTitle>
        <DialogDescription>Check linked sections, LaTeX blocks and bibliography entries across all Canvas pages.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 space-y-3 overflow-y-auto p-1">
        {message && <div className="flex flex-wrap items-center gap-2 rounded border p-2">
          <p role="status" className="flex-1 text-sm">{message}</p>
          <Button size="sm" variant="outline" onClick={() => { onUndo(); edit('') }}>Undo repair</Button>
        </div>}
        {!catalog && <p role="status" className="text-sm text-muted-foreground">Indexing project sources…</p>}
        {catalog && !issues.length && <p role="status" className="text-sm">No missing or conflicting source links.</p>}
        {catalog && issues.length > 0 && !issue && <>
          <p role="status" className="text-sm font-medium">{issues.length} {issues.length === 1 ? 'link needs' : 'links need'} attention.</p>
          <ul className="space-y-2">
            {issues.map(item => <li key={issueKey(item)} className="space-y-2 rounded border p-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={'rounded px-1.5 py-0.5 text-xs font-medium ' + (item.resolution.status === 'conflict'
                  ? 'bg-amber-100 text-amber-950' : 'bg-red-100 text-red-950')}>
                  {item.resolution.status === 'conflict' ? 'Conflict' : 'Missing target'}
                </span>
                <span className="min-w-0 break-words text-sm font-medium">{item.title}</span>
              </div>
              <p className="break-all text-xs text-muted-foreground">
                {item.pageName} · {sourceLinkNames[item.link.type]} · {sourceLinkIdentity(item.link)}
              </p>
              {item.resolution.status === 'conflict' && item.resolution.locations.length > 0 &&
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Conflicting locations</summary>
                  <ul className="mt-1 space-y-1">
                    {item.resolution.locations.map(location => <li key={JSON.stringify([location.path, location.start])}
                      className="break-all font-mono">{location.path}:{location.line}</li>)}
                  </ul>
                </details>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => onLocate(item)}>Locate card</Button>
                <Button size="sm" variant="outline" onClick={() => edit(issueKey(item))}>Repair link</Button>
              </div>
            </li>)}
          </ul>
        </>}
        {issue && <>
          <div className="space-y-1">
            <h3 className="break-words text-sm font-semibold">{issue.title}</h3>
            <p className="break-all text-xs text-muted-foreground">
              {issue.pageName} · {sourceLinkNames[issue.link.type]} · {sourceLinkIdentity(issue.link)}
            </p>
          </div>
          <label className="grid gap-1 text-sm">Search replacement targets
            <Input type="search" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Title, label, citation key or path" />
          </label>
          {matches.length === 0 && <p className="text-sm text-muted-foreground">{targets.length
            ? 'No matching targets.' : 'No unambiguous targets are available. Check the current sources in Writing.'}</p>}
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {matches.slice(0, 50).map(target => <li key={targetKey(target)}>
              <button type="button" aria-pressed={selection === targetKey(target)}
                className="w-full rounded border px-2 py-1.5 text-left hover:bg-accent aria-pressed:border-primary aria-pressed:bg-accent"
                onClick={() => { setSelection(targetKey(target)); setError('') }}>
                <span className="block break-words text-sm">{target.title}</span>
                <span className="block break-all font-mono text-xs text-muted-foreground">
                  {target.location.path}:{target.location.line} · {sourceLinkIdentity(target.link)}
                </span>
              </button>
            </li>)}
          </ul>
          {matches.length > 50 && <p className="text-xs text-muted-foreground">Showing the first 50 matches. Refine your search to see more.</p>}
          {selected && <div className="space-y-1 rounded border bg-muted/40 p-2 text-sm">
            <p className="font-medium">Rebind to {selected.title}</p>
            <p className="break-all font-mono text-xs">{selected.location.path}:{selected.location.line}</p>
          </div>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </>}
      </div>
      {issue && <DialogFooter>
        <Button variant="outline" onClick={() => edit('')}>Back to issues</Button>
        <Button disabled={!selected} onClick={() => {
          if (!selected) return
          if (onRepair(issue, selected)) {
            edit('')
            setMessage('Source link repaired.')
          } else setError('The link or target changed. Choose a replacement again.')
        }}>Confirm repair</Button>
      </DialogFooter>}
    </DialogContent>
  </Dialog>
}
