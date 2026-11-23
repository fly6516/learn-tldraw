'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CrossReferenceIndex } from '@/lib/project/cross-references'
import type { SourceLocation } from '@/lib/project/latex-source'

export function CrossReferencesPanel({ index, titles, canInsert, onInsert, onLocate, onRename }: {
  index: CrossReferenceIndex
  titles: ReadonlyMap<string, string>
  canInsert: boolean
  onInsert: (command: 'ref' | 'pageref', key: string) => void
  onLocate: (location: SourceLocation) => void
  onRename?: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  const [command, setCommand] = useState<'ref' | 'pageref'>('ref')
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matches = [...index.labels].filter(([key, definitions]) => {
    const text = [key, titles.get(key), ...definitions.map(item => item.path)].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  })
  return <section aria-label="Cross-references" className="space-y-3 p-3">
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1 space-y-1 text-sm font-medium">
        <span>Search LaTeX labels</span>
        <Input type="search" placeholder="Label, heading, caption, or file" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <label className="space-y-1 text-sm font-medium">
        <span className="block">Insert as</span>
        <select value={command} onChange={event => setCommand(event.target.value === 'pageref' ? 'pageref' : 'ref')}
          className="h-9 rounded-md border bg-white px-2"><option value="ref">Reference number</option><option value="pageref">Page number</option></select>
      </label>
    </div>
    <p className="text-xs text-slate-600">Labels from the current main file and its included sources, including local drafts.</p>
    {!matches.length && <p role="status" className="text-sm text-slate-600">No matching labels.</p>}
    <ul className="divide-y">
      {matches.slice(0, 50).map(([key, definitions]) => {
        const uses = index.uses.get(key) ?? []
        return <li key={key} className="flex items-start justify-between gap-2 py-2 text-sm">
          <div className="min-w-0 space-y-1">
            <p className="break-all font-medium">{titles.get(key) ? `${titles.get(key)} · ${key}` : key}</p>
            {definitions.length > 1 && <p className="text-amber-800">Duplicate label. Choose a definition to resolve it.</p>}
            {definitions.map(item => <button type="button" key={`${item.path}:${item.start}`} onClick={() => onLocate(item)}
              className="block break-all text-left font-mono text-xs underline">{item.path}:{item.line}</button>)}
            {uses.length > 0 && <details>
              <summary className="cursor-pointer text-xs text-slate-700">{uses.length} {uses.length === 1 ? 'use' : 'uses'}</summary>
              {uses.map(item => <button type="button" key={`${item.path}:${item.start}`} onClick={() => onLocate(item)}
                className="block break-all text-left font-mono text-xs underline">{item.path}:{item.line} · \{item.command}</button>)}
            </details>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Button size="sm" variant="outline" aria-label={`Insert cross-reference for ${key}`} disabled={!canInsert || definitions.length !== 1}
              onClick={() => onInsert(command, key)}>Insert</Button>
            {onRename && <Button size="sm" variant="ghost" aria-label={`Rename LaTeX label ${key}`} disabled={definitions.length !== 1}
              onClick={() => onRename(key)}>Rename label</Button>}
          </div>
        </li>
      })}
    </ul>
    {matches.length > 50 && <p className="text-sm text-slate-600">Showing the first 50 labels. Refine the search for more.</p>}
  </section>
}
