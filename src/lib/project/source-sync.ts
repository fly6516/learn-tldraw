export interface SyncRegion {
  path: string
  line: number
  page: number
  // PDF points from the top left of the unrotated media box.
  x: number
  y: number
  width: number
  height: number
}

export function findPdfRegion(regions: SyncRegion[], path: string, line: number) {
  let best: SyncRegion | undefined
  for (const region of regions) {
    if (region.path !== path) continue
    const distance = Math.abs(region.line - line)
    if (!best || distance < Math.abs(best.line - line)
      || (region.line === best.line && (region.page < best.page
        || (region.page === best.page && (region.y < best.y - 4
          || (Math.abs(region.y - best.y) <= 4 && region.x < best.x)))))) best = region
  }
  return best
}

export function findSourceRegion(regions: SyncRegion[], page: number, x: number, y: number) {
  let best: SyncRegion | undefined
  let bestDistance = 14
  for (const region of regions) {
    if (region.page !== page) continue
    const dx = Math.max(region.x - x, 0, x - (region.x + region.width))
    const dy = Math.max(region.y - y, 0, y - (region.y + region.height))
    const distance = Math.hypot(dx, dy * 2)
    if (distance < bestDistance || (distance === bestDistance && best && region.width < best.width)) {
      bestDistance = distance
      best = region
    }
  }
  return best
}
