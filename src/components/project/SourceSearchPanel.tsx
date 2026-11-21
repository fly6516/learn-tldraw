'use client'

import { useDeferredValue, useId, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import type { SourceLocation } from '@/lib/project/latex-source'
import { searchProjectSources, sourceSearchLimit } from '@/lib/project/source-search'
import type { ProjectFileSystem } from '@/lib/project/types'

export function SourceSearchPanel({ files, query, onQuery, onLocate }: {
  files: ProjectFileSystem['files']
  query: string
  onQuery: (query: string) => void
  onLocate: (location: SourceLocation) => void
}) {
  const inputId = useId()
  const deferredQuery = useDeferredValue(query)
  const deferredFiles = useDeferredValue(files)
  const { matches, limited } = useMemo(
    () => searchProjectSources(deferredFiles, deferredQuery), [deferredFiles, deferredQuery],
  )
  const searching = query !== deferredQuery || files !== deferredFiles
  const hasQuery = Boolean(query.trim())

  return (
    <section aria-label="Project source search" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-1.5 border-b px-2 py-2.5">
        <label htmlFor={inputId} className="block text-xs font-medium">Search project source</label>
        <Input id={inputId} type="search" maxLength={256} value={query} autoFocus
          placeholder="Find text or commands" className="h-8" onChange={event => onQuery(event.target.value)} />
        <p role="status" className="text-xs text-muted-foreground">
          {!hasQuery ? '.tex and .bib, including local drafts' : searching ? 'Searching…' : limited
            ? `Showing first ${sourceSearchLimit} matches. Refine your search to see more.`
            : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}
        </p>
      </div>
      {hasQuery && !searching && matches.length > 0 && (
        <ul aria-label="Search results" className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
          {matches.map(result => (
            <li key={`${result.path}:${result.start}`}>
              <button type="button" onClick={() => onLocate(result)} title={result.path}
                className="block w-full min-w-0 rounded-md border bg-white px-2 py-1.5 text-left outline-none hover:border-indigo-300 hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500">
                <span className="block break-all text-xs font-semibold">{result.name}:{result.line}</span>
                {result.path.includes('/') && <span className="block break-all text-xs text-muted-foreground">
                  {result.path.slice(0, result.path.lastIndexOf('/'))}
                </span>}
                <span className="mt-1 block font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {result.before}<mark className="rounded-sm bg-amber-200 text-amber-950">{result.match}</mark>{result.after}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
