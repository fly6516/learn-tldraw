import JSZip from 'jszip'
import { importSourceArchive } from './source-archive'

export const testPaperName = 'Practice Paper'
export const testMethods = 'sections/methods.tex'
export const testResults = 'sections/results.tex'
export const testMethodLine = 'We recorded a temperature for each synthetic observation.'
export const testResultLine = 'The synthetic observations had an average of twenty degrees.'
export const testMethodEdit = 'We recorded one temperature per synthetic observation.'
export const testResultEdit = 'The mean temperature of the synthetic observations was twenty degrees.'
export const testEvidence = 'Measurements were reported in degrees Celsius.'
export const testScenarios = {
  pass: 'Test: passing proposal',
  fail: 'Test: compile error',
  interrupted: 'Test: interrupted proposal',
}

export async function testPaperZip() {
  const zip = new JSZip()
  zip.file('main.tex', String.raw`\documentclass{article}
\makeatletter
\renewcommand\section{\@startsection{section}{1}{0pt}{2ex}{1ex}{\normalfont\normalsize}}
\makeatother
\begin{document}
Practice Paper
\input{sections/methods}
\input{sections/results}
\XeTeXpicfile "figures/plot.png" width 12mm
\end{document}
`)
  zip.file(testMethods, `\\section{Methods}\n${testMethodLine}\nObservations were generated solely to exercise the writing workflow.\n`)
  zip.file(testResults, `\\section{Results}\n${testResultLine}\nThe readings are illustrative and are kept separate from any actual measurements.\n${testEvidence}\nThe same reporting unit was used for all entries in the sample.\n`)
  zip.file('references.bib', '@misc{fixture, title={Synthetic test reference}, year={2026}}\n')
  zip.file('figures/plot.png', 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGNQaLgDRwzEcQBeEhfB+KME1gAAAABJRU5ErkJggg==', { base64: true })
  return zip.generateAsync({ type: 'blob' })
}

export async function createTestPaper() {
  return importSourceArchive(new File([await testPaperZip()], `${testPaperName}.zip`))
}
