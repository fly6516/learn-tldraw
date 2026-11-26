import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import JSZip from 'jszip'

const official = process.env.RESEARCH_OFFICIAL_EXPANSION_FIXTURES
const school = process.env.RESEARCH_LAYOUT_PREFLIGHT_FIXTURES

async function compile(page: Page) {
  const request = page.waitForResponse(response => response.url().includes('/api/latex/compile?') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  const response = await request
  expect(response.ok(), response.ok() ? undefined : (await response.text()).slice(0, 2500)).toBe(true)
  await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 60_000 })
}

async function report(page: Page) {
  await page.getByRole('button', { name: '提交前版式检查' }).click()
  return page.getByRole('dialog', { name: '提交前版式检查' })
}

async function edit(page: Page, title: string, source: string) {
  const navigator = page.getByRole('complementary', { name: 'Project navigation' })
  const file = navigator.getByTitle(title, { exact: true })
  if (title.includes('/') && !await file.isVisible()) {
    await navigator.getByRole('button', { name: title.split('/')[0], exact: true }).click()
  }
  await file.click()
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+a')
  await page.keyboard.insertText(source)
}

test('SUEP measures PDF geometry, locates an incorrect margin and reopens the old report', async ({ page }) => {
  test.skip(!school, 'Requires the SUEP project ZIP.')
  test.setTimeout(150_000)
  const sourceZip = join(school!, 'suep.zip')
  const archive = await JSZip.loadAsync(await readFile(sourceZip))
  const correct = await archive.file('main.tex')!.async('string')
  const wrong = correct.replace('left=31.7mm', 'left=13mm')
  expect(wrong).not.toBe(correct)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles(sourceZip)
  await page.getByRole('button', { name: 'Compile settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Compile settings' })
  await settings.getByLabel('Engine').selectOption('xelatex')
  await settings.getByLabel('Bibliography backend').selectOption('none')
  await settings.getByRole('button', { name: 'Save compile settings' }).click()
  await compile(page)
  let checks = await report(page)
  const margin = () => checks.getByRole('listitem').filter({ hasText: '正文页边距' })
  await expect(margin()).toContainText('已核对')
  await expect(margin()).toContainText('左 31.7 mm')
  await checks.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const submission = page.getByRole('dialog', { name: 'Prepare submission' })
  await submission.getByRole('button', { name: 'Compile submission files' }).click()
  await expect(submission.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
  const summary = submission.getByText('提交前版式检查', { exact: true })
  if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
  await submission.getByRole('checkbox', { name: '人工确认 · 校徽与声明版面' }).check()
  await submission.getByLabel('Version name').fill('上电原版式')
  await submission.getByRole('button', { name: 'Save submission version' }).click()
  await expect(submission.getByText(/上电原版式/)).toBeVisible()
  await submission.getByRole('button', { name: 'Close' }).click()

  await edit(page, 'main.tex', wrong)
  await compile(page)
  checks = await report(page)
  await expect(margin()).toContainText('发现问题')
  await expect(margin().getByText(/左 13 mm/)).toBeVisible()
  const pdfLink = margin().getByRole('button', { name: /查看 PDF 第/ })
  const pageNumber = /\d+/.exec(await pdfLink.innerText())?.[0]
  await pdfLink.click()
  await expect(page.getByRole('region', { name: 'Compiled PDF, page ' + pageNumber, exact: true })).toBeVisible()
  checks = await report(page)
  await margin().getByRole('button', { name: /main\.tex:\d+/ }).click()
  await expect(checks).toBeHidden()
  await edit(page, 'main.tex', correct)
  await compile(page)
  checks = await report(page)
  await expect(margin()).toContainText('已核对')
  await checks.getByRole('button', { name: 'Close' }).click()

  await page.reload()
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  await submission.getByText(/上电原版式/).click()
  await submission.getByRole('button', { name: '复查归档版式报告' }).click()
  const saved = submission.getByRole('region', { name: '归档版式报告' })
  await expect(saved).toContainText('原 PDF 和源包校验通过')
  await expect(saved).toContainText('归档前已人工核对')
  await expect(saved.getByRole('listitem').filter({ hasText: '正文页边距' })).toContainText('左 31.7 mm')
})

test('JMLR locates missing BibTeX metadata in a compiled submission', async ({ page }) => {
  test.skip(!official, 'Requires the pinned official JMLR archive.')
  test.setTimeout(90_000)
  const sourceZip = join(official!, 'jmlr-pinned.zip')
  const archive = await JSZip.loadAsync(await readFile(sourceZip))
  const bib = Object.keys(archive.files).find(path => path.endsWith('/sample.bib'))!
  const correct = await archive.file(bib)!.async('string')
  const wrong = correct.replace(/^\s*year\s*=\s*\{1968\},\n/m, '\n')
  expect(wrong).not.toBe(correct)
  await page.goto('/research?section=templates&category=journal&template=jmlr')
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project from template' })
  await create.getByLabel('Project name').fill('JMLR 引用检查')
  await create.getByLabel('Publisher template ZIP').setInputFiles(sourceZip)
  await create.getByRole('button', { name: 'Create project' }).click()

  await compile(page)
  let checks = await report(page)
  const reference = () => checks.getByRole('listitem').filter({ hasText: '参考文献缺项' })
  await expect(reference()).toContainText('已核对')
  await checks.getByRole('button', { name: 'Close' }).click()
  await edit(page, bib, wrong)
  await compile(page)
  checks = await report(page)
  await expect(reference()).toContainText('条目 chow:68 缺少年份')
  await reference().getByRole('button', { name: /sample\.bib:\d+/ }).click()
  await expect(checks).toBeHidden()
  await edit(page, bib, correct)
  await compile(page)
  checks = await report(page)
  await expect(reference()).toContainText('已核对')
  await expect(checks.getByRole('listitem').filter({ hasText: 'JMLR 投稿阶段要求' })).toContainText('待人工核对')
})
