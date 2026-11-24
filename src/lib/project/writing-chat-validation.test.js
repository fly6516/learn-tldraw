import { expect, test } from 'bun:test'
import { buildValidationSnapshot, originalDiagnosticLine, verificationBaseline, verificationPatch } from './writing-chat-validation'

function project() {
  return {
    files: new Map([
      ['methods.tex', { path: 'methods.tex', type: 'editable', metadata: { editable: true }, content: 'Method.\nDetails.' }],
      ['results.tex', { path: 'results.tex', type: 'editable', metadata: { editable: true }, content: 'Figure.\nResult.' }],
      ['plot.png', { path: 'plot.png', type: 'asset', blob: new Blob(['12']) }],
    ]),
    metadata: { mainFile: 'methods.tex' },
  }
}

const edits = [
  { path: 'methods.tex', before: 'Method.', after: 'Protocol.' },
  { path: 'results.tex', before: 'Figure.', after: 'Figure.\n\\badcommand' },
]

test('builds a multi-file temporary snapshot without writing to the working project or including unchecked changes', () => {
  const saved = project()
  const run = { main: 'methods.tex', sources: {
    'methods.tex': { saved: 'Method.\nDetails.' }, 'results.tex': { saved: 'Figure.\nResult.' },
  } }
  const { candidate, changed } = buildValidationSnapshot(saved, saved, {}, run, edits)
  expect(changed.size).toBe(2)
  expect(candidate.files.get('results.tex').content).toBe('Figure.\n\\badcommand\nResult.')
  expect(saved.files.get('results.tex').content).toBe('Figure.\nResult.')
  expect(buildValidationSnapshot(saved, saved, {}, run, edits.slice(0, 1)).candidate.files.get('results.tex').content)
    .toBe('Figure.\nResult.')
  expect(() => buildValidationSnapshot(saved, saved, { 'results.tex': { base: 'Figure.\nResult.', text: 'New result' } }, run, edits))
    .toThrow('results.tex')
})

test('binds verification to the exact patch, all project inputs, local drafts, and the compile entry', async () => {
  const saved = project()
  const baseline = await verificationBaseline(saved, {})
  expect(await verificationBaseline(project(), {})).toBe(baseline)
  const reloaded = project()
  const methods = reloaded.files.get('methods.tex')
  reloaded.files.set('methods.tex', { ...methods, blob: new Blob([methods.content]) })
  expect(await verificationBaseline(reloaded, {})).toBe(baseline)
  const other = project()
  other.files.set('plot.png', { path: 'plot.png', type: 'asset', blob: new Blob(['34']) })
  expect(await verificationBaseline(other, {})).not.toBe(baseline)
  expect(await verificationBaseline({ ...saved, metadata: { mainFile: 'results.tex' } }, {})).not.toBe(baseline)
  const configure = (engine, bibliography) => ({ ...saved, metadata: { ...saved.metadata, compileProfile: { engine, bibliography } } })
  expect(await verificationBaseline(configure('tectonic', 'auto'), {})).toBe(baseline)
  expect(await verificationBaseline(configure('pdflatex', 'biber'), {})).not.toBe(baseline)
  expect(await verificationBaseline(configure('pdflatex', 'auto'), {})).not.toBe(await verificationBaseline(configure('pdflatex', 'biber'), {}))
  expect(await verificationBaseline(saved, { 'results.tex': { base: 'Figure.\nResult.', text: 'Changed' } })).not.toBe(baseline)
  expect(await verificationPatch(edits.slice(0, 1))).not.toBe(await verificationPatch(edits))
})

test('maps temporary compiler lines back to the live LaTeX source after inserted lines', () => {
  const original = 'Figure.\nResult.'
  const patched = 'Figure.\n\\badcommand\nResult.'
  expect(originalDiagnosticLine(original, patched, [edits[1]], 2)).toBe(1)
  expect(originalDiagnosticLine(original, patched, [edits[1]], 3)).toBe(2)
  expect(originalDiagnosticLine(original, patched, [edits[1]], 4)).toBeUndefined()
})
