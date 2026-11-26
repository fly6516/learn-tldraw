import type { SyncRegion } from './source-sync'

// SyncTeX v1 coordinates are scaled TeX points. A PDF point is 1/72 inch.
const toPdfPoint = 72 / (72.27 * 65536)
const maxRegions = 100_000
const record = /^([([gkx])(-?\d+),(\d+)(?:,\d+)?:([-\d]+),([-\d]+)(?::([-\d]+)(?:,([-\d]+),([-\d]+))?)?$/

interface Box {
  start: number
  baseline: number
  width: number
  height: number
  depth: number
  previous: number
  path?: string
  line: number
  hasContent: boolean
}

export function parseSyncTex(text: string, resolveInput: (input: string) => string | undefined): SyncRegion[] {
  if (!text.startsWith('SyncTeX Version:1')) return []
  const lines = text.split(/\r?\n/)
  const tags = new Map<number, string>()
  const settings = new Map<string, number>()
  for (const line of lines) {
    const input = /^Input:(\d+):(.+)$/.exec(line)
    if (input) {
      const path = resolveInput(input[2])
      if (path) tags.set(Number(input[1]), path)
    }
    const setting = /^(Magnification|Unit|X Offset|Y Offset):(-?\d+)$/.exec(line)
    if (setting) settings.set(setting[1], Number(setting[2]))
  }
  const unit = (settings.get('Unit') ?? 1) * toPdfPoint
  const scale = unit * (settings.get('Magnification') ?? 1000) / 1000
  if (!(scale > 0)) return []
  const offsetX = (settings.get('X Offset') ?? 0) * unit
  const offsetY = (settings.get('Y Offset') ?? 0) * unit
  const regions: SyncRegion[] = []
  const boxes: Box[] = []
  let page = 0

  function add(path: string | undefined, line: number, left: number, right: number, box: Box) {
    if (!path || line < 1 || Math.abs(right - left) * scale < 1 || regions.length >= maxRegions) return
    const ascent = Math.min(18, Math.max(6, box.height * scale))
    const descent = Math.min(10, Math.max(2, box.depth * scale))
    const x = Math.min(left, right) * scale + offsetX
    const y = box.baseline * scale + offsetY - ascent
    const width = Math.abs(right - left) * scale
    const previous = regions.at(-1)
    if (previous?.path === path && previous.line === line && previous.page === page
      && Math.abs(previous.y - y) < 1 && Math.abs(previous.x + previous.width - x) < 0.1) {
      previous.width += width
    } else {
      regions.push({ path, line, page, x, y, width, height: ascent + descent })
    }
    box.hasContent = true
  }

  for (const [index, raw] of lines.entries()) {
    if (raw.startsWith('{')) { page = Number(raw.slice(1)); boxes.length = 0; continue }
    if (raw.startsWith('}')) { page = 0; continue }
    if (!Number.isSafeInteger(page) || page < 1) continue
    const parent = boxes.at(-1)
    if (raw === ')' || raw === ']') {
      const finished = boxes.pop()
      if (raw === ')' && finished && !finished.hasContent && finished.width * scale < 140) {
        add(finished.path, finished.line, finished.start, finished.start + finished.width, finished)
      }
      const outer = boxes.at(-1)
      if (finished?.hasContent && outer?.baseline === finished.baseline) {
        outer.previous = finished.start + finished.width
        outer.hasContent = true
      }
      continue
    }
    const match = record.exec(raw)
    if (!match) continue
    const [, kind, tag, lineText, h, v, w, ht, dp] = match
    const [line, x, baseline, width, height, depth] = [lineText, h, v, w ?? 0, ht ?? 0, dp ?? 0].map(Number)
    if (![line, x, baseline, width, height, depth].every(Number.isSafeInteger)) continue
    const path = tags.get(Number(tag))
    if (kind === '(' || kind === '[') {
      boxes.push({ start: x, baseline, width, height, depth, previous: x, path, line, hasContent: false })
    } else if (parent && Math.abs(parent.baseline - baseline) * scale < 4) {
      // A kern marks the end of the run before the interword or trailing space.
      const right = kind === 'k' ? x - width : x
      const runPath = kind === 'k' ? parent.path ?? path : path
      let runLine = kind === 'k' && parent.path ? parent.line : line
      if (kind === 'x' && path === parent.path && line === parent.line && parent.previous === parent.start) {
        // TeX can tag the first glyph run with the command that ends the
        // paragraph. The following glue or glyph on this baseline identifies
        // the earlier manuscript line from which the paragraph starts.
        const next = record.exec(lines[index + 1] ?? '')
        if (next && /^[gx]$/.test(next[1]) && next[2] === tag && Number(next[3]) < line
          && Number(next[4]) > x && Number(next[5]) === baseline) runLine = Number(next[3])
      }
      add(runPath, runLine, parent.previous, right, parent)
      if (kind !== 'k' && path) {
        parent.path = path
        parent.line = runLine
      }
      parent.previous = x
    }
  }
  return regions
}
