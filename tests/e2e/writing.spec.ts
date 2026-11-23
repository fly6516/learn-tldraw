import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { testEvidence, testMethodEdit, testMethodLine, testResultEdit, testResultLine, testScenarios } from '../../src/lib/project/test-paper'

const workspace = '/research-test?view=write'

async function menu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function openAi(page: Page) {
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Writing AI' })).toBeVisible()
}

async function scopeBoth(page: Page) {
  await page.getByRole('button', { name: 'methods.tex', exact: true }).click()
  await page.getByRole('combobox', { name: 'Writing workflow' }).selectOption('project')
  await page.getByText('Scope · 1', { exact: true }).click()
  await page.getByRole('checkbox', { name: 'sections/results.tex', exact: true }).click()
  await page.getByText('Scope · 2', { exact: true }).click()
}

async function request(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function selectSource(page: Page, name: string) {
  await page.getByTitle(`sections/${name}`, { exact: true }).and(page.getByRole('button')).click()
  const source = page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')
  await page.getByRole('textbox', { name: 'Project source editor' }).press('Control+Home')
  return source
}

test('reviews AI permission requests and revokes full draft access during a turn', async ({ page }) => {
  await page.goto(workspace)
  await openAi(page)
  const requests = page.getByRole('region', { name: 'Draft permission request' })
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await request(page, 'Test: request draft access')
  await requests.last().getByRole('button', { name: 'Deny request' }).click()
  await expect(requests.last().getByText('Request denied.')).toBeVisible()
  await expect(proposals).toHaveCount(0)

  await request(page, 'Test: request draft access')
  await expect(requests).toHaveCount(2)
  await expect(requests.last().getByText('sections/methods.tex', { exact: true })).toBeVisible()
  await requests.last().getByRole('button', { name: 'Approve and continue' }).click()
  await expect(proposals.last().getByText('Applied to local drafts', { exact: true })).toBeVisible()
  await expect(await selectSource(page, 'methods.tex')).toContainText(testMethodEdit)
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultLine)
  await proposals.last().getByRole('button', { name: 'Verify working drafts' }).click()
  await expect(proposals.last().getByText(/^Verification passed\./)).toBeVisible()
  await expect(proposals.last().getByText(/^Working snapshot/)).toBeVisible()
  await proposals.last().getByRole('button', { name: 'Undo AI changes' }).click()
  await expect(proposals.last().getByText('Undone', { exact: true })).toBeVisible()

  const mode = page.getByRole('combobox', { name: 'Approval mode' })
  await mode.selectOption('full')
  await page.getByRole('button', { name: 'Grant full draft access', exact: true }).click()
  await expect(mode).toHaveValue('full')
  let arrived!: () => void
  let release!: () => void
  const intercepted = new Promise<void>(resolve => { arrived = resolve })
  const proceed = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/latex/chat', async route => {
    arrived()
    await proceed
    await route.continue()
  }, { times: 1 })
  try {
    await request(page, testScenarios.pass)
    await intercepted
    await page.getByRole('button', { name: 'Revoke access' }).click()
  } finally { release() }
  await expect(proposals).toHaveCount(2)
  await expect(proposals.last().getByRole('button', { name: 'Apply to drafts' })).toBeVisible()
  await expect(await selectSource(page, 'methods.tex')).toContainText(testMethodLine)

  await mode.selectOption('full')
  await page.getByRole('button', { name: 'Grant full draft access', exact: true }).click()
  await request(page, testScenarios.pass)
  await expect(proposals.last().getByText('Applied to local drafts', { exact: true })).toBeVisible()
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultEdit)
  await page.reload()
  await openAi(page)
  await expect(mode).toHaveValue('manual')
  await expect(proposals.last().getByText('Applied to local drafts', { exact: true })).toBeVisible()
})

test('reuses the exact passing verification when saving a reviewed patch', async ({ page }) => {
  await page.goto(workspace)
  await openAi(page)
  await request(page, testScenarios.pass)
  const proposal = page.getByRole('region', { name: 'Source change proposal' })
  let builds = 0
  page.on('request', request => { if (request.url().includes('/api/latex/compile?')) builds++ })
  await proposal.getByRole('button', { name: 'Verify selected changes' }).click()
  await expect(proposal.getByText(/^Verification passed\./)).toBeVisible()
  await proposal.getByRole('button', { name: 'Save verified changes' }).click()
  await expect(proposal.getByText('Saved to project', { exact: true })).toBeVisible()
  expect(builds).toBe(1)
})

test('repairs and reverifies the selected failed patch without saving it', async ({ page }) => {
  await page.goto(workspace)
  await openAi(page)
  await request(page, testScenarios.fail)
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await proposals.last().getByRole('button', { name: 'Verify selected changes' }).click()
  await expect(proposals.last().getByText(/^Verification failed\./)).toBeVisible()
  await proposals.last().getByRole('button', { name: 'Repair and reverify' }).click()
  await expect(proposals).toHaveCount(2)
  await expect(proposals.last().getByText(/^Verification passed\./)).toBeVisible()
  await expect(proposals.last().getByRole('button', { name: 'Save verified changes' })).toBeEnabled()
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultLine)
})

test('runs writing, preview, submission and a grounded reviewer reply from one conversation', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.goto(workspace)
  await openAi(page)
  await request(page, '/layout floating')
  await expect(page.getByRole('article', { name: 'Assistant' }).getByText('Writing AI is now floating.')).toBeVisible()
  await page.reload()
  await openAi(page)
  await expect(page.getByRole('button', { name: /same level|dock/i })).toBeVisible()
  await request(page, '/layout docked')

  await request(page, 'Test: compile preview')
  await page.getByRole('button', { name: 'Approve preview compile' }).click()
  await expect(page.getByText(/^Compile passed ·/)).toBeVisible()
  await request(page, 'Test: explain build')
  await expect(page.getByText(/The compiler result is available/)).toBeVisible()

  await request(page, 'Test: prepare submission')
  const first = page.getByRole('region', { name: 'Submission task' }).first()
  await first.getByText(/^ZIP manifest/).click()
  await expect(first.getByRole('checkbox', { name: 'references.bib' })).not.toBeChecked()
  await first.getByRole('button', { name: 'Compile reviewed ZIP' }).click()
  await expect(first.getByText(/ZIP SHA-256/)).toBeVisible()
  const original = []
  for (const kind of ['ZIP', 'PDF']) {
    const pending = page.waitForEvent('download')
    await first.getByRole('button', { name: kind === 'ZIP' ? 'Download compiled source ZIP' : 'Download compiled PDF' }).click()
    const file = info.outputPath(`first.${kind.toLowerCase()}`)
    await (await pending).saveAs(file)
    original.push(await readFile(file))
  }
  await first.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(first.getByText('Archived Submission v1.')).toBeVisible()

  await request(page, testScenarios.fail)
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await expect(proposals.last().getByText('sections/methods.tex', { exact: true })).toBeVisible()
  await expect(proposals.last().getByText('sections/results.tex', { exact: true })).toBeVisible()
  await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
  await expect(proposals.last().getByText(/^Verification failed\./)).toBeVisible()
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultLine)
  await request(page, 'Test: explain build')
  await expect(page.getByText(/The compiler result is available: failed/)).toBeVisible()
  await proposals.last().getByRole('button', { name: 'Use diagnostics in chat' }).click()
  await expect(proposals).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'Original proposal and compiler result' })).toBeVisible()
  await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
  await expect(proposals.last().getByText('Saved to project', { exact: true })).toBeVisible()
  await expect(await selectSource(page, 'results.tex')).toContainText(testResultEdit)

  await request(page, '/submission Submission v2')
  const second = page.getByRole('region', { name: 'Submission task' }).last()
  await second.getByRole('button', { name: 'Compile reviewed ZIP' }).click()
  await second.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(second.getByText('Archived Submission v2.')).toBeVisible()

  await request(page, 'Test: create Round 1 from Submission v1')
  const setup = page.getByRole('region', { name: 'Revision setup' })
  await setup.getByRole('button', { name: 'Confirm revision round' }).click()
  await expect(setup.getByText('Revision round created.')).toBeVisible()
  await request(page, 'Test: add reviewer comment Clarify the reported results.')
  await setup.getByRole('button', { name: 'Confirm reviewer comment' }).click()
  await expect(setup.getByText('Reviewer comment added.')).toBeVisible()

  await request(page, 'Test: reply to comment 1')
  await page.getByRole('button', { name: 'Draft reply from archived changes' }).click()
  const reply = page.getByRole('region', { name: 'Reviewer reply proposal' })
  await expect(reply.getByText(/Archived evidence · sections\/results\.tex/)).toBeVisible()
  await expect(reply.getByText('Reply saved.')).toHaveCount(0)
  await reply.getByRole('button', { name: 'Confirm archive link and save reply' }).click()
  await expect(reply.getByText('Reply saved.')).toBeVisible()
  await request(page, '/letter')
  const letter = page.getByRole('region', { name: 'Response letter' })
  await expect(letter.getByText(/We clarified the synthetic mean temperature/)).toBeVisible()
  const downloadedLetter = page.waitForEvent('download')
  await letter.getByRole('button', { name: 'Download response letter' }).click()
  expect((await downloadedLetter).suggestedFilename()).toBe('Round 1-response.md')

  await request(page, 'Add the following reviewer comment to Round 1, targeting sections/methods.tex: "Clarify sampling."')
  const nextComment = setup.filter({ hasText: 'Clarify sampling.' })
  await expect(nextComment.getByText('sections/methods.tex', { exact: true })).toBeVisible()
  await nextComment.getByRole('button', { name: 'Confirm reviewer comment' }).click()
  await expect(nextComment.getByText('Reviewer comment added.')).toBeVisible()

  await request(page, '/submission Submission v1')
  const duplicate = page.getByRole('region', { name: 'Submission task' }).last()
  await duplicate.getByRole('button', { name: 'Compile reviewed ZIP' }).click()
  await duplicate.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(duplicate.getByText('Archived Submission v1.')).toBeVisible()
  await request(page, 'Test: create Round 1 from Submission v1')
  await expect(page.getByText('Choose the exact name of a unique archived submission.')).toBeVisible()
  await expect(setup.getByRole('button', { name: 'Confirm revision round' })).toHaveCount(0)

  await page.reload()
  await openAi(page)
  await expect(reply.getByText('Reply saved.')).toBeVisible()
  for (const [index, kind] of ['ZIP', 'PDF'].entries()) {
    const pending = page.waitForEvent('download')
    await first.getByRole('button', { name: kind === 'ZIP' ? 'Download compiled source ZIP' : 'Download compiled PDF' }).click()
    const file = info.outputPath(`restored.${kind.toLowerCase()}`)
    await (await pending).saveAs(file)
    expect(await readFile(file)).toEqual(original[index])
  }
})

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

test('Writing AI has one entry and keeps its state when resized, floated, or docked', async ({ page }) => {
  await page.goto(workspace)
  const entry = page.getByRole('button', { name: 'Writing AI', exact: true })
  await expect(entry).toHaveCount(1)
  await openAi(page)
  const ai = page.getByRole('complementary', { name: 'Writing AI' })
  const composer = ai.getByRole('textbox', { name: 'Message Writing AI' })
  const handle = page.getByRole('separator', { name: 'Resize Writing AI' })
  const source = page.locator('#writing-work-area')
  await composer.fill('Keep this message while switching layouts.')
  await expect(handle).toBeVisible()
  await expect.poll(async () => (await ai.boundingBox())?.width ?? 0).toBeGreaterThan(300)
  const divider = (await handle.boundingBox())!
  const previous = (await ai.boundingBox())!.width
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x - 96, divider.y + divider.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await ai.boundingBox())?.width ?? 0).toBeGreaterThan(previous + 50)
  const resized = (await ai.boundingBox())!.width
  await ai.getByRole('button', { name: 'Float panel' }).click()
  await expect(handle).toBeHidden()
  await expect.poll(async () => (await source.boundingBox())?.width ?? 0).toBeGreaterThan(1300)
  await expect(composer).toHaveValue('Keep this message while switching layouts.')
  await ai.getByRole('button', { name: 'Dock panel' }).click()
  await expect(handle).toBeVisible()
  await expect.poll(async () => Math.abs(((await ai.boundingBox())?.width ?? 0) - resized)).toBeLessThan(5)
  await expect(composer).toHaveValue('Keep this message while switching layouts.')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(entry).toHaveCount(1)
  await expect(handle).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await ai.getByRole('button', { name: 'Float panel' }).click()
  await expect(handle).toBeHidden()
  await expect(ai.getByRole('button', { name: 'Dock panel' })).toBeVisible()
  await composer.press('Escape')
  await expect(ai).toBeHidden()
  await expect(entry).toBeFocused()
})
