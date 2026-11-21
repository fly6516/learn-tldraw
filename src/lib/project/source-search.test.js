import { expect, test } from 'bun:test'
import { createProjectFileSystem, addFile } from './file-system'
import { sourcePosition } from './latex-source'
import { searchProjectSources, sourceSearchLimit } from './source-search'
import { applyWritingDrafts } from './writing-drafts'

const template = { documentClass: 'article', packages: [], preamble: '', metadata: {} }
const intro = 'chapters/intro.tex'
const results = 'chapters/results.tex'
const bibliography = 'refs/library.bib'

function projectWithSources(sources) {
  return Object.entries(sources).reduce((project, [path, content]) => addFile(project, {
    name: path.split('/').at(-1), path, content, type: 'editable', metadata: { editable: true },
  }), createProjectFileSystem(template))
}

test('finds literal source and bibliography matches at exact editor coordinates, including drafts', () => {
  const base = 'Stored results.'
  const project = projectWithSources({
    [intro]: '\uFEFFFirst k\r\n\r\nTitle: KEY [x]\rLast',
    [results]: base,
    [bibliography]: '@article{key, title={A [x]}}',
    'notes.md': 'KEY',
  })
  const draft = 'Draft header\r\nDraft key.'
  const working = applyWritingDrafts(project, { [results]: { base, text: draft } })
  const { matches } = searchProjectSources(working.files, 'key')
  expect(matches.map(({ path, name, line, match }) => [path, name, line, match])).toEqual([
    [intro, 'intro.tex', 3, 'KEY'],
    [results, 'results.tex', 2, 'key'],
    [bibliography, 'library.bib', 1, 'key'],
  ])
  expect(sourcePosition(working.files.get(intro).content, matches[0].start)).toEqual({ lineNumber: 3, column: 8 })
  expect(draft.slice(matches[1].start, matches[1].end)).toBe('key')
  expect(searchProjectSources(project.files, 'key').matches.map(match => match.path)).toEqual([intro, bibliography])
  expect(searchProjectSources(working.files, '[x]').matches.map(match => match.path)).toEqual([intro, bibliography])
  expect(searchProjectSources(working.files, ' ').matches).toEqual([])
})

test('clips long snippets and reports when results exceed the limit', () => {
  const text = 'a'.repeat(90) + 'needle' + 'b'.repeat(90)
  const project = projectWithSources({ [intro]: Array(sourceSearchLimit + 1).fill(text).join('\n') })
  const { matches, limited } = searchProjectSources(project.files, 'needle')
  expect(limited).toBe(true)
  expect(matches).toHaveLength(sourceSearchLimit)
  expect(matches[0]).toMatchObject({
    line: 1, before: '…' + 'a'.repeat(32), match: 'needle', after: 'b'.repeat(48) + '…',
  })
  expect(matches.at(-1).line).toBe(sourceSearchLimit)
})
