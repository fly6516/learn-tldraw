export interface CompileDiagnostic {
  path: string
  line: number
  severity: 'error' | 'warning'
  message: string
}

export interface CompileReport {
  diagnostics: CompileDiagnostic[]
  hasWarnings: boolean
  log: string
}

export function parseCompileDiagnostics(output: string, main: string, paths: Iterable<string>): CompileDiagnostic[] {
  const files = new Set(paths)
  const folder = main.slice(0, main.lastIndexOf('/') + 1)
  const diagnosticLines = /^(error|warning):[^\S\r\n]*(.+?):(\d+):[^\S\r\n]*(.+)$/gm
  const seen = new Set<string>()
  const diagnostics: CompileDiagnostic[] = []
  for (const [, level, filename, lineNumber, message] of output.matchAll(diagnosticLines)) {
    const reported = filename.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    const relative = folder + reported
    const parts: string[] = []
    for (const segment of relative.split('/')) {
      if (segment === '..') parts.pop()
      else if (segment && segment !== '.') parts.push(segment)
    }
    const resolved = parts.join('/')
    // TeX may report the literal argument of \input, without the resolved extension.
    const bySuffix = [...files].filter(path => reported.endsWith('/' + path)
      || path.endsWith('/' + reported) || path.endsWith('/' + reported + '.tex'))
    const path = files.has(relative) ? relative : files.has(resolved) ? resolved
      : files.has(resolved + '.tex') ? resolved + '.tex' : files.has(reported) ? reported
        : files.has(reported + '.tex') ? reported + '.tex' : bySuffix.length === 1 ? bySuffix[0] : undefined
    const line = Number(lineNumber)
    const key = JSON.stringify([path, line, level, message])
    if (!path || !Number.isSafeInteger(line) || line < 1 || seen.has(key)) continue
    seen.add(key)
    diagnostics.push({ path, line, severity: level === 'warning' ? 'warning' : 'error', message: message.trim() })
  }
  return diagnostics
}
