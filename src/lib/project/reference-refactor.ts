import { researchNodeTitle } from './canvas-search'
import { indexCrossReferences } from './cross-references'
import { updateFileContent } from './file-system'
import { groupEnd, indexLatexLabels, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'
import { bibliographyKeyUses, bibliographyRecords, findCitations, parseBibliography } from './references'
import { makeSelectionAnchor, resolveSelectionAnchor } from './review-links'
import type { ProjectFileSystem } from './types'
import { editableSource, type PortableWritingState } from './writing-drafts'

export type ReferenceOperation = { kind: 'citation' | 'label'; from: string; to: string }
  | { kind: 'merge'; path: string; name: string; source: string }

type Edit = SourceLocation & { text: string }
type Change = { path: string; line: number; layer: string; from: string; to: string }
type Binding = { page: string; title: string; kind: string }
const latexFile = /\.(?:tex|sty|cls)$/i
const bibliographyFile = /\.bib$/i
const literalKey = /^[\p{L}\p{N}_:.+/=-]+$/u
const definitionCommands = /\\(?:\\|bibitem(?![a-zA-Z@]))/g

function bibItems(path: string, source: string) {
  const text = maskLatexCode(source)
  const items: (SourceLocation & { key: string })[] = []
  for (const match of text.matchAll(definitionCommands)) {
    if (!match[0].endsWith('bibitem')) continue
    let start = match.index + match[0].length
    while (/\s/.test(text[start] ?? '')) start++
    if (text[start] === '[') {
      const end = groupEnd(text, start, '[', ']')
      if (end === -1) continue
      start = end + 1
      while (/\s/.test(text[start] ?? '')) start++
    }
    if (text[start] !== '{') continue
    const end = groupEnd(text, start, '{', '}')
    if (end === -1) continue
    const key = text.slice(start + 1, end).trim()
    if (!literalKey.test(key)) continue
    start = text.indexOf(key, start + 1)
    items.push({ path, start, end: start + key.length, line: lineNumber(source, start), key })
  }
  return items
}

function rewrite(source: string, edits: Edit[]) {
  return [...edits].sort((a, b) => b.start - a.start).reduce((text, edit) =>
    text.slice(0, edit.start) + edit.text + text.slice(edit.end), source)
}

function shifted(offset: number, edits: Edit[], end: boolean) {
  let delta = 0
  for (const edit of edits) {
    if (offset <= edit.start) break
    if (offset < edit.end) return edit.start + delta + (end ? edit.text.length : 0)
    delta += edit.text.length - (edit.end - edit.start)
  }
  return offset + delta
}

export function planReferenceOperation(project: ProjectFileSystem, writing: PortableWritingState, operation: ReferenceOperation) {
  const working = new Map<string, string>()
  const saved = new Map<string, string>()
  const base = new Map<string, string>()
  for (const file of project.files.values()) {
    if (!('content' in file) || typeof file.content !== 'string' || (!latexFile.test(file.path) && !bibliographyFile.test(file.path))) continue
    const draft = writing.drafts[file.path]
    saved.set(file.path, file.content)
    working.set(file.path, draft?.text ?? file.content)
    base.set(file.path, draft?.base ?? file.content)
  }
  let updated = project
  const drafts = { ...writing.drafts }
  const changes: Change[] = []
  const bindings: Binding[] = []
  const skipped: string[] = []
  const added: string[] = []
  const warnings: string[] = []

  function updateSaved(path: string, text: string) {
    if (editableSource(project, path) === undefined) throw new Error(`${path} is read-only. Review its references manually.`)
    updated = updateFileContent(updated, path, text)
  }

  if (operation.kind === 'merge') {
    const { path, name, source } = operation
    const current = working.get(path)
    if (!bibliographyFile.test(path) || current === undefined || editableSource(project, path) === undefined) {
      throw new Error('Choose an editable bibliography file in this project.')
    }
    const incoming = bibliographyRecords(name, source)
    if (!incoming.length) throw new Error('The uploaded file contains no recognized BibTeX entries.')
    const occupied = new Set([saved, working, base].flatMap(layer => [...layer].flatMap(([file, text]) =>
      bibliographyFile.test(file) ? parseBibliography(file, text).map(entry => entry.key) : [])))
    const seen = new Set<string>()
    for (const { entry } of incoming) {
      if (seen.has(entry.key)) throw new Error(`The uploaded file repeats the key ${entry.key}. Give each entry a unique key before importing.`)
      seen.add(entry.key)
      if (occupied.has(entry.key)) skipped.push(entry.key)
      else added.push(entry.key)
    }
    if (!added.length) throw new Error('Every uploaded entry conflicts with a key in this project. Rename the incoming keys before importing.')
    if (/^\s*@\s*(string|preamble)\s*[({]/im.test(source)) {
      throw new Error('This file defines BibTeX strings or preamble code. Expand the strings and review the preamble before merging.')
    }
    const eol = current.includes('\r\n') ? '\r\n' : '\n'
    const additions = incoming.filter(item => !occupied.has(item.entry.key))
      .map(({ start, end }) => source.slice(start, end).replace(/\r\n|\r|\n/g, eol)).join(eol + eol)
    const text = current + (current.trim() ? eol + eol : '') + additions + eol
    drafts[path] = { base: drafts[path]?.base ?? saved.get(path)!, text }
  } else {
    const { kind, from, to } = operation
    if (!literalKey.test(to) || to === from) throw new Error('Enter a different literal key using letters, numbers, or _ : . + / = -.')
    const definitionIndex = (layer: Map<string, string>) => {
      const tex = [...layer].filter(([path]) => latexFile.test(path))
      if (kind === 'label') return indexLatexLabels(tex)
      const definitions = new Map<string, SourceLocation[]>()
      for (const [path, text] of layer) {
        if (!bibliographyFile.test(path)) continue
        for (const item of parseBibliography(path, text)) definitions.set(item.key, [...definitions.get(item.key) ?? [], item])
      }
      return definitions
    }
    const indexes = [working, saved, base].map(definitionIndex)
    if (indexes[0].get(from)?.length !== 1 || indexes.some(index => (index.get(from)?.length ?? 0) > 1)) {
      throw new Error('This key needs one unambiguous definition. Resolve duplicate keys before renaming.')
    }
    if (indexes.some(index => index.has(to))) throw new Error('The new key is already defined in the project or a draft.')

    const editsByPath = new Map<string, Edit[]>()
    const manual = new Set<string>()
    function editLayer(layer: Map<string, string>, name: string, index: Map<string, SourceLocation[]>) {
      const references = kind === 'label' ? indexCrossReferences(new Map([...layer].filter(([path]) => latexFile.test(path))), index).uses : undefined
      return new Map([...layer].map(([path, source]) => {
        const uses = latexFile.test(path) ? references
          ? [...references.get(from) ?? [], ...references.get(to) ?? []].filter(use => use.path === path)
          : [...findCitations(path, source), ...bibItems(path, source)]
          : kind === 'citation' ? bibliographyKeyUses(path, source) : []
        if (uses.some(use => use.key === to)) throw new Error('The new key is already used by a reference. Choose a different key.')
        const edits = [...(index.get(from) ?? []).filter(item => item.path === path), ...uses.filter(use => use.key === from)]
          .map(item => ({ ...item, text: to })).sort((a, b) => a.start - b.start)
        const masked = latexFile.test(path) ? maskLatexCode(source) : source.replace(/%[^\r\n]*/g, match => ' '.repeat(match.length))
        let offset = masked.indexOf(from)
        while (offset !== -1) {
          if (!edits.some(edit => edit.start === offset)) manual.add(path)
          offset = masked.indexOf(from, offset + from.length)
        }
        if (name === 'working') editsByPath.set(path, edits)
        if (name === 'saved source' || (name === 'working' && Object.hasOwn(writing.drafts, path))) {
          for (const item of edits) changes.push({ path, line: item.line, layer: name === 'working' ? 'local draft' : name, from, to })
        }
        return [path, edits.length ? rewrite(source, edits) : source] as const
      }))
    }
    const nextWorking = editLayer(working, 'working', indexes[0])
    const nextSaved = editLayer(saved, 'saved source', indexes[1])
    const nextBase = editLayer(base, 'baseline', indexes[2])
    warnings.push(...[...manual].map(path => `${path} also mentions ${from} outside recognized definitions and reference commands. Review those occurrences manually.`))
    for (const [path, text] of nextSaved) if (text !== saved.get(path)) updateSaved(path, text)
    for (const [path, draft] of Object.entries(writing.drafts)) {
      drafts[path] = { base: nextBase.get(path) ?? draft.base, text: nextWorking.get(path) ?? draft.text }
    }

    const projectId = project.metadata.createdAt
    const canvas = project.canvas && { ...project.canvas, pages: project.canvas.pages.map(page => ({
      ...page, nodes: page.nodes.map(node => {
        const data = { ...node.data }
        const record = (type: string) => bindings.push({ page: page.name, title: researchNodeTitle(data), kind: type })
        if (kind === 'citation' && data.resource?.kind === 'bibliography' && data.resource.project === projectId && data.resource.key === from) {
          data.resource = { ...data.resource, key: to }; record('Bibliography')
        }
        if (kind === 'label' && data.sourceAnchor?.kind === 'label' && data.sourceAnchor.project === projectId && data.sourceAnchor.label === from) {
          data.sourceAnchor = { ...data.sourceAnchor, label: to }; record('Section or review')
        }
        if (kind === 'label' && data.figureAnchor?.project === projectId && data.figureAnchor.label === from) {
          data.figureAnchor = { ...data.figureAnchor, label: to }; record('LaTeX block or review')
        }
        const anchor = data.selectionAnchor
        if (anchor && anchor.project === projectId && editsByPath.get(anchor.path)?.length) {
          const text = working.get(anchor.path)!
          const location = resolveSelectionAnchor(projectId, text, anchor)
          if (location) {
            const edits = editsByPath.get(anchor.path)!
            data.selectionAnchor = makeSelectionAnchor(projectId, anchor.path, nextWorking.get(anchor.path)!,
              shifted(location.start, edits, false), shifted(location.end, edits, true)) ?? anchor
            if (data.selectionAnchor !== anchor) record('Review selection')
          }
        }
        return data.resource === node.data.resource && data.sourceAnchor === node.data.sourceAnchor
          && data.figureAnchor === node.data.figureAnchor && data.selectionAnchor === node.data.selectionAnchor ? node : { ...node, data }
      }),
    })) }
    updated = { ...updated, canvas }
  }

  const draftPaths = Object.keys(drafts).filter(path => drafts[path].text !== writing.drafts[path]?.text || drafts[path].base !== writing.drafts[path]?.base)
  return { project: updated, writing: { ...writing, drafts }, changes, bindings, draftPaths, added, skipped, warnings }
}
