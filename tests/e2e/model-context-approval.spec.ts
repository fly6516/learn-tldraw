import { expect, test, type Page } from '@playwright/test'
import { approveContext, contextReview } from '../fixtures/model-context'
import { morningWalkZip } from '../fixtures/morning-walk'

async function requireReview(page: Page) {
  let recipient = 'Local test model'
  await page.route(url => url.pathname === '/api/latex/status' && url.searchParams.get('check') === 'model', route =>
    route.fulfill({ json: { recipient, localOnly: false } }))
  return (model: string) => { recipient = model }
}

async function ask(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(message)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

const nextRequest = (page: Page) => page.waitForRequest(request => request.url().endsWith('/api/latex/chat'))

test('requires the first context approval and asks again for changed diagnostic data or model', async ({ page }) => {
  const setModel = await requireReview(page)
  await page.goto('/research-test?view=write')
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  let sent = 0
  page.on('request', request => { if (request.url().endsWith('/api/latex/chat')) sent++ })
  await ask(page, 'Test: show markdown')
  const review = contextReview(page)
  await expect(review).toContainText('Local test model')
  expect(sent).toBe(0)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(sent).toBe(0)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const approved = nextRequest(page)
  await approveContext(page)
  expect((await approved).postDataJSON().expectedRecipient).toBe('Local test model')
  const last = page.getByRole('article', { name: 'Assistant' }).last()
  await expect(last.getByRole('heading', { name: '修改摘要' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await last.getByText('Model context sent', { exact: true }).click()
  await expect(last).toContainText('Context confirmed for this request.')

  const reused = nextRequest(page)
  await ask(page, 'Continue explaining the project.')
  expect((await reused).postDataJSON().expectedRecipient).toBe('Local test model')
  await expect(last).toContainText('Fixture response')
  await last.getByText('Model context sent', { exact: true }).click()
  await expect(last).toContainText('Existing context approval reused.')
  expect(sent).toBe(2)

  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible()
  await ask(page, 'Explain the latest compiler result.')
  await expect(review).toContainText('Compiler diagnostics or logs included.')
  expect(sent).toBe(2)
  await approveContext(page)
  await expect(last).toContainText('Fixture response')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

  setModel('Another model · revision B')
  await ask(page, 'Continue reviewing the paper.')
  await expect(review).toContainText('Another model · revision B')
  expect(sent).toBe(3)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('pauses the first manuscript batch until its context is approved', async ({ page }) => {
  await requireReview(page)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Morning Walk Study.zip', mimeType: 'application/zip', buffer: await morningWalkZip(),
  })
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await ask(page, 'Morning claim review. Read data/sessions.csv, revise Methods and Results, compile and prepare the submission.')
  await approveContext(page)
  const task = page.getByRole('region', { name: 'Manuscript task' })
  const resume = task.getByRole('button', { name: 'Continue task' })
  await resume.click()
  const review = contextReview(page)
  await expect(review).toContainText('Continue the manuscript batch')
  await expect(review).toContainText('data/sessions.csv · CSV source')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(resume).toBeEnabled()
  await resume.click()
  const sent = nextRequest(page)
  await approveContext(page)
  expect((await sent).postDataJSON().manuscript.mode).toBe('batch')
  await expect(page.getByRole('button', { name: 'Apply to drafts' }).last()).toBeVisible()
})

test('reviews archived excerpts before sending a reviewer reply', async ({ page }) => {
  await requireReview(page)
  await page.goto('/research-test?view=write')
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  async function archive(name: string) {
    await ask(page, `/submission ${name}`)
    const card = page.getByRole('region', { name: 'Submission task' }).last()
    await card.getByRole('button', { name: 'Compile reviewed ZIP' }).click()
    await card.getByRole('button', { name: 'Confirm submission archive' }).click()
    await expect(card.getByText(`Archived ${name}.`)).toBeVisible()
  }
  await archive('Submission v1')
  await page.getByRole('button', { name: 'results.tex', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+End')
  await page.keyboard.insertText('\nA sentence added in the revision.\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
  await archive('Submission v2')
  await ask(page, '/newround Round 1 | Submission v1')
  await page.getByRole('button', { name: 'Confirm revision round' }).click()
  await expect(page.getByText('Revision round created.')).toBeVisible()
  await ask(page, '/comment sections/results.tex | Clarify the Results. | Round 1')
  await page.getByRole('button', { name: 'Confirm reviewer comment' }).click()
  await expect(page.getByText('Reviewer comment added.')).toBeVisible()
  await ask(page, '/reply 1 | Round 1 | Submission v2')
  const review = contextReview(page)
  await expect(review).toContainText('Draft a reviewer reply from the selected archives')
  await expect(review).toContainText('sections/results.tex · Archived source excerpts')
  const sent = nextRequest(page)
  await approveContext(page)
  expect((await sent).postDataJSON().workflow).toBe('revision')
  const reply = page.getByRole('region', { name: 'Reviewer reply proposal' })
  await expect(reply.getByText('Archived evidence · sections/results.tex')).toBeVisible()
  await expect(reply.getByText('Reply saved.')).toHaveCount(0)
})
