export interface SourceLocation {
  path: string
  line: number
  start: number
  end: number
}

export type SourceResolution<T extends SourceLocation> =
  | { status: 'linked'; location: T }
  | { status: 'missing' }
  | { status: 'conflict'; locations: readonly SourceLocation[] }

export const latexLabelPattern = /\\(?:\\|label\s*\{([^\s{}\\]+)\})/g

export function indexLatexLabels(sources: Iterable<[string, string]>) {
  const labels = new Map<string, SourceLocation[]>()
  for (const [path, source] of sources) {
    for (const match of maskLatexCode(source).matchAll(latexLabelPattern)) {
      const label = match[1]
      if (!label) continue
      const start = match.index + match[0].indexOf('{') + 1
      const location = { path, start, end: start + label.length, line: lineNumber(source, start) }
      const locations = labels.get(label) ?? []
      locations.push(location)
      labels.set(label, locations)
    }
  }
  return labels
}

export function lineNumber(source: string, offset: number) {
  return source.slice(0, offset).split(/\r\n|\n|\r/).length
}

export function sourcePosition(source: string, offset: number) {
  const from = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const lines = source.slice(from, offset).split(/\r\n|\n|\r/)
  return { lineNumber: lines.length, column: lines[lines.length - 1].length + 1 }
}

export function sourceOffsetAtPosition(source: string, position: { lineNumber: number; column: number }) {
  let start = source.charCodeAt(0) === 0xfeff ? 1 : 0
  if (position.lineNumber > 1) {
    let line = 1
    for (const newline of source.matchAll(/\r\n|\n|\r/g)) {
      start = newline.index + newline[0].length
      if (++line === position.lineNumber) break
    }
  }
  return Math.min(source.length, start + position.column - 1)
}

// Replace comments and literal code with spaces while retaining source offsets.
export function maskLatexCode(source: string, keepListingDelimiters = false) {
  return source.replace(
    /\\begin\s*\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?(?:\\end\s*\{\1\}|$)|\\verb\*?([^\r\n\w\s])[^\r\n]*?\2|\\[\s\S]|%[^\r\n]*/g,
    (token, environment, delimiter) => {
      if (environment && keepListingDelimiters) {
        const opening = token.indexOf('}') + 1
        const closing = token.search(/\\end\s*\{[^{}]+\}$/)
        return token.slice(0, opening) + token.slice(opening, closing < 0 ? undefined : closing)
          .replace(/[^\r\n]/g, ' ') + (closing < 0 ? '' : token.slice(closing))
      }
      return environment || delimiter || token[0] === '%' ? token.replace(/[^\r\n]/g, ' ') : token
    },
  )
}

export function groupEnd(source: string, start: number, open: string, close: string) {
  let depth = 0
  let braces = 0
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') {
      i++
      continue
    }
    if (open !== '{') {
      if (char === '{') braces++
      if (char === '}') braces--
      if (braces > 0) continue
    }
    if (char === open) depth++
    if (char === close && --depth === 0) return i
  }
  return -1
}
