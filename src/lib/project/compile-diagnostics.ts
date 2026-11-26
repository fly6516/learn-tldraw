import type { PdfFontInventory } from './submission-fonts'
import type { CompiledGeometry } from './layout-geometry'

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
  pdfFonts?: PdfFontInventory
  geometry?: CompiledGeometry[]
}

export function missingTexFile(output: string) {
  return /(?:LaTeX Error:\s+File\s+|Missing input file\s+|I can't find file\s+)[\x60'"]?([a-z\d_][a-z\d_.+-]{0,119}\.(?:sty|cls|def|fd|tfm|pfb))['"\x60]/i.exec(output)?.[1]
}

export function compileFailureMessage(output: string, onlyCached: boolean) {
  const font = /^warning: >> This font is mapped to a physical font "([^"\r\n]{1,150})"\./m.exec(output)?.[1]
  if (/Cannot proceed without \.vf or "physical" font for PDF output/i.test(output)) {
    return `Tectonic could not load a font${font ? ` (${font})` : ''} required to produce the PDF.${
      onlyCached ? ' Allow Tectonic to download missing bundle resources and retry.' : ' Check the Tectonic bundle and font configuration.'}`
  }
  const error = /^error:[^\S\r\n]*(.+)$/m.exec(output)?.[1]?.trim()
  return error ? `LaTeX compilation failed. ${error.slice(0, 600)}` : 'LaTeX compilation failed.'
}

export function compileLog(output: string, log: string, limit: number) {
  if (!output) return log.slice(-limit)
  if (!log) return output.slice(-limit)
  if (output.length + log.length + 2 <= limit) return output + '\n\n' + log
  const limitOutput = Math.floor(limit / 2)
  const consoleOutput = output.length <= limitOutput ? output : output.slice(-limitOutput)
  return consoleOutput + '\n\n' + log.slice(-(limit - consoleOutput.length - 2))
}

export function parseCompileDiagnostics(output: string, main: string, paths: Iterable<string>): CompileDiagnostic[] {
  const files = new Set(paths)
  const folder = main.slice(0, main.lastIndexOf('/') + 1)
  const diagnosticLines = /^(?:(error|warning):[^\S\r\n]*(.+?)|(.+?\.(?:tex|sty|cls|bib|bbl))):(\d+):[^\S\r\n]*(.+)$/gim
  const seen = new Set<string>()
  const diagnostics: CompileDiagnostic[] = []
  for (const [, explicitLevel, tectonicPath, systemPath, lineNumber, message] of output.matchAll(diagnosticLines)) {
    const filename = tectonicPath ?? systemPath
    const level = explicitLevel ?? (/\bwarning\b/i.test(message) ? 'warning' : 'error')
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
