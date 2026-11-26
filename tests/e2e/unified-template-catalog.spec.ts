import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { catalogReleaseSource, importCatalogTemplate, templateCatalog, type CatalogTemplate } from '../../src/lib/project/template-catalog'
import { catalogSwitchStatus, exportTargets } from '../../src/lib/project/template-export-client'
import { createTemplateProject } from '../../src/lib/project/paper-templates'
import { externalTexCommand } from '../fixtures/external-tex'
import { compileProject, confirmTemplatePublication, loadCandidate, publisherFile, replaceProjectSource,
  saveCompiledPdf, templateCard } from './support/official-template'
import { checkCatalogDelivery, compileCatalogDelivery, openCatalogDelivery, verifyCatalogDelivery } from './support/submission-delivery'
import { stagesForTemplate } from '../../src/lib/project/submission-stages'
import { servePinnedTemplateFixtures } from './support/official-template'

test.beforeEach(async ({ page }) => { await servePinnedTemplateFixtures(page) })

const fixtures = process.env.RESEARCH_UNIFIED_TEMPLATE_FIXTURES
const independentText = 'The bibliography fixture uses the dependence-tree work'
const primary = (page: Page) => page.getByRole('button', { name: '使用模板', exact: true })
const manual = (page: Page) => page.getByRole('button', { name: '手动上传原件', exact: true })
const createDialog = (page: Page) => page.getByRole('dialog', { name: 'Create project from template' })

async function visit(page: Page, entry: CatalogTemplate) {
  await page.goto(templateCard(entry.category, entry.id) + '&manage=1')
  const details = page.getByRole('complementary', { name: 'Template details' })
  await expect(details.getByRole('heading', { name: entry.name, exact: true })).toBeVisible()
  return details
}

async function checkSource(page: Page, entry: CatalogTemplate) {
  const source = catalogReleaseSource(entry)!
  const details = page.getByRole('complementary', { name: 'Template details' })
  const request = page.waitForResponse(response => response.url().endsWith('/api/templates/source?id=' + entry.id), { timeout: 30_000 })
  await details.getByRole('button', { name: '检查官方原件更新' }).click()
  const response = await request
  const result = await response.json()
  if (response.ok()) {
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(details.getByRole('status')).toContainText(result.matchesBaseline ? '与当前发布版一致' : '发现不同的官方原件')
    if (!result.matchesBaseline) await expect(details.getByRole('button', { name: '载入官方原件验收' })).toBeEnabled()
    if (result.matchesBaseline) expect([source.baseline.sha256, source.equivalentBranchSha256]).toContain(result.sha256)
  } else {
    expect([409, 422, 502]).toContain(response.status())
    await expect(page.getByRole('region', { name: 'Template catalog' }).getByRole('alert')).toContainText(result.error)
    test.info().annotations.push({ type: 'source-check', description: entry.id + ': ' + result.error })
  }
}

async function openSource(page: Page, entry: CatalogTemplate, isWord?: boolean) {
  await primary(page).click()
  const dialog = isWord ? page.getByRole('dialog', { name: '从 Word 生成模板' }) : createDialog(page)
  const alert = page.getByRole('region', { name: 'Template catalog' }).getByRole('alert')
  await expect(dialog.or(alert)).toBeVisible({ timeout: 35_000 })
  if (await dialog.isVisible()) return { dialog, uploaded: false }
  test.info().annotations.push({ type: 'manual-source', description: entry.id + ': ' + await alert.innerText() })
  await manual(page).click()
  return { dialog, uploaded: true }
}

async function createLatexProject(page: Page, name: string) {
  const dialog = createDialog(page)
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Create project' }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function buildExternal(id: string, main: string, zipPath: string, destination: string) {
  const source = await JSZip.loadAsync(await readFile(zipPath))
  for (const item of Object.values(source.files)) {
    if (item.dir) continue
    expect(item.name.split('/')).not.toContain('..')
    const path = join(destination, item.name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await item.async('nodebuffer'))
  }
  const cwd = join(destination, dirname(main))
  const filename = main.split('/').at(-1)!
  const lua = id === 'mit-thesis'
  if (!lua) externalTexCommand('epstopdf', ['--outfile=fig-eps-converted-to.pdf', 'fig.eps'], cwd)
  externalTexCommand('env', ['BSTINPUTS=.//:', 'latexmk', '-norc', lua ? '-lualatex' : '-pdf', '-latexoption=-no-shell-escape', filename], cwd)
  return join(cwd, filename.replace(/\.tex$/, '.pdf'))
}

async function addIndependentText(page: Page, entry: CatalogTemplate, main: string, original?: Buffer) {
  const project = entry.delivery === 'archive'
    ? await importCatalogTemplate(entry, new File([new Uint8Array(original!)], entry.id + '.zip'), entry.name)
    : entry.delivery === 'built-in' ? await createTemplateProject(entry.template.id, entry.name) : undefined
  const file = project?.files.get(main)
  if (!file || !('content' in file) || typeof file.content !== 'string') throw new Error('Missing editable TeX at ' + main)
  const end = file.content.lastIndexOf('\\end{document}')
  expect(end).toBeGreaterThan(0)
  await replaceProjectSource(page, main, file.content.slice(0, end) + '\\par\\noindent ' + independentText + '.\\par\n' + file.content.slice(end))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
}

for (const entry of templateCatalog) {
  const { workflow } = entry
  if (workflow.kind === 'reference') {
    test(`REFERENCE ${entry.id} exposes its source without a project action`, async ({ page }) => {
      const details = await visit(page, entry)
      await expect(details.getByRole('link', { name: '查看模板来源' })).toHaveAttribute('href', entry.sourceUrl!)
      if (checkCatalogDelivery) await expect(details).toContainText('参考条目 · 查看发布方要求')
      await expect(primary(page)).toHaveCount(0)
      await expect(manual(page)).toHaveCount(0)
      if (entry.delivery === 'official') for (const link of entry.officialFiles) {
        await expect(details.getByRole('link', { name: link.label })).toHaveAttribute('href', link.url)
      }
      if (entry.requirementsUrl) await expect(details.locator('a[href=' + JSON.stringify(entry.requirementsUrl) + ']')).toBeVisible()
    })
  }
  if (workflow.kind === 'word') {
    test(`WORD ${entry.id} builds and uses the configured Word layout`, async ({ page }, info) => {
      test.skip(!fixtures, 'Requires the registered originals and existing independent Word fixture.')
      test.setTimeout(180_000)
      await visit(page, entry)
      await checkSource(page, entry)
      const ext = workflow.original.url.endsWith('.doc') ? '.doc' : '.docx'
      const original = join(fixtures!, entry.id + ext)
      await publisherFile(original, workflow.original.sha256)
      const { dialog, uploaded } = await openSource(page, entry, true)
      if (uploaded) {
        await dialog.getByLabel('Word 样例').setInputFiles(original)
        if (workflow.guideline) await dialog.getByLabel('学校撰写规范（选填）').setInputFiles(join(fixtures!, entry.id + '-guidelines.pdf'))
      } else if (workflow.guideline) {
        await expect(dialog).toContainText('已校验官方规范 PDF')
      }
      await dialog.getByRole('button', { name: '生成版式配置' }).click()
      await expect(dialog.getByLabel('纸张')).toBeVisible({ timeout: 35_000 })
      const conflicts = dialog.getByText('样例与规范不一致，请选择', { exact: true }).locator('..')
      while (await conflicts.count()) await conflicts.first().getByRole('button', { name: '采用规范' }).click()
      await dialog.getByRole('button', { name: '编译 PDF 预览' }).click()
      await expect(dialog.getByRole('link', { name: '下载预览 PDF' })).toBeVisible({ timeout: 70_000 })
      await dialog.getByRole('button', { name: '保存到我的模板' }).click()
      await expect(dialog).toBeHidden()
      await primary(page).click()
      const importer = page.getByRole('dialog', { name: 'Import Word to TeX' })
      await importer.getByLabel('Project name').fill(entry.id + ' acceptance')
      await importer.getByLabel('Word manuscript').setInputFiles(join(fixtures!, 'independent.docx'))
      await importer.getByRole('button', { name: 'Create TeX project' }).click()
      await page.waitForURL(url => url.searchParams.has('project'))
      await expect(page.getByRole('heading', { name: entry.id + ' acceptance', exact: true })).toBeVisible()
      const pdf = info.outputPath(entry.id + '.pdf')
      if (!checkCatalogDelivery || entry.id === 'sjtu-graduate-word') {
        await compileProject(page)
        await saveCompiledPdf(page, pdf)
      }
      if (checkCatalogDelivery) {
        const stage = entry.id === 'sjtu-graduate-word' ? 'sjtu-deposit' : 'catalog-delivery'
        const attachment = stage === 'sjtu-deposit' ? { name: 'qa-signed-slot-sample.pdf', bytes: await readFile(pdf) } : undefined
        await writeFile(pdf, await compileCatalogDelivery(page, info, entry, stage, attachment))
      }
      expect(externalTexCommand('pdftotext', ['-layout', pdf, '-'], info.outputDir)).toContain('校园无障碍路径观察')
    })
  }
  if (workflow.kind === 'starter' || workflow.kind === 'zip') {
    test(`${workflow.kind === 'zip' ? 'ZIP' : 'STARTER'} ${entry.id} creates a project and compiles independent content`, async ({ page }, info) => {
      test.skip(!fixtures, 'Requires the registered source archives and local TeX tools.')
      test.setTimeout(180_000)
      await visit(page, entry)
      let bytes: Buffer | undefined
      if (workflow.kind === 'zip') {
        await checkSource(page, entry)
        const original = join(fixtures!, entry.id + '.zip')
        bytes = await publisherFile(original, workflow.original.sha256)
        const { dialog, uploaded } = await openSource(page, entry)
        if (uploaded) await dialog.getByLabel('Publisher template ZIP').setInputFiles(original)
      } else await primary(page).click()
      await createLatexProject(page, entry.id + ' acceptance')
      await addIndependentText(page, entry, workflow.compile.mainFile, bytes)
      const pdf = info.outputPath(entry.id + '.pdf')
      if (workflow.kind === 'zip' && workflow.preview === 'external') {
        const dialog = checkCatalogDelivery ? await openCatalogDelivery(page, 'catalog-delivery')
          : page.getByRole('dialog', { name: 'Prepare submission' })
        if (!checkCatalogDelivery) await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
        await dialog.getByText('External compilation', { exact: true }).click()
        await dialog.getByRole('button', { name: 'Prepare external build ZIP' }).click()
        const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download external build ZIP' }).click()])
        const zip = info.outputPath('build.zip')
        await download.saveAs(zip)
        const built = await buildExternal(entry.id, workflow.compile.mainFile, zip, info.outputPath('build'))
        await dialog.getByLabel('Compiled PDF').setInputFiles(built)
        await dialog.getByRole('checkbox', { name: /I compiled this PDF/ }).check()
        await dialog.getByRole('button', { name: 'Attach external PDF' }).click()
        await expect(dialog.getByRole('status', { name: 'Compilation' })).toContainText('External PDF attached')
        if (checkCatalogDelivery) await verifyCatalogDelivery(page, dialog, info, entry, 'catalog-delivery', await readFile(zip), true)
        await writeFile(pdf, await readFile(built))
      } else if (checkCatalogDelivery) {
        const stage = entry.id === 'aps-prl' ? 'prl-review' : 'catalog-delivery'
        await writeFile(pdf, await compileCatalogDelivery(page, info, entry, stage))
        if (entry.id === 'aps-prl') await compileCatalogDelivery(page, info, entry, 'prl-production')
      } else {
        await compileProject(page)
        await saveCompiledPdf(page, pdf)
      }
      expect(externalTexCommand('pdftotext', ['-layout', pdf, '-'], info.outputDir).replace(/\s+/g, ' '))
        .toContain('uses the dependence-tree work')
    })
  }
}

test('EXTERNAL Springer candidate uses the existing external ZIP and confirmation flow', async ({ page }, info) => {
  test.skip(!fixtures, 'Requires the original Springer ZIP and external pdfLaTeX tools.')
  test.setTimeout(150_000)
  const entry = templateCatalog.find(item => item.id === 'springer-nature')!
  if (entry.workflow.kind !== 'zip') throw new Error('Missing Springer workflow.')
  const { version, original, compile } = entry.workflow
  const bytes = await publisherFile(join(fixtures!, entry.id + '.zip'), original.sha256)
  const zip = await JSZip.loadAsync(bytes)
  const text = await zip.file(compile.mainFile)!.async('string')
  zip.file(compile.mainFile, text.replaceAll('Article Title', 'Article Title - External Candidate'))
  const candidate = await zip.generateAsync({ type: 'nodebuffer' })
  await visit(page, entry)
  await loadCandidate(page, entry.id, original.url, version, 'springer-qa.zip', candidate)
  const dialog = page.getByRole('dialog', { name: '验收模板候选' })
  await dialog.getByLabel('候选版本号').fill('qa-2026.1')
  await dialog.getByRole('button', { name: '准备候选外部编译' }).click()
  await expect(dialog.getByRole('button', { name: '发布新版本' })).toHaveCount(0)
  await dialog.getByText('External compilation', { exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('link', { name: 'Download external build ZIP' }).click()])
  const archive = info.outputPath('candidate-build.zip')
  await download.saveAs(archive)
  const built = await buildExternal(entry.id, compile.mainFile, archive, info.outputPath('candidate-build'))
  expect(externalTexCommand('pdftotext', [built, '-'], info.outputDir)).toContain('External Candidate')
  await dialog.getByLabel('Compiled PDF').setInputFiles(built)
  await dialog.getByRole('checkbox', { name: /I compiled this PDF/ }).check()
  await dialog.getByRole('button', { name: 'Attach external PDF' }).click()
  await expect(dialog.getByRole('link', { name: '查看候选 PDF' })).toBeVisible()
  await dialog.getByRole('button', { name: '发布新版本' }).click()
  await confirmTemplatePublication(page, 'qa-2026.1', version)
})

test('MIGRATION preserves the registered catalog and gives each entry its configured route', () => {
  const previous = [
    'english-article', 'chinese-article', 'suep-undergraduate', 'aps-prl', 'suep-masters', 'scau-undergraduate',
    'njupt-academic-masters', 'njupt-humanities-masters', 'zju-basic-medicine-undergraduate', 'ustc-graduate-word',
    'mnras', 'elsevier-cas-sc', 'jmlr', 'sjtu-graduate-word', 'acm-journal', 'springer-nature', 'plos-one',
    'tsinghua-thesis', 'mit-thesis', 'ieee-compsoc', 'science-aaas',
  ]
  const entries = new Map(templateCatalog.map(entry => [entry.id, entry]))
  expect(entries.size).toBe(templateCatalog.length)
  for (const id of previous) expect(entries.has(id), id).toBe(true)
  for (const entry of templateCatalog) {
    expect(stagesForTemplate(entry.id).includes('catalog-delivery')).toBe(entry.workflow.kind !== 'reference')
    const target = exportTargets.find(item => item.entry === entry)
    const state = catalogSwitchStatus(entry)
    if (entry.workflow.kind === 'reference') {
      expect(state, entry.id).toBe('reference')
      expect(target, entry.id).toBeUndefined()
      expect(entry.sourceUrl, entry.id).toMatch(/^https:\/\//)
    } else {
      expect(['pinned', 'versioned', 'external-switch'], entry.id).toContain(state)
      expect(target?.sha256, entry.id).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.workflow.compile.mainFile, entry.id).toMatch(/\.tex$/)
    }
  }
})
