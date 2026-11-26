import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import JSZip from 'jszip'
import { templateCatalog } from '../../src/lib/project/template-catalog'
import { archiveSubmission, compileProject, openLayoutReport, replaceProjectSource, reviewArchive,
  saveCompiledPdf, templateCard, useOfficialTemplate } from './support/official-template'

const zjuFiles = process.env.RESEARCH_OFFICIAL_TEMPLATE_FIXTURES
const njuptFiles = process.env.RESEARCH_OFFICIAL_EXPANSION_FIXTURES
const cases = [
  { id: 'zju-basic-medicine-undergraduate', name: '浙大', version: '2026-09-01',
    sample: zjuFiles && join(zjuFiles, 'zju.docx'), guide: zjuFiles && join(zjuFiles, 'zju-guide.pdf'),
    marginPage: 10, referencePage: 9, captionPage: 9, expectedLeft: 25, invalidLeft: 24, minimum: true },
  { id: 'njupt-humanities-masters', name: '南邮', version: '2025-05-08',
    sample: njuptFiles && join(njuptFiles, 'njupt-humanities.doc'), guide: njuptFiles && join(njuptFiles, 'requirements.pdf'),
    marginPage: 88, referencePage: 87, captionPage: 88, expectedLeft: 20, invalidLeft: 21, minimum: false },
]

for (const scenario of cases) {
  test(`${scenario.name} compares official PDF clauses with sample, compiled settings and archived decisions`, async ({ page }, info) => {
    test.skip(!scenario.sample || !scenario.guide || !zjuFiles, 'Requires the official guide and independent Word manuscript fixtures.')
    test.setTimeout(240_000)
    await page.goto(templateCard('school', scenario.id))
    const builder = page.getByRole('dialog', { name: '从 Word 生成模板' })
    if (scenario.id === 'zju-basic-medicine-undergraduate') {
      const entry = templateCatalog.find(entry => entry.id === scenario.id)!
      if (entry.workflow?.kind !== 'word' || !entry.workflow.guideline) throw new Error('Missing ZJU workflow.')
      await expect(page.getByRole('button', { name: '使用模板', exact: true })).toBeVisible()
      await useOfficialTemplate(page, entry.workflow.original.sha256, entry.workflow.guideline.sha256)
      await expect(builder).toContainText('已校验官方 Word')
      await expect(builder).toContainText('已校验官方规范 PDF')
      await expect(builder.locator('input[type=file]')).toHaveCount(0)
    } else {
      await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
      await builder.getByLabel('Word 样例').setInputFiles(scenario.sample!)
      await builder.getByLabel('学校撰写规范（选填）').setInputFiles(scenario.guide!)
    }
    const inspected = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/api/word/import'))
    await builder.getByRole('button', { name: '生成版式配置' }).click()
    const response = await inspected
    expect(response.ok(), response.ok() ? undefined : await response.text()).toBe(true)
    const { layout } = await response.json()
    expect(layout.rules.left.standard).toMatchObject({ value: scenario.expectedLeft, excerpt: { page: scenario.marginPage } })
    expect(layout.rules.captionSeparator.standard).toMatchObject({ value: 'dot', excerpt: { page: scenario.captionPage } })
    expect(layout.rules.references.standard.excerpt.page).toBe(scenario.referencePage)
    if (scenario.minimum) {
      expect(layout.rules.left.standard.constraint.kind).toBe('minimum')
      expect(layout.rules.left.chosen.value).toBeGreaterThan(25)
      expect(layout.rules.references.standard.constraint.values).toEqual(['numbered', 'author-year'])
    } else {
      expect(layout.rules.left.standard.constraint).toBeUndefined()
      expect(layout.rules.references.standard.value).toBe('numbered')
      expect(layout.rules.references.standard.constraint).toBeUndefined()
    }

    const left = builder.getByLabel('左边距（mm）').locator('../..')
    await left.getByText(new RegExp('规范原文 · PDF 第 ' + scenario.marginPage + ' 页')).click()
    await expect(left.getByRole('link', { name: '打开规范第 ' + scenario.marginPage + ' 页' }))
      .toHaveAttribute('href', new RegExp('#page=' + scenario.marginPage + '$'))
    if (scenario.minimum) await expect(left).not.toContainText('样例与规范不一致，请选择')
    const conflicts = builder.getByText('样例与规范不一致，请选择').locator('..')
    while (await conflicts.count()) await conflicts.first().getByRole('button', { name: '采用规范' }).click()
    const refSelect = builder.getByLabel('参考文献', { exact: true })
    if (scenario.minimum) await refSelect.selectOption('author-year')
    await refSelect.selectOption('numbered')
    await refSelect.locator('../..').getByRole('checkbox', { name: '人工确认采用此规则' }).check()
    await builder.getByLabel('一级标题起页方式').selectOption('new-page')
    await builder.getByRole('button', { name: '编译 PDF 预览' }).click()
    await expect(builder.getByRole('link', { name: '下载预览 PDF' })).toBeVisible({ timeout: 120_000 })
    await expect(builder.getByText('规范和编译结果对照', { exact: true })).toBeVisible()
    await expect(builder.getByRole('region', { name: '提交前版式检查结果' })).toContainText('编译检测')
    await builder.getByRole('button', { name: '保存到我的模板' }).click()
    await page.getByRole('button', { name: '使用模板', exact: true }).click()
    const importer = page.getByRole('dialog', { name: 'Import Word to TeX' })
    await importer.getByLabel('Project name').fill(scenario.name + '规范对照验收')
    await importer.getByLabel('Word manuscript').setInputFiles(join(zjuFiles!, 'zju-manuscript.docx'))
    const converted = page.waitForResponse(res => res.request().method() === 'POST' && res.url().endsWith('/api/word/import'))
    await importer.getByRole('button', { name: 'Create TeX project' }).click()
    const imported = await converted
    expect(imported.ok(), imported.ok() ? undefined : await imported.text()).toBe(true)
    const project = await JSZip.loadAsync(await imported.body())
    const main = await project.file('main.tex')!.async('string')
    const body = await project.file('manuscript.tex')!.async('string')
    const invalidMain = main.replace(/\bleft=\d+(?:\.\d+)?mm/, 'left=' + scenario.invalidLeft + 'mm')
    const invalidBody = body.replace(/(\\caption\{表\s*\d+)\.(?=\d+)/, '$1-')
    expect(invalidMain).not.toBe(main)
    expect(invalidBody).not.toBe(body)
    await page.waitForURL(url => url.searchParams.has('project'))
    const oldUrl = page.url()

    await compileProject(page)
    let report = await openLayoutReport(page)
    const row = (label: string) => report.getByRole('listitem').filter({ hasText: label })
    await expect(row('正文页边距')).toContainText('已核对')
    await expect(row('规范图表章号分隔符')).toContainText('已核对')
    await expect(row('规范参考文献制式')).toContainText('已核对')
    await expect(row('规范参考文献制式')).toContainText('人工确认')
    await report.getByRole('button', { name: 'Close' }).click()
    await archiveSubmission(page, scenario.name + '规范旧报告', '其余版式规范')

    if (scenario.minimum) {
      const minimumPass = main.replace(/\bleft=\d+(?:\.\d+)?mm/, 'left=26mm')
      await replaceProjectSource(page, 'main.tex', minimumPass)
      await compileProject(page)
      report = await openLayoutReport(page)
      await expect(row('正文页边距')).toContainText('已核对')
      await expect(row('正文页边距')).toContainText('左 26 mm')
      await report.getByRole('button', { name: 'Close' }).click()
    }
    const bibliography = body.lastIndexOf('\\section{参考文献}')
    expect(bibliography).toBeGreaterThan(0)
    const authorYear = body.slice(0, bibliography).replaceAll('{[}1{]}', 'Jacobs (1961)')
      + '\\section{参考文献}\n\\CustomWordReference{}Jacobs J. (1961). The Death and Life of Great American Cities.\n'
    await replaceProjectSource(page, 'manuscript.tex', authorYear)
    await compileProject(page)
    report = await openLayoutReport(page)
    await expect(row('规范参考文献制式')).toContainText(scenario.minimum ? '已核对' : '发现问题')
    await expect(row('规范参考文献制式')).toContainText('著者—出版年制')
    await report.getByRole('button', { name: 'Close' }).click()
    if (scenario.minimum) {
      await replaceProjectSource(page, 'manuscript.tex', authorYear + '\\CustomWordReference{2} A second example.\n')
      await compileProject(page)
      report = await openLayoutReport(page)
      await expect(row('规范参考文献制式')).toContainText('发现问题')
      await expect(row('规范参考文献制式')).toContainText('同时出现顺序编码与著者—出版年条目')
      await report.getByRole('button', { name: 'Close' }).click()
    }

    await replaceProjectSource(page, 'main.tex', invalidMain)
    await replaceProjectSource(page, 'manuscript.tex', invalidBody)
    await compileProject(page)
    report = await openLayoutReport(page)
    await expect(row('正文页边距')).toContainText('发现问题')
    await expect(row('正文页边距')).toContainText('左 ' + scenario.invalidLeft + ' mm')
    await expect(row('规范图表章号分隔符')).toContainText('发现问题')
    await row('规范图表章号分隔符').getByRole('button', { name: /manuscript\.tex:\d+/ }).click()
    await expect(report).toBeHidden()

    await replaceProjectSource(page, 'main.tex', main)
    await replaceProjectSource(page, 'manuscript.tex', body)
    await compileProject(page)
    await saveCompiledPdf(page, info.outputPath(scenario.id + '.pdf'))
    report = await openLayoutReport(page)
    await expect(row('正文页边距')).toContainText('已核对')
    await expect(row('规范图表章号分隔符')).toContainText('已核对')
    await expect(row('规范参考文献制式')).toContainText('已核对')
    await report.getByRole('button', { name: 'Close' }).click()
    await reviewArchive(page, oldUrl, scenario.name + '规范旧报告', scenario.id + ' · ' + scenario.version, async archived => {
      const saved = archived.getByRole('listitem').filter({ hasText: '规范参考文献制式' })
      await expect(saved).toContainText('人工确认')
      await saved.getByText(new RegExp('规范原文 · PDF 第 ' + scenario.referencePage + ' 页')).click()
      await expect(saved).toContainText('顺序编码制')
    })
  })
}

test('ZJU keeps the manual entry available when the official guideline fails verification', async ({ page }) => {
  test.skip(!zjuFiles, 'The manual fallback scenario uses the live official Word source.')
  await page.route(url => url.pathname === '/api/templates/source' && url.searchParams.get('asset') === 'guideline',
    route => route.fulfill({ body: '%PDF-invalid', headers: { 'Content-Disposition': 'attachment; filename="zju-guidelines.pdf"' } }))
  await page.goto(templateCard('school', 'zju-basic-medicine-undergraduate'))
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Template catalog' }).getByRole('alert')).toContainText(/规范 PDF 失败.*原件校验失败/)
  const builder = page.getByRole('dialog', { name: '从 Word 生成模板' })
  await expect(builder).toHaveCount(0)
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  await expect(builder.getByLabel('Word 样例')).toBeVisible()
  await expect(builder.getByLabel('学校撰写规范（选填）')).toBeVisible()
})
