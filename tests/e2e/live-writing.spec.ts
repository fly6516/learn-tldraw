import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { morningWalkZip } from '../fixtures/morning-walk'

const zipPath = process.env.RESEARCH_LIVE_TEST_ZIP
const seededPath = process.env.RESEARCH_LIVE_TEST_PATH
const path = seededPath || (process.env.RESEARCH_LIVE_TEST === '1' || zipPath ? '/research' : undefined)
test.skip(!path, 'Requires a local synthetic Morning Walk Study and a configured model.')

async function openPaper(page: Page) {
  await page.goto(path!)
  if (zipPath || !seededPath) await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Morning Walk Study.zip', mimeType: 'application/zip', buffer: zipPath ? await readFile(zipPath) : await morningWalkZip(),
  })
  await expect(page.getByRole('heading', { name: 'Morning Walk Study' })).toBeVisible()
}

async function openAi(page: Page) {
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Writing AI' })).toBeVisible()
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function submitVersion(page: Page, version: string) {
  const cards = page.getByRole('region', { name: 'Submission task' })
  const count = await cards.count()
  await send(page, `Prepare the current saved manuscript for submission and name the archive ${version}. Keep all ZIP files.`)
  await expect(cards).toHaveCount(count + 1, { timeout: 65_000 })
  const card = cards.last()
  await expect(card.getByRole('button', { name: 'Compile reviewed ZIP' })).toBeEnabled()
  await card.getByRole('button', { name: 'Compile reviewed ZIP' }).click()
  await expect(card.getByText(/ZIP SHA-256/)).toBeVisible()
  await expect(card.getByRole('textbox', { name: 'Submission version name' })).toHaveValue(version)
  await card.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(card.getByText(`Archived ${version}.`, { exact: true })).toBeVisible()
}

test('real model moves Morning Walk Study from writing through submission and revision', async ({ page }) => {
  test.setTimeout(420_000)
  await openPaper(page)
  await openAi(page)
  await submitVersion(page, 'Submission v1')

  const methods = 'The two routes were surveyed at the same planned departure time.'
  const results = 'The shaded route was cooler in all four paired sessions.'
  await send(page, `For a synthetic compiler QA check, read sections/methods.tex and sections/results.tex and stage these two exact edits. In Methods replace the sentence about observers traversing the routes with "${methods}" In Results replace only the first sentence about the shaded route with "${results} \\qaUndefinedMorningWalk" Leave the intentionally undefined LaTeX command in this test proposal so I can check that failed compilation prevents saving. Use propose_edits for both files.`)
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await expect(proposals.last().getByText('sections/methods.tex', { exact: true }).first()).toBeVisible({ timeout: 65_000 })
  await expect(proposals.last().getByText('sections/results.tex', { exact: true }).first()).toBeVisible()
  await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
  await expect(proposals.last().getByText(/^Verification failed\./)).toBeVisible()
  await expect(proposals.last().getByText('Saved to project', { exact: true })).toHaveCount(0)

  await page.reload()
  await openAi(page)
  await expect(proposals.last().getByText(/^Verification failed\./)).toBeVisible()
  await send(page, '根据刚才临时编译的报错继续修复。请去掉导致编译失败的命令，保留两个章节原先拟议的文字改动，并重新提出完整的双文件补丁。')
  await expect(proposals).toHaveCount(2, { timeout: 65_000 })
  await expect(page.getByRole('link', { name: 'Original proposal and compiler result' })).toBeVisible()
  let compiled!: () => void
  let release!: () => void
  const ready = new Promise<void>(resolve => { compiled = resolve })
  const resume = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/latex/compile?*', async route => {
    const response = await route.fetch()
    compiled()
    await resume
    await route.fulfill({ response }).catch(() => {})
  }, { times: 1 })
  try {
    await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
    await ready
    await page.reload()
  } finally { release() }
  await openAi(page)
  await expect(proposals).toHaveCount(2)
  await expect(proposals.last().getByText('Saved to project', { exact: true })).toHaveCount(0)
  await proposals.last().getByRole('button', { name: 'Save if verification passes' }).click()
  await expect(proposals.last().getByText('Saved to project', { exact: true })).toBeVisible()
  for (const [filename, expected] of [['methods.tex', methods], ['results.tex', results]]) {
    await page.getByRole('button', { name: filename, exact: true }).click()
    await expect(page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')).toContainText(expected)
  }
  await submitVersion(page, 'Submission v2')

  await send(page, 'Create a revision round named Route review from the archived Submission v1.')
  const setup = page.getByRole('region', { name: 'Revision setup' })
  await setup.getByRole('button', { name: 'Confirm revision round' }).click({ timeout: 65_000 })
  await expect(setup.getByText('Revision round created.')).toBeVisible()
  const comments = [
    ['sections/methods.tex', 'Please clarify whether the routes were surveyed at the same time.'],
    ['sections/results.tex', 'Please clarify how often the shaded route was cooler.'],
  ]
  for (const [source, comment] of comments) {
    await send(page, `Add the following reviewer comment to Route review, targeting ${source}: "${comment}"`)
    const current = setup.filter({ hasText: comment })
    await expect(current.getByText(source, { exact: true })).toBeVisible({ timeout: 65_000 })
    await current.getByRole('button', { name: 'Confirm reviewer comment' }).click()
    await expect(current.getByText('Reviewer comment added.')).toBeVisible()
  }
  for (const [index, [source]] of comments.entries()) {
    const requests = page.getByRole('button', { name: 'Draft reply from archived changes' })
    await send(page, `Draft a reviewer reply to comment ${index + 1} in Route review using archived Submission v2.`)
    await expect(requests).toHaveCount(index + 1, { timeout: 65_000 })
    await requests.last().click()
    const reply = page.getByRole('region', { name: 'Reviewer reply proposal' }).nth(index)
    await expect(reply.getByText(`Archived evidence · ${source}`)).toBeVisible({ timeout: 65_000 })
    await reply.getByRole('button', { name: /Confirm .*save reply/ }).click()
    await expect(reply.getByText('Reply saved.')).toBeVisible()
  }
  await send(page, '/letter Route review')
  const [letter] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download response letter', exact: true }).click()])
  expect(letter.suggestedFilename()).toBe('Route review-response.md')
})

test('real model reads Morning Walk Study evidence and applies a multi-batch manuscript task', async ({ page }) => {
  test.setTimeout(300_000)
  await openPaper(page)
  await openAi(page)
  const source = page.getByRole('region', { name: 'Source editor' })
  const mainFile = page.getByRole('button', { name: /^main\.tex Main/ })
  await mainFile.click()
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+Home')
  await page.keyboard.insertText('% Author draft kept outside the manuscript task.\n')
  await expect(mainFile.getByLabel('Unsaved')).toBeVisible()
  await send(page, 'List project attachments to confirm figures/route-temperatures.png exists, then use read_csv_rows on data/sessions.csv, starting at row 2 for all four sessions. Cite their physical line numbers. Do not edit anything.')
  await expect(page.getByText(/^Source evidence ·/)).toBeVisible({ timeout: 65_000 })
  await page.getByText(/^Source evidence ·/).click()
  await expect(page.getByRole('button', { name: /^data\/sessions\.csv:2/ })).toBeVisible()

  await page.getByRole('combobox', { name: 'Approval mode' }).selectOption('full')
  await page.getByRole('button', { name: 'Grant full draft access', exact: true }).click()
  const files = ['sections/introduction.tex', 'sections/methods.tex', 'sections/results.tex', 'sections/discussion.tex']
  await send(page, `Plan a manuscript writing task to edit exactly these four LaTeX files: ${files.join(', ')}. In each file replace its complete opening section or subsection heading line with the same line followed by a new short paragraph: "This draft uses synthetic observations for workflow testing." Keep all math, LaTeX commands, labels and citations unchanged.`)
  const task = page.getByRole('region', { name: 'Manuscript task' })
  await expect(task.getByRole('status')).toContainText('0 of 4 files applied', { timeout: 65_000 })
  await task.getByRole('button', { name: 'Continue task' }).click()
  await expect(task.getByRole('status')).toContainText('4 of 4 files applied', { timeout: 120_000 })
  await expect(task.getByText(/^Batches · [2-4]$/)).toBeVisible()
  await task.getByRole('button', { name: 'Undo latest batch' }).click()
  await page.getByRole('button', { name: 'Confirm undo' }).click()
  await expect(task.getByRole('status')).toHaveText(/^[1-3] of 4 files applied · Paused$/)
  const retained = Number((await task.getByRole('status').innerText())[0])
  await page.reload()
  await openAi(page)
  await expect(task.getByRole('status')).toContainText(`${retained} of 4 files applied`)
  await task.getByRole('button', { name: 'Continue task' }).click()
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  for (let applied = retained; applied < files.length;) {
    await proposals.last().getByRole('button', { name: 'Apply to drafts' }).click({ timeout: 65_000 })
    await expect.poll(async () => Number((await task.getByRole('status').innerText())[0])).toBeGreaterThan(applied)
    applied = Number((await task.getByRole('status').innerText())[0])
  }
  await send(page, 'Review the manuscript task.')
  const review = page.getByRole('dialog', { name: 'Review manuscript task' })
  await expect(review.getByText('4 files selected')).toBeVisible()
  await review.getByRole('button', { name: 'Verify manuscript' }).click()
  const repair = review.getByRole('button', { name: 'Repair affected files with AI' })
  await expect(review.getByRole('status')).toContainText(/Manuscript verification (passed|failed)\./)
  if (await repair.isVisible()) {
    await repair.click()
    await proposals.last().getByRole('button', { name: 'Apply to drafts' }).click({ timeout: 65_000 })
    await send(page, 'Review the manuscript task.')
    await review.getByRole('button', { name: 'Verify manuscript' }).click()
  }
  await expect(review.getByRole('status')).toContainText('Manuscript verification passed.')
  await review.getByRole('button', { name: 'Save verified files' }).click()
  await expect(task.getByText('4 task files saved together.')).toBeVisible()
  await expect(mainFile.getByLabel('Unsaved')).toBeVisible()
  await submitVersion(page, 'Manuscript task submission')
  await task.getByRole('button', { name: 'Undo manuscript save' }).click()
  await page.getByRole('dialog', { name: 'Undo manuscript save?' }).getByRole('button', { name: 'Undo manuscript save' }).click()
  await expect(page.getByRole('button', { name: /^methods\.tex/ }).getByLabel('Unsaved')).toBeVisible()
  await mainFile.click()
  await expect(source.locator('.view-lines')).toContainText('Author draft kept outside the manuscript task.')
})

test('real model carries one Morning Walk Study request from CSV evidence to an approved archive', async ({ page }) => {
  test.setTimeout(180_000)
  await openPaper(page)
  await openAi(page)
  await send(page, 'Read rows 1 through 5 of data/sessions.csv, revise exactly sections/methods.tex and sections/results.tex, compile the manuscript, and prepare a submission named "Evidence review". In Methods clarify that the sessions were paired. In Results add that the shaded route measured 28.1 degrees Celsius in session 1. Link that sentence to CSV physical line 2 in your proposal. These are synthetic observations confirmed for this test. Preserve the rest of the text, figures and citations. No further factual questions need answering.')
  const task = page.getByRole('region', { name: 'Manuscript task' })
  await expect(task.getByText(/data\/sessions\.csv · CSV rows/)).toBeVisible({ timeout: 65_000 })
  const continueTask = task.getByRole('button', { name: 'Continue task' })
  if (await continueTask.isDisabled()) {
    await task.getByText('Author decisions and open questions').click()
    const questions = task.getByRole('textbox', { name: 'Task open questions' })
    expect(await questions.inputValue()).toMatch(/(?:CSV|data\/sessions\.csv)/i)
    await questions.fill('')
    await questions.press('Tab')
  }
  await continueTask.click()
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  // The final batch opens the modal, which hides the task card from the accessibility tree.
  const appliedFiles = async () => Number((await page.locator('section[aria-label="Manuscript task"] [role="status"]').textContent())?.[0])
  for (let applied = 0; applied < 2;) {
    await proposals.last().getByRole('button', { name: 'Apply to drafts' }).click({ timeout: 65_000 })
    await expect.poll(appliedFiles).toBeGreaterThan(applied)
    applied = await appliedFiles()
  }
  const review = page.getByRole('dialog', { name: 'Review manuscript task' })
  await expect(review.getByRole('status')).toContainText('Manuscript verification passed.')
  await review.getByRole('button', { name: 'sections/results.tex', exact: true }).click()
  const evidence = review.getByRole('region', { name: 'Evidence for proposed changes' })
  await expect(evidence.getByText(/28\.1/).first()).toBeVisible()
  await expect(evidence.getByRole('button', { name: 'CSV · data/sessions.csv:2' })).toBeVisible()
  for (const path of ['sections/methods.tex', 'sections/results.tex']) {
    await review.getByRole('button', { name: path, exact: true }).click()
    for (const claim of await review.getByRole('button', { name: 'Confirm claim' }).all()) {
      if (await claim.isEnabled()) await claim.click()
    }
  }
  await review.getByRole('button', { name: 'Save verified files' }).click()
  const submission = page.getByRole('region', { name: 'Submission task' })
  await expect(submission.getByRole('textbox', { name: 'Submission version name' })).toHaveValue('Evidence review')
  await submission.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(submission.getByText('Archived Evidence review.')).toBeVisible()
})

test('real model uses the read-only CSV calculator and displays its exact inputs', async ({ page }) => {
  test.setTimeout(100_000)
  await openPaper(page)
  await openAi(page)
  await send(page, 'Calculate the mean using calculate_csv. Use data/sessions.csv, column shaded_c, CSV record numbers 3 and 4 (the header is 1), rounded to 2 decimal places. This is a read-only check.')
  const calculation = page.getByRole('region', { name: 'CSV calculation calc-1', exact: true })
  await expect(calculation.getByText('(27.5 + 27) / 2 = 27.25 · 2 decimal places')).toBeVisible({ timeout: 65_000 })
  await expect(calculation.getByRole('button', { name: 'data/sessions.csv:3' })).toBeVisible()
  await expect(calculation.getByRole('button', { name: 'data/sessions.csv:4' })).toBeVisible()
  const message = page.getByRole('article', { name: 'Assistant' }).last()
  await message.getByText('Model context sent', { exact: true }).click()
  await expect(message.getByText(/DeepSeek ·/)).toBeVisible()
  await expect(message.getByRole('list', { name: 'Model context files' })).toContainText('data/sessions.csv · CSV source')
  await expect(page.getByRole('region', { name: 'Source change proposal' })).toHaveCount(0)
})
