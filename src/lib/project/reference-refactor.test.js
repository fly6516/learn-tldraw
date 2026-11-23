import { expect, test } from 'bun:test'
import { createCanvasFixture } from './canvas-test-fixture'
import { updateFileContent } from './file-system'
import { planReferenceOperation } from './reference-refactor'
import { makeSelectionAnchor, resolveSelectionAnchor } from './review-links'
import { draftConflicts } from './writing-drafts'

test('renames literal labels and citation keys across saved files, drafts, and Canvas bindings', async () => {
  let project = await createCanvasFixture()
  const results = 'sections/results.tex'
  const methods = 'sections/methods.tex'
  const bib = 'references/library.bib'
  const base = '\\section{Results}\n\\label{sec:results}\n\\cite{walk2020}\n'
  const quote = '\\ref{sec:results}'
  const draft = base + quote + '\n% \\ref{sec:results}\n\\verb|\\ref{sec:results}|\n'
  project = updateFileContent(project, results, base)
  project = updateFileContent(project, methods, '\\cref{sec:results, sec:other}\n\\bibitem[Walk]{walk2020}')
  project.files.set(bib, { path: bib, type: 'editable', name: 'library.bib',
    content: '@book{walk2020,title={Walk}}\n@inbook{child,title={Title, crossref={walk2020}}, crossref="walk2020"}', metadata: { editable: true } })
  const id = project.metadata.createdAt
  const page = project.canvas.pages[1]
  const node = { id: 'citation', position: { x: 1, y: 1 }, data: { section: 'custom', level: 1, order: 1, content: 'Keep these notes',
    resource: { kind: 'bibliography', project: id, key: 'walk2020' },
    sourceAnchor: { kind: 'label', project: id, label: 'sec:results' },
    selectionAnchor: makeSelectionAnchor(id, results, draft, draft.indexOf(quote), draft.indexOf(quote) + quote.length),
  } }
  page.nodes.push(node)
  const original = { drafts: { [results]: { base, text: draft } } }
  const renamed = planReferenceOperation(project, original, { kind: 'label', from: 'sec:results', to: 'sec:findings' })
  expect(renamed.project.files.get(methods).content).toContain('\\cref{sec:findings, sec:other}')
  expect(renamed.writing.drafts[results].text).toContain('% \\ref{sec:results}\n\\verb|\\ref{sec:results}|')
  expect(draftConflicts(renamed.project, renamed.writing.drafts)).toEqual([])
  const updated = renamed.project.canvas.pages[1].nodes.at(-1)
  expect(updated.data.sourceAnchor.label).toBe('sec:findings')
  expect(updated.position).toEqual(node.position)
  expect(renamed.project.canvas.pages[1].edges).toBe(page.edges)
  expect(resolveSelectionAnchor(id, renamed.writing.drafts[results].text, updated.data.selectionAnchor)).toBeDefined()
  expect(updated.data.selectionAnchor.quote).toBe('\\ref{sec:findings}')
  const citation = planReferenceOperation(renamed.project, renamed.writing, { kind: 'citation', from: 'walk2020', to: 'walk-study' })
  expect(citation.project.files.get(bib).content).toContain('@book{walk-study')
  expect(citation.project.files.get(bib).content).toContain('title={Title, crossref={walk2020}}, crossref="walk-study"')
  expect(citation.project.files.get(methods).content).toContain('\\bibitem[Walk]{walk-study}')
  expect(citation.writing.drafts[results].text).toContain('\\cite{walk-study}')
  expect(citation.project.canvas.pages[1].nodes.at(-1).data).toMatchObject({ content: 'Keep these notes', resource: { key: 'walk-study' } })
})

test('merges source bytes into an existing draft while keeping duplicate keys unchanged', async () => {
  const project = await createCanvasFixture()
  const path = 'references/library.bib'
  const base = '@book{old,title={Original}}'
  project.files.set(path, { path, type: 'editable', name: 'library.bib', content: base, metadata: { editable: true } })
  const text = base + '\n% unresolved local notes\n'
  const writing = { drafts: { [path]: { base, text } } }
  const plan = planReferenceOperation(project, writing, { kind: 'merge', path, name: 'extra.bib',
    source: '@book{old,title={Do not overwrite}}\n@article{new,title={{Preserve}, braces}}' })
  expect(plan.skipped).toEqual(['old'])
  expect(plan.added).toEqual(['new'])
  expect(plan.project.files.get(path).content).toBe(base)
  expect(plan.writing.drafts[path]).toEqual({ base, text: text + '\n\n@article{new,title={{Preserve}, braces}}\n' })
  expect(() => planReferenceOperation(project, writing, { kind: 'merge', path, name: 'extra.bib',
    source: '@article{same,title={One}}\n@article{same,title={Two}}' })).toThrow('repeats the key')
  const duplicate = { ...writing, drafts: { [path]: { base, text: text + '\n@book{old,title={Conflict}}' } } }
  expect(() => planReferenceOperation(project, duplicate, { kind: 'citation', from: 'old', to: 'unique' })).toThrow('unambiguous')
})
