import { applyProjectEdits, type ProjectSuggestion } from './ai-edit'
import type { CompileDiagnostic, CompileReport } from './compile-diagnostics'
import { updateFileContent } from './file-system'
import { lineNumber, sourceOffsetAtPosition } from './latex-source'
import { buildManuscriptSnapshot } from './manuscript-review'
import { collectBibliography, findNewUnknownCitations } from './references'
import { exportSourceArchive, sourceArchiveEntry } from './source-archive'
import type { ProjectFileSystem } from './types'
import type { ChatCheckpoint, ChatRun } from './writing-chat'
import { editableSource, sameDraft, type WritingDrafts } from './writing-drafts'

type Edits = ProjectSuggestion['edits']
export type VerificationDiagnostic = CompileDiagnostic & { sourceLine?: number }
export type ChatVerification = {
  baseline: string
  patch: string
  compiledBaseline: string
  selected: number[]
  currentSelection?: number[]
  working?: boolean
  manuscript?: { paths: string[]; accepted: string[] }
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
  edits: Edits; selected: number[]; main: string; signal: AbortSignal; verifyWorking?: boolean
}): Promise<ChatVerification> {
  const { project, working, drafts, run, edits, selected, main, signal, verifyWorking } = input
  signal.throwIfAborted()
  if (!main || !edits.length) throw new Error('Select at least one change and a compile entry.')
  const { candidate, sources, changed } = verifyWorking ? {
    candidate: working,
    sources: new Map(Object.entries(run.sources).map(([path, source]) => [path, source.draft?.text ?? source.saved])),
    changed: new Map([...new Set(edits.map(edit => edit.path))].flatMap(path => {
      const source = editableSource(working, path)
      return source === undefined ? [] : [[path, source] as const]
    })),
  } : buildValidationSnapshot(project, working, drafts, run, edits)
  const result = await compileChatSnapshot(project, drafts, candidate, changed, sources, main, signal, verificationPatch(edits))
  const diagnostics = result.diagnostics.map(issue => {
    const file = working.files.get(issue.path)
    const original = file && 'content' in file ? file.content : undefined
    const patched = changed.get(issue.path) ?? original
    return { ...issue, sourceLine: original === undefined || patched === undefined ? undefined : verifyWorking ? issue.line
      : originalDiagnosticLine(original, patched, edits.filter(edit => edit.path === issue.path), issue.line) }
  })
  return { ...result, diagnostics, selected, working: verifyWorking }
}

export async function validateManuscript(input: {
  project: ProjectFileSystem; working: ProjectFileSystem; drafts: WritingDrafts; checkpoints: ChatCheckpoint[]
  paths: string[]; accepted: string[]; signal: AbortSignal
}): Promise<ChatVerification> {
  const { project, working, drafts, checkpoints, paths, accepted, signal } = input
  const { candidate, checkpoint } = buildManuscriptSnapshot(project, drafts, checkpoints, paths, accepted)
  const before = new Map(paths.map(path => [path, checkpoint.before[path].saved]))
  const after = new Map(paths.map(path => [path, checkpoint.after[path].saved]))
  const result = await compileChatSnapshot(project, drafts, candidate, after, before, checkpoint.main, signal, Promise.resolve(''))
  const diagnostics = result.diagnostics.map(issue => {
    const compiled = candidate.files.get(issue.path)
    const live = working.files.get(issue.path)
    const sourceLine = compiled && live && 'content' in compiled && 'content' in live && compiled.content === live.content
      && compiled.content && issue.line <= compiled.content.split(/\r\n|\r|\n/).length ? issue.line : undefined
    return { ...issue, sourceLine }
  })
  return { ...result, diagnostics, patch: result.compiledBaseline, selected: [], manuscript: { paths, accepted } }
}

async function compileChatSnapshot(project: ProjectFileSystem, drafts: WritingDrafts, candidate: ProjectFileSystem,
  changed: Map<string, string>, sources: Map<string, string>, main: string, signal: AbortSignal, patchHash: Promise<string>) {
  signal.throwIfAborted()
  const [baseline, patch, archive, compiledBaseline] = await Promise.all([
    verificationBaseline(project, drafts), patchHash, exportSourceArchive(candidate),
    verificationBaseline(candidate, {}),
  ])
  signal.throwIfAborted()
  const bibliography = collectBibliography(candidate)
  const citations = [...changed].flatMap(([path, text]) => findNewUnknownCitations(path, sources.get(path) ?? '', text, bibliography)
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
  const diagnostics = issues.slice(0, 50)
  return { baseline, patch, compiledBaseline, main, diagnostics, status: passed ? 'passed' as const : 'failed' as const,
    message: passed ? report.hasWarnings || diagnostics.length ? 'Compiled with warnings.' : 'Compiled successfully.'
      : report.error ?? 'Validation found errors in the selected changes.',
    log: report.log?.slice(-8000) ?? '' }
}
