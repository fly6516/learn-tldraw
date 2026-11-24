import { expect, test } from 'bun:test'
import JSZip from 'jszip'
import { decodeProjectBackup, encodeProjectBackup } from './backup'
import { addFigure, createProjectFileSystem, updateFileContent } from './file-system'
import { emptyPage } from './research-graph'
import { applyWritingDrafts } from './writing-drafts'

const template = { documentClass: 'article', preamble: '', packages: [], metadata: {} }
const node = (id, x, data = {}) => ({
  id, position: { x, y: 274 }, data: { section: 'custom', content: id, level: 1, order: 1, ...data },
})
const canvas = {
  activePageId: 'results',
  pages: [
    { ...emptyPage(), nodes: [node('intro', 120)] },
    {
      ...emptyPage('Results', 'results'), viewport: { x: 25, y: 30, zoom: 0.7 },
      nodes: [node('results', 620, { sourceAnchor: { kind: 'label', project: 'example', label: 'sec:results' } }),
        node('detail', 100, { parentId: 'results', level: 2, tags: ['test'] })],
      edges: [{ id: 'order', source: 'results', target: 'detail' }],
    },
  ],
}

test('round-trips graph pages, node positions, directed edges, viewports, and attachments', async () => {
  const bytes = Uint8Array.of(0, 37, 128, 255)
  const project = addFigure(
    updateFileContent(createProjectFileSystem(template, 'Portable paper'), 'preamble.tex', 'custom'),
    'figure.png', new Blob([bytes], { type: 'image/png' }),
  )
  project.metadata.compileProfile = { engine: 'pdflatex', bibliography: 'biber' }
  const restored = await decodeProjectBackup(await encodeProjectBackup(canvas, project))
  expect(restored.project.canvas).toEqual(canvas)
  expect(restored.project.metadata.projectName).toBe('Portable paper')
  expect(restored.project.metadata.compileProfile).toEqual({ engine: 'pdflatex', bibliography: 'biber' })
  expect(restored.project.files.get('preamble.tex').content).toBe('custom')
  const figure = restored.project.files.get('figures/figure.png')
  expect(figure.blob.type).toBe('image/png')
  expect(new Uint8Array(await figure.blob.arrayBuffer())).toEqual(bytes)
  expect(restored.project.files.get('figures/').files).toEqual([figure])
})

test('rejects old backups, invalid graphs and missing attachments', async () => {
  const project = addFigure(createProjectFileSystem(template), 'figure.png', new Blob(['image']))
  const backup = await encodeProjectBackup(canvas, project)
  const archive = await JSZip.loadAsync(await backup.arrayBuffer())
  const manifest = JSON.parse(await archive.file('project.json').async('text'))
  async function read(candidate) {
    archive.file('project.json', JSON.stringify(candidate))
    return decodeProjectBackup(await archive.generateAsync({ type: 'blob' }))
  }
  await expect(read({ ...manifest, version: 1 })).rejects.toThrow('unsupported version')
  const corrupted = structuredClone(manifest)
  corrupted.canvas.pages[1].edges.push({ id: 'cycle', source: 'detail', target: 'results' })
  await expect(read(corrupted)).rejects.toThrow('invalid')
  archive.remove('attachments')
  await expect(read(manifest)).rejects.toThrow('Missing project attachment')
})

test('keeps portable drafts separate and reports changed or missing baselines on import', async () => {
  const project = updateFileContent(createProjectFileSystem(template), 'preamble.tex', 'Saved preamble')
  const view = { path: 'preamble.tex', lineNumber: 1, column: 3 }
  const writing = { view, drafts: {
    'preamble.tex': { base: 'Saved preamble', text: 'Local draft' },
    'missing.tex': { base: 'Prior source', text: 'Keep this local draft' },
  } }
  const savedOnly = await decodeProjectBackup(await encodeProjectBackup(canvas, project))
  expect(savedOnly.writing).toBeUndefined()
  const portable = await decodeProjectBackup(await encodeProjectBackup(canvas, project, writing))
  expect(portable.writing).toEqual(writing)
  expect(portable.conflicts).toEqual(['missing.tex'])
  expect(portable.project.files.get('preamble.tex').content).toBe('Saved preamble')
  expect(applyWritingDrafts(portable.project, portable.writing.drafts).files.get('preamble.tex').content).toBe('Local draft')
  const conflicting = updateFileContent(project, 'preamble.tex', 'A newer saved version')
  const restored = await decodeProjectBackup(await encodeProjectBackup(canvas, conflicting, writing))
  expect(restored.conflicts).toEqual(['preamble.tex', 'missing.tex'])
  expect(applyWritingDrafts(restored.project, restored.writing.drafts)).toBe(restored.project)
})

test('restores exact submission archives, linked rounds, snapshots and optional AI history', async () => {
  const project = createProjectFileSystem(template)
  const now = project.metadata.createdAt
  const pdf = new Blob(['%PDF-1.4\narchived'], { type: 'application/pdf' })
  const zip = new Blob([Uint8Array.of(80, 75, 3, 4, 170)], { type: 'application/zip' })
  const version = { id: 'v1', name: 'Submission v1', createdAt: now, main: 'main.tex', paths: ['main.tex'], excluded: [],
    drafts: [], issues: [], warnings: false, diagnostics: [], pdf, zip }
  const round = { id: 'round', name: 'Review', createdAt: now, submissionId: 'v1', revisedSubmissionId: 'v2', comments: [
    { id: 'comment', kind: 'comment', target: { type: 'file', path: 'main.tex' }, reviewer: 'Reviewer', text: 'Clarify the methods.',
      response: { kind: 'changed', text: 'The methods were clarified.', paths: ['main.tex'] } },
  ] }
  const history = { publication: { submissions: [version, { ...version, id: 'v2', name: 'Submission v2' }], rounds: [round] },
    snapshots: [{ id: 'snapshot', name: 'Initial', createdAt: now, project }],
    ai: { history: { selected: 'chat', conversations: [{ id: 'chat', title: 'Review', messages: [
      { id: 'user-msg', role: 'user', parts: [{ type: 'text', text: 'Review this.' }], metadata: { run: 'run' } },
      { id: 'local-msg', role: 'assistant', parts: [{ type: 'text', text: 'Review the manifest.' }], metadata: {
        run: 'submission', local: true, complete: true, submission: { name: 'Submission v1' },
        feedback: { status: 'passed', message: 'Compiled.', diagnostics: [] },
      } },
    ], runs: { run: { sources: {}, pathRevision: 0, reply: {
      round: 'round', roundName: 'Review', comment: 'comment', commentText: 'Clarify the methods.',
      originalId: 'v1', revisedId: 'v2', paths: ['main.tex'], kind: 'changed',
    } } } }] }, moves: [{ from: 'old.tex', to: 'main.tex' }],
    tasks: { run: [{ kind: 'reply-saved', at: Date.now() }], submission: [{ kind: 'archived', at: Date.now(), detail: 'Submission v1' }] },
    checkpoints: {}, verifications: {} },
  }
  const exported = await encodeProjectBackup(canvas, project, undefined, history)
  const restored = (await decodeProjectBackup(exported)).history
  expect(restored.publication.rounds).toEqual([round])
  expect(await restored.publication.submissions[0].pdf.text()).toBe(await pdf.text())
  expect(await restored.publication.submissions[0].zip.arrayBuffer()).toEqual(await zip.arrayBuffer())
  expect(restored.snapshots[0].project.files).toEqual(project.files)
  expect(restored.snapshots[0].project.canvas).toBeUndefined()
  expect(restored.ai).toEqual(history.ai)

  const publicationOnly = await decodeProjectBackup(await encodeProjectBackup(canvas, project, undefined, { publication: history.publication }))
  expect(publicationOnly.history.snapshots).toBeUndefined()
  expect(publicationOnly.history.ai).toBeUndefined()

  const archive = await JSZip.loadAsync(await exported.arrayBuffer())
  const manifest = JSON.parse(await archive.file('project.json').async('text'))
  archive.file('history/submissions/0.pdf', '%PDF-1.4\nchanged!')
  await expect(decodeProjectBackup(await archive.generateAsync({ type: 'blob' }))).rejects.toThrow('checksum')
  archive.remove('history/submissions/0.pdf')
  await expect(decodeProjectBackup(await archive.generateAsync({ type: 'blob' }))).rejects.toThrow('Missing project history')
  manifest.history.publication.rounds[0].submissionId = 'missing'
  archive.file('project.json', JSON.stringify(manifest))
  await expect(decodeProjectBackup(await archive.generateAsync({ type: 'blob' }))).rejects.toThrow('invalid')
})

test('carries a pending verified PDF only with AI history and rejects tampered bytes', async () => {
  const project = createProjectFileSystem(template)
  const id = '6bfaca2c-0e53-453b-89f1-d4c0f03d5030'
  const checksum = 'a'.repeat(64)
  const pdf = new Blob(['%PDF-1.4\nverified'], { type: 'application/pdf' })
  const build = { pdf, sourceChecksum: checksum, compiledBaseline: checksum, externalEngine: 'pdflatex' }
  const ai = { history: { selected: 'chat', conversations: [{ id: 'chat', title: 'Pending', messages: [], runs: {},
    manuscript: { id, title: 'Task', goal: 'Revise', files: ['main.tex'], decisions: [], questions: [], batches: [] } }] },
  tasks: {}, moves: [], checkpoints: {}, verifications: { [id]: { main: 'main.tex', compiledBaseline: checksum,
    baseline: checksum, patch: checksum, selected: [], status: 'passed', diagnostics: [], message: 'External', log: '',
    manuscript: { paths: ['main.tex'], accepted: [] } } }, builds: { [id]: build } }
  const exported = await encodeProjectBackup(canvas, project, undefined, { ai })
  expect((await decodeProjectBackup(await encodeProjectBackup(canvas, project))).history?.ai).toBeUndefined()
  const restored = (await decodeProjectBackup(exported)).history.ai.builds[id]
  expect(restored.sourceChecksum).toBe(checksum)
  expect(await restored.pdf.arrayBuffer()).toEqual(await pdf.arrayBuffer())
  const archive = await JSZip.loadAsync(await exported.arrayBuffer())
  archive.file('history/manuscript-builds/0.pdf', '%PDF-1.4\nchanged!')
  await expect(decodeProjectBackup(await archive.generateAsync({ type: 'blob' }))).rejects.toThrow('checksum')
})
