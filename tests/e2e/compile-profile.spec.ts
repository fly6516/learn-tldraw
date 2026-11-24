import { basename, dirname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { testMethodLine, testResultLine } from '../../src/lib/project/test-paper'
import { externalTexCommand } from '../fixtures/external-tex'

async function paper() {
  const zip = new JSZip()
  zip.file('main.tex', String.raw`\documentclass{article}
\usepackage[backend=biber]{biblatex}
\addbibresource{refs/library.bib}
\begin{document}
\input{sections/methods}
\input{sections/results}
\printbibliography
\end{document}
`)
  zip.file('sections/methods.tex', `\\section{Methods}\n${testMethodLine}\\cite{river2024}\n`)
  zip.file('sections/results.tex', `\\section{Results}\n${testResultLine}\n`)
  zip.file('refs/library.bib', '@book{river2024, author={Jones, Pat}, title={Example River Handbook}, date={2024}, publisher={Test Press}}')
  return zip.generateAsync({ type: 'nodebuffer' })
}

const systemBuild = (page: Page) => page.waitForRequest(request => {
  const url = new URL(request.url())
  return url.pathname === '/api/latex/compile' && url.searchParams.get('main') === 'main.tex'
    && url.searchParams.get('engine') === 'pdflatex' && url.searchParams.get('bibliography') === 'biber'
})

test('persists a compile profile and uses it for Biber preview, AI verification and final archival', async ({ page }, info) => {
  test.skip(process.env.RESEARCH_SYSTEM_TEX_E2E !== '1', 'Requires local TeX Live, Biber and Poppler.')
  test.setTimeout(180_000)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({ name: 'River Gauge Profile.zip', mimeType: 'application/zip', buffer: await paper() })
  const settings = page.getByRole('dialog', { name: 'Compile settings' })
  await page.getByRole('button', { name: 'Compile settings', exact: true }).click()
  await expect(settings.getByLabel('Main file')).toHaveValue('main.tex')
  await settings.getByLabel('Engine').selectOption('pdflatex')
  await settings.getByLabel('Bibliography backend').selectOption('biber')
  await settings.getByRole('button', { name: 'Save compile settings' }).click()
  await page.getByRole('link', { name: 'Back to projects' }).click()
  await page.getByRole('link', { name: 'Open River Gauge Profile' }).click()
  await page.getByRole('button', { name: 'Compile settings', exact: true }).click()
  await expect(settings.getByLabel('Engine')).toHaveValue('pdflatex')
  await expect(settings.getByLabel('Bibliography backend')).toHaveValue('biber')
  await settings.getByRole('button', { name: 'Cancel' }).click()

  const first = systemBuild(page)
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  await first
  await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 45_000 })
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download PDF', exact: true }).click()
  const output = info.outputPath('compiled.pdf')
  await (await download).saveAs(output)
  expect(externalTexCommand('pdftotext', [basename(output), '-'], dirname(output))).toContain('Example River Handbook')

  const method = page.getByRole('complementary', { name: 'Project navigation' }).getByTitle('sections/methods.tex')
  await method.click()
  await page.getByRole('button', { name: 'Show in PDF', exact: true }).click()
  await expect(page.getByText(/(?:Source line|Nearest typeset line) \d+ · PDF page \d+/)).toBeVisible()
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+Home')
  await page.keyboard.insertText('\\unexpectedGaugeCommand\n')
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  const issue = page.getByRole('button', { name: /Undefined control sequence.*sections\/methods\.tex:1/ }).first()
  await expect(issue).toBeVisible({ timeout: 45_000 })
  await issue.click()
  await expect(editor).toBeFocused()
  await editor.press('Control+Home')
  await editor.press('Shift+ArrowDown')
  await editor.press('Backspace')
  await expect(page.getByText('All changes saved to project')).toBeVisible()

  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill('Test: passing proposal')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const proposal = page.getByRole('region', { name: 'Source change proposal' })
  const verification = systemBuild(page)
  await proposal.getByRole('button', { name: 'Save if verification passes' }).click()
  await verification
  await expect(proposal.getByRole('status').filter({ hasText: /^Saved to project$/ })).toBeVisible({ timeout: 45_000 })
  await page.getByRole('button', { name: 'Close Writing AI' }).click()
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const submission = page.getByRole('dialog', { name: 'Prepare submission' })
  const final = systemBuild(page)
  await submission.getByRole('button', { name: 'Compile submission files' }).click()
  await final
  await submission.getByRole('textbox', { name: 'Version name' }).fill('River v1')
  await submission.getByRole('button', { name: 'Save submission version' }).click()
  await submission.getByText(/^River v1 ·/).click()
  await expect(submission.getByText(/pdfLaTeX.*preflight findings/)).toBeVisible()
  await expect(submission.getByText(/ZIP SHA-256/)).toBeVisible()
})
