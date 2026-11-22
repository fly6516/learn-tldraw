import { buildProjectOutline } from './outline'
import { indexCrossReferences } from './cross-references'
import { checkCitations, collectBibliography } from './references'
import { groupEnd, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'
import type { ProjectFileSystem } from './types'

export type SubmissionIssue = { severity: 'error' | 'warning'; message: string; location?: SourceLocation }
export type SubmissionFiles = { pdf: Blob; zip: Blob; warnings: boolean; diagnostics: SubmissionIssue[] }
export type SubmissionVersion = SubmissionFiles & { id: string; name: string; createdAt: string; main: string;
  paths: string[]; excluded: string[]; drafts: string[]; issues: SubmissionIssue[] }
export type SubmissionVersionInfo = Omit<SubmissionVersion, 'pdf' | 'zip'>

const suffixes: Record<string, string[]> = {
  input: ['.tex'], include: ['.tex'], includegraphics: ['.pdf', '.png', '.jpg', '.jpeg', '.eps'],
  XeTeXpicfile: ['.pdf', '.png', '.jpg', '.jpeg'], bibliography: ['.bib'], addbibresource: ['.bib'],
}

function projectPath(root: string, literal: string) {
  if (!/^[\p{L}\p{N}_.+/ -]+$/u.test(literal) || literal.startsWith('/')) return
  const parts: string[] = []
  for (const part of (root + literal).split('/')) {
    if (part === '..') { if (!parts.length) return; parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

export function prepareSubmission(project: ProjectFileSystem, main: string, excluded: ReadonlySet<string>) {
  const files = new Map([...project.files].filter(([path, file]) => file.type !== 'directory' && (path === main || !excluded.has(path))))
  const target = { ...project, files }
  const sources = new Map<string, string>()
  const add = (path: string, text: string) => { sources.set(path, text) }
  buildProjectOutline(target, main, undefined, add, add)
  const root = main.slice(0, main.lastIndexOf('/') + 1)
  const issues: SubmissionIssue[] = []
  const bibliographyPaths = new Set<string>()
  let uncertainBibliography = false
  const hasGraphicsPath = [...sources.values()].some(source => /\\graphicspath\s*\{/.test(maskLatexCode(source)))
  for (const [path, source] of sources) {
    const text = maskLatexCode(source)
    const commands = /\\(?:\\|(input|include|includegraphics|XeTeXpicfile|bibliography|addbibresource|graphicspath|includeonly)(?![\w@])\*?)/g
    for (const match of text.matchAll(commands)) {
      const command = match[1]
      if (!command) continue
      const bibliography = command === 'bibliography' || command === 'addbibresource'
      const issue = (message: string, severity: SubmissionIssue['severity'], start = match.index, end = match.index + match[0].length) => {
        issues.push({ severity, message, location: { path, line: lineNumber(source, start), start, end } })
      }
      const manual = () => { issue(`Check \\${command} path manually`, 'warning'); if (bibliography) uncertainBibliography = true }
      if (!Object.hasOwn(suffixes, command)) { manual(); continue }
      let start = match.index + match[0].length
      while (/\s/.test(text[start] ?? '')) start++
      while (text[start] === '[') {
        const end = groupEnd(text, start, '[', ']')
        if (end < 0) break
        start = end + 1
        while (/\s/.test(text[start] ?? '')) start++
      }
      const brace = text[start] === '{'
      const quote = text[start] === '"' && (command === 'XeTeXpicfile' || command === 'input')
      const end = brace ? groupEnd(text, start, '{', '}') : quote ? text.indexOf('"', start + 1)
        : command === 'input' || command === 'XeTeXpicfile' ? start + (/^[^\s{}\\]+/.exec(text.slice(start))?.[0].length ?? 0) : -1
      if (end <= start || (!brace && !quote && text[end] === '\\')) { manual(); continue }
      const from = start + Number(brace || quote)
      for (const value of text.slice(from, end).matchAll(command === 'bibliography' ? /[^,]+/g : /[\s\S]+/g)) {
        const literal = value[0].trim()
        const resolved = projectPath(root, literal)
        if (!resolved) { manual(); continue }
        const candidates = [resolved, ...suffixes[command].map(ext => resolved + ext)]
        const included = candidates.find(candidate => files.has(candidate))
        if (included) { if (bibliography) bibliographyPaths.add(included); continue }
        const offset = from + value.index + value[0].indexOf(literal)
        const excludedPath = candidates.find(candidate => excluded.has(candidate))
        const searchPath = command === 'includegraphics' && hasGraphicsPath && !excludedPath
        issue(excludedPath ? `Excluded dependency: ${excludedPath}` : searchPath ? `Check graphics search path: ${literal}` : `Missing file for \\${command}: ${literal}`,
          searchPath ? 'warning' : 'error', offset, offset + literal.length)
      }
    }
  }
  for (const { key, kind, ...location } of indexCrossReferences(sources).issues) {
    issues.push({ severity: 'warning', location, message: kind === 'missing' ? `Undefined LaTeX reference: ${key}` : `Duplicate LaTeX label: ${key}` })
  }
  const citations = collectBibliography(target).filter(entry => !bibliographyPaths.size || uncertainBibliography || bibliographyPaths.has(entry.path))
  const reachable = new Map([...files].filter(([path]) => sources.has(path)))
  for (const { key, kind, ...location } of checkCitations({ ...target, files: reachable }, citations)) {
    issues.push({ severity: 'warning', location, message: kind === 'missing' ? `Unknown citation key: ${key}` : `Duplicate bibliography key: ${key}` })
  }
  return { target, issues }
}
