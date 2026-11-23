import { expect, test } from '@playwright/test'
import { morningWalkZip } from '../fixtures/morning-walk'

test('renders streamed Markdown in a narrow Writing AI panel without widening the layout', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 850 })
  await page.goto('/research-test?view=write')
  await expect(page.getByRole('heading', { name: 'Practice Paper' })).toBeVisible()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill('Test: show markdown')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const message = page.getByRole('article', { name: 'Assistant' }).last()
  await expect(message.getByRole('heading', { name: '修改摘要' })).toBeVisible()
  const scroller = message.getByRole('region', { name: 'Markdown table' })
  const table = scroller.getByRole('table')
  await expect(table.getByRole('columnheader', { name: '文件' })).toBeVisible()
  await expect(table.getByRole('cell', { name: 'A | B' })).toBeVisible()
  await expect(table.getByRole('cell', { name: '28.1' })).toHaveCSS('text-align', 'right')
  await expect(table.locator('code')).toHaveText(['sections/methods.tex', 'data/sessions.csv'])
  await expect(message.locator('ol > li > ul > li > em')).toHaveText('补充说明')
  await expect(message.locator('blockquote del')).toHaveText('旧结果')
  await expect(message.locator('pre code')).toContainText('\\input{sections/methods}')
  await expect(message.getByRole('link', { name: '文档' })).toHaveAttribute('href', 'https://example.com')
  await expect(message.getByRole('link', { name: '不安全' })).toHaveCount(0)
  await expect(message.locator('img, script')).toHaveCount(0)
  await expect(message.locator('strong', { hasText: '原始 HTML' })).toHaveCount(0)
  await expect.poll(() => scroller.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect.poll(() => message.locator('pre').evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

  await page.reload()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(table.getByRole('cell', { name: 'A | B' })).toBeVisible()
  await page.setViewportSize({ width: 1133, height: 813 })
  await expect(table.getByRole('columnheader', { name: '文件' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

test('opens verified Markdown evidence across files and returns to the same narrow chat', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 850 })
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Morning Walk Study.zip', mimeType: 'application/zip', buffer: await morningWalkZip(),
  })
  await expect(page.getByRole('heading', { name: 'Morning Walk Study' })).toBeVisible()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill('Test: show inline evidence')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const message = page.getByRole('article', { name: 'Assistant' }).last()
  await expect(message.getByText(/sections\/methods\.tex:999/)).toBeVisible()
  await expect(message.getByRole('button', { name: /999/ })).toHaveCount(0)
  await expect(message.locator('pre button')).toHaveCount(0)
  const table = message.getByRole('table')
  const editor = page.getByRole('region', { name: 'Source editor' })
  for (const [scope, button, source] of [
    [message, 'Open sections/methods.tex:3', 'sections/methods.tex'],
    [table, 'Open sections/results.tex:3', 'sections/results.tex'],
    [table, 'Open data/sessions.csv:2', 'data/sessions.csv'],
    [table, /^Open references\/library\.bib:\d+$/, 'references/library.bib'],
  ] as const) {
    await scope.getByRole('button', { name: button, exact: typeof button === 'string' }).click()
    await expect(editor.getByText(source, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to Writing AI' }).click()
    await expect(scope.getByRole('button', { name: button, exact: typeof button === 'string' })).toBeFocused()
  }
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(table.getByRole('button', { name: 'Open data/sessions.csv:2', exact: true })).toBeVisible()
})
