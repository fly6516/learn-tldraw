import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { templateCatalog } from '../../src/lib/project/template-catalog'
import { checkCatalogDelivery, compileCatalogDelivery } from './support/submission-delivery'
import { externalTexCommand } from '../fixtures/external-tex'

const fixture = process.env.RESEARCH_WORD_FIXTURE_DIR
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('imports the original SUEP Word files and compiles the resulting TeX project', async ({ page }, info) => {
  test.skip(!fixture, 'Set RESEARCH_WORD_FIXTURE_DIR to the directory with the official cover, declaration and sample.')
  if (checkCatalogDelivery) test.setTimeout(160_000)
  const files = {
    body: join(fixture!, 'example.doc'),
    cover: join(fixture!, 'current-cover.doc'),
    declaration: join(fixture!, 'declaration.doc'),
  }
  expect(digest(await readFile(files.cover))).toBe('f06b20bacfc3181be5f7c443e37e940f604e1433b6bfeca79f63051c538ba42b')
  expect(digest(await readFile(files.declaration))).toBe('df4c2d2b90d0b3effb2d704a3c920a4fef2f5e8117850b411a7566302877beb8')
  expect(digest(await readFile(files.body))).toBe('682978def76fb275f269355ea178fbbc06bd8ba1275d49d286bd93f5e45904ff')
  await page.goto('/research?section=templates&category=school&template=suep-undergraduate')
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import Word to TeX' })
  await expect(dialog.getByLabel('TeX layout')).toHaveValue('suep-undergraduate')
  await dialog.getByLabel('Project name').fill('上电本科 Word 导入验收')
  await dialog.getByLabel('Word manuscript').setInputFiles(files.body)
  await dialog.getByLabel('Word cover (optional)').setInputFiles(files.cover)
  await dialog.getByLabel('Word declaration (optional)').setInputFiles(files.declaration)
  // Clone the real browser response before the app navigates to the new project.
  let bytes: Buffer | undefined
  let importError: string | undefined
  await page.exposeFunction('captureWordImport', (payload?: number[], error?: string) => {
    if (payload) bytes = Buffer.from(payload)
    importError = error
  })
  await page.evaluate(() => {
    const capture = (window as Window & typeof globalThis & {
      captureWordImport: (payload?: number[], error?: string) => Promise<void>
    }).captureWordImport
    const fetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await fetch(...args)
      if (response.url.endsWith('/api/word/import') && args[1]?.method === 'POST') {
        const copy = response.clone()
        if (copy.ok) await capture([...new Uint8Array(await copy.arrayBuffer())])
        else await capture(undefined, await copy.text())
      }
      return response
    }
  })
  await dialog.getByRole('button', { name: 'Create TeX project' }).click()
  await expect.poll(() => Boolean(bytes || importError), { timeout: 45_000 }).toBe(true)
  expect(importError).toBeUndefined()
  expect(bytes?.length).toBeGreaterThan(0)
  const zip = await JSZip.loadAsync(bytes!)
  const manuscript = await zip.file('manuscript.tex')!.async('string')
  expect(manuscript).toContain('电力变压器绝缘故障诊断')
  expect(manuscript).toContain('数据管理中心')
  expect(manuscript).toContain('\\begin{longtable}')
  expect(manuscript).toContain('\\SuepStartBody')
  expect(manuscript).toContain('\\caption{图 2-1 油浸式电力变压器结构}')
  expect(manuscript).toContain('\\caption{图 2-2 数据管理中心}')
  expect(manuscript).toContain('\\caption{表 2-1 按故障发生的部位分类}')
  expect(manuscript).toContain('\\SuepTableSetup{2-1}{raggedleft}')
  expect(manuscript).toContain('\\caption{续表 2-1}')
  expect(manuscript).toContain('如表 2-1 及其续表所列')
  expect(manuscript).toContain('\\begin{SuepChineseAbstract}')
  expect(manuscript).toContain('\\begin{SuepEnglishAbstract}')
  expect(manuscript.match(/\\tableofcontents/g)).toHaveLength(1)
  expect(manuscript).toMatch(/\\subsubsection.*2\.2\.1/)
  expect(manuscript).toContain('\\textsuperscript{{[}1{]}}')
  expect(manuscript.match(/\\SuepReference\{\d+\}/g)).toHaveLength(9)
  expect(manuscript).toContain('潜伏性故障诊断结论')
  expect(manuscript).not.toContain('试验报告制作对应机制')
  expect(await zip.file('Word import.md')!.async('string')).toContain('9 distinct, 2 marked as journal articles')
  expect(manuscript.match(/\\includegraphics/g)?.length).toBeGreaterThanOrEqual(4)
  const main = await zip.file('main.tex')!.async('string')
  expect(main).toContain('left=31.7mm,right=25mm')
  expect(main).toContain('zihao=-4')
  expect(await zip.file('suep-layout.tex')!.async('string')).toContain('基于智能技术的电力变压器故障诊断系统')
  for (const role of ['body', 'cover', 'declaration'] as const) {
    expect(digest(await zip.file(`word-original/${role}.doc`)!.async('nodebuffer'))).toBe(digest(await readFile(files[role])))
  }
  await expect(page.getByRole('heading', { name: '上电本科 Word 导入验收' })).toBeVisible()
  await page.getByRole('button', { name: 'manuscript.tex', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Source editor' }).locator('.view-lines')).toContainText('SuepChineseAbstract')
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  const preview = page.getByRole('region', { name: 'PDF Preview' })
  await expect(preview.getByRole('link', { name: 'Download PDF' })).toBeVisible({ timeout: 45_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), preview.getByRole('link', { name: 'Download PDF' }).click()])
  const pdf = info.outputPath('suep-undergraduate.pdf')
  await download.saveAs(pdf)
  const pages = externalTexCommand('pdftotext', ['-layout', pdf, '-'], info.outputDir).split('\f').map(text => text.replace(/\s+/g, ''))
  const expected = ['本科毕业设计', '原创性声明', '使用授权声明', '摘要', 'Abstract', '目录']
  const nextPage = preview.getByRole('button', { name: 'Next PDF page' })
  for (const [index, title] of expected.entries()) {
    if (index) await nextPage.click()
    const sheet = page.getByRole('region', { name: 'Compiled PDF, page ' + (index + 1), exact: true })
    await expect(sheet).toBeVisible()
    expect(pages[index]).toContain(title)
  }
  expect(pages[5]).toContain('潜伏性故障诊断结论')
  if (checkCatalogDelivery) await compileCatalogDelivery(page, info, templateCatalog.find(entry => entry.id === 'suep-undergraduate')!)
})
