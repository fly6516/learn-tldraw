import { groupEnd, indexLatexLabels, lineNumber, maskLatexCode } from './latex-source'
import { researchNodeTitle } from './canvas-search'
import { makeSelectionAnchor, resolveSelectionAnchor } from './review-links'
import { isProjectPath } from './source-archive'
import type { ProjectFile, ProjectFileSystem } from './types'
import { rebuildProjectDirectories } from './file-system'
import { editableSource, type PortableWritingState } from './writing-drafts'
import { parseBibliography } from './references'

export type FileOperation = { kind: 'move'; from: string; to: string }
  | { kind: 'chapter'; parent: string; to: string; title: string }
type TextEdit = { start: number; end: number; text: string }
type ReferenceChange = { path: string; line: number; from: string; to: string; layer: string }
type Warning = { path: string; line: number; command: string }

function directory(path: string) {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

function absolute(root: string, value: string) {
  const result: string[] = []
  for (const part of (root + value).split('/')) {
    if (part === '..') {
      if (!result.length) return
      result.pop()
    } else if (part && part !== '.') result.push(part)
  }
  return result.join('/')
}

function relative(root: string, file: string) {
  const parts = root.split('/').filter(Boolean)
  const target = file.split('/')
  let shared = 0
  while (shared < parts.length && parts[shared] === target[shared]) shared++
  return '../'.repeat(parts.length - shared) + target.slice(shared).join('/')
}

const extensions: Record<string, string[]> = {
  input: ['.tex'], include: ['.tex'], includegraphics: ['.pdf', '.png', '.jpg', '.jpeg', '.eps'],
  XeTeXpicfile: [], bibliography: ['.bib'], addbibresource: ['.bib'],
}
const pathText = /^[\p{L}\p{N}_./+ -]+$/u

function rewriteReferences(source: string, root: string, nextRoot: string, paths: Set<string>, move: (path: string) => string,
  warn: (offset: number, command: string) => void,
) {
  const text = maskLatexCode(source)
  const commands = /\\(?:\\|(input|include|includegraphics|XeTeXpicfile|bibliography|addbibresource|graphicspath|includeonly)(?![\w@])\*?)/g
  const edits: TextEdit[] = []
  for (const match of text.matchAll(commands)) {
    const command = match[1]
    if (!command) continue
    let start = match.index + match[0].length
    while (/\s/.test(text[start] ?? '')) start++
    if (!Object.hasOwn(extensions, command)) {
      warn(start, command)
      continue
    }
    if (text[start] === '[') {
      const end = groupEnd(text, start, '[', ']')
      if (end < 0) { warn(start, command); continue }
      start = end + 1
      while (/\s/.test(text[start] ?? '')) start++
    }
    const delimiter = text[start]
    const braced = delimiter === '{'
    const quoted = command === 'XeTeXpicfile' && delimiter === '"'
    const end = braced ? groupEnd(text, start, '{', '}') : quoted ? text.indexOf('"', start + 1)
      : command === 'input' || command === 'XeTeXpicfile' ? start + (/^[^\s{}\\]+/.exec(text.slice(start))?.[0].length ?? 0) : -1
    if (end <= start) { warn(start, command); continue }
    const from = start + Number(braced || quoted)
    const alternatives = command === 'bibliography' ? /[^,]+/g : /[\s\S]+/g
    for (const value of text.slice(from, end).matchAll(alternatives)) {
      const literal = value[0].trim()
      if (!literal || literal.startsWith('/') || !pathText.test(literal)) { warn(start, command); continue }
      const path = absolute(root, literal)
      if (!path) { warn(start, command); continue }
      const choices = paths.has(path) ? [path] : extensions[command].map(ext => path + ext).filter(candidate => paths.has(candidate))
      if (choices.length !== 1) { warn(start, command); continue }
      const resolved = choices[0]
      const target = move(resolved)
      if (root === nextRoot && resolved === target) continue
      const suffix = resolved.slice(path.length)
      let replacement = relative(nextRoot, suffix ? target.slice(0, -suffix.length) : target)
      if (!pathText.test(replacement)) { warn(start, command); continue }
      if (!braced && !quoted && replacement.includes(' ')) replacement = command === 'input' ? '{' + replacement + '}' : '"' + replacement + '"'
      if (replacement === literal) continue
      const offset = from + value.index + value[0].indexOf(literal)
      edits.push({ start: offset, end: offset + literal.length, text: replacement })
    }
  }
  return edits
}

function applyEdits(source: string, edits: TextEdit[]) {
  let next = source
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (source.slice(edit.start, edit.end).includes('\n')) throw new Error('A path spans multiple lines and needs manual review.')
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  }
  return next
}

export function planFileOperation(project: ProjectFileSystem, writing: PortableWritingState, main: string, operation: FileOperation) {
  if (project.metadata.sourceMode !== 'archive') throw new Error('Open an editable LaTeX project to change source paths.')
  const { to } = operation
  if (!isProjectPath(to) || !pathText.test(to)) throw new Error('Enter a valid project-relative path.')
  const moving = operation.kind === 'move' ? project.files.get(operation.from) : undefined
  const from = operation.kind === 'move' ? operation.from : ''
  if (operation.kind === 'move' && (!moving || 'files' in moving || moving.type === 'generated' || from === to
    || from.split('.').at(-1)?.toLowerCase() !== to.split('.').at(-1)?.toLowerCase())) {
    throw new Error('Choose a different file path with the same extension.')
  }
  const occupied = new Set([...project.files.keys(), ...Object.keys(writing.drafts)].filter(path => path !== from)
    .map(path => path.toLowerCase()))
  const destination = to.toLowerCase()
  if ([...occupied].some(path => path.replace(/\/$/, '') === destination || path.startsWith(destination + '/')
    || (!path.endsWith('/') && destination.startsWith(path + '/')))) throw new Error('The destination overlaps an existing file or folder.')
  const move = (path: string) => path === from ? to : path
  const root = directory(main)
  const nextMain = move(main)
  const nextRoot = directory(nextMain)
  if (operation.kind === 'chapter' && (!/\.tex$/i.test(to) || !operation.title.trim() || /[\\{}%#$^&_~\r\n]/.test(operation.title)
    || !to.startsWith(root) || editableSource(project, operation.parent) === undefined)) {
    throw new Error('Choose an editable parent, a plain-text title and a .tex path beneath the main file directory.')
  }
  const paths = new Set([...project.files].filter(([, item]) => !('files' in item)).map(([path]) => path))
  const changes: ReferenceChange[] = []
  const warningMap = new Map<string, Warning>()
  function rewrite(path: string, source: string, layer: string) {
    const edits = operation.kind === 'move' && /\.(tex|sty|cls)$/i.test(path)
      ? rewriteReferences(source, root, nextRoot, paths, move, (offset, command) => {
        const line = lineNumber(source, offset)
        warningMap.set(JSON.stringify([path, line, command]), { path, line, command })
      }) : []
    if (operation.kind === 'chapter' && path === operation.parent) {
      const end = /\\end\s*\{document\}/.exec(maskLatexCode(source))?.index ?? source.length
      const eol = source.includes('\r\n') ? '\r\n' : source.includes('\r') && !source.includes('\n') ? '\r' : '\n'
      edits.push({ start: end, end, text: eol + '\\input{' + relative(root, to).replace(/\.tex$/i, '') + '}' + eol })
    }
    for (const edit of edits) if (layer !== 'baseline') changes.push({ path, line: lineNumber(source, edit.start),
      from: source.slice(edit.start, edit.end), to: edit.text.trim(), layer })
    return applyEdits(source, edits)
  }
  const files: ProjectFileSystem['files'] = new Map()
  const drafts: PortableWritingState['drafts'] = Object.create(null)
  const now = new Date().toISOString()
  for (const file of project.files.values()) {
    const path = move(file.path)
    if ('files' in file) { files.set(path, file); continue }
    const content = typeof file.content === 'string' ? rewrite(file.path, file.content, 'saved source') : undefined
    if (content !== file.content && !file.metadata?.editable) throw new Error('A reference in a read-only file needs manual review.')
    const item: ProjectFile = path === file.path && content === file.content ? file : {
      ...file, path, name: path.split('/').at(-1)!, content,
      ...(content !== file.content ? { blob: undefined, size: undefined, metadata: { ...file.metadata!, lastModified: now } } : {}),
    }
    files.set(path, item)
  }
  for (const [path, draft] of Object.entries(writing.drafts)) {
    drafts[move(path)] = { text: rewrite(path, draft.text, 'local draft'), base: rewrite(path, draft.base, 'baseline') }
  }
  if (operation.kind === 'chapter') {
    const label = to.replace(/\.tex$/i, '').replace(/[^A-Za-z0-9:_-]/g, '-')
    let key = 'sec:' + label
    const allSources = [...files.values()].flatMap(file => 'content' in file ? [file.content ?? ''] : [])
    for (let suffix = 2; allSources.some(source => source.includes('{' + key + '}')); suffix++) key = 'sec:' + label + '-' + suffix
    files.set(to, { path: to, name: to.split('/').at(-1)!, type: 'editable',
      content: '\\subsection{' + operation.title.trim() + '}\n\\label{' + key + '}\n\n', metadata: { editable: true } })
  }
  const bindings: { title: string; page: string; kind: string }[] = []
  const movedText = writing.drafts[from]?.text ?? (moving && 'content' in moving ? moving.content : undefined)
  const movedLabels = movedText && /\.tex$/i.test(from) ? indexLatexLabels([[from, movedText]]) : undefined
  const movedKeys = movedText && /\.bib$/i.test(from) ? new Set(parseBibliography(from, movedText).map(entry => entry.key)) : undefined
  const canvas = project.canvas && { ...project.canvas, pages: project.canvas.pages.map(page => ({
    ...page, nodes: page.nodes.map(node => {
      const { data } = node
      const anchors = { sourceAnchor: data.sourceAnchor, figureAnchor: data.figureAnchor, selectionAnchor: data.selectionAnchor, resource: data.resource }
      function record(kind: string) { bindings.push({ title: researchNodeTitle(data), page: page.name, kind }) }
      if (anchors.sourceAnchor?.kind === 'heading' && anchors.sourceAnchor.path === from) {
        anchors.sourceAnchor = { ...anchors.sourceAnchor, path: to }
        record('Section or review')
      }
      if (anchors.sourceAnchor?.kind === 'label' && movedLabels?.has(anchors.sourceAnchor.label)) record('Section or review · label retained')
      if (anchors.figureAnchor?.path === from) {
        anchors.figureAnchor = { ...anchors.figureAnchor, path: to }
        record('LaTeX block or review')
      }
      if (anchors.selectionAnchor) {
        const anchor = anchors.selectionAnchor
        const path = move(anchor.path)
        const before = writing.drafts[anchor.path]?.text ?? editableSource(project, anchor.path)
        const item = files.get(path)
        const after = drafts[path]?.text ?? (item && 'content' in item ? item.content : undefined)
        if (path !== anchor.path || before !== after) {
          const location = before === undefined ? undefined : resolveSelectionAnchor(project.metadata.createdAt, before, anchor)
          const relocated = after === undefined ? undefined : resolveSelectionAnchor(project.metadata.createdAt, after, anchor)
          if (location && relocated && after !== undefined) {
            anchors.selectionAnchor = makeSelectionAnchor(project.metadata.createdAt, path, after, relocated.start, relocated.end)
              ?? { ...anchor, path }
          } else anchors.selectionAnchor = { ...anchor, path }
          record('Review selection')
        }
      }
      if (anchors.resource && 'path' in anchors.resource && anchors.resource.path === from) {
        anchors.resource = { ...anchors.resource, path: to }
        record('Project attachment')
      }
      if (anchors.resource?.kind === 'bibliography' && movedKeys?.has(anchors.resource.key)) record('Bibliography · key retained')
      return anchors.sourceAnchor === data.sourceAnchor && anchors.figureAnchor === data.figureAnchor
        && anchors.selectionAnchor === data.selectionAnchor && anchors.resource === data.resource
        ? node : { ...node, data: { ...data, ...anchors } }
    }),
  })) }
  const view = writing.view && { ...writing.view, path: move(writing.view.path) }
  return {
    project: { ...project, files: rebuildProjectDirectories(files), canvas,
      metadata: { ...project.metadata, mainFile: nextMain || project.metadata.mainFile, updatedAt: now } },
    writing: { drafts, view }, changes, bindings, warnings: [...warningMap.values()],
    draftPaths: Object.keys(writing.drafts).filter(path => move(path) !== path
      || drafts[path].text !== writing.drafts[path].text || drafts[path].base !== writing.drafts[path].base),
    mainChanged: nextMain !== main,
  }
}
