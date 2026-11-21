import { groupEnd, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'
import type { ProjectFileSystem } from './types'

const headingLevels = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'] as const
type Heading = typeof headingLevels[number]

export interface OutlineHeading extends SourceLocation {
  command: Heading
  title: string
  titleSource: string
  label?: string
  children: OutlineHeading[]
}

type OutlineEvent = Omit<OutlineHeading, 'children'> | { include: string }

function analyzeSource(path: string, source: string): OutlineEvent[] {
  const text = maskLatexCode(source)
  const commands = /\\(?:\\|(begin|end|input|include|part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(?![A-Za-z@])(\s*\*)?)/g
  const adjacentLabel = /\s*\\label\s*\{([^\s{}\\]+)\}/y
  let events: OutlineEvent[] = []
  for (let match = commands.exec(text); match; match = commands.exec(text)) {
    const command = match[1] as Heading | 'begin' | 'end' | 'input' | 'include' | undefined
    if (!command) continue
    let start = commands.lastIndex
    while (/\s/.test(text[start] ?? '')) start++
    if (text[start] === '[') {
      const optionalEnd = groupEnd(text, start, '[', ']')
      if (optionalEnd < 0) continue
      start = optionalEnd + 1
      while (/\s/.test(text[start] ?? '')) start++
    }
    const braced = text[start] === '{'
    if (!braced && command !== 'input') continue
    const end = braced ? groupEnd(text, start, '{', '}') : start + (/^[^\s\\{}]+/.exec(text.slice(start))?.[0].length ?? 0)
    if (end <= start) continue
    const argumentStart = start + Number(braced)
    const argument = text.slice(argumentStart, end).trim()
    commands.lastIndex = end + Number(braced)
    if (command === 'begin' || command === 'end') {
      if (argument !== 'document') continue
      if (command === 'end') break
      events = []
    } else if (command === 'input' || command === 'include') {
      if (argument && !/[\\{}#]/.test(argument)) events.push({ include: argument })
    } else {
      const title = argument.replace(/\\(?:textbf|textit|emph|texttt|textrm)\s*\{([^{}]*)\}/g, '$1')
        .replace(/\s+/g, ' ')
      // An adjacent label belongs to this heading. Labels in the body can belong to figures or lists.
      adjacentLabel.lastIndex = commands.lastIndex
      const label = adjacentLabel.exec(text)?.[1]
      events.push({ path, start: argumentStart, end, command, title: title || '(Untitled heading)',
        titleSource: argument, label,
        line: lineNumber(source, match.index) })
    }
  }
  return events
}

function resolveInclude(main: string, target: string, files: Map<string, string>) {
  if (target.startsWith('/')) return undefined
  const directory = main.slice(0, main.lastIndexOf('/') + 1)
  const parts: string[] = []
  for (const part of (directory + target).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(part)
  }
  const path = parts.join('/')
  if (files.has(path)) return path
  if (!/\.tex$/i.test(path) && files.has(path + '.tex')) return path + '.tex'
  return undefined
}

export function buildProjectOutline(
  project: Pick<ProjectFileSystem, 'files'>, main: string, active?: { path: string; source: string },
): OutlineHeading[] {
  const files = new Map<string, string>()
  for (const file of project.files.values()) {
    if ('content' in file && /\.tex$/i.test(file.path)) {
      files.set(file.path, file.path === active?.path ? active.source : file.content ?? '')
    }
  }
  const headings: OutlineHeading[] = []
  const parents: OutlineHeading[] = []
  const ancestors = new Set<string>()
  const parsedFiles = new Map<string, OutlineEvent[]>()

  function visit(path: string) {
    const source = files.get(path)
    if (source === undefined || ancestors.has(path)) return
    ancestors.add(path)
    const events = parsedFiles.get(path) ?? analyzeSource(path, source)
    parsedFiles.set(path, events)
    for (const event of events) {
      if ('include' in event) {
        const included = resolveInclude(main, event.include, files)
        if (included) visit(included)
        continue
      }
      const level = headingLevels.indexOf(event.command)
      while (parents.length && headingLevels.indexOf(parents[parents.length - 1].command) >= level) parents.pop()
      const heading = { ...event, children: [] }
      const siblings = parents.at(-1)?.children ?? headings
      siblings.push(heading)
      parents.push(heading)
    }
    ancestors.delete(path)
  }

  visit(main)
  return headings
}
