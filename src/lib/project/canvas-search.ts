import { RESEARCH_NODE_META } from '@/app/research/research-node'
import type { ResearchPage, ResearchNode } from './research-graph'
import { literalSearchPattern } from './text-search'
import { canvasResourceNames, researchCardNames } from './canvas-card-kinds'
import type { LatexBlock } from './latex-blocks'
import type { BibliographyEntry } from './references'

export type CanvasLocation = { pageId: string; nodeId: string }

export function researchNodeTitle(data: ResearchNode['data']) {
  const resource = data.resource
  return data.customLabel || (resource?.kind === 'research' ? resource.customType || researchCardNames[resource.role]
    : resource ? canvasResourceNames[resource.kind] : RESEARCH_NODE_META[data.section].label)
}

export const canvasSearchLimit = 100

export function searchCanvasNodes(pages: ResearchPage[], query: string, blocks?: ReadonlyMap<ResearchNode['data'], LatexBlock>,
  bibliography?: ReadonlyMap<ResearchNode['data'], BibliographyEntry>) {
  const matches: (CanvasLocation & {
    pageName: string
    title: string
    before: string
    match: string
    after: string
  })[] = []
  const text = query.trim()
  if (!text) return { matches, limited: false }
  const pattern = literalSearchPattern(text)

  for (const page of pages) {
    for (const node of page.nodes) {
      const { data } = node
      const title = researchNodeTitle(data)
      const resource = data.resource
      const block = blocks?.get(data)
      const reference = bibliography?.get(data)
      const research = resource?.kind === 'research' ? resource : undefined
      const fields = [title, data.content, ...data.tags ?? [], resource ? resource.kind : RESEARCH_NODE_META[data.section].label,
        resource && canvasResourceNames[resource.kind], resource && 'path' in resource ? resource.path : undefined,
        resource?.kind === 'bibliography' ? resource.key : undefined, reference?.title, reference?.author, reference?.year, reference?.path,
        research?.customType, research && researchCardNames[research.role], research?.status,
        data.figureAnchor?.label, data.figureAnchor?.path, data.figureAnchor?.caption,
        block?.environment, block?.path, block?.caption, block?.preview, ...block?.labels ?? [],
        data.metadata?.sectionNumber, data.metadata?.importSource]
      for (const field of fields) {
        if (!field) continue
        const hit = pattern.exec(field)
        if (!hit) continue
        if (matches.length === canvasSearchLimit) return { matches, limited: true }
        const start = Math.max(0, hit.index - 32)
        const end = hit.index + hit[0].length
        const snippetEnd = Math.min(field.length, end + 48)
        matches.push({
          pageId: page.id, nodeId: node.id, pageName: page.name, title,
          before: (start ? '…' : '') + field.slice(start, hit.index), match: hit[0],
          after: field.slice(end, snippetEnd) + (snippetEnd < field.length ? '…' : ''),
        })
        break
      }
    }
  }
  return { matches, limited: false }
}
