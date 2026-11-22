import { type CanvasLocation } from './canvas-search'
import type { CanvasSourceCatalog } from './canvas-source-links'
import type { SourceLocation } from './latex-source'
import type { BibliographyEntry } from './references'

export interface SearchSourceLink extends CanvasLocation {
  title: string
  pageName: string
  source: SourceLocation
}

export function indexSearchLinks(links: SearchSourceLink[]) {
  const byNode = new Map<string, SearchSourceLink>()
  const byPath = new Map<string, SearchSourceLink[]>()
  for (const link of links) {
    byNode.set(link.nodeId, link)
    const group = byPath.get(link.source.path) ?? []
    group.push(link)
    byPath.set(link.source.path, group)
  }
  return {
    byNode,
    forSource(source: SourceLocation) {
      return (byPath.get(source.path) ?? []).filter(link => link.source.start < source.end && source.start
        < ('extentEnd' in link.source && typeof link.source.extentEnd === 'number' ? link.source.extentEnd : link.source.end))
    },
  }
}

export const bibliographySearchLimit = 100

export function searchBibliography(catalog: CanvasSourceCatalog | undefined, query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const matches: BibliographyEntry[] = []
  if (!catalog || !words.length) return { matches, limited: false }
  for (const entries of catalog.references.entriesByKey.values()) for (const entry of entries) {
    const fields = [entry.key, entry.title, entry.author, entry.year, entry.path].join(' ').toLowerCase()
    if (!words.every(word => fields.includes(word))) continue
    if (matches.length === bibliographySearchLimit) return { matches, limited: true }
    matches.push(entry)
  }
  return { matches, limited: false }
}
