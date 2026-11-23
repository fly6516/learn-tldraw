import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, firefox, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { testMethodLine, testMethods, testResultLine, testResults } from '../../src/lib/project/test-paper'

const distro = process.env.RESEARCH_BIBER_WSL
test.skip(!distro && process.env.RESEARCH_BIBER_TEST !== '1', 'Requires a TeX Live installation with Biber and Poppler.')

function externalCommand(command: string, args: string[], cwd: string) {
  const options = { encoding: 'utf8' as const, timeout: 60_000 }
  if (!distro) return execFileSync(command, args, { ...options, cwd })
  const directory = execFileSync('wsl.exe', ['-d', distro, '--', 'wslpath', '-a', cwd.replaceAll('\\', '/')], options).trim()
  return execFileSync('wsl.exe', ['-d', distro, '--cd', directory, '--', command, ...args], options)
}

async function riverPaper() {
  const zip = new JSZip()
  zip.file('main.tex', String.raw`% !TeX program = pdflatex
\documentclass{riverstudy}
\addbibresource{references/river.bib}
\begin{document}
\begin{center}River Gauge Study\end{center}
\input{sections/methods}
\input{sections/results}
\appendix
\input{appendix/calibration}
\printbibliography
\end{document}
`)
  zip.file('riverstudy.cls', String.raw`\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{riverstudy}[2026/01/01 Research Canvas fixture]
\LoadClass{article}
\RequirePackage[backend=biber,style=numeric]{biblatex}
`)
  zip.file(testMethods, `\\section{Methods}\n${testMethodLine}\n`)
  zip.file(testResults, `\\section{Results}\n${testResultLine} See \\cite{syntheticGauge}.\n`)
  zip.file('appendix/calibration.tex', '\\section{Calibration appendix}\nSynthetic instrument calibration notes.\n')
  zip.file('notes/first.tex', 'Original test note.\n')
  zip.file('notes/second.tex', 'Original test note.\n')
  zip.file('data/sessions.csv', 'session,first_value\n1,28.1\n2,27.5\n')
  zip.file('references/river.bib', '@book{syntheticGauge, author={Taylor, Dana}, title={River Gauge Calibration Handbook}, date={2025}, publisher={Synthetic Test Press}}\n')
  return zip.generateAsync({ type: 'nodebuffer' })
}

test('revokes draft access and restores the exact Biber PDF across browsers before archiving', async ({ page, baseURL }, info) => {
  test.setTimeout(150_000)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'River Gauge Study.zip', mimeType: 'application/zip', buffer: await riverPaper(),
  })
  await expect(page.getByRole('heading', { name: 'River Gauge Study', level: 1 })).toBeVisible()
  const reopen = () => page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await reopen()
  await page.getByRole('combobox', { name: 'Approval mode' }).selectOption('full')
  await page.getByRole('button', { name: 'Grant full draft access' }).click()
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(
    'Read data/sessions.csv, revise the manuscript, compile it, and prepare the submission River publication.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const task = page.getByRole('region', { name: 'Manuscript task' })
  let started!: () => void
  let release!: () => void
  const batchStarted = new Promise<void>(resolve => { started = resolve })
  const resume = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/latex/chat', async route => {
    const body = route.request().postDataJSON()
    if (body.manuscript?.mode === 'batch') { started(); await resume }
    await route.continue()
  })
  try {
    await task.getByRole('button', { name: 'Continue task' }).click()
    await batchStarted
    await page.getByRole('button', { name: 'Revoke access' }).click()
  } finally { release() }
  const proposal = page.getByRole('region', { name: 'Source change proposal' }).last()
  await expect(proposal.getByRole('button', { name: 'Apply to drafts' })).toBeVisible()
  await expect(task.getByRole('status')).toContainText('0 of 4 files applied')
  await expect(proposal.getByRole('button', { name: /Bibliography · references\/river\.bib:1/ })).toBeVisible()
  await proposal.getByRole('button', { name: 'Apply to drafts' }).click()
  await expect(task.getByRole('status')).toContainText('3 of 4 files applied')
  await proposal.getByRole('button', { name: 'Apply to drafts' }).click()

  const review = page.getByRole('dialog', { name: 'Review manuscript task' })
  await review.getByText('External compilation', { exact: true }).click()
  await expect(review.getByText('Biber', { exact: true })).toBeVisible()
  await expect(review.getByLabel('External engine')).toHaveValue('pdflatex')
  await review.getByRole('button', { name: 'Prepare external build ZIP' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), review.getByRole('link', { name: 'Download external build ZIP' }).click()])
  const zipPath = info.outputPath('external-source.zip')
  await download.saveAs(zipPath)
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  const directory = info.outputPath('tex')
  await mkdir(directory, { recursive: true })
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    expect(entry.name).toMatch(/^[\w./-]+$/)
    expect(entry.name.split('/')).not.toContain('..')
    const destination = join(directory, entry.name)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, await entry.async('nodebuffer'))
  }
  const log = externalCommand('latexmk', ['-norc', '-pdf', '-latexoption=-no-shell-escape', './main.tex'], directory)
  expect(log).toMatch(/Running 'biber\b/i)
  const contents = externalCommand('pdftotext', ['main.pdf', '-'], directory)
  expect(contents).toContain('River Gauge Study')
  expect(contents).toContain('Calibration appendix')
  expect(contents).toContain('River Gauge Calibration Handbook')
  expect(contents).toContain('28.1 degrees')
  const pdfPath = join(directory, 'main.pdf')
  await review.getByLabel('Compiled PDF').setInputFiles(pdfPath)
  await review.getByRole('checkbox', { name: /I compiled this PDF/ }).check()
  await review.getByRole('button', { name: 'Attach external PDF' }).click()
  await expect(review.getByRole('status')).toContainText('Manuscript verification passed. External PDF attached')
  await review.getByRole('button', { name: testResults, exact: true }).click()
  for (const claim of await review.getByRole('button', { name: 'Confirm claim' }).all()) await claim.click()
  await review.getByRole('button', { name: 'Save verified files' }).click()
  await expect(task.getByText('4 task files saved together.')).toBeVisible()

  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Include AI conversations and task history' }).check()
  const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Backup' }).click()])
  const backupPath = info.outputPath('river-before-archive.research-canvas')
  await backup.saveAs(backupPath)
  const other = await firefox.launch()
  async function restore() {
    const restored = await other.newPage({ baseURL, viewport: { width: 1440, height: 900 } })
    await restored.goto('/research')
    await restored.getByLabel('Choose project ZIP or backup').setInputFiles(backupPath)
    await expect(restored.getByRole('heading', { name: 'River Gauge Study', level: 1 })).toBeVisible()
    await restored.getByRole('button', { name: 'Writing', exact: true }).click()
    await restored.getByRole('button', { name: 'Writing AI', exact: true }).click()
    await expect(restored.getByRole('combobox', { name: 'Approval mode' })).toHaveValue('manual')
    return restored
  }
  try {
    const stale = await restore()
    const staleSubmission = stale.getByRole('region', { name: 'Submission task' })
    await expect(staleSubmission.getByText(/External PDF · pdflatex/)).toBeVisible()
    const editor = stale.getByRole('textbox', { name: 'Project source editor' })
    await editor.press('Control+Home')
    await stale.keyboard.insertText('% Saved after restoring the backup.\n')
    await stale.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(staleSubmission.getByText(/verified PDF is out of date/i)).toBeVisible()
    await expect(staleSubmission.getByRole('button', { name: 'Confirm submission archive' })).toHaveCount(0)
    await stale.context().close()

    const restored = await restore()
    const submission = restored.getByRole('region', { name: 'Submission task' })
    await expect(submission.getByText(/External PDF · pdflatex/)).toBeVisible()
    await submission.getByRole('button', { name: 'Confirm submission archive' }).click()
    await expect(submission.getByText('Archived River publication.')).toBeVisible()
    const downloadBytes = async (browser: Page, button: string) => {
      const [file] = await Promise.all([browser.waitForEvent('download'), submission.getByRole('button', { name: button }).click()])
      return readFile((await file.path())!)
    }
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
    expect(hash(await downloadBytes(restored, 'Download compiled source ZIP'))).toBe(hash(await readFile(zipPath)))
    expect(hash(await downloadBytes(restored, 'Download compiled PDF'))).toBe(hash(await readFile(pdfPath)))
  } finally { await other.close() }
})
