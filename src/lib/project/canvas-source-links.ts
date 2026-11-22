import { blockFingerprint, inspectLatexBlock, latexBlockTitle, type LatexBlock } from './latex-blocks'
import type { SourceLocation, SourceResolution } from './latex-source'
import type { indexCanvasReferences } from './references'
import type { FigureAnchor, ResearchCanvas, ResearchNode, SectionAnchor } from './research-graph'
import { anchorHeading, inspectSectionAnchor, type indexOutline } from './section-links'
import { researchNodeTitle } from './canvas-search'
import type { ProjectFileSystem } from './types'

type NodeData = ResearchNode['data']
type BibliographyAnchor = Extract<NonNullable<NodeData['resource']>, { kind: 'bibliography' }>

export type CanvasSourceLink =
  | { type: 'section'; anchor: SectionAnchor }
  | { type: 'block'; anchor: FigureAnchor }
  | { type: 'bibliography'; anchor: BibliographyAnchor }

export const sourceLinkNames = {
  section: 'Section',
  block: 'LaTeX block',
  bibliography: 'Bibliography entry',
} as const

export interface CanvasSourceCatalog {
  project: string
  index: ReturnType<typeof indexOutline>
  blocks: LatexBlock[]
  references: ReturnType<typeof indexCanvasReferences>
  files: ProjectFileSystem['files']
}

export interface SourceLinkIssue {
  pageId: string
  pageName: string
  nodeId: string
  title: string
  link: CanvasSourceLink
  resolution: Exclude<SourceResolution<SourceLocation>, { status: 'linked' }>
}

export interface SourceLinkTarget {
  link: CanvasSourceLink
  location: SourceLocation
  title: string
}

export function sourceLinkKey(link: CanvasSourceLink) {
  if (link.type === 'bibliography') return JSON.stringify([link.type, link.anchor.project, link.anchor.key])
  if (link.type === 'section') {
    const anchor = link.anchor
    return JSON.stringify([link.type, anchor.project, anchor.kind, anchor.kind === 'label'
      ? anchor.label : [anchor.path, anchor.command, anchor.titleSource]])
  }
  const anchor = link.anchor
  return JSON.stringify([link.type, anchor.project, anchor.kind, anchor.label ? ['label', anchor.label] : [anchor.path, anchor.caption]])
}

export function sourceLinkIdentity(link: CanvasSourceLink) {
  if (link.type === 'bibliography') return link.anchor.key
  if (link.type === 'section') return link.anchor.kind === 'label' ? link.anchor.label : link.anchor.titleSource
  return link.anchor.label || link.anchor.path
}

export function anchorLatexBlock(catalog: Pick<CanvasSourceCatalog, 'blocks' | 'project' | 'index'>, block: LatexBlock) {
  const { project, blocks, index } = catalog
  const { path, kind } = block
  const anchors = block.labels.length
    ? block.labels.map(label => ({ project, kind, path, label, caption: block.caption }))
    : [{ project, kind, path, caption: blockFingerprint(block) }].filter(anchor => anchor.caption)
  return anchors.find(anchor => {
    const result = inspectLatexBlock(blocks, project, anchor, index.labelLocations)
    return result.status === 'linked' && result.location === block
  })
}

function linksFromNode(data: NodeData): CanvasSourceLink[] {
  const links: CanvasSourceLink[] = []
  if (data.sourceAnchor) links.push({ type: 'section', anchor: data.sourceAnchor })
  if (data.figureAnchor) links.push({ type: 'block', anchor: data.figureAnchor })
  if (data.resource?.kind === 'bibliography') links.push({ type: 'bibliography', anchor: data.resource })
  return links
}

function inspectLink(catalog: CanvasSourceCatalog, link: CanvasSourceLink): SourceResolution<SourceLocation> {
  if (link.anchor.project !== catalog.project) return { status: 'missing' }
  if (link.type === 'section') return inspectSectionAnchor(catalog.index, catalog.project, link.anchor)
  if (link.type === 'block') return inspectLatexBlock(catalog.blocks, catalog.project, link.anchor, catalog.index.labelLocations)
  const entries = catalog.references.entriesByKey.get(link.anchor.key) ?? []
  if (entries.length > 1) return { status: 'conflict', locations: entries }
  return entries.length ? { status: 'linked', location: entries[0] } : { status: 'missing' }
}

export function findSourceLinkIssues(pages: ResearchCanvas['pages'], catalog: CanvasSourceCatalog): SourceLinkIssue[] {
  return pages.flatMap(page => page.nodes.flatMap(node => linksFromNode(node.data).flatMap(link => {
    const resolution = inspectLink(catalog, link)
    return resolution.status === 'linked' ? [] : [{
      pageId: page.id, pageName: page.name, nodeId: node.id, title: researchNodeTitle(node.data), link, resolution,
    }]
  })))
}

export function sourceLinkTargets(canvas: ResearchCanvas, catalog: CanvasSourceCatalog, issue: SourceLinkIssue): SourceLinkTarget[] {
  const locationKey = (location: SourceLocation) => JSON.stringify([location.path, location.start])
  const node = canvas.pages.find(page => page.id === issue.pageId)?.nodes.find(node => node.id === issue.nodeId)
  const allowsSharedTarget = node?.data.resource?.kind === 'research'
  const occupied = new Set(canvas.pages.flatMap(page => page.nodes.filter(node => node.id !== issue.nodeId)
    .flatMap(node => linksFromNode(node.data).flatMap(link => {
      if (allowsSharedTarget || node.data.resource?.kind === 'research' || link.type !== issue.link.type) return []
      const result = inspectLink(catalog, link)
      return result.status === 'linked' ? [locationKey(result.location)] : []
    }))))
  const targets: SourceLinkTarget[] = []
  if (issue.link.type === 'section') {
    for (const heading of catalog.index.entries) {
      const anchor = anchorHeading(catalog.index, catalog.project, heading)
      if (anchor) targets.push({ title: heading.title, location: heading, link: { type: 'section', anchor } })
    }
  } else if (issue.link.type === 'block') {
    const kind = issue.link.anchor.kind
    for (const block of catalog.blocks.filter(block => block.kind === kind)) {
      const anchor = anchorLatexBlock(catalog, block)
      if (anchor) targets.push({ title: latexBlockTitle(block), location: block, link: { type: 'block', anchor } })
    }
  } else {
    for (const entry of catalog.references.definitions.values()) {
      if (entry) targets.push({ title: entry.title || entry.key, location: entry,
        link: { type: 'bibliography', anchor: { kind: 'bibliography', project: catalog.project, key: entry.key } } })
    }
  }
  return targets.filter(target => !occupied.has(locationKey(target.location)))
}

export function repairSourceLink(canvas: ResearchCanvas, catalog: CanvasSourceCatalog, issue: SourceLinkIssue, target: SourceLinkTarget): ResearchCanvas {
  const previousKey = sourceLinkKey(issue.link)
  const currentIssue = findSourceLinkIssues(canvas.pages.filter(page => page.id === issue.pageId), catalog).find(item => item.nodeId === issue.nodeId
    && item.pageId === issue.pageId && sourceLinkKey(item.link) === previousKey)
  if (!currentIssue) return canvas
  const replacement = sourceLinkTargets(canvas, catalog, currentIssue).find(item => sourceLinkKey(item.link) === sourceLinkKey(target.link)
    && item.location.path === target.location.path && item.location.start === target.location.start && item.title === target.title)
  if (!replacement) return canvas
  const { link } = replacement
  return { ...canvas, pages: canvas.pages.map(page => page.id !== issue.pageId ? page : {
    ...page, nodes: page.nodes.map(node => node.id !== issue.nodeId ? node : {
      ...node, data: { ...node.data, ...(link.type === 'section' ? { sourceAnchor: link.anchor }
        : link.type === 'block' ? { figureAnchor: link.anchor } : { resource: link.anchor }) },
    }),
  }) }
}
