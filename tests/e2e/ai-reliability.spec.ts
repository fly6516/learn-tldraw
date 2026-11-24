import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { longAiPaperZip, longResultHeading, longResultLine, selectLongResult } from '../fixtures/long-ai-paper'
import { testResultEdit, testResultLine, testResults, testScenarios } from '../../src/lib/project/test-paper'
import type { chatRequestSchema } from '../../src/lib/project/writing-chat'
import type { z } from 'zod'

async function send(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

test('selects and automatically locates a late source range, then verifies and undoes the exact edit', async ({ page }) => {
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Long paper.zip', mimeType: 'application/zip', buffer: await longAiPaperZip(),
  })
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await selectLongResult(page)
  const bySelection = page.waitForRequest('**/api/latex/chat', { timeout: 12_000 })
  await send(page, testScenarios.pass)
  const selected = (await bySelection).postDataJSON() as z.infer<typeof chatRequestSchema>
  expect(selected.excerpts).toEqual([{ path: testResults, start: longResultLine, source: testResultLine }])
  expect(selected.source?.context.some(file => file.path === testResults)).toBe(false)
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await expect(proposals).toHaveCount(1)

  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: /^main\.tex\b/ }).click()
  const byHeading = page.waitForRequest('**/api/latex/chat', { timeout: 12_000 })
  await send(page, testScenarios.pass + '. Revise the ' + longResultHeading + ' section in ' + testResults + '.')
  const automatic = (await byHeading).postDataJSON()
  expect(automatic.excerpts[0]).toMatchObject({ path: testResults, start: longResultLine - 1 })
  expect(JSON.stringify(automatic.excerpts)).not.toContain('Synthetic filler')
  await expect(proposals).toHaveCount(2)
  const proposal = proposals.last()
  await proposal.getByRole('button', { name: 'Verify selected changes' }).click()
  await expect(proposal.getByText(/^Verification passed\./)).toBeVisible()
  await proposal.getByRole('button', { name: 'Save verified changes' }).click()
  await expect(proposal.getByText('Saved to project', { exact: true })).toBeVisible()
  await proposals.first().getByRole('button', { name: 'Verify selected changes' }).click()
  await expect(proposals.first().getByRole('alert')).toContainText('Source or local draft changed')
  await selectLongResult(page, testResultEdit)
  const source = page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')
  await expect(source).toContainText(testResultEdit)
  await proposal.getByRole('button', { name: 'Undo AI changes' }).click()
  await expect(source).toContainText(testResultLine)
})

test('retries the exact failed compile repair and reverifies without a duplicate proposal', async ({ page }) => {
  await page.goto('/research-test?view=write')
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await send(page, testScenarios.fail)
  const proposals = page.getByRole('region', { name: 'Source change proposal' })
  await proposals.last().getByRole('button', { name: 'Verify selected changes' }).click()
  await expect(proposals.last().getByText(/^Verification failed\./)).toBeVisible()
  await page.route('**/api/latex/chat', route => route.abort('connectionreset'), { times: 1 })
  const failed = page.waitForRequest('**/api/latex/chat')
  await proposals.last().getByRole('button', { name: 'Repair and reverify' }).click()
  const first = (await failed).postDataJSON()
  await expect(proposals).toHaveCount(1)
  const resumed = page.waitForRequest('**/api/latex/chat')
  await page.getByRole('button', { name: 'Retry request' }).click()
  const retry = (await resumed).postDataJSON()
  expect(retry.run).not.toBe(first.run)
  expect(retry).toMatchObject({ manuscript: { mode: 'repair', files: first.manuscript.files },
    scope: first.scope, feedback: first.feedback, previousProposal: first.previousProposal })
  await expect(proposals).toHaveCount(2)
  await expect(proposals.last().getByText(/^Verification passed\./)).toBeVisible()
})

test('requires a passing working-draft verification before an AI proposal can save', async ({ page }) => {
  await page.goto('/research-test?view=write')
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  const proposals = page.getByRole('region', { name: 'Source change proposal' })

  await send(page, testScenarios.fail)
  const failing = proposals.first()
  await failing.getByRole('button', { name: 'Apply to drafts' }).click()
  const save = failing.getByRole('button', { name: 'Save to project', exact: true })
  await expect(save).toBeDisabled()
  await failing.getByRole('button', { name: 'Verify working drafts' }).click()
  await expect(failing.getByText(/^Verification failed\./)).toBeVisible()
  await expect(save).toBeDisabled()
  await failing.getByRole('button', { name: 'Undo AI changes' }).click()
  await expect(failing.getByText('Undone', { exact: true })).toBeVisible()

  await send(page, testScenarios.pass)
  await expect(proposals).toHaveCount(2)
  const passing = proposals.last()
  await passing.getByRole('button', { name: 'Apply to drafts' }).click()
  await passing.getByRole('button', { name: 'Verify working drafts' }).click()
  await expect(passing.getByText(/^Verification passed\./)).toBeVisible()
  await passing.getByRole('button', { name: 'Save to project', exact: true }).click()
  await expect(passing.getByText('Saved to project', { exact: true })).toBeVisible()
})

test('shares only the selected PDF page or image after context review', async ({ page }) => {
  await page.goto('/research')
  const fixture = await page.request.get('/api/latex/test-fixture')
  const archive = await JSZip.loadAsync(await fixture.body())
  const stream = (text: string) => {
    const content = 'BT /F1 12 Tf 40 100 Td (' + text + ') Tj ET'
    return '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('UNSHARED_PAGE_MARKER'), stream('APPROVED_PAGE_MARKER'),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = pdf.length
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'
    return offset.toString().padStart(10, '0') + ' 00000 n \n'
  })
  const xref = pdf.length
  pdf += 'xref\n0 8\n0000000000 65535 f \n' + offsets.join('') + 'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
  archive.file('notes/report.pdf', pdf)
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Attachment sample.zip', mimeType: 'application/zip', buffer: await archive.generateAsync({ type: 'nodebuffer' }),
  })
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await page.getByText('Share a PDF page or image', { exact: true }).click()
  const pick = page.getByRole('combobox', { name: 'Attachment', exact: true })
  await pick.selectOption('notes/report.pdf')
  await page.getByRole('spinbutton', { name: 'PDF page' }).fill('2')
  await page.getByRole('button', { name: 'Prepare attachment', exact: true }).click()
  await expect(page.getByText('APPROVED_PAGE_MARKER', { exact: true })).toBeVisible()

  async function inspectApprovedMedia(prompt: string, receipt: RegExp) {
    let sent = false
    const observe = page.waitForRequest('**/api/latex/chat').then(request => {
      sent = true
      return request.postDataJSON()
    })
    await send(page, prompt)
    const review = page.getByRole('dialog', { name: 'Review model context' })
    await expect(review).toContainText(receipt)
    expect(sent).toBe(false)
    await review.getByRole('button', { name: 'Send reviewed request' }).click()
    const payload = await observe
    await expect(page.getByRole('article', { name: 'Assistant' }).last()).toContainText('Fixture response')
    return payload
  }
  const text = await inspectApprovedMedia('Summarize the selected page.', /notes\/report\.pdf · PDF page text · Excerpt · Page 2/)
  expect(text.media).toEqual({ kind: 'pdf_page', path: 'notes/report.pdf', page: 2, text: 'APPROVED_PAGE_MARKER' })
  expect(JSON.stringify(text)).not.toContain('UNSHARED_PAGE_MARKER')
  await pick.selectOption('figures/plot.png')
  await page.getByRole('button', { name: 'Prepare attachment', exact: true }).click()
  await expect(page.getByText('Attachment ready: figures/plot.png', { exact: true })).toBeVisible()
  const image = await inspectApprovedMedia('Describe the selected figure.', /figures\/plot\.png · Image content/)
  expect(image.media).toMatchObject({ kind: 'image', path: 'figures/plot.png', mediaType: 'image/png', data: expect.any(String) })
})
