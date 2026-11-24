import { expect, test } from 'bun:test'
import { locateSourceRanges, sourceExcerpt, validateExcerptEdits } from './ai-source-ranges'
import { createChapterTools } from './ai-tools'
import { applyProjectEdits } from './ai-edit'

const path = 'sections/extended.tex'
const text = '\\section{Earlier section}\r\n' + '% filler\r\n'.repeat(3000)
  + '\\section{Calibration}\r\n\\label{sec:calibration}\r\nOriginal calibration prose.\r\n'
  + '\\section{Observations}\r\nOriginal observations prose.\r\n'
const project = { files: new Map([[path, { path, content: text }]]) }

test('locates multiple named late sections and keeps their original lines', async () => {
  const located = locateSourceRanges(project, [path], 'Revise Calibration and Observations in sections/extended.tex.', 'main.tex')
  expect(located.ambiguous).toEqual([])
  const excerpts = located.matches.map(({ range }) => sourceExcerpt(text, range))
  expect(excerpts.map(excerpt => excerpt.start)).toEqual([3002, 3005])
  expect(excerpts[0].source).toContain('Original calibration prose.')
  expect(excerpts[0].source).not.toContain('Earlier section')
  const { tools, readSharedExcerpts } = createChapterTools({ path, source: excerpts[0].source, context: [] }, undefined, excerpts)
  expect(readSharedExcerpts()[0].items).toContainEqual({ path, line: 3004, text: 'Original calibration prose.' })
  expect(await tools.read_source.execute({ path, startLine: 1, lineCount: 1 })).toMatchObject({ unavailable: expect.any(String) })
  expect(await tools.search_source.execute({ query: 'Original observations' })).toMatchObject({ items: [{ path, line: 3006 }] })
  expect(await tools.read_source.execute({ path, startLine: 3004, lineCount: 2 })).toMatchObject({ items: [{ path, line: 3004 }] })
  expect(await tools.query_references.execute({ query: 'sec:calibration', kind: 'labels' })).toMatchObject({ items: [{ path, line: 3003 }] })
  const edits = [{ path, before: 'Original calibration prose.', after: 'Updated calibration prose.' }]
  expect(() => validateExcerptEdits(excerpts, edits)).not.toThrow()
  expect(() => validateExcerptEdits(excerpts, [{ path, before: 'Earlier section', after: 'Changed' }])).toThrow('one shared source range')
  expect(() => applyProjectEdits(new Map([[path, text + edits[0].before]]), edits)).toThrow('unique part')
})

test('offers ambiguous passages and respects the available path list', () => {
  const other = 'sections/other.tex'
  const files = new Map(project.files).set(other, { path: other, content: text })
  expect(locateSourceRanges({ files }, [path, other], 'Revise Calibration.', 'main.tex').ambiguous).toHaveLength(2)
  expect(locateSourceRanges({ files }, [path, other], 'Revise Calibration.', path).matches.map(item => item.range.path)).toEqual([path])
  expect(locateSourceRanges({ files }, [path], 'Revise Calibration.', 'main.tex').ambiguous).toEqual([])
})

test('uses bilingual research terminology when a request does not name the exact passage', () => {
  const text = '\\section{Calibration}\n\\begin{equation}\nx = y\n\\end{equation}\n\\section{Limitations}\nSelection bias may limit generalization to evening sessions.\n'
  const project = { files: new Map([[path, { path, content: text }]]) }
  expect(locateSourceRanges(project, [path], '修改讨论采样偏差的段落。Preserve the equation.', path).matches)
    .toMatchObject([{ range: { path, start: 5, end: 7 }, title: 'Limitations' }])
})
