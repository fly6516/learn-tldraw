import { expect, test, type Page } from '@playwright/test'
import { testEvidence, testMethodEdit, testMethodLine, testResultEdit, testResultLine, testScenarios } from '../../src/lib/project/test-paper'

const workspace = '/research-test?view=write'

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function openAi(page: Page) {
  await page.getByRole('button', { name: 'AI', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Writing AI' })).toBeVisible()
}

async function scopeBoth(page: Page) {
  await page.getByRole('button', { name: 'methods.tex', exact: true }).click()
  await page.getByText('Scope · 1', { exact: true }).click()
  await page.getByRole('checkbox', { name: 'sections/results.tex', exact: true }).click()
  await page.getByText('Scope · 2', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Writing workflow' }).selectOption('project')
}

async function request(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function selectSource(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  const source = page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')
  await page.getByRole('textbox', { name: 'Project source editor' }).press('Control+Home')
  return source
}

test('imports the sample, validates and saves a streamed edit, and restores the exported backup', async ({ page, browser }, info) => {
  await page.goto(workspace)
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('link', { name: 'Download test project ZIP' }).click(),
  ])
  const inputZip = info.outputPath('Practice Paper.zip')
  await download.saveAs(inputZip)
  await menu(page, 'Import LaTeX')
  await page.locator('#latex-zip-file-input').setInputFiles(inputZip)
  await expect(page.getByRole('dialog', { name: 'Import LaTeX Document' })).toHaveCount(0)
  await openAi(page)
  await scopeBoth(page)
  await request(page, testScenarios.pass)
  const task = page.getByRole('region', { name: 'AI task record' })
  await expect(task.getByText('Proposed 2 changes across 2 files.', { exact: false })).toBeVisible()
  await task.getByRole('button', { name: 'Save if verification passes' }).click()
  await expect(task.getByRole('status').filter({ hasText: /^Saved to project$/ })).toBeVisible()
  await expect(task.getByText(/^Verification passed\./)).toBeVisible()
  await page.reload()
  await openAi(page)
  await task.getByText(/^Task activity ·/).click()
  await expect(task.getByText('Save after verification approved', { exact: true })).toBeVisible()
  await expect(await selectSource(page, 'methods.tex')).toContainText(testMethodEdit)
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultEdit)
  await menu(page, 'Project Backup')
  const [backup] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Download Backup' }).click(),
  ])
  const backupPath = info.outputPath('practice.research-canvas')
  await backup.saveAs(backupPath)
  const clean = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    const restored = await clean.newPage()
    await restored.goto(workspace)
    await menu(restored, 'Project Backup')
    await restored.getByLabel('Choose a Research Canvas backup').setInputFiles(backupPath)
    await restored.getByRole('button', { name: 'Replace Project' }).click()
    const dialog = restored.getByRole('dialog', { name: 'Project Backup' })
    await expect(dialog.getByText('Project restored.', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(await selectSource(restored, 'results.tex')).toContainText(testResultEdit)
    await expect(restored.getByRole('button', { name: 'plot.png', exact: true })).toBeVisible()
    await expect(restored.getByRole('button', { name: 'references.bib', exact: true })).toBeVisible()
  } finally {
    await clean.close()
  }
})

test('a failed or stale verification and an interrupted stream leave the project unchanged', async ({ page }) => {
  await page.goto(workspace)
  await openAi(page)
  await scopeBoth(page)
  await request(page, testScenarios.fail)
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
  await expect(proposals.last().getByText(/^Verification failed\./)).toBeVisible()
  await proposals.last().getByRole('button', { name: 'sections/results.tex:2', exact: true }).click()
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultLine)
  await expect(await selectSource(page, 'methods.tex')).toContainText(testMethodLine)

  await request(page, testScenarios.interrupted)
  await expect(page.getByText('Interrupted fixture response.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText(/This response did not finish/)).toBeVisible()
  await expect(proposals).toHaveCount(1)

  await request(page, testScenarios.pass)
  await expect(proposals).toHaveCount(2)
  let entered!: () => void
  let release!: () => void
  const routed = new Promise<void>(resolve => { entered = resolve })
  const proceed = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/latex/compile?*', async route => {
    entered()
    await proceed
    await route.continue()
  }, { times: 1 })
  try {
    await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
    await routed
    await page.getByRole('button', { name: 'main.tex Main' }).click()
    const monaco = page.getByRole('textbox', { name: 'Project source editor' })
    await monaco.press('Control+End')
    await monaco.press('Enter')
    await expect(page.getByText('1 local draft · Not saved to project', { exact: true })).toBeVisible()
  } finally {
    release()
  }
  await expect(proposals.last().getByText(/^Verification is out of date\./)).toBeVisible()
  await expect(proposals.last().getByText('Saved to project', { exact: true })).toHaveCount(0)
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultLine)
})

test('evidence follows renames and line shifts but refuses duplicate matching contexts after reload', async ({ page }) => {
  await page.goto(workspace)
  await openAi(page)
  await scopeBoth(page)
  await request(page, testScenarios.pass)
  const task = page.getByRole('region', { name: 'AI task record' })
  await task.getByText(/^Source evidence ·/).click()
  await task.getByRole('button', { name: /^sections\/results\.tex:4 ·/ }).first().click()
  const editor = page.getByRole('region', { name: 'Source editor' })
  await expect(editor.getByText('sections/results.tex', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Actions for results.tex' }).click()
  await page.getByRole('menuitem', { name: 'Rename or move…' }).click()
  await page.getByRole('textbox', { name: 'Project-relative path' }).fill('sections/findings.tex')
  await page.getByRole('button', { name: 'Preview changes' }).click()
  await page.getByRole('button', { name: 'Apply file changes' }).click()
  await task.getByRole('button', { name: /^sections\/findings\.tex:4 ·/ }).first().click()
  const monaco = page.getByRole('textbox', { name: 'Project source editor' })
  await monaco.press('Control+Home')
  await monaco.press('Enter')
  await expect(task.getByRole('button', { name: /^sections\/findings\.tex:5 ·/ }).first()).toBeVisible()
  await monaco.press('Control+End')
  await page.keyboard.insertText('\n\\section{Results}\n' + testResultLine
    + '\nThe readings are illustrative and are kept separate from any actual measurements.\n'
    + testEvidence + '\nThe same reporting unit was used for all entries in the sample.\n')
  const ambiguous = task.getByRole('listitem').filter({ hasText: 'sections/results.tex:4 · ' + testEvidence }).first()
  await expect(ambiguous.getByRole('button', { name: /Location unverified/ })).toBeVisible()
  await page.reload()
  await openAi(page)
  await task.getByText(/^Source evidence ·/).click()
  await expect(ambiguous.getByRole('button', { name: /Location unverified/ })).toBeVisible()
  await ambiguous.getByRole('button', { name: /Find fresh evidence/ }).click()
  await expect(page.getByRole('textbox', { name: 'Message Writing AI' })).toHaveValue(/Find fresh source evidence/)
})

test('cancelling an approved verification revokes the pending save', async ({ page }) => {
  await page.goto(workspace)
  await openAi(page)
  await scopeBoth(page)
  await request(page, testScenarios.pass)
  const task = page.getByRole('region', { name: 'AI task record' })
  let entered!: () => void
  let release!: () => void
  const routed = new Promise<void>(resolve => { entered = resolve })
  const proceed = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/latex/compile?*', async route => {
    entered()
    await proceed
    await route.continue().catch(() => {}) // The cancelled browser request may already be closed.
  }, { times: 1 })
  try {
    await task.getByRole('button', { name: 'Save if verification passes' }).click()
    await routed
    await task.getByRole('button', { name: 'Cancel verification' }).click()
  } finally {
    release()
  }
  await task.getByText(/^Task activity ·/).click()
  await expect(task.getByText('Verification cancelled', { exact: true })).toBeVisible()
  await expect(task.getByRole('status').filter({ hasText: /^Saved to project$/ })).toHaveCount(0)
  await expect(await selectSource(page, 'methods.tex')).toContainText(testMethodLine)
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultLine)
})
