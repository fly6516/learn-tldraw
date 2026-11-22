'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { checkCitations, type BibliographyEntry, type ReferenceLocation } from '@/lib/project/references'
import type { ProjectFileSystem } from '@/lib/project/types'

export function ReferencesPanel({ project, entries, path, draft, canInsert, onInsert, onLocate, canvasAction }: {
  project: ProjectFileSystem
  entries: BibliographyEntry[]
  path: string
  draft: string
  canInsert: boolean
  onInsert: (key: string) => void
  onLocate: (location: ReferenceLocation) => void
  canvasAction: (entry: BibliographyEntry) => { label: string; run: () => void } | undefined
}) {
  const [query, setQuery] = useState('')
  const issues = useMemo(() => checkCitations(project, entries, { path, source: draft }), [project, entries, path, draft])
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const matches = entries.filter(entry => {
    const haystack = [entry.key, entry.title, entry.author, entry.year].join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  })
  return (
    <section aria-label="References" className="space-y-4 p-3">
      <div className="space-y-2">
        <label htmlFor="reference-search" className="font-semibold">Search bibliography</label>
        <Input id="reference-search" placeholder="Key, title, author, or year" value={query}
          onChange={event => setQuery(event.target.value)} />
        {!matches.length && <p className="text-sm text-muted-foreground">{entries.length ? 'No matching entries.' : 'No bibliography entries found.'}</p>}
        <ul className="divide-y">
          {matches.slice(0, 50).map(entry => {
            const action = canvasAction(entry)
            return (
            <li key={`${entry.path}:${entry.start}`} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0 text-sm">
                <p className="break-words font-medium">{entry.title || entry.key}</p>
                <p className="break-words text-muted-foreground">{[entry.author, entry.year].filter(Boolean).join(' · ')}</p>
                <button type="button" className="break-all text-left underline" onClick={() => onLocate(entry)}>
                  {entry.key} · {entry.path}:{entry.line}
                </button>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Button size="sm" variant="outline" aria-label={`Insert citation for ${entry.key}`}
                  disabled={!canInsert} onClick={() => onInsert(entry.key)}>Insert</Button>
                {action && <Button size="sm" variant="ghost" onClick={action.run}>{action.label}</Button>}
              </div>
            </li>
            )
          })}
        </ul>
        {matches.length > 50 && <p className="text-sm text-muted-foreground">Showing the first 50 matches. Refine your search to see more.</p>}
      </div>
      <div className="space-y-2 border-t pt-3">
        <h2 className="font-semibold">Citation issues</h2>
        {!issues.length && <p role="status" className="text-sm text-muted-foreground">No missing or duplicate citation keys.</p>}
        <ul className="space-y-2">
          {issues.map(issue => (
            <li key={`${issue.kind}:${issue.path}:${issue.start}`}>
              <button type="button" className="block max-w-full break-all text-left text-sm underline"
                onClick={() => onLocate(issue)}>
                {issue.kind === 'missing' ? 'Missing key' : 'Duplicate key'} {issue.key} · {issue.path}:{issue.line}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
