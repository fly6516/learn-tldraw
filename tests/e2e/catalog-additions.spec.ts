import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const fixture = process.env.RESEARCH_CATALOG_ADDITIONS_FIXTURES
const schoolUrl = '/research?section=templates&category=school&template=sjtu-graduate-word'
const prlUrl = '/research?section=templates&category=journal&template=aps-prl'
const apsFolder = 'revtex-tds/doc/latex/revtex/sample/aps/'

async function compile(page: Page) {
  const response = page.waitForResponse(res => res.request().method() === 'POST' && res.url().includes('/api/latex/compile?'))
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  const result = await response
  expect(result.ok(), result.ok() ? undefined : (await result.text()).slice(-4500)).toBe(true)
  await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 60_000 })
}

async function replaceSource(page: Page, content: string) {
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('ControlOrMeta+a')
  await page.keyboard.insertText(content)
}

async function preflight(page: Page, label: string, expected: string, locate = false) {
  await page.getByRole('button', { name: '提交前版式检查' }).click()
  const dialog = page.getByRole('dialog', { name: '提交前版式检查' })
  const row = dialog.getByRole('listitem').filter({ hasText: label })
  await expect(row).toContainText(expected)
  if (locate) {
    await row.getByRole('button', { name: /\.tex/ }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')).toBeVisible()
  } else await dialog.getByRole('button', { name: 'Close' }).click()
}

test('uses the official SJTU Word template with independent content and repairs the PDF paper size', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the official SJTU files and independent test manuscript.')
  test.setTimeout(180_000)
  expect(createHash('sha256').update(await readFile(join(fixture!, 'sjtu.docx'))).digest('hex'))
    .toBe('22dfebf3332939293b1b08bb158fd479b7267162ffb63a82d95c3e8366c1a81f')
  await page.goto(schoolUrl)
  const details = page.getByRole('complementary', { name: 'Template details' })
  await expect(details).toContainText('2025-11-24 撰写指南')
  await expect(details).toContainText('待人工核对')
  await details.getByRole('button', { name: '手动上传原件', exact: true }).click()
  const builder = page.getByRole('dialog', { name: '从 Word 生成模板' })
  await builder.getByLabel('Word 样例').setInputFiles(join(fixture!, 'sjtu.docx'))
  await builder.getByLabel('学校撰写规范（选填）').setInputFiles(join(fixture!, 'sjtu-guide.pdf'))
  await builder.getByRole('button', { name: '生成版式配置' }).click()
  await expect(builder.getByLabel('纸张')).toHaveValue('a4')
  await expect(builder.getByLabel('摘要与目录页码')).toHaveValue('Roman')
  const conflict = builder.getByText('样例与规范不一致，请选择').locator('..')
  while (await conflict.count()) await conflict.first().getByRole('button', { name: '采用规范' }).click()
  await builder.getByLabel('正文单双页页眉').selectOption('split')
  await builder.getByLabel('固定页眉文字').fill('上海交通大学硕士学位论文')
  await builder.getByLabel('一级标题起页方式').selectOption('new-page')
  await builder.getByLabel('正文字号（pt）').fill('12')
  await builder.getByLabel('页码位置').selectOption('center')
  await builder.getByLabel('参考文献', { exact: true }).selectOption('numbered')
  await builder.getByLabel('模板名称').fill('上海交大 · 版式验收')
  await builder.getByRole('button', { name: '编译 PDF 预览' }).click()
  await expect(builder.getByRole('link', { name: '下载预览 PDF' }).or(builder.getByRole('alert'))).toBeVisible({ timeout: 60_000 })
  await expect(builder.getByRole('alert')).toHaveCount(0)
  await builder.getByRole('button', { name: '保存到我的模板' }).click()
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const importer = page.getByRole('dialog', { name: 'Import Word to TeX' })
  await importer.getByLabel('Project name').fill('港区步道观测')
  await importer.getByLabel('Word manuscript').setInputFiles(join(fixture!, 'sjtu-manuscript.docx'))
  const imported = page.waitForResponse(res => res.url().endsWith('/api/word/import') && res.request().method() === 'POST')
  await importer.getByRole('button', { name: 'Create TeX project' }).click()
  const response = await imported
  expect(response.ok()).toBe(true)
  const project = await JSZip.loadAsync(await response.body())
  const correct = await project.file('main.tex')!.async('string')
  const source = await project.file('manuscript.tex')!.async('string')
  expect(source).toContain('港区步道观测演示稿')
  expect(source).not.toContain('学术论文和科研成果目录')
  await page.getByRole('complementary', { name: 'Project navigation' }).getByTitle('main.tex', { exact: true }).click()
  await replaceSource(page, correct.replaceAll('a4paper', 'letterpaper'))
  await compile(page)
  await preflight(page, '纸张尺寸', '实际尺寸与 A4 不符', true)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Discard drafts', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
  await expect(page.getByText(/Last successful compile.*Out of date/)).toBeVisible()
  await compile(page)
  await preflight(page, '纸张尺寸', '纸张为 A4')
  await preflight(page, '前置页码', '已核对')
  await preflight(page, '正文起始页码', '已核对')
  await preflight(page, '正文固定页眉', '已核对')
  await preflight(page, '上交大封面', '待人工核对')
  const pdf = page.getByRole('region', { name: 'PDF Preview' })
  const download = page.waitForEvent('download')
  await pdf.getByRole('link', { name: 'Download PDF' }).click()
  await (await download).saveAs(info.outputPath('sjtu-independent.pdf'))
})

test('uses the official APS archive, generates a BibTeX reference, and catches a wrong journal option', async ({ page }, info) => {
  test.skip(!fixture, 'Requires the official APS REVTeX 4.2f ZIP.')
  test.setTimeout(150_000)
  await page.goto(prlUrl)
  const details = page.getByRole('complementary', { name: 'Template details' })
  await expect(details).toContainText('REVTeX 4.2f')
  await expect(details).toContainText('待人工核对')
  await details.getByRole('button', { name: '手动上传原件', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project from template' })
  await create.getByLabel('Project name').fill('Diffusive Walk · PRL acceptance')
  const file = join(fixture!, 'revtex.zip')
  await create.getByLabel('Publisher template ZIP').setInputFiles(file)
  await create.getByRole('button', { name: 'Create project' }).click()

  await page.getByRole('button', { name: 'Compile settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Compile settings' })
  await expect(settings.getByLabel('Main file')).toHaveValue(apsFolder + 'apstemplate.tex')
  await expect(settings.getByLabel('Engine')).toHaveValue('pdflatex')
  await expect(settings.getByLabel('Bibliography backend')).toHaveValue('bibtex')
  await settings.getByRole('button', { name: 'Cancel' }).click()
  await compile(page)
  await preflight(page, 'PRL 数据可用性声明', '待人工核对')

  const archive = await JSZip.loadAsync(await readFile(file))
  const template = await archive.file(apsFolder + 'apstemplate.tex')!.async('string')
  const manuscript = template.split('\\begin{document}')[0] + String.raw`\begin{document}
\title{An independent test of diffusive walks}
\author{Layout Test}
\affiliation{Local acceptance fixture}
\begin{abstract}
This synthetic manuscript verifies compilation and citation formatting.
\end{abstract}
\maketitle
\section{Diffusion check}
Random walks provide a compact example for submission testing \cite{einstein}.
\section*{Data Availability}
The synthetic example uses no external data.
\bibliography{references}
\end{document}
`
  await page.getByRole('button', { name: 'references.bib', exact: true }).click()
  await replaceSource(page, '@article{einstein, author={Einstein, Albert}, title={On the movement of small particles suspended in stationary liquids}, journal={Annalen der Physik}, year={1905}, volume={322}, pages={549--560}}\n')
  await page.getByRole('complementary', { name: 'Project navigation' }).getByTitle(apsFolder + 'apstemplate.tex', { exact: true }).click()
  await replaceSource(page, manuscript.replace('[aps,prl,preprint', '[aps,pra,preprint'))
  await compile(page)
  await preflight(page, 'PRL 期刊选项', '发现问题', true)
  await replaceSource(page, manuscript)
  await compile(page)
  await preflight(page, 'PRL 期刊选项', '已核对')
  await preflight(page, 'PRL 数据可用性声明', '已核对')
  const pdf = page.getByRole('region', { name: 'PDF Preview' })
  const sheet = pdf.getByRole('region', { name: 'Compiled PDF, page 1', exact: true })
  await expect(sheet).toContainText(/Einstein/)
  await expect(sheet).toContainText(/549/)
  const fileDownload = page.waitForEvent('download')
  await pdf.getByRole('link', { name: 'Download PDF' }).click()
  await (await fileDownload).saveAs(info.outputPath('aps-prl-independent.pdf'))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Prepare submission' }).click()
  const submission = page.getByRole('dialog', { name: 'Prepare submission' })
  await submission.getByRole('button', { name: 'Compile submission files' }).click()
  await expect(submission.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
  const summary = submission.getByText('提交前版式检查', { exact: true })
  if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
  await expect(submission.getByRole('listitem').filter({ hasText: 'PRL 期刊选项' })).toContainText('已核对')
})
