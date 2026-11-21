'use client'

import { useMemo } from 'react'
import type { SourceLocation } from '@/lib/project/latex-source'
import { buildProjectOutline, type OutlineHeading } from '@/lib/project/outline'
import type { ProjectFileSystem } from '@/lib/project/types'

function HeadingList({ headings, onLocate }: {
  headings: OutlineHeading[]
  onLocate: (location: SourceLocation) => void
}) {
  return (
    <ul className="space-y-1">
      {headings.map((heading, index) => (
        <li key={`${heading.path}:${heading.start}:${index}`}>
          <button type="button" onClick={() => onLocate(heading)}
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block break-words text-sm font-medium">{heading.title}</span>
            <span className="block break-all text-xs text-muted-foreground">
              {heading.command} · {heading.path}:{heading.line}
            </span>
          </button>
          {heading.children.length > 0 && (
            <div className="ml-2 border-l pl-3">
              <HeadingList headings={heading.children} onLocate={onLocate} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export function OutlinePanel({ project, main, path, draft, onLocate }: {
  project: ProjectFileSystem
  main: string
  path: string
  draft: string
  onLocate: (location: SourceLocation) => void
}) {
  const headings = useMemo(() => buildProjectOutline(project, main, { path, source: draft }), [project, main, path, draft])
  return (
    <nav aria-label="Section outline" className="space-y-2 p-3">
      <h2 className="font-semibold">Section Outline</h2>
      <p className="break-all text-xs text-muted-foreground">{main}</p>
      {headings.length
        ? <HeadingList headings={headings} onLocate={onLocate} />
        : <p className="text-sm text-muted-foreground">No LaTeX headings found in the selected document.</p>}
    </nav>
  )
}
