export function literalSearchPattern(query: string, flags = 'iu') {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
}
