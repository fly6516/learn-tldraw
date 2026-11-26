import type { SyncRegion } from './source-sync'

export type ManuscriptLine = Readonly<{ path: string; line: number }>
export type LineSources = ReadonlyMap<number, ManuscriptLine>
export type MappedTex = { text: string; lines: LineSources }
export type TemplatePreview = { pdf: Blob; regions: SyncRegion[] }

export function joinMappedTex(parts: readonly (string | MappedTex | false | 0)[], separator = '\n'): MappedTex {
  const lines = new Map<number, ManuscriptLine>()
  const text: string[] = []
  let offset = 0
  for (const part of parts) {
    if (!part) continue
    const value = typeof part === 'string' ? part : part.text
    if (!value) continue
    if (typeof part !== 'string') {
      for (const [line, source] of part.lines) {
        if (!lines.has(offset + line)) lines.set(offset + line, source)
      }
    }
    text.push(value)
    offset += [...value.matchAll(/\r\n|\r|\n/g)].length + [...separator.matchAll(/\r\n|\r|\n/g)].length
  }
  return { text: text.join(separator), lines }
}

/** Keep PDF geometry and translate only regions backed by original manuscript text. */
export function manuscriptRegions(regions: SyncRegion[], generatedPath: string, lines: LineSources) {
  return regions.flatMap(region => {
    const origin = region.path === generatedPath && lines.get(region.line)
    return origin ? [{ ...region, ...origin }] : []
  })
}
