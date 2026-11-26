import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { externalTexCommand } from '../fixtures/external-tex'

const fixture = process.env.RESEARCH_PUBLISHER_ZIP
const expected = '812e76dcaa9c28dc1bff1fb6065d51729b67d4ea140552a05088317414a3ecae'
const root = 'sn-article-template'
const main = `${root}/sn-article.tex`
const style = `${root}/bst/sn-mathphys-num.bst`
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
test.skip(!fixture, 'Set RESEARCH_PUBLISHER_ZIP to the official Springer Nature December 2024 template ZIP.')

async function download(page: Page, kind: 'link' | 'button', name: string, path: string) {
  const event = page.waitForEvent('download')
  await page.getByRole(kind, { name, exact: true }).click()
  await (await event).saveAs(path)
  return readFile(path)
}

async function compile(bytes: Buffer, destination: string) {
  const zip = await JSZip.loadAsync(bytes)
  const cwd = join(destination, root)
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    expect(entry.name).toMatch(/^[\w./-]+$/)
    expect(entry.name.split('/')).not.toContain('..')
    const path = join(destination, entry.name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await entry.async('nodebuffer'))
  }
  externalTexCommand('epstopdf', ['--outfile=fig-eps-converted-to.pdf', 'fig.eps'], cwd)
  const log = externalTexCommand('env', ['BSTINPUTS=.//:', 'latexmk', '-norc', '-pdf', '-latexoption=-no-shell-escape', './sn-article.tex'], cwd)
  expect(log).toMatch(/Running 'bibtex\b/i)
  const contents = externalTexCommand('pdftotext', ['sn-article.pdf', '-'], cwd)
  expect(contents).toContain('Article Title')
  expect(contents).toContain('References')
  return { pdf: join(cwd, 'sn-article.pdf'), zip }
}

test('rebuilds the official Springer Nature template after invalidating an older external ZIP', async ({ page }, info) => {
  test.setTimeout(180_000)
  const bytes = await readFile(resolve(fixture!))
  expect(hash(bytes)).toBe(expected)
  await page.goto('/research?section=templates&category=journal&template=springer-nature')
  await page.getByRole('button', { name: '手动上传原件', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Create project from template' })
  await picker.getByRole('textbox', { name: 'Project name' }).fill('Springer Nature regression')
  await picker.getByLabel('Publisher template ZIP').setInputFiles({ name: 'Springer Nature.zip', mimeType: 'application/zip', buffer: bytes })
  await picker.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Springer Nature regression' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Source editor' }).getByText(main, { exact: true })).toBeVisible()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  const open = () => page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const prepare = async () => {
    await dialog.getByRole('button', { name: 'Prepare external build ZIP' }).click()
    await expect(dialog.getByRole('link', { name: 'Download external build ZIP' })).toBeVisible()
  }
  await open()
  await dialog.getByText('ZIP files', { exact: false }).click()
  await dialog.getByRole('checkbox', { name: style, exact: true }).uncheck()
  await expect(dialog.getByText(/Excluded bibliography style:/)).toContainText(style)
  await dialog.getByRole('checkbox', { name: style, exact: true }).check()
  await dialog.getByText('External compilation', { exact: true }).click()
  await expect(dialog.getByLabel('External engine')).toHaveValue('pdflatex')
  await expect(dialog.getByText('BibTeX', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/recursive BibTeX search path/)).toBeVisible()
  await prepare()
  const oldZip = await download(page, 'link', 'Download external build ZIP', info.outputPath('old.zip'))
  const old = await compile(oldZip, info.outputPath('old'))
  await dialog.getByLabel('Compiled PDF').setInputFiles(old.pdf)
  await dialog.getByRole('checkbox', { name: /I compiled this PDF/ }).check()
  await expect(dialog.getByRole('button', { name: 'Attach external PDF' })).toBeEnabled()
  const manual = dialog.getByRole('checkbox', { name: `${root}/user-manual.pdf`, exact: true })
  await manual.uncheck()
  await expect(dialog.getByText(/External ZIP out of date/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Attach external PDF' })).toHaveCount(0)
  await manual.check()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()

  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+End')
  await page.keyboard.insertText('\n% Springer handoff regression\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
  await open()
  await dialog.getByText('External compilation', { exact: true }).click()
  await expect(dialog.getByText(/External ZIP out of date/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Attach external PDF' })).toHaveCount(0)
  await prepare()
  const currentZip = await download(page, 'link', 'Download external build ZIP', info.outputPath('current.zip'))
  expect(hash(currentZip)).not.toBe(hash(oldZip))
  await expect(dialog.getByText('ZIP SHA-256', { exact: false })).toContainText(hash(currentZip))
  const current = await compile(currentZip, info.outputPath('current'))
  expect(await current.zip.file(main)?.async('string')).toContain('Springer handoff regression')
  await dialog.getByLabel('Compiled PDF').setInputFiles(current.pdf)
  await dialog.getByRole('checkbox', { name: /I compiled this PDF/ }).check()
  await dialog.getByRole('button', { name: 'Attach external PDF' }).click()
  await expect(dialog.getByRole('status', { name: 'Compilation' })).toContainText('External PDF attached')
  await dialog.getByRole('textbox', { name: 'Version name' }).fill('Springer handoff')
  await dialog.getByRole('button', { name: 'Save submission version' }).click()
  await dialog.getByText(/^Springer handoff ·/).click()
  expect(hash(await download(page, 'button', 'Download archived ZIP', info.outputPath('archived.zip')))).toBe(hash(currentZip))
  expect(hash(await download(page, 'button', 'Download archived PDF', info.outputPath('archived.pdf')))).toBe(hash(await readFile(current.pdf)))
})
