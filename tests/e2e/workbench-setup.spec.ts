import { expect, test } from '@playwright/test'

test('shows actionable local setup status before a compile or model call', async ({ page, request }) => {
  await page.goto('/research')
  await page.getByRole('button', { name: 'Workbench setup' }).click()
  const setup = page.getByRole('dialog', { name: 'Workbench setup' })
  await expect(setup.getByText('Local project storage ready')).toBeVisible()
  await expect(setup.getByText(/No model configured/)).toBeVisible()
  await expect(setup.getByText(process.env.RESEARCH_SETUP_EXPECT || 'Sample resources ready', { exact: true })).toBeVisible()
  const retry = page.waitForResponse(response => response.url().endsWith('/api/latex/status'))
  await setup.getByRole('button', { name: 'Retry checks' }).click()
  expect((await retry).ok()).toBe(true)
  expect((await request.post('/api/latex/status')).status()).toBe(403)
  await setup.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Try a writing sample' }).click()
  await expect(page.getByRole('heading', { name: 'Practice Paper', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Workbench setup' }).click()
  await expect(setup.getByText('Local project storage ready')).toBeVisible()
})
