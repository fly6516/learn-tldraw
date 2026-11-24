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

test('shows preparation progress, resumes the status after reopening Setup, and supports retry', async ({ page }) => {
  let runs = 0
  let state: object = { state: 'idle' }
  await page.route('**/api/latex/status*', async route => {
    const command = new URL(route.request().url()).searchParams.get('check')
    if (command === 'prepare') {
      runs++
      state = { state: 'running', startedAt: Date.now() }
      await route.fulfill({ json: state })
    } else if (command === 'preparation') {
      state = runs === 1 ? { state: 'failed', message: 'Resource download unavailable. Check your connection and retry.' } : { state: 'ready' }
      await route.fulfill({ json: state })
    } else await route.fulfill({ json: { compiler: 'resources', cachedOnly: false, model: null, preparation: state } })
  })
  await page.goto('/research')
  const open = page.getByRole('button', { name: 'Workbench setup' })
  const setup = page.getByRole('dialog', { name: 'Workbench setup' })
  await open.click()
  await setup.getByRole('button', { name: 'Prepare TeX resources' }).click()
  await expect(setup.getByRole('status')).toContainText('Preparing the built-in sample')
  await setup.getByRole('button', { name: 'Close', exact: true }).click()
  await open.click()
  await expect(setup.getByRole('alert')).toContainText('Check your connection and retry.')
  await setup.getByRole('button', { name: 'Retry TeX preparation' }).click()
  await expect(setup.getByText('Built-in sample compiled successfully')).toBeVisible()
  expect(runs).toBe(2)
})

test('prepares a real unpacked trial installation before compiling a manuscript', async ({ page, request }) => {
  test.skip(process.env.RESEARCH_TRIAL_PREPARE !== '1', 'Use a local trial server with resource downloading enabled.')
  test.setTimeout(420_000)
  const denied = await request.post('/api/latex/status?check=prepare')
  expect(denied.status()).toBe(403)
  await page.goto('/research')
  await page.getByRole('button', { name: 'Workbench setup' }).click()
  await page.getByRole('button', { name: 'Prepare TeX resources' }).click()
  await expect(page.getByText('Built-in sample compiled successfully')).toBeVisible({ timeout: 375_000 })
})
