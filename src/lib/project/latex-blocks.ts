import { groupEnd, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'
import type { FigureAnchor } from './research-graph'
import type { ProjectDirectory, ProjectFile, ProjectFileSystem } from './types'
import { latexBlockNames, type LatexBlockKind } from './latex-block-kinds'
import type { LatexMathPart } from './latex-math-preview'

export interface LatexBlock extends SourceLocation {
  kind: LatexBlockKind
  environment: string
  caption: string
  label?: string
  labels: string[]
  ambiguousLabels?: ReadonlySet<string>
  imagePath?: string
  preview?: string
  equations?: LatexMathPart[]
}

const standardEnvironments = new Map<string, LatexBlockKind>([
  ['figure', 'figure'], ['table', 'table'],
  ...['equation', 'align', 'alignat', 'flalign', 'gather', 'multline', 'eqnarray', 'subequations', 'displaymath']
    .map(name => [name, 'equation'] as const),
  ...['algorithm', 'algorithm2e', 'algorithmic', 'algorithmicx', 'pseudocode']
    .map(name => [name, 'algorithm'] as const),
  ...['listing', 'lstlisting', 'minted', 'verbatim'].map(name => [name, 'listing'] as const),
  ...['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'example', 'proof']
    .map(name => [name, 'theorem'] as const),
])

const latexLabels = /\\(?:\\|label\s*\{([^\s{}\\]+)\})/g

export function readProjectLatexBlocks(project: Pick<ProjectFileSystem, 'files'>, main: string,
  documents: ReadonlyMap<string, string>, preamble: ReadonlyMap<string, string> = new Map(),
) {
  const declared = declaredLatexEnvironments([...preamble.values(), ...documents.values()])
  const labels = new Set<string>()
  const ambiguousLabels = new Set<string>()
  const blocks = [...documents].flatMap(([path, text]) => {
    for (const [, label] of maskLatexCode(text).matchAll(latexLabels)) {
      if (!label) continue
      if (labels.has(label)) ambiguousLabels.add(label)
      labels.add(label)
    }
    return readLatexBlocks(project, main, path, text, declared)
  })
  return blocks.map(block => ({ ...block, ambiguousLabels }))
}

export function declaredLatexEnvironments(sources: Iterable<string>) {
  const declared = new Map<string, { kind: LatexBlockKind; title: string }>()
  for (const source of sources) {
    const text = maskLatexCode(source)
    for (const match of text.matchAll(/\\(?:\\|(newtheorem|(?:new|renew|provide)environment)\*?\s*\{([\w@:-]+)\})/g)) {
      if (!match[1]) continue
      const [, command, name] = match
      const theorem = command === 'newtheorem'
      const title = theorem ? argument(text.slice(match.index + match[0].length), /^(?:\s*\[[^\]]*\])?\s*\{/) : undefined
      declared.set(name, { kind: theorem ? 'theorem' : 'environment', title: title || name })
    }
  }
  return declared
}

export function imageAttachment(file: ProjectFile | ProjectDirectory | undefined): file is ProjectFile & { blob: Blob } {
  return Boolean(file && file.type !== 'directory' && file.blob && /\.(?:png|jpe?g|webp|gif)$/i.test(file.path))
}

function resolveImage(project: Pick<ProjectFileSystem, 'files'>, main: string, source: string, name: string) {
  if (!name || /[\\{}#]/.test(name) || name.startsWith('/')) return undefined
  for (const from of [main, source]) {
    const parts: string[] = []
    let valid = true
    for (const part of (from.slice(0, from.lastIndexOf('/') + 1) + name).split('/')) {
      if (part === '..') {
        if (!parts.length) { valid = false; break }
        parts.pop()
      } else if (part !== '.' && part) parts.push(part)
    }
    if (!valid) continue
    const path = parts.join('/')
    const choices = /\.[^.\/]+$/.test(path) ? [path] : [...project.files.keys()].filter(candidate => candidate.slice(0, candidate.lastIndexOf('.')) === path)
    const images = choices.filter(candidate => imageAttachment(project.files.get(candidate)))
    if (images.length === 1) return images[0]
  }
}

function argument(text: string, command: RegExp) {
  const match = command.exec(text)
  if (!match) return undefined
  const start = match.index + match[0].length - 1
  const end = groupEnd(text, start, '{', '}')
  return end < 0 ? undefined : text.slice(start + 1, end).trim()
}

export function readLatexBlocks(project: Pick<ProjectFileSystem, 'files'>, main: string, path: string, source: string,
  declared = declaredLatexEnvironments([source]),
): LatexBlock[] {
  const text = maskLatexCode(source, true)
  const tokens = /\\(?:\\|(begin|end)\s*\{([\w@:-]+\*?)\}|(\[|\])|\$)|(\$\$)/g
  const stack: { environment: string; start: number; openEnd: number; nested: LatexBlock[] }[] = []
  let blocks: LatexBlock[] = []
  for (const match of text.matchAll(tokens)) {
    const [, command, name, delimiter, dollars] = match
    if (!command && !delimiter && !dollars) continue
    const environment = name ?? (dollars ? '$$' : 'displaymath')
    if (command === 'begin' || delimiter === '[' || (dollars && stack.at(-1)?.environment !== '$$')) {
      if (environment === 'document') blocks = []
      stack.push({ environment, start: match.index, openEnd: match.index + match[0].length, nested: [] })
      continue
    }
    const opener = stack.at(-1)
    if (opener?.environment !== environment) continue
    stack.pop()
    const destination = stack.at(-1)?.nested ?? blocks
    const base = dollars ? 'displaymath' : environment.replace(/\*$/, '')
    const declaration = declared.get(environment) ?? declared.get(base)
    const kind = standardEnvironments.get(base) ?? declaration?.kind
    if (!kind) {
      destination.push(...opener.nested)
      if (environment === 'document') break
      continue
    }
    const body = text.slice(opener.openEnd, match.index)
    const caption = argument(body, /\\caption(?:\s*\[[^\]]*\])?\s*\{/)
      ?? (kind === 'theorem' ? /^\s*\[([^\]]+)\]/.exec(body)?.[1]?.trim() : undefined)
      ?? declaration?.title ?? ''
    const labels = [...body.matchAll(latexLabels)].flatMap(label => label[1] ? [label[1]] : [])
    const graphic = kind === 'figure' ? argument(body, /\\includegraphics\*?(?:\s*\[[^\]]*\])?\s*\{/)
      ?? /\\XeTeXpicfile\s+(?:"([^"]+)"|([^\s{}]+))/.exec(body)?.slice(1).find(Boolean) : undefined
    const preview = kind === 'figure' || kind === 'table' ? undefined
      : kind === 'listing' ? source.slice(opener.openEnd, match.index).trim()
      : body.replace(/\\label\s*\{[^\s{}\\]+\}/g, '').trim()
    const groupedMath = kind === 'equation' && base === 'subequations'
    const equations = groupedMath ? opener.nested.flatMap(block => {
      if (block.kind !== 'equation' || !block.preview) return []
      return block.equations ?? [{ source: block.preview, environment: block.environment }]
    }) : undefined
    destination.push({
      kind, path, environment, caption, labels, label: labels[0],
      imagePath: graphic ? resolveImage(project, main, path, graphic) : undefined, preview,
      equations: equations?.length ? equations : undefined,
      line: lineNumber(source, opener.start), start: opener.start, end: opener.openEnd,
    })
    destination.push(...opener.nested.filter(block => !(groupedMath && block.kind === 'equation')
      && !(kind === 'algorithm' && block.kind === 'algorithm')
      && !(kind === 'listing' && block.kind === 'listing')))
  }
  // Keep complete blocks while a user is still typing an enclosing environment.
  return [...blocks, ...stack.flatMap(open => open.nested)].sort((a, b) => a.start - b.start)
}

export function latexBlockTitle(block: LatexBlock) {
  return block.caption.replace(/\s+/g, ' ') || block.label || latexBlockNames[block.kind]
}

export function blockFingerprint(block: LatexBlock) {
  if (block.kind === 'figure' || block.kind === 'table') return block.caption
  return block.preview ? JSON.stringify([block.environment, block.caption, block.preview]) : ''
}

export function locateLatexBlock(blocks: LatexBlock[], project: string, anchor?: FigureAnchor) {
  if (!anchor || anchor.project !== project) return undefined
  const matches = blocks.filter(block => anchor.label ? block.labels.includes(anchor.label!)
    : block.kind === anchor.kind && block.path === anchor.path && blockFingerprint(block) === anchor.caption)
  return matches.length === 1 && matches[0].kind === anchor.kind
    && (!anchor.label || (!matches[0].ambiguousLabels?.has(anchor.label)
      && matches[0].labels.filter(label => label === anchor.label).length === 1)) ? matches[0] : undefined
}
