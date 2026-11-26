import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { templateCatalog } from '../../src/lib/project/template-catalog'
import { archiveSubmission, compileProject, confirmTemplatePublication, loadCandidate, manageOfficialVersion, openLayoutReport, publisherFile,
  replaceProjectSource, reviewArchive, saveCompiledPdf, templateCard } from './support/official-template'

const fixtures = process.env.RESEARCH_OFFICIAL_TEMPLATE_FIXTURES
const zjuId = 'zju-basic-medicine-undergraduate'
const casId = 'elsevier-cas-sc'
const zju = templateCatalog.find(entry => entry.id === zjuId)!
const cas = templateCatalog.find(entry => entry.id === casId)!
if (zju.workflow?.kind !== 'word' || cas.delivery !== 'archive') throw new Error('Acceptance catalog entries are missing.')
const zjuOrigin = { ...zju.workflow.original, version: zju.workflow.version }
const version = 'qa-2026.1'

function forTemplate(page: Page, category: 'school' | 'journal', id: string) {
  return page.goto(templateCard(category, id) + '&manage=1')
}

async function assertPublisherSource(page: Page) {
  const details = page.getByRole('complementary', { name: 'Template details' })
  await details.getByRole('button', { name: '检查官方原件更新' }).click()
  await expect(details.getByRole('status')).toContainText('所检查的官方原件与当前发布版一致。', { timeout: 25_000 })
  await expect(details.getByText('待人工核对', { exact: true })).toBeVisible()
}

async function acceptWord(page: Page, sample?: Buffer) {
  const update = !sample
  const builder = page.getByRole('dialog', { name: update ? '验收模板候选' : '从 Word 生成模板' })
  if (sample) await builder.getByLabel('Word 样例').setInputFiles({
    name: 'zju.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: sample,
  })
  else {
    await builder.getByLabel('候选版本号').fill(version)
    await expect(builder).toContainText('zju-qa-conflict.docx')
  }
  await builder.getByLabel('学校撰写规范（选填）').setInputFiles(join(fixtures!, 'zju-guide.pdf'))
  await builder.getByRole('button', { name: '生成版式配置' }).click()
  await expect(builder.getByLabel('纸张')).toHaveValue('a4', { timeout: 30_000 })
  if (update) {
    const field = builder.getByLabel('左边距（mm）')
    const rule = field.locator('../..')
    await expect(rule).toContainText('样例与规范不一致，请选择')
    await expect(rule).toContainText('规范原文 · PDF 第 10 页')
    await expect(builder.getByRole('button', { name: '编译 PDF 预览' })).toBeDisabled()
    await rule.getByRole('button', { name: '采用样例' }).click()
    await expect(field).toHaveValue('20')
    await rule.getByRole('button', { name: '采用规范' }).click()
    await expect(field).toHaveValue('25')
  }
  const conflicts = builder.getByText('样例与规范不一致，请选择').locator('..')
  while (await conflicts.count()) await conflicts.first().getByRole('button', { name: '采用规范' }).click()
  await builder.getByLabel('图表章号分隔符').selectOption('dot')
  await builder.getByLabel('页码位置').selectOption('center')
  await builder.getByLabel('参考文献', { exact: true }).selectOption('numbered')
  await builder.getByLabel('模板名称').fill(update ? '浙大冲突测试样本' : '浙大官方版式验收')
  const save = builder.getByRole('button', { name: update ? '发布新版本' : '保存到我的模板' })
  await expect(save).toBeDisabled()
  const request = page.waitForResponse(res => res.url().includes('/api/latex/compile?'), { timeout: 130_000 })
  await builder.getByRole('button', { name: '编译 PDF 预览' }).click()
  const response = await request
  expect(response.ok(), response.ok() ? undefined : (await response.text()).slice(0, 1500)).toBe(true)
  await expect(builder.getByRole('link', { name: '下载预览 PDF' })).toBeVisible({ timeout: 60_000 })
  await save.click()
  if (update) await confirmTemplatePublication(page, version, zjuOrigin.version)
  await expect(builder).toBeHidden()
}

async function loadWord(page: Page, name: string) {
  const importer = page.getByRole('dialog', { name: 'Import Word to TeX' })
  await importer.getByLabel('Project name').fill(name)
  await importer.getByLabel('Word manuscript').setInputFiles(join(fixtures!, 'zju-manuscript.docx'))
  const request = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/word/import'))
  await importer.getByRole('button', { name: 'Create TeX project' }).click()
  const response = await request
  expect(response.ok(), response.ok() ? undefined : await response.text()).toBe(true)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return JSZip.loadAsync(await response.body())
}

test('ZJU official Word acceptance from source, independent manuscript, wrong margin, and retained release', async ({ page }, info) => {
  test.skip(!fixtures, 'See docs/official-template-acceptance.md for the publisher files and fixture setup.')
  test.setTimeout(240_000)
  const original = await publisherFile(join(fixtures!, 'zju.docx'), zjuOrigin.sha256)
  await publisherFile(join(fixtures!, 'zju-guide.pdf'), '11825591e22311b0d1ca65b9c1ebcb47a58c8f891a1e98942223bbd82040954d')
  await forTemplate(page, 'school', zjuId)
  await assertPublisherSource(page)
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  await acceptWord(page, original)
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const project = await loadWord(page, '浙大独立稿验收')
  await page.waitForURL(url => url.searchParams.has('project'))
  const oldUrl = page.url()
  const independent = await project.file('manuscript.tex')!.async('string')
  expect(independent).toContain('校园无障碍路径观察')
  expect(independent).toContain('表 1.1 模拟记录表')
  expect(independent).not.toContain('2022 级基础医学')
  const main = await project.file('main.tex')!.async('string')
  const wrong = main.replace(/\bleft=\d+(?:\.\d+)?mm/, 'left=10mm')
  expect(wrong).not.toBe(main)
  await compileProject(page)
  await saveCompiledPdf(page, info.outputPath('zju-independent.pdf'))
  let report = await openLayoutReport(page)
  const margin = () => report.getByRole('listitem').filter({ hasText: '正文页边距' })
  await expect(margin()).toContainText('已核对')
  await expect(report.getByRole('listitem').filter({ hasText: '参考文献缺项' })).toContainText('已核对')
  await report.getByRole('button', { name: 'Close' }).click()

  await replaceProjectSource(page, 'main.tex', wrong)
  await compileProject(page)
  report = await openLayoutReport(page)
  await expect(margin()).toContainText('发现问题')
  await expect(margin()).toContainText('左 10 mm')
  await margin().getByRole('button', { name: /main\.tex:\d+/ }).click()
  await expect(report).toBeHidden()
  await replaceProjectSource(page, 'main.tex', main)
  await compileProject(page)
  report = await openLayoutReport(page)
  await expect(margin()).toContainText('已核对')
  await report.getByRole('button', { name: 'Close' }).click()
  await archiveSubmission(page, '浙大初始版报告', '其余版式规范')

  const candidate = await JSZip.loadAsync(original)
  const xml = await candidate.file('word/document.xml')!.async('string')
  // Synthetic conflicting sample. The registered official original stays untouched.
  candidate.file('word/document.xml', xml.replace(/(<w:pgMar\b[^>]*\bw:left=")\d+/g, (_match, prefix: string) => prefix + '1134'))
  await forTemplate(page, 'school', zjuId)
  await loadCandidate(page, zjuId, zjuOrigin.url, zjuOrigin.version, 'zju-qa-conflict.docx', await candidate.generateAsync({ type: 'nodebuffer' }))
  await acceptWord(page)
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const updated = await loadWord(page, '浙大新版本稿件')
  expect(await updated.file('main.tex')!.async('string')).toContain('left=25mm')
  await compileProject(page)
  await saveCompiledPdf(page, info.outputPath('zju-conflict-resolved.pdf'))
  const updatedReport = await openLayoutReport(page)
  const updatedMargin = updatedReport.getByRole('listitem').filter({ hasText: '正文页边距' })
  await expect(updatedMargin).toContainText('已核对')
  await expect(updatedMargin).toContainText('左 25 mm')
  await updatedReport.getByRole('button', { name: 'Close' }).click()
  await reviewArchive(page, oldUrl, '浙大初始版报告', zjuId + ' · ' + zjuOrigin.version)
  await compileProject(page)
  const oldReport = await openLayoutReport(page)
  const oldMargin = /\bleft=(\d+(?:\.\d+)?)mm/.exec(main)![1]
  const oldMarginRow = oldReport.getByRole('listitem').filter({ hasText: '正文页边距' })
  await expect(oldMarginRow).toContainText('已核对')
  await expect(oldMarginRow).toContainText('左 ' + oldMargin + ' mm')
  await expect(oldMarginRow).not.toContainText('左 25 mm')
})

test('Elsevier CAS official ZIP acceptance from source, independent manuscript, wrong class, and retained release', async ({ page }, info) => {
  test.skip(!fixtures, 'See docs/official-template-acceptance.md for the publisher files and fixture setup.')
  test.setTimeout(180_000)
  const original = await publisherFile(join(fixtures!, 'elsevier.zip'), cas.template.sha256)
  const main = cas.template.mainFile
  const manuscript = await readFile(join('tests', 'e2e', 'fixtures', 'official-template-acceptance', 'cas-manuscript.tex'), 'utf8')
  const wrong = manuscript.replace('{cas-sc}', '{cas-dc}')
  expect(wrong).not.toBe(manuscript)
  await forTemplate(page, 'journal', casId)
  await assertPublisherSource(page)
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project from template' })
  await create.getByLabel('Project name').fill('CAS 初始版验收')
  await create.getByLabel('Publisher template ZIP').setInputFiles(join(fixtures!, 'elsevier.zip'))
  await create.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'CAS 初始版验收', exact: true })).toBeVisible()
  const oldUrl = page.url()
  await compileProject(page)
  await replaceProjectSource(page, main, manuscript)
  await compileProject(page)
  await expect(page.getByRole('region', { name: 'Compiled PDF, page 1', exact: true })).toContainText('Reproducible Route Observations')
  await saveCompiledPdf(page, info.outputPath('elsevier-independent.pdf'))
  let report = await openLayoutReport(page)
  const classRow = () => report.getByRole('listitem').filter({ hasText: 'Elsevier CAS 文档类' })
  await expect(classRow()).toContainText('已核对')
  await expect(report.getByRole('listitem').filter({ hasText: '参考文献缺项' })).toContainText('已核对')
  await report.getByRole('button', { name: 'Close' }).click()
  await replaceProjectSource(page, main, wrong)
  await compileProject(page)
  report = await openLayoutReport(page)
  await expect(classRow()).toContainText('发现问题')
  await expect(classRow()).toContainText('cas-dc')
  await classRow().getByRole('button', { name: /cas-sc-sample\.tex:1/ }).click()
  await expect(report).toBeHidden()
  await replaceProjectSource(page, main, manuscript)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
  await compileProject(page)
  report = await openLayoutReport(page)
  await expect(classRow()).toContainText('已核对')
  await report.getByRole('button', { name: 'Close' }).click()
  await archiveSubmission(page, 'CAS 初始版报告', 'Elsevier 目标期刊要求')

  const candidate = await JSZip.loadAsync(original)
  candidate.file(main, manuscript.replace('Reproducible Route Observations', 'Candidate Route Observations'))
  await forTemplate(page, 'journal', casId)
  await manageOfficialVersion(page)
  const verify = page.getByRole('dialog', { name: '验收模板候选' })
  await verify.getByLabel('候选版本号').fill(version)
  await verify.getByLabel('候选官方 ZIP').setInputFiles({
    name: 'elsevier-qa.zip', mimeType: 'application/zip', buffer: await candidate.generateAsync({ type: 'nodebuffer' }),
  })
  await verify.getByRole('button', { name: '编译候选' }).click()
  await expect(verify.getByRole('link', { name: '查看候选 PDF' })).toBeVisible({ timeout: 60_000 })
  await verify.getByRole('button', { name: '发布新版本' }).click()
  await confirmTemplatePublication(page, version, cas.template.version)
  await expect(verify).toBeHidden()
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  await create.getByLabel('Project name').fill('CAS 新版本验收')
  await create.getByRole('button', { name: 'Create project' }).click()
  await compileProject(page)
  const pageOne = page.getByRole('region', { name: 'Compiled PDF, page 1', exact: true })
  await expect(pageOne).toContainText('Candidate Route Observations')

  await reviewArchive(page, oldUrl, 'CAS 初始版报告', casId + ' · ' + cas.template.version)
  await compileProject(page)
  await expect(pageOne).toContainText('Reproducible Route Observations')
})
