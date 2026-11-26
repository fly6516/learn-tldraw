import { expect, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { catalogReleaseSource, templateCatalog } from '../../../src/lib/project/template-catalog'

export const templateCard = (category: string, id: string) => '/research?section=templates&category=' + category + '&template=' + id

export async function manageOfficialVersion(page: Page) {
  const summary = page.getByText('管理官方版本', { exact: true })
  if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
  await page.getByRole('button', { name: '验收候选文件' }).click()
}

export async function archiveSubmission(page: Page, name: string, manualLabel: string) {
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  await dialog.getByRole('button', { name: 'Compile submission files' }).click()
  await expect(dialog.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
  const summary = dialog.getByText('提交前版式检查', { exact: true })
  if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
  await dialog.getByRole('checkbox', { name: '人工确认 · ' + manualLabel, exact: true }).check()
  await dialog.getByLabel('Version name').fill(name)
  await dialog.getByRole('button', { name: 'Save submission version' }).click()
  await expect(dialog.getByText(new RegExp(name))).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
}

export async function reviewArchive(page: Page, url: string, name: string, version: string, check?: (report: Locator) => Promise<void>) {
  await page.goto(url)
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  await dialog.getByText(new RegExp(name)).click()
  await dialog.getByRole('button', { name: '复查归档版式报告' }).click()
  const report = dialog.getByRole('region', { name: '归档版式报告' })
  await expect(report).toContainText('原 PDF 和源包校验通过')
  await expect(report).toContainText(version)
  await expect(report).toContainText('归档前已人工核对')
  await expect(report).toContainText(/PDF SHA-256 [a-f0-9]{64}/)
  await expect(report).toContainText(/源包 SHA-256 [a-f0-9]{64}/)
  await check?.(report)
  await dialog.getByRole('button', { name: 'Close' }).click()
}

export async function publisherFile(path: string, sha256: string) {
  const buffer = await readFile(path)
  expect(createHash('sha256').update(buffer).digest('hex'), path).toBe(sha256)
  return buffer
}

export async function useOfficialTemplate(page: Page, ...digests: string[]) {
  const requests = digests.map(sha256 => page.waitForResponse(response => response.url().includes('/api/templates/source?')
    && new URL(response.url()).searchParams.get('sha256') === sha256, { timeout: 30_000 }))
  await page.getByRole('button', { name: /^使用(?:官方)?模板$/ }).click()
  for (const [index, response] of (await Promise.all(requests)).entries()) {
    expect(response.ok(), response.ok() ? undefined : await response.text()).toBe(true)
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(digests[index])
  }
}

export async function confirmTemplatePublication(page: Page, version: string, previousVersion: string) {
  const confirmation = page.getByRole('alertdialog', { name: '确认发布模板版本' })
  await expect(confirmation).toContainText(version)
  await expect(page.getByText('当前发布版 ' + previousVersion, { exact: true })).toBeVisible()
  await confirmation.getByRole('button', { name: '确认发布', exact: true }).click()
  await expect(confirmation).toBeHidden({ timeout: 90_000 })
  await expect(page.getByText('当前发布版 ' + version, { exact: true })).toBeVisible()
}

export async function loadCandidate(page: Page, id: string, sourceUrl: string, currentVersion: string, name: string, bytes: Buffer) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await page.route(url => url.pathname === '/api/templates/source' && url.searchParams.get('id') === id, async route => {
    const expected = new URL(route.request().url()).searchParams.get('sha256')
    if (!expected) {
      await route.fulfill({ json: { sha256, url: sourceUrl, scope: 'file' } })
    } else if (expected === sha256) {
      await route.fulfill({ body: bytes, contentType: 'application/octet-stream',
        headers: { 'Content-Disposition': 'attachment; filename="' + name + '"' } })
    } else await route.continue()
  })
  await page.getByRole('button', { name: '检查官方原件更新' }).click()
  await expect(page.getByText('发现不同的官方原件', { exact: false })).toBeVisible()
  await expect(page.getByText('当前发布版 ' + currentVersion, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '载入官方原件验收' }).click()
}

export async function compileProject(page: Page) {
  const request = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/latex/compile?'))
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  const response = await request
  expect(response.ok(), response.ok() ? undefined : (await response.text()).slice(0, 2500)).toBe(true)
  await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 60_000 })
}

export async function saveCompiledPdf(page: Page, path: string) {
  const download = page.waitForEvent('download')
  await page.getByRole('region', { name: 'PDF Preview' }).getByRole('link', { name: 'Download PDF', exact: true }).click()
  await (await download).saveAs(path)
}

export async function openLayoutReport(page: Page) {
  await page.getByRole('button', { name: '提交前版式检查' }).click()
  return page.getByRole('dialog', { name: '提交前版式检查' })
}

export async function replaceProjectSource(page: Page, path: string, content: string) {
  const file = page.getByRole('complementary', { name: 'Project navigation' }).getByTitle(path, { exact: true })
  await file.click()
  await page.getByRole('textbox', { name: 'Project source editor' }).press('Control+a')
  await page.keyboard.insertText(content)
}

/** Serve already verified pins so the browser workflow can be repeated when a publisher is offline. */
export async function servePinnedTemplateFixtures(page: Page) {
  const fixtures = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES
  if (!fixtures) return
  await page.route(url => url.pathname === '/api/templates/source', async route => {
    const params = new URL(route.request().url()).searchParams
    const entry = templateCatalog.find(item => item.id === params.get('id'))
    if (!entry) return route.fallback()
    const source = catalogReleaseSource(entry)
    if (!source || (entry.workflow.kind !== 'zip' && entry.workflow.kind !== 'word')) return route.fallback()
    const expected = params.get('sha256')
    if (!expected) {
      return route.fulfill({ json: { sha256: source.baseline.sha256, url: source.sourceUrl, scope: 'file', matchesBaseline: true } })
    }
    let name = entry.id + (entry.workflow.kind === 'zip' ? '.zip' : entry.workflow.original.url.endsWith('.doc') ? '.doc' : '.docx')
    const asset = params.get('asset')
    if (asset === 'guideline') name = entry.id + '-guidelines.pdf'
    if (asset === 'blind-cover') name = 'njupt-blind-cover.doc'
    if (asset === 'declaration') name = 'njupt-declaration.doc'
    const bytes = await readFile(join(fixtures, name)).catch(() => undefined)
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) return route.fallback()
    return route.fulfill({ body: bytes, contentType: 'application/octet-stream',
      headers: { 'Content-Disposition': 'attachment; filename="' + name + '"' } })
  })
}
