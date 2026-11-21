export interface SourceLocation {
  path: string
  line: number
  start: number
  end: number
}

export function lineNumber(source: string, offset: number) {
  return source.slice(0, offset).split(/\r\n|\n|\r/).length
}

// Replace comments and literal code with spaces while retaining source offsets.
export function maskLatexCode(source: string) {
  return source.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted)\}[\s\S]*?\\end\{\1\}|\\verb\*?([^\r\n\w\s])[^\r\n]*?\2|\\[\s\S]|%[^\r\n]*/g,
    (token, environment, delimiter) => environment || delimiter || token[0] === '%'
      ? token.replace(/[^\r\n]/g, ' ') : token,
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
