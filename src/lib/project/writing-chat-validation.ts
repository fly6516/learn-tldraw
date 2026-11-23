import { applyProjectEdits, type ProjectSuggestion } from './ai-edit'
import type { CompileDiagnostic, CompileReport } from './compile-diagnostics'
import { updateFileContent } from './file-system'
import { lineNumber, sourceOffsetAtPosition } from './latex-source'
import { collectBibliography, findNewUnknownCitations } from './references'
import { exportSourceArchive, sourceArchiveEntry } from './source-archive'
import type { ProjectFileSystem } from './types'
import type { ChatRun } from './writing-chat'
import { editableSource, sameDraft, type WritingDrafts } from './writing-drafts'

type Edits = ProjectSuggestion['edits']
export type VerificationDiagnostic = CompileDiagnostic & { sourceLine?: number }
export type ChatVerification = {
  baseline: string
  patch: string
  compiledBaseline: string
  selected: number[]
  currentSelection?: number[]
  main: string
  status: 'passed' | 'failed'
  diagnostics: VerificationDiagnostic[]
  message: string
  log: string
}

const encoder = new TextEncoder()
const binaryHashes = new WeakMap<Blob, Promise<string>>()
async function digest(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

function binaryHash(blob: Blob) {
  let hash = binaryHashes.get(blob)
  if (!hash) {
    hash = blob.arrayBuffer().then(digest)
    binaryHashes.set(blob, hash)
  }
  return hash
}

export async function verificationBaseline(project: ProjectFileSystem, drafts: WritingDrafts) {
  // Sort paths so reloading IndexedDB or reordering the Canvas cannot change the identity.
  const files = await Promise.all([...project.files.keys()].sort().map(async path => {
    const file = project.files.get(path)!
    const content = sourceArchiveEntry(file)
    return [path, file.type, 'content' in file ? file.content : null,
      content instanceof Blob ? await binaryHash(content) : content === undefined ? undefined : await digest(encoder.encode(content))]
  }))
  const localDrafts = Object.keys(drafts).sort().map(path => [path, drafts[path].base, drafts[path].text])
  return digest(encoder.encode(JSON.stringify([project.metadata.mainFile, files, localDrafts])))
}

export function verificationPatch(edits: Edits) {
  return digest(encoder.encode(JSON.stringify(edits.map(({ path, before, after }) => [path, before, after]))))
}

export function buildValidationSnapshot(project: ProjectFileSystem, working: ProjectFileSystem, drafts: WritingDrafts, run: ChatRun, edits: Edits) {
  if (run.main !== project.metadata.mainFile) throw new Error('The compile entry changed. Request a new proposal.')
  const sources = new Map<string, string>()
  for (const path of new Set(edits.map(edit => edit.path))) {
    const expected = Object.hasOwn(run.sources, path) ? run.sources[path] : undefined
    const saved = editableSource(project, path)
    const source = editableSource(working, path)
    if (!expected || source === undefined || expected.saved !== saved || !sameDraft(expected.draft, drafts[path])) {
      throw new Error(`Source or local draft changed in ${path}. Request a new proposal.`)
    }
    sources.set(path, source)
  }
  const changed = applyProjectEdits(sources, edits)
  const candidate = [...changed].reduce((target, [path, text]) => updateFileContent(target, path, text), working)
  return { candidate, sources, changed }
}

export function originalDiagnosticLine(original: string, patched: string, edits: Edits, line: number) {
  if (!Number.isInteger(line) || line < 1 || line > patched.split(/\r\n|\r|\n/).length) return
  const offset = sourceOffsetAtPosition(patched, { lineNumber: line, column: 1 })
  const ordered = edits.map(edit => ({ ...edit, start: original.indexOf(edit.before) })).sort((a, b) => a.start - b.start)
  let delta = 0
  for (const edit of ordered) {
    const start = edit.start + delta
    if (offset < start) break
    if (offset < start + edit.after.length) return lineNumber(original, edit.start)
    delta += edit.after.length - edit.before.length
  }
  return lineNumber(original, offset - delta)
}

export async function validateChatProposal(input: {
  project: ProjectFileSystem; working: ProjectFileSystem; drafts: WritingDrafts; run: ChatRun
  edits: Edits; selected: number[]; main: string; signal: AbortSignal
}): Promise<ChatVerification> {
  const { project, working, drafts, run, edits, selected, main, signal } = input
  signal.throwIfAborted()
  if (!main || !edits.length) throw new Error('Select at least one change and a compile entry.')
  const { candidate, sources, changed } = buildValidationSnapshot(project, working, drafts, run, edits)
  const [baseline, patch, archive, compiledBaseline] = await Promise.all([
    verificationBaseline(project, drafts), verificationPatch(edits), exportSourceArchive(candidate),
    verificationBaseline(candidate, {}),
  ])
  signal.throwIfAborted()
  const bibliography = collectBibliography(candidate)
  const citations = [...changed].flatMap(([path, text]) => findNewUnknownCitations(path, sources.get(path)!, text, bibliography)
    .map(({ line, key }): CompileDiagnostic => ({ path, line, severity: 'error', message: `New unknown citation: ${key}` })))
  const response = await fetch(`/api/latex/compile?main=${encodeURIComponent(main)}&sync=1`, { method: 'POST', body: archive, signal })
  let report: Partial<CompileReport> & { error?: string }
  if (response.ok) {
    const form = await response.formData()
    if (!(form.get('pdf') instanceof Blob)) throw new Error('The compiler did not return a PDF.')
    const data = form.get('report')
    report = typeof data === 'string' ? JSON.parse(data) : {}
  } else {
    report = await response.json()
  }
  const issues = [...citations, ...(report.diagnostics ?? [])]
  const passed = response.ok && !issues.some(issue => issue.severity === 'error')
  const diagnostics = issues.slice(0, 50).map(issue => {
    const file = working.files.get(issue.path)
    const original = file && 'content' in file ? file.content : undefined
    const patched = changed.get(issue.path) ?? original
    return { ...issue, sourceLine: original === undefined || patched === undefined ? undefined
      : originalDiagnosticLine(original, patched, edits.filter(edit => edit.path === issue.path), issue.line) }
  })
  return { baseline, patch, compiledBaseline, selected, main, diagnostics, status: passed ? 'passed' : 'failed',
    message: passed ? report.hasWarnings || diagnostics.length ? 'Compiled with warnings.' : 'Compiled successfully.'
      : report.error ?? 'Validation found errors in the selected changes.',
    log: report.log?.slice(-8000) ?? '' }
}
