import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Locator } from '@playwright/test'
import JSZip from 'jszip'
import { suepDocxMembers, suepUndergraduateOrigin } from '../../src/lib/project/suep-undergraduate-source'
import { externalTexCommand } from '../fixtures/external-tex'
import { compileProject, confirmTemplatePublication, saveCompiledPdf, templateCard } from './support/official-template'

const exec = promisify(execFile)
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const baseline = suepUndergraduateOrigin
const candidateVersion = '2026-11-27-simulation'
const ownText = "This independent SUEP manuscript proves that the student's observations were retained."
const source = [
  '摘要', '', '这是上电独立验收稿。测量程序使用三个独立通道。', '', '关键词：校准；测量；重复性', '',
  'Independent SUEP Calibration Manuscript', '', 'Abstract', '',
  'This test article compares three measurement channels during independent verification.', '',
  'Key Words: calibration; measurement; reproducibility', '', '# 第一章 实验设计', '', ownText, '',
  '## 1.1 观测协议', '', 'Every channel was sampled once under the reference condition.', '',
  '# 第二章 结果', '', 'All three measurements support the calibration result.', '',
].join('\n')
const cover = {
  中文题目: '上电独立校准研究', 作者姓名: '测试作者', 学号: '20260001', 所在院系: '电气工程学院',
  专业年级: '电气工程2026级', 指导教师: '测试导师', 提交日期: '2026年11月27日',
}

test('uses the verified SUEP Word bundle from all three entry points and keeps earlier archives pinned', async ({ page }, info) => {
  const upstream = process.env.RESEARCH_SUEP_UPSTREAM_STATE
  const fixtures = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES
  const cache = process.env.SUEP_TEMPLATE_CACHE_DIR
  test.skip(!upstream || !fixtures || !cache || !process.env.RESEARCH_TRIAL_E2E_URL, 'Requires isolated SUEP cache, upstream fixture and loopback compiler.')
  test.setTimeout(420_000)
  const output = info.outputPath('suep')
  await mkdir(output, { recursive: true })
  const rar = join(fixtures!, 'suep-undergraduate.rar')
  const bytes = await readFile(rar)
  expect(digest(bytes)).toBe(baseline.sha256)
  const candidate = Buffer.concat([bytes, Buffer.from('\nSUEP local simulated release. Official members unchanged.\n')])
  const next = digest(candidate)
  const baselineCache = join(cache!, baseline.id, baseline.version, baseline.sha256 + '.json')
  const candidateCache = join(cache!, baseline.id, candidateVersion, next + '.json')
  await rm(baselineCache, { force: true })
  await rm(candidateCache, { force: true })
  await writeFile(upstream!, process.env.RESEARCH_SUEP_LIVE === '1' ? 'live' : 'baseline')
  await writeFile(upstream! + '.requests', '')
  await writeFile(upstream! + '.candidate.rar', candidate)
  await writeFile(join(output, 'manuscript.md'), source)
  await exec(process.env.PANDOC_BIN || 'pandoc', ['manuscript.md', '-o', 'independent.docx'], { cwd: output })
  const market = templateCard('school', baseline.id)
  const imported = page.getByRole('dialog', { name: 'Import Word to TeX' })
  const select = () => page.getByRole('button', { name: '使用模板', exact: true }).click()
  const loadStatus = (scope: Locator) => scope.getByRole('region', { name: '上电官方附件' })
  const requests = async () => (await readFile(upstream! + '.requests', 'utf8')).trim().split('\n').filter(Boolean)
  async function create(name: string) {
    await imported.getByLabel('Project name').fill(name)
    await imported.getByLabel('Word manuscript').setInputFiles(join(output, 'independent.docx'))
    for (const [label, value] of Object.entries(cover)) await imported.getByLabel(label, { exact: true }).fill(value)
    await imported.getByRole('button', { name: 'Create TeX project' }).click()
    await expect(imported).toBeHidden({ timeout: 90_000 })
    await page.waitForURL(url => url.searchParams.has('project'))
    return page.url()
  }

  await page.goto(market)
  await select()
  await expect(loadStatus(imported)).toContainText('已从学校获取并缓存', { timeout: 30_000 })
  expect(await requests()).toHaveLength(1)
  const current = JSON.parse(await readFile(baselineCache, 'utf8'))
  expect(current.manifest).toMatchObject(baseline)
  for (const [role, member] of Object.entries(suepDocxMembers)) {
    expect(current.manifest.members[role].sha256).toBe(member.sha256)
    expect(digest(Buffer.from(current.members[role], 'base64'))).toBe(member.sha256)
  }
  await writeFile(join(output, 'baseline-manifest.json'), JSON.stringify(current.manifest, null, 2))
  const oldProject = await create('上电 Word 自动原件验收')
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await compileProject(page)
  const creationPdf = join(output, 'create.pdf')
  await saveCompiledPdf(page, creationPdf)
  const assertLayout = (path: string) => {
    const text = externalTexCommand('pdftotext', ['-layout', path, '-'], output).replace(/(\p{L})-\s*\r?\n\s*(\p{L})/gu, '$1$2')
      .replace(/’/g, "'").replace(/\s+/g, ' ')
    expect(text.replace(/\s/g, '')).toContain('原创性声明')
    expect(text.replace(/\s/g, '')).toContain('使用授权声明')
    expect(text.replace(/\s/g, '')).toContain('上电独立校准研究')
    expect(text).toContain(ownText)
    expect(text).not.toMatch(/变压器故障|指导教师对文献|格式示范文本/)
  }
  assertLayout(creationPdf)

  await page.goto(market)
  await select()
  await expect(loadStatus(imported)).toContainText('已使用校验通过的本地缓存')
  expect(await requests()).toHaveLength(1)
  await imported.getByRole('button', { name: 'Close', exact: true }).click()
  await writeFile(upstream!, 'offline')
  await select()
  await expect(loadStatus(imported)).toContainText('已使用校验通过的本地缓存')
  expect(await requests()).toHaveLength(1)
  await imported.getByRole('button', { name: 'Close', exact: true }).click()

  current.members.cover = Buffer.from('damaged cached member').toString('base64')
  await writeFile(baselineCache, JSON.stringify(current))
  await writeFile(upstream!, 'baseline')
  await select()
  await expect(loadStatus(imported)).toContainText('已从学校获取并缓存', { timeout: 30_000 })
  expect(await requests()).toHaveLength(2)
  expect(JSON.parse(await readFile(baselineCache, 'utf8')).members.cover).not.toBe(current.members.cover)
  await imported.getByRole('button', { name: 'Close', exact: true }).click()

  await writeFile(upstream!, 'offline')
  await rm(baselineCache)
  await select()
  const assets = loadStatus(imported)
  await expect(assets.getByRole('alert')).toContainText('手动上传', { timeout: 30_000 })
  expect(await requests()).toHaveLength(3)
  const file = assets.getByLabel('官方附件包 RAR')
  await file.setInputFiles({ name: 'wrong.rar', mimeType: 'application/octet-stream', buffer: Buffer.from('incorrect') })
  await expect(assets.getByRole('alert')).toContainText('SHA-256')
  await expect(imported.getByRole('button', { name: 'Create TeX project' })).toBeDisabled()
  await file.setInputFiles(rar)
  await expect(assets).toContainText('已校验并载入上传的官方附件包')
  await access(baselineCache)
  await imported.getByRole('button', { name: 'Close', exact: true }).click()

  await page.goto(oldProject)
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await page.getByRole('button', { name: '更换模板', exact: true }).click()
  const switcher = page.getByRole('dialog', { name: '更换模板', exact: true })
  await expect(switcher.getByRole('combobox', { name: '目标模板' })).toHaveValue(baseline.id)
  await expect(loadStatus(switcher)).toContainText('已使用校验通过的本地缓存')
  await switcher.getByRole('button', { name: '编译预览', exact: true }).click()
  const apply = switcher.getByRole('button', { name: '设为当前模板' })
  await expect(apply.or(switcher.getByRole('alert'))).toBeVisible({ timeout: 90_000 })
  expect(await switcher.getByRole('alert').allTextContents()).toEqual([])
  await apply.click()
  await expect(switcher).toBeHidden()
  await page.goto(oldProject)
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await expect(page.getByLabel('当前编译模板')).toContainText(baseline.version)
  await compileProject(page)
  const switchedPdf = join(output, 'switched.pdf')
  await saveCompiledPdf(page, switchedPdf)
  assertLayout(switchedPdf)

  async function openSubmission() {
    await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    return page.getByRole('dialog', { name: 'Prepare submission' })
  }
  async function saveDownload(button: Locator, name: string) {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 70_000 }), button.click()])
    const path = join(output, name)
    await download.saveAs(path)
    return { path, sha256: digest(await readFile(path)) }
  }
  const submission = await openSubmission()
  await submission.getByRole('button', { name: 'Compile submission files' }).click()
  const pdf = submission.getByRole('button', { name: 'Download submission PDF', exact: true })
  await expect(pdf).toBeVisible({ timeout: 90_000 })
  const savedPdf = await saveDownload(pdf, 'archived.pdf')
  const savedSource = await saveDownload(submission.getByRole('button', { name: 'Download source ZIP', exact: true }), 'archived-source.zip')
  await submission.getByLabel('Version name').fill('上电旧版 PDF 证据')
  await submission.getByRole('button', { name: 'Save submission version' }).click()
  await expect(submission.getByText(/上电旧版 PDF 证据 ·/)).toBeVisible()
  await submission.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
  const form = submission.getByRole('form', { name: '导出 Word（DOCX）' })
  await expect(loadStatus(form)).toContainText('已使用校验通过的本地缓存')
  await expect(form.getByLabel('中文题目')).toHaveValue(cover.中文题目)
  const generated = await saveDownload(form.getByRole('button', { name: '生成并下载 DOCX' }), 'generated.docx')
  const word = await JSZip.loadAsync(await readFile(generated.path), { checkCRC32: true })
  const xml = await word.file('word/document.xml')!.async('string')
  expect(xml).toContain(cover.中文题目)
  expect(xml).toContain('原创性')
  expect(xml).toContain('Independent SUEP')
  expect(xml).not.toMatch(/变压器故障|指导教师对文献|格式示范文本/)
  expect(Object.keys(word.files).some(path => path.startsWith('word/media/Cover-'))).toBe(true)
  const core = await word.file('docProps/core.xml')!.async('string')
  expect(core).toContain(baseline.sha256)
  for (const item of Object.values(suepDocxMembers)) expect(core).toContain(item.sha256)
  await form.getByLabel('交付归档名称').fill('上电旧版 Word 证据')
  let finalSha: string | undefined
  if (process.env.RESEARCH_DOCX_WORD_NATIVE === '1') {
    const final = join(output, 'suep-word-final.docx')
    await copyFile(generated.path, final)
    const native = await exec('/usr/bin/osascript', [join(__dirname, 'fixtures/submission-docx-word.applescript'), final, '实验设计', 'no-reference'],
      { timeout: 120_000 })
    expect(native.stdout).toContain('Saved and reopened in Microsoft Word')
    expect(native.stdout).toContain('观测协议')
    await writeFile(join(output, 'word.log'), native.stdout)
    finalSha = digest(await readFile(final))
    await form.getByLabel('附上 Word 保存的最终文件（选填）').setInputFiles(final)
    await expect(form.getByText('suep-word-final.docx', { exact: false })).toBeVisible()
  }
  await form.getByRole('button', { name: '归档 DOCX 交付' }).click()
  await expect(form.getByText('已归档 上电旧版 Word 证据')).toBeVisible()

  await writeFile(upstream!, 'candidate')
  await page.goto(market)
  await page.getByText('管理官方版本', { exact: true }).click()
  await page.getByRole('button', { name: '检查官方原件更新' }).click()
  await expect(page.getByText('发现不同的官方原件', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '载入官方原件验收' }).click()
  const candidateDialog = page.getByRole('dialog', { name: '验收上电官方附件候选' })
  await candidateDialog.getByLabel('候选版本').fill(candidateVersion)
  await candidateDialog.getByRole('button', { name: '编译候选预览' }).click()
  await expect(candidateDialog.getByRole('status').or(candidateDialog.getByRole('alert'))).toBeVisible({ timeout: 100_000 })
  expect(await candidateDialog.getByRole('alert').allTextContents()).toEqual([])
  await expect(candidateDialog.locator('iframe')).toBeVisible()
  await candidateDialog.getByRole('button', { name: '发布此版本' }).click()
  await confirmTemplatePublication(page, candidateVersion, baseline.version)
  const savedCandidate = JSON.parse(await readFile(candidateCache, 'utf8'))
  expect(savedCandidate.manifest.sha256).toBe(next)
  expect(savedCandidate.manifest.members).toEqual(current.manifest.members)

  await writeFile(upstream!, 'offline')
  await select()
  await expect(loadStatus(imported)).toContainText(candidateVersion)
  await expect(loadStatus(imported)).toContainText('已使用校验通过的本地缓存')
  const newProject = await create('上电模拟新版验收')
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await compileProject(page)
  const candidatePdf = join(output, 'published-candidate.pdf')
  await saveCompiledPdf(page, candidatePdf)
  assertLayout(candidatePdf)
  const newSubmission = await openSubmission()
  await newSubmission.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
  const newForm = newSubmission.getByRole('form', { name: '导出 Word（DOCX）' })
  await expect(newForm).toContainText(candidateVersion)
  await expect(newForm).toContainText(next)
  const newWord = await saveDownload(newForm.getByRole('button', { name: '生成并下载 DOCX' }), 'published-candidate.docx')
  expect(await (await JSZip.loadAsync(await readFile(newWord.path))).file('docProps/core.xml')!.async('string')).toContain(next)

  await page.goto(oldProject)
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await expect(page.getByLabel('当前编译模板')).toContainText(baseline.version)
  const history = await openSubmission()
  const archive = history.getByRole('region', { name: 'Archived submissions' })
  const oldPdf = archive.getByText(/上电旧版 PDF 证据 ·/).locator('..')
  const oldWord = archive.getByText(/上电旧版 Word 证据 ·/).locator('..')
  await oldPdf.locator(':scope > summary').click()
  await oldPdf.getByRole('button', { name: '复查归档版式报告' }).click()
  const oldReport = oldPdf.getByRole('region', { name: '归档版式报告' })
  await expect(oldReport).toContainText('原 PDF 和源包校验通过')
  await expect(oldReport).toContainText(baseline.sha256)
  await expect(oldReport).toContainText(savedPdf.sha256)
  await expect(oldReport).toContainText(savedSource.sha256)
  expect((await saveDownload(oldPdf.getByRole('button', { name: 'Download archived PDF' }), 'reviewed-archive.pdf')).sha256).toBe(savedPdf.sha256)
  expect((await saveDownload(oldPdf.getByRole('button', { name: 'Download archived ZIP' }), 'reviewed-source.zip')).sha256).toBe(savedSource.sha256)
  await oldWord.locator(':scope > summary').click()
  await oldWord.getByRole('button', { name: '复查归档 DOCX' }).click()
  const wordReport = oldWord.getByRole('region', { name: 'DOCX 归档检查报告' })
  await expect(wordReport).toContainText('归档文件 SHA-256 校验通过')
  await expect(wordReport).toContainText(baseline.sha256)
  const record = await saveDownload(wordReport.getByRole('button', { name: '下载 DOCX 检查报告' }), 'archived-docx-report.json')
  const report = JSON.parse(await readFile(record.path, 'utf8'))
  expect(report.template).toMatchObject({ ...baseline })
  expect(report.generated.sha256).toBe(generated.sha256)
  expect((await saveDownload(wordReport.getByRole('button', { name: '下载归档生成稿' }), 'reviewed-generated.docx')).sha256).toBe(generated.sha256)
  if (finalSha) expect((await saveDownload(wordReport.getByRole('button', { name: '下载归档 Word 定稿' }), 'reviewed-word-final.docx')).sha256).toBe(finalSha)
  await history.getByRole('button', { name: '导出 Word（DOCX）', exact: true }).click()
  await expect(history.getByRole('form', { name: '导出 Word（DOCX）' })).toContainText(baseline.sha256)

  await writeFile(join(output, 'acceptance.json'), JSON.stringify({
    baseline: current.manifest, candidate: savedCandidate.manifest, oldProject, newProject,
    unchangedArchive: { pdf: savedPdf.sha256, source: savedSource.sha256, generated: generated.sha256, final: finalSha, docxReport: record.sha256 },
    upstreamRequests: await requests(),
  }, null, 2) + '\n')
})
