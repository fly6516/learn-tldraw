import { expect, test } from 'bun:test'
import { captureManuscript } from './template-export'
import { missingTemplateFields, projectInformationSchema, sharedTemplateFields, sourcesWithProjectInformation } from './project-information'

const main = 'main.tex'
const content = String.raw`\documentclass{article}
% \author{Duplicate in comment}
\title{Source
title}
\author{${'原稿作者'}}
\begin{document}
\maketitle
\begin{abstract}
Abstract from the source.
\end{abstract}
\section{Method}
Text from the source.
\end{document}`

test('uses project identity in a temporary TeX copy and preserves body line numbers', () => {
  const project = { files: new Map([[main, { path: main, type: 'file', content }]]),
    metadata: { information: { title: 'Shared & safe', authors: ['Writer A', 'Writer B'] } } }
  const rendered = sourcesWithProjectInformation(project, main)
  const compiled = rendered.files.get(main).content
  expect(compiled).toContain(String.raw`\title{Shared \& safe}`)
  expect(compiled).toContain(String.raw`\author{Writer A \and Writer B}`)
  expect(compiled.split('\n').findIndex(line => line.startsWith('Text'))).toBe(content.split('\n').findIndex(line => line.startsWith('Text')))
  expect(project.files.get(main).content).toBe(content)
})

test('uses shared names for rendering and keeps source names available for blind review', () => {
  const files = new Map([[main, { path: main, type: 'file', content }]])
  const rendered = captureManuscript(files, main, { information: { title: 'Shared title', authors: ['Writer A', 'Writer B'] } })
  expect(rendered.title).toBe('Shared title')
  expect(rendered.authors).toEqual(['Writer A', 'Writer B'])
  expect(rendered.sourceAuthors).toEqual(['原稿作者'])
  expect(rendered.unicodeLocation).toBeUndefined()
  const withHan = captureManuscript(files, main, { information: { authors: ['中文姓名'] } })
  expect(withHan.unicodeLocation?.path).toBe('项目信息')
})

test('separates shared school and journal inputs and shows only applicable missing fields', () => {
  const information = projectInformationSchema.parse({ affiliation: '医学院', englishAffiliation: 'Medical School', studentNumber: '001017' })
  expect(sharedTemplateFields(information, true).affiliation).toBe('Medical School')
  expect(sharedTemplateFields(information, false).affiliation).toBe('医学院')
  expect(missingTemplateFields('jmlr-article', 'jmlr', {})).toEqual(['作者单位'])
  expect(missingTemplateFields('njupt-masters', 'njupt-professional-masters', {}, true)).not.toContain('学号')
  expect(missingTemplateFields('njupt-masters', 'njupt-professional-masters', {})).toContain('学号')
})
