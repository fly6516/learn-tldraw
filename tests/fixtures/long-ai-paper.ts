import JSZip from 'jszip'
import { expect, type Page } from '@playwright/test'
import { testResultLine, testResults } from '../../src/lib/project/test-paper'

export const longResultHeading = 'Late Observations'
export const longResultLine = 1803

export async function selectLongResult(page: Page, text = testResultLine) {
  const navigation = page.getByRole('complementary', { name: 'Project navigation' })
  await navigation.getByRole('button', { name: 'Search', exact: true }).click()
  await navigation.getByRole('searchbox', { name: 'Search project source' }).fill(text)
  await navigation.getByRole('button', { name: new RegExp('results\\.tex:' + longResultLine) }).click()
  await expect(page.getByRole('textbox', { name: 'Project source editor' })).toBeFocused()
}

export async function longAiPaperZip() {
  const zip = new JSZip()
  zip.file('main.tex', '\\documentclass{article}\n\\begin{document}\n\\input{sections/results}\n\\end{document}\n')
  zip.file(testResults, '\\section{Earlier observations}\n'
    + '% Synthetic filler for the long chapter fixture.\n'.repeat(1800)
    + '\\section{' + longResultHeading + '}\n' + testResultLine + '\n')
  zip.file('private/notes.tex', '\\section{Late Observations}\nPrivate fixture text.\n')
  return zip.generateAsync({ type: 'nodebuffer' })
}
