import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { archiveSubmission, confirmTemplatePublication, manageOfficialVersion, reviewArchive, saveCompiledPdf, templateCard } from './support/official-template'
import { servePinnedTemplateFixtures } from './support/official-template'

test.beforeEach(async ({ page }) => { await servePinnedTemplateFixtures(page) })

const fixture = process.env.RESEARCH_CATALOG_ADDITIONS_FIXTURES
const schoolCard = templateCard('school', 'sjtu-graduate-word')
const journalCard = templateCard('journal', 'aps-prl')

async function prepareWord(page: Page, file: string) {
  const dialog = page.getByRole('dialog', { name: 'Import Word to TeX' })
  await dialog.getByLabel('Project name').fill(file)
  await dialog.getByLabel('Word manuscript').setInputFiles(join(fixture!, 'sjtu-manuscript.docx'))
  const request = page.waitForResponse(res => res.url().endsWith('/api/word/import') && res.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Create TeX project' }).click()
  const response = await request
  expect(response.ok()).toBe(true)
  await expect(page.getByRole('heading', { name: file, exact: true })).toBeVisible()
  return JSZip.loadAsync(await response.body())
}

async function acceptWord(page: Page, candidate: boolean, buffer: Buffer) {
  const dialog = page.getByRole('dialog', { name: candidate ? '验收模板候选' : '从 Word 生成模板' })
  if (candidate) await dialog.getByLabel('候选版本号').fill('2026-qa.1')
  await dialog.getByLabel('Word 样例').setInputFiles({ name: 'sjtu.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer })
  await dialog.getByRole('button', { name: '生成版式配置' }).click()
  await expect(dialog.getByLabel('装订线（mm）')).toBeVisible()
  await dialog.getByLabel('正文字号（pt）').fill('12')
  await expect(dialog.getByLabel('左边距（mm）')).toHaveValue(candidate ? '30' : '25')
  const save = dialog.getByRole('button', { name: candidate ? '发布新版本' : '保存到我的模板' })
  await expect(save).toBeDisabled()
  await dialog.getByRole('button', { name: '编译 PDF 预览' }).click()
  await expect(dialog.getByRole('link', { name: '下载预览 PDF' })).toBeVisible({ timeout: 60_000 })
  await save.click()
  if (candidate) await confirmTemplatePublication(page, '2026-qa.1', '2024-07-01')
  await expect(dialog).toBeHidden()
}

test('publishes and transfers a verified SJTU Word release while keeping the old source and submission report', async ({ page, browser }, info) => {
  test.skip(!fixture, 'Requires the official SJTU Word template and manuscript.')
  test.setTimeout(180_000)
  const original = await readFile(join(fixture!, 'sjtu.docx'))
  await page.goto(schoolCard)
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  await acceptWord(page, false, original)
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const old = await prepareWord(page, '上交大旧版验收')
  const oldUrl = page.url()
  expect(await old.file('main.tex')!.async('string')).toContain('left=25mm')
  await archiveSubmission(page, '上交大旧报告', '其余版式规范')

  const changed = await JSZip.loadAsync(original)
  const xml = await changed.file('word/document.xml')!.async('string')
  changed.file('word/document.xml', xml.replace(/(<w:pgMar\b[^>]*\bw:left=")\d+/g, (_match, prefix: string) => prefix + '1701'))
  const buffer = await changed.generateAsync({ type: 'nodebuffer' })

  await page.goto(schoolCard)
  await manageOfficialVersion(page)
  await acceptWord(page, true, buffer)
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Template details' })).toContainText('2026-qa.1')
  await page.getByText('管理官方版本', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出所选版本' }).click()
  const transfer = info.outputPath('sjtu.release.zip')
  await (await download).saveAs(transfer)
  const context = await browser.newContext()
  try {
    const fresh = await context.newPage()
    await fresh.goto(new URL(schoolCard, page.url()).href)
    await fresh.getByText('管理官方版本', { exact: true }).click()
    await fresh.getByLabel('官方模板版本包').setInputFiles(transfer)
    await fresh.getByRole('button', { name: '导入并启用' }).click()
    await fresh.getByRole('button', { name: '使用模板', exact: true }).click()
    const migrated = await prepareWord(fresh, '上交大迁移版验收')
    expect(await migrated.file('main.tex')!.async('string')).toContain('left=30mm')
  } finally {
    await context.close()
  }
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const updated = await prepareWord(page, '上交大新版验收')
  expect(await updated.file('main.tex')!.async('string')).toContain('left=30mm')
  await reviewArchive(page, oldUrl, '上交大旧报告', 'sjtu-graduate-word · 2024-07-01')
  await expect(page.getByRole('complementary', { name: 'Project navigation' }).getByTitle('main.tex', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')).toContainText('left=25mm')
})

test('publishes a verified PRL ZIP release and keeps the old source and submission report', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the official REVTeX ZIP.')
  test.setTimeout(180_000)
  await page.goto(journalCard)
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project from template' })
  await create.getByLabel('Project name').fill('PRL old release')
  const original = await readFile(join(fixture!, 'revtex.zip'))
  await create.getByLabel('Publisher template ZIP').setInputFiles({ name: 'revtex.zip', mimeType: 'application/zip', buffer: original })
  await create.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'PRL old release' })).toBeVisible()
  const oldUrl = page.url()
  await archiveSubmission(page, 'PRL archived check', '期刊投稿细则')

  const changed = await JSZip.loadAsync(original)
  const main = 'revtex-tds/doc/latex/revtex/sample/aps/apstemplate.tex'
  changed.file(main, (await changed.file(main)!.async('string')).replace('\\title{}', '\\title{Simulated APS Version}'))
  await page.goto(journalCard)
  await manageOfficialVersion(page)
  const candidate = page.getByRole('dialog', { name: '验收模板候选' })
  await candidate.getByLabel('候选版本号').fill('4.2f-qa.1')
  const input = candidate.getByLabel('候选官方 ZIP')
  await input.setInputFiles({ name: 'revtex.zip', mimeType: 'application/zip', buffer: original })
  await candidate.getByRole('button', { name: '编译候选' }).click()
  await expect(candidate.getByRole('alert')).toContainText('候选原件与当前发布版相同')
  await expect(candidate.getByRole('button', { name: '发布新版本' })).toHaveCount(0)
  const next = await changed.generateAsync({ type: 'nodebuffer' })
  await input.setInputFiles({ name: 'revtex-qa.zip', mimeType: 'application/zip', buffer: next })
  await candidate.getByRole('button', { name: '编译候选' }).click()
  await expect(candidate.getByRole('link', { name: '查看候选 PDF' })).toBeVisible({ timeout: 60_000 })
  await candidate.getByRole('button', { name: '发布新版本' }).click()
  const confirmation = page.getByRole('alertdialog', { name: '确认发布模板版本' })
  await page.route(url => url.pathname === '/api/latex/compile' && url.searchParams.get('sync') === '1',
    route => route.fulfill({ status: 422, json: { error: 'PRL independent compile rejected for acceptance test' } }), { times: 1 })
  await confirmation.getByRole('button', { name: '确认发布', exact: true }).click()
  await expect(confirmation.getByRole('alert')).toContainText('PRL independent compile rejected', { timeout: 60_000 })
  await expect(page.getByText('当前发布版 4.2f', { exact: true })).toBeVisible()
  await confirmTemplatePublication(page, '4.2f-qa.1', '4.2f')
  await expect(candidate).toBeHidden()

  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Template details' })).toContainText('4.2f-qa.1')
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  await create.getByLabel('Project name').fill('PRL new release')
  await expect(create.getByLabel('Publisher template ZIP')).toHaveCount(0)
  await create.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'PRL new release' })).toBeVisible()
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  const pageOne = page.getByRole('region', { name: 'Compiled PDF, page 1', exact: true })
  await expect(pageOne).toContainText('Simulated APS Version', { timeout: 60_000 })

  await saveCompiledPdf(page, info.outputPath('prl-new-release.pdf'))
  let previousReport = ''
  await reviewArchive(page, oldUrl, 'PRL archived check', 'aps-prl · 4.2f', async report => { previousReport = await report.innerText() })
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  await expect(pageOne).toBeVisible({ timeout: 60_000 })
  await expect(pageOne).not.toContainText('Simulated APS Version')
  await saveCompiledPdf(page, info.outputPath('prl-original-release.pdf'))
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  await writeFile(info.outputPath('prl-release-acceptance.json'), JSON.stringify({
    original: { version: '4.2f', sha256: sha256(original) }, published: { version: '4.2f-qa.1', sha256: sha256(next) },
    failedIndependentCheckKeptBaseline: true, previousReport,
  }, null, 2))
})
