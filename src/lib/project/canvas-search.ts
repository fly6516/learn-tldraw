import { RESEARCH_NODE_META } from '@/app/research/research-node'
import type { ResearchPage, ResearchNode } from './research-graph'
import { literalSearchPattern } from './text-search'

export type CanvasLocation = { pageId: string; nodeId: string }

export function researchNodeTitle(data: ResearchNode['data']) {
  return data.customLabel || RESEARCH_NODE_META[data.section].label
}

export const canvasSearchLimit = 100

export function searchCanvasNodes(pages: ResearchPage[], query: string) {
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
      const fields = [title, data.content, ...data.tags ?? [], RESEARCH_NODE_META[data.section].label,
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
