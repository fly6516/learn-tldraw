import { dirname, relative, resolve } from 'node:path'
import { parseSyncTex } from './parse-synctex'

export function readSyncTex(text: string, sources: string, main: string, paths: Iterable<string>) {
  const files = new Set([...paths].filter(path => /\.tex$/i.test(path)))
  const cwd = dirname(resolve(sources, main))
  return parseSyncTex(text, input => {
    const path = relative(sources, resolve(cwd, input.replace(/\\/g, '/'))).replace(/\\/g, '/')
    if (files.has(path)) return path
    if (files.has(path + '.tex')) return path + '.tex'
  })
}
