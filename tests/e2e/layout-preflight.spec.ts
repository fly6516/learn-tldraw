import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const fixtures = process.env.RESEARCH_LAYOUT_PREFLIGHT_FIXTURES
const cases = [
  { name: '华南农大', file: 'scau.zip', source: 'main.tex', broken: (text: string) => text.replaceAll('a4paper', 'letterpaper'),
    label: '纸张尺寸', problem: /实际尺寸与 A4 不符/, repaired: /纸张为 A4/ },
  { name: '南邮', file: 'njupt.zip', source: 'word-layout.tex', broken: (text: string) => text.replace(/\\selectfont\\thepage/, '\\selectfont 7'),
    label: '正文起始页码', problem: /正文首页显示页码 7/, repaired: /正文首页显示页码 1/ },
  { name: '上电', file: 'suep.zip', source: 'main.tex', broken: (text: string) => text.replace(/^\\includepdf[^\n]+front\/declaration\.pdf[^\n]*$/m, '% declaration omitted for acceptance'),
    label: '原创性声明', problem: /未找到学校声明标题/, repaired: /在正文前找到学校声明/ },
]

for (const scenario of cases) {
  test(`${scenario.name} layout preflight finds a damaged PDF and clears the fixed issue`, async ({ page }) => {
    test.skip(!fixtures, 'Requires local school project ZIPs and XeLaTeX.')
    test.setTimeout(150_000)
    const archive = await JSZip.loadAsync(await readFile(join(fixtures!, scenario.file)))
    const correct = await archive.file(scenario.source)!.async('string')
    const wrong = scenario.broken(correct)
    expect(wrong).not.toBe(correct)
    archive.file(scenario.source, wrong)

    await page.goto('/research')
    await page.getByLabel('Choose project ZIP or backup').setInputFiles({
      name: scenario.name + '提交检查.zip', mimeType: 'application/zip', buffer: await archive.generateAsync({ type: 'nodebuffer' }),
    })
    await page.getByRole('button', { name: 'Compile settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Compile settings' })
    await settings.getByLabel('Engine').selectOption('xelatex')
    await settings.getByLabel('Bibliography backend').selectOption('none')
    await settings.getByRole('button', { name: 'Save compile settings' }).click()

    const compile = page.getByRole('button', { name: 'Compile PDF', exact: true })
    const panel = page.getByRole('region', { name: 'PDF Preview' })
    const open = panel.getByRole('button', { name: '提交前版式检查' })
    const check = page.getByRole('dialog', { name: '提交前版式检查' })
    const row = check.getByRole('listitem').filter({ hasText: scenario.label })
    await compile.click()
    await expect(panel.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible({ timeout: 60_000 })
    await open.click()
    await expect(row).toContainText('发现问题')
    await expect(row).toContainText(scenario.problem)
    if (scenario.file === 'njupt.zip') {
      await expect(check.getByRole('listitem').filter({ hasText: '前置页码' })).toContainText('已核对')
      await expect(check.getByRole('listitem').filter({ hasText: '图表题注与引用' })).toContainText('已核对')
      const tocIssues = check.getByRole('listitem').filter({ hasText: '目录页码' }).filter({ hasText: '发现问题' })
      await expect(tocIssues.first()).toBeVisible()
    }
    const locatePage = row.getByRole('button', { name: /查看 PDF 第/ })
    if (await locatePage.count()) {
      const label = await locatePage.innerText()
      const number = /\d+/.exec(label)?.[0]
      await locatePage.click()
      await expect(panel.getByRole('region', { name: 'Compiled PDF, page ' + number, exact: true })).toBeVisible()
      await open.click()
    }
    await row.getByRole('button', { name: new RegExp(scenario.file === 'njupt.zip' ? 'manuscript\\.tex' : 'main\\.tex') }).click()
    await expect(check).toBeHidden()
    if (scenario.file === 'njupt.zip') await page.getByRole('button', { name: scenario.source, exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Project source editor' })
    await editor.press('Control+a')
    await page.keyboard.insertText(correct)
    await open.click()
    await expect(check).toContainText('稿件已更改')
    await expect(check.getByText(scenario.problem)).toHaveCount(0)
    await check.getByRole('button', { name: 'Close' }).click()

    const repaired = page.waitForResponse(response => response.url().includes('/api/latex/compile?') && response.request().method() === 'POST')
    await compile.click()
    const compiled = await repaired
    expect(compiled.ok(), compiled.ok() ? undefined : await compiled.text()).toBe(true)
    await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 60_000 })
    await open.click()
    await expect(row).toContainText('已核对')
    await expect(row).toContainText(scenario.repaired)
    if (scenario.file === 'njupt.zip') await expect(check.getByRole('listitem').filter({ hasText: '目录页码' }).filter({ hasText: '发现问题' })).toHaveCount(0)
    await check.getByRole('button', { name: 'Close' }).click()
    if (scenario.file === 'scau.zip') {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
      const submission = page.getByRole('dialog', { name: 'Prepare submission' })
      await submission.getByRole('button', { name: /Compile/ }).first().click()
      await expect(submission.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
      const summary = submission.getByText('提交前版式检查', { exact: true })
      if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
      await expect(submission.getByRole('listitem').filter({ hasText: '纸张尺寸' })).toContainText('纸张为 A4')
    }
  })
}
