import type { OutlineHeading } from './outline'
import type { SectionAnchor } from './research-graph'

export function headingKey(heading: OutlineHeading) {
  return JSON.stringify([heading.path, heading.start])
}

function sourceKey(heading: { path: string; command: string; titleSource: string }) {
  return JSON.stringify([heading.path, heading.command, heading.titleSource])
}

export function indexOutline(headings: OutlineHeading[]) {
  const labels = new Map<string, OutlineHeading | null>()
  const sources = new Map<string, OutlineHeading | null>()
  const visited = new Set<string>()
  function visit(items: OutlineHeading[]) {
    for (const heading of items) {
      const key = headingKey(heading)
      if (!visited.has(key)) {
        visited.add(key)
        if (heading.label) labels.set(heading.label, labels.has(heading.label) ? null : heading)
        const source = sourceKey(heading)
        sources.set(source, sources.has(source) ? null : heading)
      }
      visit(heading.children)
    }
  }
  visit(headings)
  return { labels, sources }
}

export function anchorHeading(index: ReturnType<typeof indexOutline>, project: string, heading: OutlineHeading): SectionAnchor | undefined {
  const { label, path, command, titleSource } = heading
  const labelMatch = label && index.labels.get(label)
  if (label && labelMatch && headingKey(labelMatch) === headingKey(heading)) return { kind: 'label', project, label }
  const sourceMatch = index.sources.get(sourceKey(heading))
  if (titleSource && sourceMatch && headingKey(sourceMatch) === headingKey(heading)) return { kind: 'heading', project, path, command, titleSource }
}

export function resolveSectionAnchor(index: ReturnType<typeof indexOutline>, project: string, anchor: SectionAnchor | undefined) {
  if (!anchor || anchor.project !== project) return undefined
  return (anchor.kind === 'label' ? index.labels.get(anchor.label) : index.sources.get(sourceKey(anchor))) ?? undefined
}
