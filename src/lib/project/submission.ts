import { buildProjectOutline } from './outline'
import { indexCrossReferences } from './cross-references'
import { checkCitations, collectBibliography } from './references'
import { groupEnd, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'
import type { ProjectFileSystem } from './types'
import { detectCompileCompatibility, type ExternalEngine } from './compile-compatibility'
import { exportSourceArchive } from './source-archive'
import type { SubmissionEvidence } from './submission-evidence'

export type SubmissionIssue = { severity: 'error' | 'warning'; message: string; location?: SourceLocation }
export type SubmissionFiles = { pdf: Blob; zip: Blob; warnings: boolean; diagnostics: SubmissionIssue[] }
export type SubmissionVersion = SubmissionFiles & { id: string; name: string; createdAt: string; main: string;
  paths: string[]; excluded: string[]; drafts: string[]; issues: SubmissionIssue[]; externalEngine?: ExternalEngine; sourceChecksum?: string
  evidence?: SubmissionEvidence }
export type SubmissionVersionInfo = Omit<SubmissionVersion, 'pdf' | 'zip'>
export type SubmissionBuild = Omit<SubmissionVersion, 'id' | 'name' | 'createdAt'>
export type SubmissionSelection = Pick<SubmissionVersion, 'paths' | 'excluded' | 'drafts' | 'issues'> & { target: ProjectFileSystem }

export async function exportExternalBuild(project: ProjectFileSystem) {
  const files = new Map([...project.files].filter(([, file]) => file.type !== 'directory')
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  const zip = await exportSourceArchive({ ...project, files }, new Date('1980-01-01T00:00:00Z'))
  const digest = await crypto.subtle.digest('SHA-256', await zip.arrayBuffer())
  const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return { zip, checksum }
}

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
  // A local class or package can choose the bibliography backend for the document.
  for (const [sourcePath, source] of sources) {
    for (const command of maskLatexCode(source).matchAll(/\\(documentclass|LoadClass|usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)) {
      const suffix = command[1] === 'documentclass' || command[1] === 'LoadClass' ? '.cls' : '.sty'
      for (const name of command[2].split(',')) {
        const path = projectPath(root, name.trim())
        const resolved = path?.endsWith(suffix) ? path : path && path + suffix
        if (!resolved || sources.has(resolved)) continue
        if (excluded.has(resolved) && project.files.has(resolved)) {
          const start = command.index + command[0].lastIndexOf('{') + 1
          issues.push({ severity: 'error', message: `Excluded dependency: ${resolved}`,
            location: { path: sourcePath, line: lineNumber(source, start), start, end: start + command[2].length } })
        }
        const file = files.get(resolved)
        if (file && 'content' in file && typeof file.content === 'string') sources.set(resolved, file.content)
      }
    }
  }
  const bibliographyPaths = new Set<string>()
  let uncertainBibliography = false
  const selectedOptions = /\\documentclass\s*\[([^\]]*)\]/.exec(maskLatexCode(sources.get(main) ?? ''))?.[1]
    .split(',').map(option => option.trim()) ?? []
  const projectPaths = [...project.files.keys()]
  const hasGraphicsPath = [...sources.values()].some(source => /\\graphicspath\s*\{/.test(maskLatexCode(source)))
  for (const [path, source] of sources) {
    const text = maskLatexCode(source)
    const templateFile = /\.(?:cls|sty)$/i.test(path)
    for (const style of text.matchAll(/\\bibliographystyle\s*\{([^{}]+)\}/g)) {
      const name = style[1].trim()
      if (templateFile && !selectedOptions.includes(name)) continue
      const literal = projectPath(root, name.endsWith('.bst') ? name : name + '.bst')
      if (!literal) continue
      const nested = name.includes('/') ? [] : projectPaths.filter(candidate => candidate.startsWith(root)
        && candidate.endsWith('/' + literal.slice(root.length)))
      const dependency = project.files.has(literal) ? literal : nested.length === 1 ? nested[0] : undefined
      if (dependency && excluded.has(dependency)) {
        const start = style.index + style[0].indexOf('{') + 1
        issues.push({ severity: 'error', message: `Excluded bibliography style: ${dependency}`,
          location: { path, line: lineNumber(source, start), start, end: start + style[1].length } })
      }
    }
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
        const graphics = command === 'includegraphics' || command === 'XeTeXpicfile'
        const optionalGraphics = graphics && templateFile
        const searchPath = command === 'includegraphics' && hasGraphicsPath && !excludedPath
        issue(optionalGraphics ? `Check conditional template graphic: ${excludedPath ?? literal}`
          : excludedPath ? `Excluded dependency: ${excludedPath}` : searchPath ? `Check graphics search path: ${literal}` : `Missing file for \\${command}: ${literal}`,
          optionalGraphics || searchPath ? 'warning' : 'error', offset, offset + literal.length)
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
  return { target, issues, compatibility: detectCompileCompatibility(sources, main, files.keys()) }
}
