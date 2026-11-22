import { expect, test } from 'bun:test'
import { detectCompileCompatibility, externalCompileCommand, missingCompilerFile } from './compile-compatibility'

test('recognizes nested pdfLaTeX and BibTeX template inputs and missing TeX resources', () => {
  const main = 'paper/manuscript.tex'
  const sources = new Map([[main, String.raw`\documentclass[pdflatex,sn-mathphys-num]{sn-jnl}
\bibliography{references}`]])
  expect(detectCompileCompatibility(sources, main, [main, 'paper/bst/style.bst', 'paper/fig.eps']))
    .toEqual({ engine: 'pdflatex', bibliography: 'bibtex', eps: true, nestedStyles: true })
  expect(externalCompileCommand('pdflatex')).toBe('latexmk -norc -pdf -latexoption=-no-shell-escape ./MAIN.tex')
  expect(missingCompilerFile("error: LaTeX Error: File `fleqn.clo' not found.")).toBe('fleqn.clo')
})

test('detects explicit and default Biber backends across files and ignores comments', () => {
  const main = 'main.tex'
  const sources = new Map([[main, '% !TeX program = lualatex\n% \\usepackage[backend=bibtex]{biblatex}'],
    ['preamble.tex', String.raw`\usepackage{biblatex}`]])
  expect(detectCompileCompatibility(sources, main, sources.keys())).toMatchObject({ engine: 'lualatex', bibliography: 'biber' })
  sources.set('preamble.tex', String.raw`\usepackage[backend=bibtex]{biblatex}`)
  expect(detectCompileCompatibility(sources, main, sources.keys()).bibliography).toBe('bibtex')
})
