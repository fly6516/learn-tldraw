import { expect, firefox, test, type Browser, type Locator, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import { decodeProjectBackup, encodeProjectBackup } from '../../src/lib/project/backup'
import { importSourceArchive } from '../../src/lib/project/source-archive'
import { emptyCanvas } from '../../src/lib/project/research-graph'
import { zjuAttachmentTemplate as id, njuptAttachmentTemplate, catalogWordAttachments } from '../../src/lib/project/word-release-attachments'
import { attachmentManifestDigest } from '../../src/lib/project/official-attachments'
import { docxFields, docxFixture } from './fixtures/submission-docx'
import { compileProject, confirmTemplatePublication, saveCompiledPdf, templateCard } from './support/official-template'
import { externalTexCommand } from '../fixtures/external-tex'

const exec = promisify(execFile)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const baseline = '2026-09-01'
const version = '2026-11-27-attachment-test'
const fixture = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES

async function download(page: Page, button: Locator, path: string) {
  const [result] = await Promise.all([page.waitForEvent('download'), button.click()])
  await result.saveAs(path)
  return digest(await readFile(path))
}

async function restoreOffline(browser: Browser, market: string, packagePath: string, manifestDigest: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    const page = await context.newPage()
    await page.goto(market)
    await page.getByText('管理官方版本', { exact: true }).click()
    await page.getByLabel('官方模板版本包').setInputFiles(packagePath)
    const dialog = page.getByRole('dialog', { name: '导入官方模板版本包' })
    await dialog.getByRole('button', { name: '导入并启用' }).click()
    await expect(dialog).toBeHidden({ timeout: 110_000 })
    await expect(page.getByText('附件清单 SHA-256 ' + manifestDigest, { exact: true })).toBeVisible()
  } finally {
    await context.close()
  }
}

async function recordWordAcceptance(page: Page, market: string, generated: { form: Locator; path: string; sha256: string },
  output: string, school: string, manifestSha256: string) {
  const file = join(output, `${school}-word-final-${process.pid}.docx`)
  await copyFile(generated.path, file)
  const { stdout } = await exec('/usr/bin/osascript', [join(__dirname, 'fixtures/submission-docx-word.applescript'), file], { timeout: 120_000 })
  const version = stdout.match(/Saved and reopened in Microsoft Word (\S+) with/)?.[1]
  if (!version) throw new Error('Microsoft Word did not report a successful save and reopen.')
  await writeFile(join(output, 'word.log'), stdout)
  await copyFile(file, join(output, 'word-final.docx'))
  await generated.form.getByLabel('附上 Word 保存的最终文件（选填）').setInputFiles(file)
  await expect(generated.form.getByText(basename(file), { exact: false })).toBeVisible()
  await generated.form.getByLabel('通过实机验收的 Microsoft Word 版本（选填）').fill(version)
  await generated.form.getByLabel('交付归档名称').fill('新版 Word 实机定稿')
  await generated.form.getByRole('button', { name: '归档 DOCX 交付' }).click()
  await expect(generated.form.getByText('已归档 新版 Word 实机定稿')).toBeVisible()
  await expect(generated.form.getByText(`已通过 Microsoft Word ${version} 实机验收`, { exact: false })).toBeVisible()
  const finalSha256 = digest(await readFile(file))
  const review = await page.context().newPage()
  try {
    await review.goto(market)
    await review.getByText('管理官方版本', { exact: true }).click()
    await expect(review.getByText(`Microsoft Word ${version} 实机验收通过 · 定稿 SHA-256 ${finalSha256}`)).toBeVisible()
    const path = join(output, 'word-accepted-release.zip')
    await download(review, review.getByRole('button', { name: '导出所选版本' }), path)
    const archive = await JSZip.loadAsync(await readFile(path))
    const record = JSON.parse(await archive.file('release.json')!.async('string'))
    expect(record.wordAcceptance).toMatchObject({ software: 'Microsoft Word', version, result: 'passed', manifestSha256,
      generatedSha256: generated.sha256, finalSha256 })
  } finally { await review.close() }
}

async function restoreProjectInFirefox(page: Page, output: string, version: string, manifestSha256: string,
  expected: { pdfName: string; pdf: string; source: string; docxName: string; docx: string; attachments: number },
  reexport: (restored: Page, submission: Locator) => Promise<string>) {
  const native = process.env.RESEARCH_DOCX_WORD_NATIVE === '1'
  const baseURL = new URL(page.url()).origin
  await page.getByRole('dialog', { name: 'Prepare submission' }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  const backup = page.getByRole('dialog', { name: 'Project Backup' })
  await backup.getByRole('button', { name: 'Complete recovery backup' }).click()
  const archive = join(output, 'complete-project.research-canvas')
  const backupSha256 = await download(page, backup.getByRole('button', { name: 'Download Backup' }), archive)
  const portable = await JSZip.loadAsync(await readFile(archive))
  const originalBundle = await portable.file('history/template-releases/0.zip')!.async('nodebuffer')
  portable.file('history/template-releases/0.zip', Buffer.concat([originalBundle, Buffer.from('changed')]))
  const damaged = await portable.generateAsync({ type: 'uint8array' })
  await expect(decodeProjectBackup(new Blob([new Uint8Array(damaged)]))).rejects.toThrow(/checksum does not match/)

  const browser = await firefox.launch()
  try {
    const restored = await browser.newPage({ baseURL, viewport: { width: 1440, height: 900 } })
    const attachmentRequests: string[] = []
    await restored.route(url => ['https:', 'http:'].includes(url.protocol) && url.origin !== baseURL,
      route => route.abort('internetdisconnected'))
    await restored.route('**/api/templates/source', route => {
      attachmentRequests.push(route.request().url())
      return route.abort('internetdisconnected')
    })
    await restored.goto('/research')
    await restored.getByLabel('Choose project ZIP or backup').setInputFiles(archive)
    const preview = restored.getByRole('dialog', { name: 'Preview project backup' })
    await expect(preview.getByText(`· ${version} · ${expected.attachments} verified attachments`, { exact: false })).toBeVisible()
    if (native) await expect(preview.getByText(/Microsoft Word .* verified/)).toBeVisible()
    await expect(preview.getByText(/1 submission versions/)).toBeVisible()
    await preview.getByRole('button', { name: 'Import as new project' }).click()
    await restored.waitForURL(url => url.searchParams.has('project'))
    await restored.getByRole('button', { name: 'Writing', exact: true }).click()
    await expect(restored.getByLabel('当前编译模板')).toContainText(version)
    await restored.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    const submission = restored.getByRole('dialog', { name: 'Prepare submission' })
    const history = submission.getByRole('region', { name: 'Archived submissions' })
    const archivedPdf = history.getByText(expected.pdfName, { exact: false }).locator('..')
    await archivedPdf.locator(':scope > summary').click()
    expect(await download(restored, archivedPdf.getByRole('button', { name: 'Download archived PDF' }), join(output, 'restored-old.pdf'))).toBe(expected.pdf)
    expect(await download(restored, archivedPdf.getByRole('button', { name: 'Download archived ZIP' }), join(output, 'restored-old-source.zip'))).toBe(expected.source)
    await archivedPdf.getByRole('button', { name: '复查归档版式报告' }).click()
    await expect(archivedPdf.getByRole('region', { name: '归档版式报告' })).toContainText(expected.pdf)
    const archivedDocx = history.getByText(expected.docxName, { exact: false }).locator('..')
    await archivedDocx.locator(':scope > summary').click()
    await archivedDocx.getByRole('button', { name: '复查归档 DOCX' }).click()
    expect(await download(restored, archivedDocx.getByRole('button', { name: '下载归档生成稿' }), join(output, 'restored-old.docx'))).toBe(expected.docx)
    if (native) {
      const reviewed = history.getByText('新版 Word 实机定稿 ·', { exact: false }).locator('..')
      await reviewed.locator(':scope > summary').click()
      await reviewed.getByRole('button', { name: '复查归档 DOCX' }).click()
      expect(await download(restored, reviewed.getByRole('button', { name: '下载归档 Word 定稿' }), join(output, 'restored-reviewed-word.docx')))
        .toBe(digest(await readFile(join(output, 'word-final.docx'))))
    }
    await restored.reload()
    await expect(restored.getByLabel('当前编译模板')).toContainText(version)
    await restored.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    const regeneratedDocx = await reexport(restored, submission)
    expect(attachmentRequests).toEqual([])
    await writeFile(join(output, 'migration.json'), JSON.stringify({ browser: 'Firefox ' + browser.version(), backupSha256,
      version, manifestSha256, regeneratedDocx, archivedPdf: expected.pdf, archivedSource: expected.source, archivedDocx: expected.docx, attachmentRequests }, null, 2))
  } finally { await browser.close() }
}

async function verifyRegeneratedWord(path: string, initial: string, updatedRule: RegExp) {
  const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true })
  const first = await JSZip.loadAsync(await readFile(initial))
  const keys = [/官方原件 SHA-256 [a-f0-9]{64}/, /官方附件清单 SHA-256 [a-f0-9]{64}/, /稿件快照 SHA-256 [a-f0-9]{64}/]
  const current = await zip.file('docProps/core.xml')!.async('string')
  const old = await first.file('docProps/core.xml')!.async('string')
  for (const rule of keys) {
    expect(current).toMatch(rule)
    expect(current.match(rule)![0]).toBe(old.match(rule)![0])
  }
  expect(await zip.file('word/document.xml')!.async('string')).toMatch(updatedRule)
}

test('ZJU publishes a changed guideline with unchanged Word and uses exact releases offline', async ({ page, browser }, info) => {
  const state = process.env.RESEARCH_ATTACHMENT_UPSTREAM_STATE
  const cache = process.env.OFFICIAL_ATTACHMENT_CACHE_DIR
  test.skip(!state || !fixture || !cache, 'Requires isolated upstream and attachment cache.')
  test.setTimeout(480_000)
  const output = info.outputPath('zju')
  await mkdir(output, { recursive: true })
  const source = await docxFixture()
  const project = await importSourceArchive(new File([new Uint8Array(source)], 'attachment-release.zip'))
  const archive = await encodeProjectBackup(emptyCanvas, project)
  const registered = catalogWordAttachments(id)!
  const original = registered.find(item => item.role === 'original')!
  const guidePath = state + '.guideline.pdf'
  await copyFile(join(__dirname, 'fixtures/word-attachment-guideline.tex'), state + '.guideline.tex')
  externalTexCommand('xelatex', ['-halt-on-error', '-interaction=nonstopmode', basename(state! + '.guideline.tex')], dirname(state!))
  const nextGuide = digest(await readFile(guidePath))
  const attachments = registered.map(item => item.role === 'guideline' ? { ...item, sha256: nextGuide } : item)
  const manifestDigest = await attachmentManifestDigest(attachments)
  await writeFile(state!, 'baseline')
  await writeFile(state! + '.requests', '')
  const market = templateCard('school', id)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: '浙大附件验收.research-canvas', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  const projectUrl = page.url()
  await page.getByRole('button', { name: 'Writing', exact: true }).click()

  async function switchTemplate(selectedVersion: string) {
    await page.getByRole('button', { name: '更换模板', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
    await dialog.getByRole('combobox', { name: '目标模板' }).selectOption(id)
    await dialog.getByRole('combobox', { name: '模板版本' }).selectOption(selectedVersion)
    for (const [key, value] of [
      ['中文题目', docxFields.title], ['学号', docxFields.studentNumber], ['指导教师', docxFields.advisor],
      ['年级与专业', '2022级基础医学'], ['所在学院', '医学院'], ['提交日期', docxFields.date],
      ['中文摘要', docxFields.chineseAbstract], ['中文关键词', docxFields.chineseKeywords],
    ]) await dialog.getByLabel(key).fill(value)
    await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
    const apply = dialog.getByRole('button', { name: '设为当前模板', exact: true })
    await expect(apply.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 95_000 })
    expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    await apply.click()
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('当前编译模板')).toContainText(selectedVersion)
  }

  async function submission() {
    await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    return page.getByRole('dialog', { name: 'Prepare submission' })
  }

  async function exportWord(dialog: Locator, target: string, name: string, window = page) {
    await dialog.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
    const form = dialog.getByRole('form', { name: '导出 Word（DOCX）' })
    await expect(form).toContainText(target)
    for (const [label, value] of Object.entries({
      中文题目: docxFields.title, 作者姓名: docxFields.author, 学号: docxFields.studentNumber,
      指导教师: docxFields.advisor, 所在学院: '医学院', 专业与年级: '2022级基础医学', 提交日期: docxFields.date,
      中文摘要: docxFields.chineseAbstract, 中文关键词: docxFields.chineseKeywords, 英文关键词: docxFields.englishKeywords,
    })) await form.getByLabel(label, { exact: true }).fill(value)
    const path = join(output, name)
    const sha256 = await download(window, form.getByRole('button', { name: '生成并下载 DOCX' }), path)
    return { form, path, sha256 }
  }

  await switchTemplate(baseline)
  const oldSubmission = await submission()
  await oldSubmission.getByRole('button', { name: 'Compile submission files' }).click()
  const baselinePdf = oldSubmission.getByRole('button', { name: 'Download submission PDF', exact: true })
  await expect(baselinePdf).toBeVisible({ timeout: 90_000 })
  const oldPdf = await download(page, baselinePdf, join(output, 'old.pdf'))
  const oldSource = await download(page, oldSubmission.getByRole('button', { name: 'Download source ZIP', exact: true }), join(output, 'old-source.zip'))
  await oldSubmission.getByLabel('Version name').fill('浙大旧版 PDF')
  await oldSubmission.getByRole('button', { name: 'Save submission version' }).click()
  await expect(oldSubmission.getByText(/浙大旧版 PDF ·/)).toBeVisible()
  const baselineWord = await exportWord(oldSubmission, baseline, 'old.docx')
  await baselineWord.form.getByLabel('交付归档名称').fill('浙大旧版 DOCX')
  await baselineWord.form.getByRole('button', { name: '归档 DOCX 交付' }).click()
  await expect(baselineWord.form.getByText('已归档 浙大旧版 DOCX')).toBeVisible()

  await writeFile(state!, 'candidate')
  await page.goto(market)
  await page.getByText('管理官方版本', { exact: true }).click()
  await page.getByRole('button', { name: '检查官方原件更新' }).click()
  await expect(page.getByText('发现不同的官方原件', { exact: false })).toBeVisible()
  await expect(page.getByText('guideline · ' + nextGuide)).toBeVisible()
  await page.getByRole('button', { name: '载入官方原件验收' }).click()
  const candidate = page.getByRole('dialog', { name: '验收模板候选' })
  await candidate.getByLabel('候选版本号').fill(version)
  await candidate.getByRole('button', { name: '生成版式配置' }).click()
  const compile = candidate.getByRole('button', { name: '编译 PDF 预览' })
  await expect(compile.or(candidate.getByRole('alert'))).toBeVisible({ timeout: 45_000 })
  expect(await candidate.getByRole('alert').allTextContents()).toEqual([])
  for (const choice of await candidate.getByRole('button', { name: '采用规范', exact: true }).all()) {
    if (await choice.isVisible()) await choice.click()
  }
  await compile.click()
  const publish = candidate.getByRole('button', { name: '发布新版本' })
  await expect(publish).toBeEnabled({ timeout: 90_000 })
  await publish.click()
  await confirmTemplatePublication(page, version, baseline)
  await expect(page.getByText('附件清单 SHA-256 ' + manifestDigest, { exact: true })).toBeVisible()

  const packagePath = join(output, 'zju-release.zip')
  await download(page, page.getByRole('button', { name: '导出所选版本' }), packagePath)
  const portable = await JSZip.loadAsync(await readFile(packagePath))
  expect(digest(await portable.file('attachment-guideline')!.async('nodebuffer'))).toBe(nextGuide)
  expect(digest(await portable.file('original.docx')!.async('nodebuffer'))).toBe(original.sha256)

  await writeFile(state!, 'offline')
  for (const item of registered) await rm(join(cache!, item.sha256.slice(0, 2), item.sha256), { force: true })
  await restoreOffline(browser, market, packagePath, manifestDigest)
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Import Word to TeX' })
  await expect(create).toContainText(version)
  await create.getByLabel('Project name').fill('新规范独立稿')
  await create.getByLabel('Word manuscript').setInputFiles(join(fixture!, 'independent.docx'))
  await create.getByRole('button', { name: 'Create TeX project' }).click()
  await expect(create).toBeHidden({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await compileProject(page)
  await saveCompiledPdf(page, join(output, 'created-offline.pdf'))

  await page.goto(projectUrl)
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await expect(page.getByLabel('当前编译模板')).toContainText(baseline)
  const historical = await submission()
  const history = historical.getByRole('region', { name: 'Archived submissions' })
  const pdfRecord = history.getByText(/浙大旧版 PDF ·/).locator('..')
  await pdfRecord.locator(':scope > summary').click()
  await pdfRecord.getByRole('button', { name: '复查归档版式报告' }).click()
  const pdfReport = pdfRecord.getByRole('region', { name: '归档版式报告' })
  await expect(pdfReport).toContainText(baseline)
  await expect(pdfReport).toContainText(oldPdf)
  await expect(pdfReport).toContainText(oldSource)
  const wordRecord = history.getByText(/浙大旧版 DOCX ·/).locator('..')
  await wordRecord.locator(':scope > summary').click()
  await wordRecord.getByRole('button', { name: '复查归档 DOCX' }).click()
  const wordReport = wordRecord.getByRole('region', { name: 'DOCX 归档检查报告' })
  await expect(wordReport).toContainText(baselineWord.sha256)
  expect(await download(page, wordReport.getByRole('button', { name: '下载归档生成稿' }), join(output, 'old-reviewed.docx'))).toBe(baselineWord.sha256)
  await historical.getByRole('button', { name: 'Close', exact: true }).click()

  await switchTemplate(version)
  await compileProject(page)
  await saveCompiledPdf(page, join(output, 'switched-offline.pdf'))
  const pdf = externalTexCommand('pdftotext', ['-layout', join(output, 'switched-offline.pdf'), '-'], output)
  expect(pdf).toContain('实验设计')
  const candidateWord = await exportWord(await submission(), version, 'candidate.docx')
  const packageZip = await JSZip.loadAsync(await readFile(candidateWord.path), { checkCRC32: true })
  const content = await packageZip.file('docProps/core.xml')!.async('string')
  expect(content).toContain(manifestDigest)
  expect(content).toContain(nextGuide)
  expect(content).toContain(original.sha256)
  const markup = await packageZip.file('word/document.xml')!.async('string')
  expect(markup).toMatch(/w:left="2268"/) // 40 mm chosen from the simulated guideline.
  if (process.env.RESEARCH_DOCX_WORD_NATIVE === '1') {
    await recordWordAcceptance(page, market, candidateWord, output, 'zju', manifestDigest)
  }
  await restoreProjectInFirefox(page, output, version, manifestDigest, {
    pdfName: '浙大旧版 PDF ·', pdf: oldPdf, source: oldSource, docxName: '浙大旧版 DOCX ·', docx: baselineWord.sha256, attachments: 2,
  }, async (restored, dialog) => {
    const word = await exportWord(dialog, version, 'restored-generated.docx', restored)
    await verifyRegeneratedWord(word.path, candidateWord.path, /w:left="2268"/)
    return word.sha256
  })
  const log = await readFile(state! + '.requests', 'utf8')
  expect(log).not.toContain('offline ')
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({
    baseline, version, original: original.sha256, guideline: nextGuide, manifestDigest, oldPdf, oldSource,
    oldWord: baselineWord.sha256, newWord: candidateWord.sha256, upstream: log.trim().split('\n'),
  }, null, 2))
})

test('NJUPT publishes a changed declaration and preserves the anonymous PDF stage', async ({ page, browser }, info) => {
  const state = process.env.RESEARCH_ATTACHMENT_UPSTREAM_STATE
  const cache = process.env.OFFICIAL_ATTACHMENT_CACHE_DIR
  test.skip(!state || !fixture || !cache, 'Requires isolated upstream and attachment cache.')
  test.setTimeout(480_000)
  const output = info.outputPath('njupt')
  await mkdir(output, { recursive: true })
  const marker = '模拟换版声明核验标记'
  const school = njuptAttachmentTemplate
  const baseline = '2025-05-08'
  const version = '2026-11-27-declaration-test'
  const oldDeclaration = await readFile(join(fixture!, 'njupt-declaration.doc'))
  const simulated = await JSZip.loadAsync(oldDeclaration)
  const member = 'word/document.xml'
  const originalXml = await simulated.file(member)!.async('string')
  const inserted = originalXml.replace('非国家秘密类涉密学位论文在解密后适用本授权书。', marker + '（测试附件）')
  expect(inserted).not.toBe(originalXml)
  simulated.file(member, inserted)
  const changed = await simulated.generateAsync({ type: 'nodebuffer' })
  const nextDeclaration = digest(changed)
  await writeFile(state! + '.declaration.doc', changed)
  await writeFile(state!, 'baseline')
  await writeFile(state! + '.requests', '')
  const registered = catalogWordAttachments(school)!
  const original = registered.find(item => item.role === 'original')!
  const blind = registered.find(item => item.role === 'blind-cover')!
  const manifestDigest = await attachmentManifestDigest(registered.map(item => item.role === 'declaration'
    ? { ...item, sha256: nextDeclaration } : item))
  const source = await docxFixture()
  const manuscript = await importSourceArchive(new File([new Uint8Array(source)], 'njupt-attachment-release.zip'))
  const archived = await encodeProjectBackup(emptyCanvas, manuscript)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: '南邮声明验收.research-canvas', mimeType: 'application/zip', buffer: Buffer.from(await archived.arrayBuffer()),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  const projectUrl = page.url()
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  const market = templateCard('school', school)
  const text = (path: string) => externalTexCommand('pdftotext', ['-layout', path, '-'], output).replace(/\s+/g, '')

  async function switchTemplate(target: string) {
    await page.getByRole('button', { name: '更换模板', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
    await dialog.getByRole('combobox', { name: '目标模板' }).selectOption(school)
    await dialog.getByRole('combobox', { name: '模板版本' }).selectOption(target)
    for (const [key, value] of [
      ['中文题目', docxFields.title], ['学号', docxFields.studentNumber], ['指导教师', docxFields.advisor],
      ['专业（领域）', '电子信息'], ['所在学院', '电子工程学院'], ['提交日期', docxFields.date],
      ['中文摘要', docxFields.chineseAbstract], ['中文关键词', docxFields.chineseKeywords],
      ['导师英文姓名', 'Ming Li'], ['申请学位类别', '电子信息硕士'], ['学位类别英文全称', 'Master of Electronic Information'],
    ]) await dialog.getByLabel(key).fill(value)
    await dialog.getByLabel('培养类型').selectOption('full-time')
    await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
    const apply = dialog.getByRole('button', { name: '设为当前模板', exact: true })
    await expect(apply.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 95_000 })
    expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    await apply.click()
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('当前编译模板')).toContainText(target)
  }

  async function submission() {
    await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    return page.getByRole('dialog', { name: 'Prepare submission' })
  }

  async function compileStage(dialog: Locator, stage: 'njupt-deposit' | 'njupt-blind', stem: string) {
    await dialog.getByRole('combobox', { name: '提交阶段' }).selectOption(stage)
    await dialog.getByRole('button', { name: 'Compile submission files' }).click()
    const official = dialog.getByRole('region', { name: '正式提交材料' })
    const pdf = official.getByRole('button', { name: stage === 'njupt-blind' ? '下载匿名 PDF' : '下载稿件 PDF', exact: true })
    await expect(pdf.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 95_000 })
    expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    const sha256 = await download(page, pdf, join(output, stem + '.pdf'))
    const local = dialog.getByRole('region', { name: '本地核验材料' })
    await download(page, local.getByRole('button', { name: '下载交付包' }), join(output, stem + '.zip'))
    const zip = await JSZip.loadAsync(await readFile(join(output, stem + '.zip')))
    const report = JSON.parse(await zip.file('report.json')!.async('string'))
    expect(report.pdfChecksum).toBe(sha256)
    await writeFile(join(output, stem + '-report.json'), JSON.stringify(report, null, 2))
    return report
  }

  async function generateDocx(dialog: Locator, target: string, file: string, window = page) {
    await dialog.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
    const form = dialog.getByRole('form', { name: '导出 Word（DOCX）' })
    await expect(form).toContainText(target)
    await form.getByLabel('英文关键词').fill(docxFields.englishKeywords)
    const path = join(output, file)
    const sha256 = await download(window, form.getByRole('button', { name: '生成并下载 DOCX' }), path)
    return { form, path, sha256 }
  }

  await switchTemplate(baseline)
  const oldSubmission = await submission()
  const baselineReport = await compileStage(oldSubmission, 'njupt-deposit', 'old')
  expect(text(join(output, 'old.pdf'))).not.toContain(marker)
  await oldSubmission.getByLabel('Version name').fill('南邮旧版归档 PDF')
  await oldSubmission.getByRole('button', { name: 'Save submission version' }).click()
  await expect(oldSubmission.getByText(/南邮旧版归档 PDF ·/)).toBeVisible()
  const baselineWord = await generateDocx(oldSubmission, baseline, 'old.docx')
  await baselineWord.form.getByLabel('交付归档名称').fill('南邮旧版归档 DOCX')
  await baselineWord.form.getByRole('button', { name: '归档 DOCX 交付' }).click()
  await expect(baselineWord.form.getByText('已归档 南邮旧版归档 DOCX')).toBeVisible()

  await writeFile(state!, 'candidate')
  await page.goto(market)
  await page.getByText('管理官方版本', { exact: true }).click()
  await page.getByRole('button', { name: '检查官方原件更新' }).click()
  await expect(page.getByText('发现不同的官方原件', { exact: false })).toBeVisible()
  await expect(page.getByText('declaration · ' + nextDeclaration)).toBeVisible()
  await page.getByRole('button', { name: '载入官方原件验收' }).click()
  const candidate = page.getByRole('dialog', { name: '验收模板候选' })
  await candidate.getByLabel('候选版本号').fill(version)
  await candidate.getByRole('button', { name: '生成版式配置' }).click()
  const compile = candidate.getByRole('button', { name: '编译 PDF 预览' })
  await expect(compile.or(candidate.getByRole('alert'))).toBeVisible({ timeout: 45_000 })
  expect(await candidate.getByRole('alert').allTextContents()).toEqual([])
  for (const choice of await candidate.getByRole('button', { name: '采用规范', exact: true }).all()) {
    if (await choice.isVisible()) await choice.click()
  }
  await compile.click()
  const publish = candidate.getByRole('button', { name: '发布新版本' })
  await expect(publish).toBeEnabled({ timeout: 110_000 })
  await publish.click()
  await confirmTemplatePublication(page, version, baseline)
  await expect(page.getByText('附件清单 SHA-256 ' + manifestDigest, { exact: true })).toBeVisible()
  const packagePath = join(output, 'njupt-release.zip')
  await download(page, page.getByRole('button', { name: '导出所选版本' }), packagePath)
  const release = await JSZip.loadAsync(await readFile(packagePath))
  expect(digest(await release.file('attachment-declaration')!.async('nodebuffer'))).toBe(nextDeclaration)
  expect(digest(await release.file('original.docx')!.async('nodebuffer'))).toBe(original.sha256)
  expect(digest(await release.file('attachment-blind-cover')!.async('nodebuffer'))).toBe(blind.sha256)

  await writeFile(state!, 'offline')
  for (const item of registered) await rm(join(cache!, item.sha256.slice(0, 2), item.sha256), { force: true })
  await restoreOffline(browser, market, packagePath, manifestDigest)
  await page.getByRole('button', { name: '使用模板', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Import Word to TeX' })
  await expect(create).toContainText(version)
  await expect(create).toContainText('已校验所选版本的官方声明 Word')
  await create.getByLabel('Project name').fill('南邮新版独立稿')
  await create.getByLabel('Word manuscript').setInputFiles(join(fixture!, 'independent.docx'))
  await create.getByRole('button', { name: 'Create TeX project' }).click()
  await expect(create).toBeHidden({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await compileProject(page)
  await saveCompiledPdf(page, join(output, 'created-offline.pdf'))
  expect(text(join(output, 'created-offline.pdf'))).toContain(marker)

  await page.goto(projectUrl)
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await expect(page.getByLabel('当前编译模板')).toContainText(baseline)
  const historyDialog = await submission()
  const history = historyDialog.getByRole('region', { name: 'Archived submissions' })
  const pdfRecord = history.getByText(/南邮旧版归档 PDF ·/).locator('..')
  await pdfRecord.locator(':scope > summary').click()
  await pdfRecord.getByRole('button', { name: '复查归档版式报告' }).click()
  const pdfReport = pdfRecord.getByRole('region', { name: '归档版式报告' })
  await expect(pdfReport).toContainText(baselineReport.pdfChecksum)
  await expect(pdfReport).toContainText(baselineReport.sourceChecksum)
  const docxRecord = history.getByText(/南邮旧版归档 DOCX ·/).locator('..')
  await docxRecord.locator(':scope > summary').click()
  await docxRecord.getByRole('button', { name: '复查归档 DOCX' }).click()
  const docxReport = docxRecord.getByRole('region', { name: 'DOCX 归档检查报告' })
  expect(await download(page, docxReport.getByRole('button', { name: '下载归档生成稿' }), join(output, 'old-reviewed.docx'))).toBe(baselineWord.sha256)
  await historyDialog.getByRole('button', { name: 'Close', exact: true }).click()

  await switchTemplate(version)
  const delivery = await submission()
  const blindReport = await compileStage(delivery, 'njupt-blind', 'blind')
  expect(blindReport.delivery.attachmentSha256).toBe(blind.sha256)
  expect(blindReport.templateOrigin.manifestSha256).toBe(manifestDigest)
  await expect(delivery.getByRole('button', { name: '导出 Word（DOCX）' })).toHaveCount(0)
  const officialBlind = delivery.getByRole('region', { name: '正式提交材料' })
  await expect(officialBlind.getByRole('button')).toHaveCount(1)
  const anonymousText = text(join(output, 'blind.pdf'))
  for (const identity of [marker, docxFields.author, docxFields.advisor, docxFields.studentNumber, '原创性声明', '使用授权声明']) {
    expect(anonymousText).not.toContain(identity)
  }
  const rejected = await page.request.post('/api/word/import', {
    headers: { origin: new URL(page.url()).origin },
    multipart: { intent: 'export-submission-docx', school, stage: 'njupt-blind' },
  })
  expect(rejected.status()).toBe(422)

  const formalReport = await compileStage(delivery, 'njupt-deposit', 'formal')
  expect(formalReport.templateOrigin.manifestSha256).toBe(manifestDigest)
  expect(formalReport.delivery.snapshotSha256).toBe(blindReport.delivery.snapshotSha256)
  expect(text(join(output, 'formal.pdf'))).toContain(marker)
  const generated = await generateDocx(delivery, version, 'candidate.docx')
  const result = await JSZip.loadAsync(await readFile(generated.path), { checkCRC32: true })
  const description = await result.file('docProps/core.xml')!.async('string')
  for (const hash of [manifestDigest, nextDeclaration, original.sha256, formalReport.delivery.snapshotSha256]) expect(description).toContain(hash)
  expect(await result.file('word/document.xml')!.async('string')).toContain(marker)

  if (process.env.RESEARCH_DOCX_WORD_NATIVE === '1') {
    await recordWordAcceptance(page, market, generated, output, 'njupt', manifestDigest)
  }
  await restoreProjectInFirefox(page, output, version, manifestDigest, {
    pdfName: '南邮旧版归档 PDF ·', pdf: baselineReport.pdfChecksum, source: baselineReport.sourceChecksum,
    docxName: '南邮旧版归档 DOCX ·', docx: baselineWord.sha256, attachments: 3,
  }, async (restored, dialog) => {
    await dialog.getByRole('combobox', { name: '提交阶段' }).selectOption('njupt-deposit')
    const word = await generateDocx(dialog, version, 'restored-generated.docx', restored)
    await verifyRegeneratedWord(word.path, generated.path, new RegExp(marker))
    return word.sha256
  })
  const upstream = await readFile(state! + '.requests', 'utf8')
  expect(upstream).not.toContain('offline ')
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({
    baseline, version, original: original.sha256, declaration: nextDeclaration, blindCover: blind.sha256,
    manifestDigest, oldPdf: baselineReport.pdfChecksum, oldSource: baselineReport.sourceChecksum,
    oldWord: baselineWord.sha256, formal: formalReport.pdfChecksum, anonymous: blindReport.pdfChecksum,
    word: generated.sha256, upstream: upstream.trim().split('\n'),
  }, null, 2))
})
