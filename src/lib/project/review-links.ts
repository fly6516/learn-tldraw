import type { CanvasLocation } from './canvas-search'
import { anchorLatexBlock, type CanvasSourceCatalog } from './canvas-source-links'
import { inspectLatexBlock, latexBlockTitle } from './latex-blocks'
import { lineNumber, type SourceLocation } from './latex-source'
import type { FigureAnchor, ResearchNode, ResearchPage, SectionAnchor, SelectionAnchor } from './research-graph'
import { anchorHeading, resolveSectionAnchor } from './section-links'

export type ReviewRole = 'review' | 'task'
type ReviewResource = Extract<NonNullable<ResearchNode['data']['resource']>, { kind: 'research' }>
export type ReviewStatus = NonNullable<ReviewResource['status']>
export type ReviewTarget =
  | { type: 'section'; anchor: SectionAnchor }
  | { type: 'formula'; anchor: FigureAnchor }
  | { type: 'selection'; anchor: SelectionAnchor }

export interface ReviewItem extends CanvasLocation {
  pageName: string
  data: ResearchNode['data']
  resource: ReviewResource & { role: ReviewRole }
  source?: SourceLocation
}

export function reviewResource(data: ResearchNode['data']): ReviewItem['resource'] | undefined {
  const resource = data.resource
  if (resource?.kind === 'research' && (resource.role === 'review' || resource.role === 'task')) {
    return { ...resource, role: resource.role }
  }
}

export function makeSelectionAnchor(project: string, path: string, source: string, start: number, end: number): SelectionAnchor | undefined {
  if (start < 0 || end > source.length || end <= start || end - start > 4000) return
  const quote = source.slice(start, end)
  if (!quote.trim()) return
  const anchor = { project, path, quote, before: source.slice(Math.max(0, start - 48), start), after: source.slice(end, end + 48) }
  if (resolveSelectionAnchor(project, source, anchor)?.start === start) return anchor
}

export function resolveSelectionAnchor(project: string, source: string, anchor: SelectionAnchor): SourceLocation | undefined {
  if (anchor.project !== project || !anchor.quote) return
  const matches: number[] = []
  const exactContext: number[] = []
  for (let start = source.indexOf(anchor.quote); start !== -1; start = source.indexOf(anchor.quote, start + 1)) {
    matches.push(start)
    const end = start + anchor.quote.length
    if (source.slice(Math.max(0, start - anchor.before.length), start) === anchor.before
      && source.slice(end, end + anchor.after.length) === anchor.after) exactContext.push(start)
  }
  const start = matches.length === 1 ? matches[0] : exactContext.length === 1 ? exactContext[0] : undefined
  if (start !== undefined) return { path: anchor.path, start, end: start + anchor.quote.length, line: lineNumber(source, start) }
}

export function reviewTargetChoices(catalog: CanvasSourceCatalog, path: string) {
  const choices: { title: string; source: SourceLocation; target: ReviewTarget }[] = []
  for (const heading of catalog.index.entries) {
    if (heading.path !== path) continue
    const anchor = anchorHeading(catalog.index, catalog.project, heading)
    if (anchor) choices.push({ title: heading.title, source: heading, target: { type: 'section', anchor } })
  }
  for (const block of catalog.blocks) {
    if (block.kind !== 'equation' || block.path !== path) continue
    const anchor = anchorLatexBlock(catalog, block)
    if (anchor) choices.push({ title: latexBlockTitle(block), source: block, target: { type: 'formula', anchor } })
  }
  return choices.sort((first, second) => first.source.start - second.source.start)
}

export function resolveReviewTarget(catalog: CanvasSourceCatalog, target: ReviewTarget) {
  if (target.type === 'section') return resolveSectionAnchor(catalog.index, catalog.project, target.anchor)
  if (target.type === 'formula') {
    const checked = inspectLatexBlock(catalog.blocks, catalog.project, target.anchor, catalog.index.labelLocations)
    return checked.status === 'linked' ? checked.location : undefined
  }
  const file = catalog.files.get(target.anchor.path)
  return file && 'content' in file && typeof file.content === 'string'
    ? resolveSelectionAnchor(catalog.project, file.content, target.anchor) : undefined
}

export function reviewTarget(data: ResearchNode['data']): ReviewTarget | undefined {
  if (data.sourceAnchor) return { type: 'section', anchor: data.sourceAnchor }
  if (data.figureAnchor) return { type: 'formula', anchor: data.figureAnchor }
  if (data.selectionAnchor) return { type: 'selection', anchor: data.selectionAnchor }
}

export function bindReviewTarget(data: ResearchNode['data'], target: ReviewTarget): ResearchNode['data'] {
  return { ...data, sourceAnchor: target.type === 'section' ? target.anchor : undefined,
    figureAnchor: target.type === 'formula' ? target.anchor : undefined,
    selectionAnchor: target.type === 'selection' ? target.anchor : undefined }
}

export function reviewItems(pages: ResearchPage[], catalog?: CanvasSourceCatalog): ReviewItem[] {
  return pages.flatMap(page => page.nodes.flatMap(({ id, data }) => {
    const resource = reviewResource(data)
    if (!resource) return []
    const target = reviewTarget(data)
    return [{ pageId: page.id, pageName: page.name, nodeId: id, data, resource,
      source: catalog && target ? resolveReviewTarget(catalog, target) : undefined }]
  }))
}
