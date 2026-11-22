import { z } from 'zod'
import { RESEARCH_NODE_META, type ResearchNodeType } from '@/app/research/research-node'
import type { ResearchNodeData } from './types'
import { latexBlockKinds } from './latex-block-kinds'
import { researchCardKinds, researchCardStatuses } from './canvas-card-kinds'

const position = z.object({ x: z.number(), y: z.number() })
const nodeSchema = z.object({
  id: z.string().min(1),
  position,
  data: z.object({
    section: z.custom<ResearchNodeType>(value => typeof value === 'string' && Object.hasOwn(RESEARCH_NODE_META, value)),
    content: z.string(),
    order: z.number(),
    level: z.number().int().min(1).max(4),
    parentId: z.string().optional(),
    customLabel: z.string().optional(),
    tags: z.array(z.string()).optional(),
    resource: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('image'), path: z.string().min(1).optional() }),
      z.object({ kind: z.literal('table') }),
      z.object({ kind: z.enum(['equation', 'algorithm', 'listing', 'theorem', 'environment']), environment: z.string().min(1) }),
      z.object({ kind: z.literal('bibliography'), key: z.string().min(1), project: z.string().min(1) }),
      z.object({ kind: z.enum(['dataset', 'attachment']), path: z.string().min(1) }),
      z.object({ kind: z.literal('research'), role: z.enum(researchCardKinds),
        customType: z.string().trim().min(1).optional(), status: z.enum(researchCardStatuses).optional() }),
    ]).optional(),
    // Keep this key stable for existing Canvas backups.
    figureAnchor: z.object({ project: z.string(), kind: z.enum(latexBlockKinds),
      label: z.string().optional(), path: z.string(), caption: z.string() }).optional(),
    sourceAnchor: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('label'), project: z.string().min(1), label: z.string().min(1) }),
      z.object({ kind: z.literal('heading'), project: z.string().min(1), path: z.string().min(1),
        command: z.string().min(1), titleSource: z.string().min(1) }),
    ]).optional(),
    metadata: z.object({
      originalTitle: z.string().optional(), sectionNumber: z.string().optional(),
      imported: z.boolean().optional(), importSource: z.string().optional(),
      createdAt: z.string().optional(), updatedAt: z.string().optional(),
    }).optional(),
  }),
})
const edgeSchema = z.object({ id: z.string().min(1), source: z.string(), target: z.string() })
const pageSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1), nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema), viewport: position.extend({ zoom: z.number().positive() }),
})
export const researchCanvasSchema = z.object({
  activePageId: z.string(), pages: z.array(pageSchema).min(1),
  crossPageEdges: z.array(edgeSchema).optional(),
  overviewViewport: position.extend({ zoom: z.number().positive() }).optional(),
  display: z.enum(['overview', 'page']).optional(),
  globalOrder: z.literal(true).optional(),
}).superRefine(({ pages, activePageId, crossPageEdges, globalOrder }, ctx) => {
  const pageIds = pages.map(page => page.id)
  if (new Set(pageIds).size !== pageIds.length || !pageIds.includes(activePageId)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid canvas pages' })
  }
  for (const page of pages) {
    const ids = new Set(page.nodes.map(node => node.id))
    const seenEdges = new Set<string>()
    const endpoints = new Set<string>()
    if (ids.size !== page.nodes.length || page.nodes.some(node => {
      const parent = node.data.parentId
      return parent !== undefined && (!ids.has(parent) || parent === node.id)
    }) || page.edges.some(edge => {
      const pair = JSON.stringify([edge.source, edge.target])
      if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target
        || seenEdges.has(edge.id) || endpoints.has(pair)) return true
      seenEdges.add(edge.id)
      endpoints.add(pair)
      return false
    }) || topologicalNodes(page).length !== ids.size) {
      ctx.addIssue({ code: 'custom', message: `Invalid nodes or connections on ${page.name}` })
    }
  }
  if (globalOrder || crossPageEdges?.length) {
    const owners = new Map(pages.flatMap(page => page.nodes.map(node => [node.id, page.id] as const)))
    const nodes = pages.flatMap(page => page.nodes)
    const edges = [...pages.flatMap(page => page.edges), ...crossPageEdges ?? []]
    const pairs = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target])))
    if (owners.size !== nodes.length || pairs.size !== edges.length || new Set(edges.map(edge => edge.id)).size !== edges.length
      || crossPageEdges?.some(edge => !owners.has(edge.source) || !owners.has(edge.target) || owners.get(edge.source) === owners.get(edge.target))
      || topologicalNodes({ ...pages[0], nodes, edges }).length !== nodes.length) {
      ctx.addIssue({ code: 'custom', message: 'Invalid connections between Canvas pages' })
    }
  }
})

export type ResearchNode = z.infer<typeof nodeSchema>
export type SectionAnchor = NonNullable<ResearchNode['data']['sourceAnchor']>
export type FigureAnchor = NonNullable<ResearchNode['data']['figureAnchor']>
export type ResearchEdge = z.infer<typeof edgeSchema>
export type ResearchPage = z.infer<typeof pageSchema>
export type ResearchCanvas = z.infer<typeof researchCanvasSchema>

export function emptyPage(name = 'Page 1', id = 'page-1'): ResearchPage {
  return { id, name, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

export const emptyCanvas: ResearchCanvas = { activePageId: 'page-1', pages: [emptyPage()] }

export function activeResearchPage(canvas: ResearchCanvas): ResearchPage {
  return canvas.pages.find(page => page.id === canvas.activePageId) ?? canvas.pages[0]
}

export function removeResearchNodes(page: ResearchPage, ids: Set<string>): ResearchPage {
  return {
    ...page,
    nodes: page.nodes.filter(node => !ids.has(node.id)).map(node =>
      node.data.parentId && ids.has(node.data.parentId)
        ? { ...node, data: { ...node.data, parentId: undefined } } : node),
    edges: page.edges.filter(edge => !ids.has(edge.source) && !ids.has(edge.target)),
  }
}

function outgoingEdges(edges: ResearchEdge[]) {
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const next = outgoing.get(edge.source) ?? []
    next.push(edge.target)
    outgoing.set(edge.source, next)
  }
  return outgoing
}

export function validResearchConnection(page: ResearchPage, source: string, target: string): boolean {
  if (source === target || !page.nodes.some(node => node.id === source)
    || !page.nodes.some(node => node.id === target)) return false
  const outgoing = outgoingEdges(page.edges)
  if (outgoing.get(source)?.includes(target)) return false
  const pending = [target]
  const visited = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === source) return false
    if (visited.has(id)) continue
    visited.add(id)
    pending.push(...(outgoing.get(id) ?? []))
  }
  return true
}

function topologicalNodes(page: ResearchPage) {
  const nodes = new Map(page.nodes.map(node => [node.id, node]))
  const outgoing = outgoingEdges(page.edges)
  const incoming = new Map(page.nodes.map(node => [node.id, 0]))
  for (const edge of page.edges) incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
  const byPosition = (a: string, b: string) => (nodes.get(a)?.position.y ?? 0) - (nodes.get(b)?.position.y ?? 0)
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id).sort(byPosition)
  const ordered: ResearchNode[] = []
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    const node = nodes.get(id)
    if (!node) continue
    ordered.push(node)
    for (const next of (outgoing.get(id) ?? []).sort(byPosition)) {
      const count = (incoming.get(next) ?? 0) - 1
      incoming.set(next, count)
      if (count === 0) queue.push(next)
    }
  }
  return ordered
}

export function collectArrowOrderedNodes(page: ResearchPage): ResearchNodeData[] | null {
  if (!page.edges.length) return null
  const involved = new Set(page.edges.flatMap(edge => [edge.source, edge.target]))
  const ordered = topologicalNodes(page)
  if (ordered.length !== page.nodes.length) throw new Error('Cannot export a graph with cyclic connections.')
  const sectionOrder = (node: ResearchNode) => RESEARCH_NODE_META[node.data.section].order
  const result = ordered.filter(node => involved.has(node.id))
  const unconnected = ordered.filter(node => !involved.has(node.id))
    .sort((a, b) => sectionOrder(a) - sectionOrder(b) || a.position.y - b.position.y)
  for (const node of unconnected) {
    const previous = result.findLastIndex(other => sectionOrder(other) <= sectionOrder(node))
    result.splice(previous + 1, 0, node)
  }
  return result.map(node => node.data)
}
