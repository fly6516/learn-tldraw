import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writingExerciseClaim, writingExerciseCommand } from '../../src/lib/project/writing-sample'
import { approveContext } from '../fixtures/model-context'

async function finishSample(page: Page, mode: 'Use example edits' | 'Use configured model') {
  await page.goto('/research')
  await page.getByRole('button', { name: 'Try a writing sample' }).click()
  await expect(page.getByRole('heading', { name: 'Practice Paper' })).toBeVisible()
  const guide = page.getByRole('region', { name: 'Writing sample' })
  const modelRequest = page.waitForRequest(request => request.url().endsWith('/api/latex/chat'))
  await guide.getByRole('button', { name: mode }).click()
  if (mode === 'Use configured model') await approveContext(page)
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
    if (mode === 'Use configured model') await approveContext(page)
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

test('practices compiler failure and ambiguous CSV evidence through refresh and archive', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/research')
  await page.getByRole('button', { name: 'Try a writing sample' }).click()
  const guide = page.getByRole('region', { name: 'Writing sample' })
  await guide.getByRole('button', { name: 'Practice with review issues' }).click()
  await expect(guide.getByText('Recovery exercise steps')).toBeVisible()
  const task = page.getByRole('region', { name: 'Manuscript task' })
  const review = page.getByRole('dialog', { name: 'Review manuscript task' })
  const queue = review.getByRole('region', { name: 'Manuscript review queue' })
  const claim = review.getByRole('listitem', { name: writingExerciseClaim, exact: true })
  const source = page.getByRole('region', { name: 'Source editor' })
  const editor = source.getByRole('textbox', { name: 'Project source editor' })
  const text = source.locator('.view-lines')
  const back = () => page.getByRole('button', { name: 'Back to manuscript review' }).click()

  await task.getByRole('button', { name: 'Continue task' }).click()
  await page.getByRole('button', { name: 'Apply to drafts' }).last().click()
  await expect(review.getByRole('status')).toContainText('Manuscript verification failed.')
  await queue.getByRole('button', { name: /Compile error.*sections\/results\.tex/ }).first().click()
  await page.setViewportSize({ width: 414, height: 850 })
  await queue.getByRole('button', { name: 'Open source for selected item' }).click()
  await expect(editor).toBeFocused()
  await expect(text).toContainText(writingExerciseCommand)
  await editor.press('Home')
  await editor.press('Shift+End')
  await editor.press('Backspace')
  await expect(text).not.toContainText(writingExerciseCommand)
  await back()
  await review.getByRole('button', { name: 'Include current author version' }).click()
  await claim.getByRole('button', { name: 'Confirm claim' }).click()
  const calculation = claim.getByRole('region', { name: 'CSV calculation calc-1' })
  await expect(calculation).toContainText('(19 + 21) / 2 = 20')
  await calculation.getByRole('button', { name: 'data/sessions.csv:2' }).click()
  await expect(editor).toBeFocused()
  await editor.press('Control+End')
  await page.keyboard.insertText('a,19\n')
  await expect(text).toContainText('a,19')
  await back()
  await expect(calculation).toContainText('Check the missing or ambiguous cells.')
  await expect(calculation.getByRole('button', { name: 'data/sessions.csv:2' })).toHaveCount(0)

  await page.reload()
  const resume = task.getByRole('button', { name: 'Review and save task' })
  await expect(resume).toBeVisible()
  await resume.click()
  await expect(queue.getByRole('button', { name: /Evidence or wording changed.*sample readings/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(calculation).toContainText('Check the missing or ambiguous cells.')
  await calculation.getByRole('button', { name: 'data/sessions.csv:3' }).click()
  await expect(editor).toBeFocused()
  await editor.press('Control+A')
  await page.keyboard.insertText('sample,temp_c\na,20\nb,21\n')
  await back()
  await expect(calculation).toContainText('Current inputs yield 20.5.')
  await calculation.getByRole('button', { name: 'data/sessions.csv:2' }).click()
  await expect(editor).toBeFocused()
  await editor.press('Control+A')
  await page.keyboard.insertText('sample,temp_c\na,19\nb,21\n')
  await back()
  await expect(claim.getByText('Confirmed', { exact: true })).toBeVisible()
  await review.getByRole('button', { name: 'Include current author version' }).click()
  await review.getByRole('button', { name: 'Verify manuscript' }).click()
  await expect(review.getByRole('status')).toContainText('Manuscript verification passed.')
  await review.getByRole('button', { name: 'Save verified files' }).click()
  await page.getByRole('button', { name: 'Confirm submission archive' }).click()
  await expect(guide.getByText(/Sample complete/)).toBeVisible()
})
