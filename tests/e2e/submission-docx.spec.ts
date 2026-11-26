import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { DOMParser, type Element } from '@xmldom/xmldom'
import { encodeProjectBackup } from '../../src/lib/project/backup'
import { emptyCanvas } from '../../src/lib/project/research-graph'
import { importSourceArchive } from '../../src/lib/project/source-archive'
import { submissionDocxConfig, submissionDocxIds } from '../../src/lib/project/submission-docx-config'
import { docxFields, docxFixture, docxManuscript } from './fixtures/submission-docx'
import { replaceProjectSource } from './support/official-template'

const fixtures = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

async function exportBackup(page: Page) {
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  await page.getByLabel('Include project snapshots').check()
  await page.getByLabel('Include submissions and revision rounds').check()
  const dialog = page.getByRole('dialog', { name: 'Project Backup', exact: true })
  const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download Backup', exact: true }).click()])
  const archive = await JSZip.loadAsync(await readFile((await file.path())!))
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const manifest = JSON.parse(await archive.file('project.json')!.async('string'))
  const members = Object.fromEntries(await Promise.all(Object.values(archive.files).filter(file => !file.dir && file.name !== 'project.json')
    .map(async file => [file.name, digest(await file.async('nodebuffer'))])))
  return { project: manifest.project, publication: manifest.history.publication, members }
}

async function checkOoxml(path: string, id: typeof submissionDocxIds[number]) {
  const archive = await JSZip.loadAsync(await readFile(path), { checkCRC32: true })
  const document = await archive.file('word/document.xml')!.async('string')
  const parts = new DOMParser().parseFromString(document, 'application/xml')
  const paragraph = (p: Element) => Array.from(p.getElementsByTagNameNS(ns, 't')).map(t => t.textContent).join('')
  const content = Array.from(parts.getElementsByTagNameNS(ns, 'p')).map(paragraph).join('\n')
  expect(content).toContain('周若宁')
  expect(content).toContain('20260001')
  expect(content).toContain('陈示范')
  expect(content.indexOf('原创性声明')).toBeLessThan(content.indexOf('使用授权'))
  expect(content).toMatch(/签名：[ 　]*(?:导师签名：|日期：|\n)/)
  expect(content).not.toMatch(/××××|格式示范|动脉粥样硬化|变压器故障|指导教师对文献/)
  expect(content).toContain('以独立测量核对三个通道的校准结果')
  expect(content).toContain('Independent observations'.toLowerCase())
  expect(content).toContain('实验设计')
  expect(content).toContain('研究结论的复验记录')
  const numbered = content.replace(/\s+/g, ' ')
  expect(numbered).toMatch(/\[1\] SHANNON[\s\S]+\[2\] CHOW[\s\S]+\[3\] COVER/)
  expect(parts.getElementsByTagNameNS(ns, 'tbl').length).toBe(1)
  expect(parts.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'oMath').length).toBe(2)
  expect(document).toContain('TOC \\o "1-3"')
  expect(document).toContain('PAGEREF WbxTarget')
  expect(document).toContain('REF WbxTarget')
  expect(document).toContain('PAGEREF WbxToc1')
  expect(document).toContain('REF WbxTarget1 \\n')
  expect(document).not.toContain('w:dirty="true"')
  expect(document).toContain('SEQ WbxFigure')
  expect(document).toContain('SEQ WbxTable')
  expect(document).toContain('PAGEREF WbxBibliography')
  if (id === 'suep-undergraduate') {
    expect(content).toContain('第一章 实验设计')
    expect(content.lastIndexOf('致谢')).toBeLessThan(content.lastIndexOf('参考文献'))
  }
  expect(document.indexOf('三个测量通道的独立校准结果')).toBeGreaterThan(document.indexOf('rIdWbxBody1'))
  expect(document.indexOf('独立观测样本数量')).toBeLessThan(document.indexOf('<w:tbl>'))
  const settings = await archive.file('word/settings.xml')!.async('string')
  const settingsXml = new DOMParser().parseFromString(settings, 'application/xml')
  for (const property of ['footnote', 'endnote', 'updateFields']) {
    expect(settingsXml.getElementsByTagNameNS(ns, property).length).toBe(0)
  }
  expect(Object.keys(archive.files).some(name => name.startsWith('word/media/Body-'))).toBe(true)
  const metadata = await archive.file('docProps/core.xml')!.async('string')
  expect(metadata).toContain(submissionDocxConfig(id).original.sha256)
  expect(metadata).toContain(submissionDocxConfig(id).status)
}

test('exports both official submission DOCX files from one unchanged project', async ({ page }, info) => {
  test.skip(!fixtures || process.env.RESEARCH_SUBMISSION_DOCX_ACCEPTANCE !== '1', 'Requires pinned originals and local LibreOffice and Pandoc.')
  test.setTimeout(190_000)
  const output = info.outputPath('delivery')
  await mkdir(output, { recursive: true })
  const source = await docxFixture()
  const project = await importSourceArchive(new File([new Uint8Array(source)], '校准稿件.zip'))
  project.metadata.templateOrigin = { id: 'calibration-fixture', version: '1.0.0', sha256: digest(source) }
  const saved = { id: 'saved', name: 'Existing archived submission', main: 'main.tex', paths: ['main.tex'],
    excluded: [], drafts: [], issues: [], diagnostics: [], warnings: false, createdAt: project.metadata.createdAt,
    pdf: new Blob(['%PDF-archive-preservation-fixture']), zip: new Blob([new Uint8Array(source)]), sourceChecksum: digest(source) }
  const archive = await encodeProjectBackup(emptyCanvas, project, undefined, { publication: { submissions: [saved], rounds: [] } })
  await page.route(url => url.pathname === '/api/templates/source', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('asset') === 'docx-bundle') {
      await route.fulfill({ status: 502, json: { error: '测试：官方下载暂不可用' } })
      return
    }
    const guide = params.get('asset') === 'guideline'
    const name = guide ? 'zju-basic-medicine-undergraduate-guidelines.pdf' : 'zju-basic-medicine-undergraduate.docx'
    const data = await readFile(join(fixtures!, name))
    expect(digest(data)).toBe(params.get('sha256'))
    await route.fulfill({ body: data, headers: { 'Content-Disposition': 'attachment; filename="' + name + '"' } })
  })
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: '校准稿件.research-canvas', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  const before = await exportBackup(page)
  expect(before.publication.submissions).toHaveLength(1)
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  await dialog.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
  const form = dialog.getByRole('form', { name: '导出 Word（DOCX）' })
  const inputs = {
    '中文题目': docxFields.title, '作者姓名': docxFields.author, '学号': docxFields.studentNumber,
    '指导教师': docxFields.advisor, '所在学院': '医学院', '专业与年级': '2022级基础医学（强基计划）',
    '提交日期': docxFields.date, '中文关键词': docxFields.chineseKeywords, '英文关键词': docxFields.englishKeywords,
    '中文摘要': docxFields.chineseAbstract, '致谢（选填）': docxFields.acknowledgment,
  }
  for (const [label, value] of Object.entries(inputs)) await form.getByLabel(label, { exact: true }).fill(value)
  for (const id of submissionDocxIds) {
    await form.getByLabel('目标学校').selectOption(id)
    await expect(form).toContainText(submissionDocxConfig(id).version)
    await expect(form).toContainText(submissionDocxConfig(id).status)
    const generate = form.getByRole('button', { name: '生成并下载 DOCX' })
    if (id === 'suep-undergraduate') {
      await form.getByLabel('所在学院').fill('电气工程学院')
      await form.getByLabel('专业与年级').fill('2022级电气工程及其自动化')
      await generate.click()
      await expect(form.getByRole('alert')).toContainText('手动上传官方原件')
      await form.getByText('手动上传官方原件', { exact: true }).click()
      await form.getByLabel('官方附件包 RAR').setInputFiles({ name: 'wrong.rar', mimeType: 'application/octet-stream', buffer: Buffer.from('wrong') })
      await generate.click()
      await expect(form.getByRole('alert')).toContainText('SHA-256')
      await form.getByLabel('官方附件包 RAR').setInputFiles(join(fixtures!, id + '.rar'))
    }
    const event = page.waitForEvent('download', { timeout: 70_000 })
    await generate.click()
    const path = join(output, id + '.docx')
    await (await event).saveAs(path)
    await checkOoxml(path, id)
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const after = await exportBackup(page)
  expect(after).toEqual(before)
  await writeFile(join(output, 'project-invariance.json'), JSON.stringify({ before, after, identical: true }, null, 2) + '\n')

  const unsupported = docxManuscript.replace('以同样的采样间隔', '\\begin{align}x&=1\\end{align}\n以同样的采样间隔')
  await replaceProjectSource(page, 'main.tex', unsupported)
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  await dialog.getByRole('radio', { name: /Include local drafts/ }).check()
  await dialog.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
  const manual = dialog.getByRole('form', { name: '导出 Word（DOCX）' })
  for (const [label, value] of Object.entries(inputs)) await manual.getByLabel(label, { exact: true }).fill(value)
  await manual.getByRole('button', { name: '生成并下载 DOCX' }).click()
  await expect(manual.getByRole('alert')).toContainText(/main\.tex:\d+.*align/)
})
