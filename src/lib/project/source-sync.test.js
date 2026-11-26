import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { readSyncTex } from './read-synctex'
import { findPdfRegion, findSourceRegion } from './source-sync'

test('uses project-relative SyncTeX paths and keeps the sources of adjacent text runs distinct', () => {
  const root = resolve('sync-project')
  const map = readSyncTex(`SyncTeX Version:1
Input:1:${resolve(root, 'paper', 'main.tex')}
Input:2:./chapters/results
Input:3:../../unrelated.tex
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
{2
(1,7:6553600,9830400:12000000,655360,0
g1,7:7864320,9830400
g2,11:9175040,9830400
g3,9:10485760,9830400
)
}2
`, root, 'paper/main.tex', ['paper/main.tex', 'paper/chapters/results.tex'])

  expect(map).toHaveLength(2)
  const [main, chapter] = map
  expect(main).toMatchObject({ path: 'paper/main.tex', line: 7, page: 2 })
  expect(chapter).toMatchObject({ path: 'paper/chapters/results.tex', line: 11, page: 2 })
  expect(findPdfRegion(map, chapter.path, 10)).toEqual(chapter)
  expect(findSourceRegion(map, 2, chapter.x + chapter.width / 2, chapter.y + chapter.height / 2)).toEqual(chapter)
  expect(findSourceRegion(map, 1, chapter.x, chapter.y)).toBeUndefined()
  expect(findSourceRegion(map, 2, 80, 400)).toBeUndefined()
})

test('keeps the first word of a paragraph on its source line when the box inherits the next heading tag', () => {
  const root = resolve('sync-project')
  const map = readSyncTex(`SyncTeX Version:1
Input:1:./sample.tex
Content:
{1
(1,17:5920357,17323024:28417720,498346,139537
x1,17:7156258,17323024
g1,16:7395464,17323024
x1,16:7714406,17323024
k1,17:34338077,17323024:26623671
g1,17:34338077,17323024
)
(1,17:5920357,19161556:28417720,498346,139537
x1,17:6974851,19161556
g1,17:7387479,19161556
)
}1
`, root, 'sample.tex', ['sample.tex'])
  expect(findSourceRegion(map, 1, 96, 260)).toMatchObject({ path: 'sample.tex', line: 16 })
  expect(findSourceRegion(map, 1, 96, 289)).toMatchObject({ path: 'sample.tex', line: 17 })
})
