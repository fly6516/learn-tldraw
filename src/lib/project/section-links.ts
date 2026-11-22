import type { OutlineHeading } from './outline'
import type { SectionAnchor } from './research-graph'
import type { SourceLocation, SourceResolution } from './latex-source'

export function headingKey(heading: OutlineHeading) {
  return JSON.stringify([heading.path, heading.start])
}

function sourceKey(heading: { path: string; command: string; titleSource: string }) {
  return JSON.stringify([heading.path, heading.command, heading.titleSource])
}

export function indexOutline(headings: OutlineHeading[], labelLocations?: ReadonlyMap<string, readonly SourceLocation[]>) {
  const labels = new Map<string, OutlineHeading | null>()
  const sources = new Map<string, OutlineHeading | null>()
  const visited = new Set<string>()
  const entries: OutlineHeading[] = []
  function visit(items: OutlineHeading[]) {
    for (const heading of items) {
      const key = headingKey(heading)
      if (!visited.has(key)) {
        visited.add(key)
        entries.push(heading)
        if (heading.label) labels.set(heading.label, labels.has(heading.label) ? null : heading)
        const source = sourceKey(heading)
        sources.set(source, sources.has(source) ? null : heading)
      }
      visit(heading.children)
    }
  }
  visit(headings)
  return { labels, sources, entries, labelLocations }
}

export function anchorHeading(index: ReturnType<typeof indexOutline>, project: string, heading: OutlineHeading): SectionAnchor | undefined {
  const { label, path, command, titleSource } = heading
  if (!label && !titleSource) return
  const anchor: SectionAnchor = label ? { kind: 'label', project, label } : { kind: 'heading', project, path, command, titleSource }
  const target = resolveSectionAnchor(index, project, anchor)
  if (target && headingKey(target) === headingKey(heading)) return anchor
}

export function inspectSectionAnchor(index: ReturnType<typeof indexOutline>, project: string, anchor?: SectionAnchor): SourceResolution<OutlineHeading> {
  if (!anchor || anchor.project !== project) return { status: 'missing' }
  const key = anchor.kind === 'label' ? anchor.label : sourceKey(anchor)
  const labels = anchor.kind === 'label' ? index.labelLocations?.get(anchor.label) : undefined
  if (labels && labels.length > 1) return { status: 'conflict', locations: labels }
  const match = (anchor.kind === 'label' ? index.labels : index.sources).get(key)
  if (match === null) return { status: 'conflict', locations: index.entries.filter(heading =>
    (anchor.kind === 'label' ? heading.label : sourceKey(heading)) === key) }
  if (!match) return { status: 'missing' }
  const matchLabels = match.label && index.labelLocations?.get(match.label)
  if (matchLabels && matchLabels.length > 1) return { status: 'conflict', locations: matchLabels }
  return { status: 'linked', location: match }
}

export function resolveSectionAnchor(index: ReturnType<typeof indexOutline>, project: string, anchor: SectionAnchor | undefined) {
  const result = inspectSectionAnchor(index, project, anchor)
  return result.status === 'linked' ? result.location : undefined
}
