import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

async function finishSample(page: Page, mode: 'Use example edits' | 'Use configured model') {
  await page.goto('/research')
  await page.getByRole('button', { name: 'Try a writing sample' }).click()
  await expect(page.getByRole('heading', { name: 'Practice Paper' })).toBeVisible()
  const guide = page.getByRole('region', { name: 'Writing sample' })
  const modelRequest = page.waitForRequest(request => request.url().endsWith('/api/latex/chat'))
  await guide.getByRole('button', { name: mode }).click()
  expect(Boolean((await modelRequest).postDataJSON().writingExample)).toBe(mode === 'Use example edits')
  const task = page.getByRole('region', { name: 'Manuscript task' })
  await expect(task.getByRole('status')).toContainText('0 of 2 files applied', { timeout: 65_000 })
  const start = task.getByRole('button', { name: 'Continue task' })
  if (await start.isDisabled()) {
    await task.getByText('Author decisions and open questions').click()
    const questions = task.getByRole('textbox', { name: 'Task open questions' })
    await questions.fill('')
    await questions.press('Tab')
  }
  await start.click()
  const progress = page.locator('[aria-label="Manuscript task"] [role="status"]')
  const appliedFiles = async () => Number((await progress.textContent())?.[0])
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  for (let applied = 0; applied < 2;) {
    await proposals.last().getByRole('button', { name: 'Apply to drafts' }).click({ timeout: 65_000 })
    await expect.poll(appliedFiles).toBeGreaterThan(applied)
    applied = await appliedFiles()
  }
  const review = page.getByRole('dialog', { name: 'Review manuscript task' })
  await expect(review.getByRole('status')).toContainText('Manuscript verification passed.')
  for (const path of ['sections/methods.tex', 'sections/results.tex']) {
    await review.getByRole('button', { name: path, exact: true }).click()
    for (const confirm of await review.getByRole('button', { name: 'Confirm claim' }).all()) {
      if (await confirm.isEnabled()) await confirm.click()
    }
  }
  await review.getByRole('button', { name: 'Save verified files' }).click()
  const submission = page.getByRole('region', { name: 'Submission task' })
  await expect(submission.getByText(/ZIP SHA-256/)).toBeVisible()
  await submission.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(submission.getByText(/Archived Practice submission\./i)).toBeVisible()
  await expect(guide.getByText(/Sample complete/)).toBeVisible()
  for (const [name, signature] of [['Download compiled source ZIP', 'PK'], ['Download compiled PDF', '%PDF-']] as const) {
    const event = page.waitForEvent('download')
    await submission.getByRole('button', { name }).click()
    const download = await event
    const bytes = await readFile(await download.path())
    expect(bytes.subarray(0, signature.length).toString()).toBe(signature)
    if (signature === 'PK') {
      await expect(submission).toContainText(createHash('sha256').update(bytes).digest('hex'))
    }
  }
}

test('guides a new project from sample import to archive using example edits', async ({ page }) => {
  test.setTimeout(120_000)
  await finishSample(page, 'Use example edits')
})

test('guides the sample from import to archive with the configured model', async ({ page }) => {
  test.skip(process.env.RESEARCH_LIVE_TEST !== '1', 'Requires the configured model.')
  test.setTimeout(240_000)
  await finishSample(page, 'Use configured model')
})
