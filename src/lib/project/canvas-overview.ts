import { sortNodesBySection } from '../export/latex-exporter'
import { collectArrowOrderedNodes, emptyPage, type ResearchCanvas, type ResearchEdge, type ResearchNode, type ResearchPage } from './research-graph'

const cardWidth = 320
const cardHeight = 430
const margin = 48
export const pageCapacity = 12
type Point = ResearchNode['position']
type Placement = { pageId: string; position: Point }

export function normalizeCanvas(canvas: ResearchCanvas): ResearchCanvas {
  if (canvas.globalOrder) return canvas
  let order = 0
  const usedNodes = new Set<string>()
  const usedEdges = new Set<string>()
  function unique(id: string, pageId: string, used: Set<string>) {
    let candidate = id
    while (used.has(candidate)) candidate = `${pageId}:${candidate}`
    used.add(candidate)
    return candidate
  }
  return { ...canvas, globalOrder: true, pages: canvas.pages.map(page => {
    const ordered = collectArrowOrderedNodes(page) ?? sortNodesBySection(page.nodes.map(node => node.data))
    const orderByData = new Map(ordered.map(data => [data, order++]))
    const ids = new Map(page.nodes.map(node => [node.id, unique(node.id, page.id, usedNodes)]))
    return { ...page, nodes: page.nodes.map(node => ({ ...node, id: ids.get(node.id)!, data: {
      ...node.data, order: orderByData.get(node.data)!, parentId: node.data.parentId ? ids.get(node.data.parentId) : undefined,
    } })), edges: page.edges.map(edge => ({ ...edge, id: unique(edge.id, page.id, usedEdges),
      source: ids.get(edge.source)!, target: ids.get(edge.target)!,
    })) }
  }) }
}

export function canvasEdges(canvas: ResearchCanvas) {
  return [...canvas.pages.flatMap(page => page.edges), ...canvas.crossPageEdges ?? []]
}

export function documentPage(canvas: ResearchCanvas): ResearchPage {
  const sections = canvas.pages.flatMap(page => page.nodes).filter(node => !node.data.resource)
    .sort((a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id))
  const incoming = new Map(sections.map(node => [node.id, 0]))
  const edges = canvasEdges(canvas).filter(edge => incoming.has(edge.source) && incoming.has(edge.target))
  const outgoing = new Map<string, string[]>()
  for (const { source, target } of edges) {
    incoming.set(target, incoming.get(target)! + 1)
    const targets = outgoing.get(source) ?? []
    targets.push(target)
    outgoing.set(source, targets)
  }
  const ordered: ResearchNode[] = []
  while (ordered.length < sections.length) {
    const next = sections.find(node => incoming.get(node.id) === 0)
    if (!next) break
    ordered.push(next)
    incoming.delete(next.id)
    for (const target of outgoing.get(next.id) ?? []) incoming.set(target, incoming.get(target)! - 1)
  }
  // Fall back to explicit order for legacy data with invalid connections.
  const nodes = (ordered.length === sections.length ? ordered : sections).map((node, y) => ({ ...node, position: { x: 0, y } }))
  return { ...emptyPage('Whole paper'), nodes, edges }
}

export interface PageRegion {
  pageId: string
  name: string
  count: number
  x: number
  y: number
  width: number
  height: number
  origin: Point
}

export function projectOverview(canvas: ResearchCanvas) {
  let x = 0
  const regions: PageRegion[] = canvas.pages.map(page => {
    const left = Math.min(0, ...page.nodes.map(node => node.position.x))
    const top = Math.min(0, ...page.nodes.map(node => node.position.y))
    const right = Math.max(800, ...page.nodes.map(node => node.position.x + cardWidth + margin))
    const bottom = Math.max(480, ...page.nodes.map(node => node.position.y + cardHeight + margin))
    const region = { pageId: page.id, name: page.name, count: page.nodes.length, x, y: 0,
      width: right - left + 2 * margin, height: bottom - top + 2 * margin, origin: { x: x + margin - left, y: margin - top } }
    x += region.width + 80
    return region
  })
  const nodes = canvas.pages.flatMap((page, index) => page.nodes.map(node => {
    const { origin } = regions[index]
    return { ...node, position: { x: node.position.x + origin.x, y: node.position.y + origin.y } }
  }))
  const viewport = canvas.overviewViewport ?? { x: 24, y: 70, zoom: 0.6 }
  return { regions, page: { ...emptyPage('Whole paper', 'overview'), nodes, edges: canvasEdges(canvas), viewport } }
}

export function repageCanvas(canvas: ResearchCanvas, nodes: ResearchNode[], edges: ResearchEdge[], placements: ReadonlyMap<string, Placement>) {
  const existing = new Map(canvas.pages.flatMap(page => page.nodes.map(node => [node.id, page.id] as const)))
  const owners = new Map(nodes.map(node => [node.id, placements.get(node.id)?.pageId ?? existing.get(node.id) ?? canvas.activePageId]))
  const buckets = new Map(canvas.pages.map(page => [page.id, { ...page, nodes: [] as ResearchNode[], edges: [] as ResearchEdge[] }]))
  const detached: ResearchNode[] = []
  for (const node of nodes) {
    const pageId = owners.get(node.id)!
    const parent = node.data.parentId
    const parentChanged = parent !== undefined && pageId !== owners.get(parent)
    if (parentChanged && owners.has(parent)) detached.push(node)
    const data = parentChanged ? { ...node.data, parentId: undefined } : node.data
    buckets.get(pageId)?.nodes.push({ ...node, position: placements.get(node.id)?.position ?? node.position, data })
  }
  const crossPageEdges: ResearchEdge[] = []
  for (const edge of edges) {
    const source = owners.get(edge.source)
    const target = owners.get(edge.target)
    if (!source || !target) continue
    if (source === target) buckets.get(source)?.edges.push(edge)
    else crossPageEdges.push(edge)
  }
  return { canvas: { ...canvas, pages: [...buckets.values()], crossPageEdges }, detached }
}

export function dropOverviewNodes(canvas: ResearchCanvas, regions: PageRegion[], leaderId: string, positions: ReadonlyMap<string, Point>) {
  const leader = positions.get(leaderId)
  if (!leader) return undefined
  const x = leader.x + cardWidth / 2
  const y = leader.y + 40
  const region = regions.find(item => x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height)
  if (!region) return undefined
  const placements = new Map([...positions].map(([id, point]) => [id, { pageId: region.pageId,
    position: { x: point.x - region.origin.x, y: point.y - region.origin.y },
  }]))
  if (canvas.pages.every(page => page.nodes.every(node => {
    const placement = placements.get(node.id)
    return !placement || (page.id === placement.pageId && node.position.x === placement.position.x && node.position.y === placement.position.y)
  }))) return undefined
  return repageCanvas(canvas, canvas.pages.flatMap(page => page.nodes), canvasEdges(canvas), placements)
}

export function arrangeCanvas(canvas: ResearchCanvas, makeId: () => string) {
  const placements = new Map<string, Placement>()
  const newPages: ResearchPage[] = []
  const moved: { node: ResearchNode; from: string; to: string }[] = []
  const pages = canvas.pages.flatMap(page => {
    const byId = new Map(page.nodes.map(node => [node.id, node]))
    const parent = new Map(page.nodes.filter(node => node.data.parentId).map(node => [node.id, node.data.parentId!]))
    for (const edge of page.edges) {
      const target = byId.get(edge.target)
      const source = byId.get(edge.source)
      if (target?.data.resource && source && !source.data.resource && !parent.has(target.id)) parent.set(target.id, source.id)
    }
    function root(id: string) {
      const seen = new Set<string>()
      while (!seen.has(id) && parent.has(id)) {
        seen.add(id)
        id = parent.get(id)!
      }
      return id
    }
    const groups = new Map<string, ResearchNode[]>()
    for (const node of [...page.nodes].sort((a, b) => a.data.order - b.data.order)) {
      const key = root(node.id)
      const group = groups.get(key) ?? []
      group.push(node)
      groups.set(key, group)
    }
    const result = [page]
    let used = 0
    for (const group of groups.values()) {
      for (let start = 0; start < group.length; start += pageCapacity) {
        const chunk = group.slice(start, start + pageCapacity)
        if (used + chunk.length > pageCapacity) {
          const next = emptyPage(`${page.name} (${result.length + 1})`, makeId())
          result.push(next)
          newPages.push(next)
          used = 0
        }
        const target = result.at(-1)!
        for (const node of chunk) {
          placements.set(node.id, { pageId: target.id, position: { x: 50 + used % 3 * 380, y: 50 + Math.floor(used / 3) * cardHeight } })
          used++
          if (target !== page) moved.push({ node, from: page.name, to: target.name })
        }
      }
    }
    return result
  })
  return { ...repageCanvas({ ...canvas, pages }, canvas.pages.flatMap(page => page.nodes), canvasEdges(canvas), placements), newPages, moved }
}
