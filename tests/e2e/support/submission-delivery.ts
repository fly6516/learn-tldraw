import { expect, type Page, type TestInfo, type Locator } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { submissionLayoutSchema } from '../../../src/lib/project/submission-layout'
import { submissionMaterialPath } from '../../../src/lib/project/submission-materials'
import type { SubmissionStage } from '../../../src/lib/project/submission-stages'
import type { CatalogTemplate } from '../../../src/lib/project/template-catalog'

export const checkCatalogDelivery = process.env.RESEARCH_SUBMISSION_CATALOG_ACCEPTANCE === '1'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export async function openCatalogDelivery(page: Page, stage: SubmissionStage) {
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  await dialog.getByRole('combobox', { name: '提交阶段' }).selectOption(stage)
  return dialog
}

export async function verifyCatalogDelivery(page: Page, dialog: Locator, info: TestInfo, entry: CatalogTemplate, stage: SubmissionStage,
  expectedSource?: Buffer, external = false, attachment?: { name: string; bytes: Buffer }) {
  const formal = dialog.getByRole('region', { name: '正式提交材料' })
  const local = dialog.getByRole('region', { name: '本地核验材料' })
  await expect(formal).toBeVisible()
  await expect(formal).toContainText('材料待核对')
  const download = local.getByRole('button', { name: '下载交付包' })
  await expect(download).toBeEnabled({ timeout: 75_000 })
  if (stage === 'sjtu-deposit') {
    await expect(formal).toContainText('待补齐 已核对的签署版定稿 PDF')
    if (!attachment) throw new Error('Missing a fixture for the signed PDF slot.')
    await formal.getByLabel('已核对的签署版定稿 PDF').setInputFiles({ name: attachment.name, mimeType: 'application/pdf', buffer: attachment.bytes })
    await expect(formal.getByRole('button', { name: attachment.name, exact: true })).toBeVisible()
  } else if (stage === 'prl-production') {
    await expect(formal.getByRole('button', { name: '下载清洁版 LaTeX 源包' })).toBeVisible()
  } else {
    await expect(formal.getByRole('button', { name: '下载稿件 PDF' })).toBeVisible()
  }
  const guide = entry.requirementsUrl ?? entry.sourceUrl
  if (guide && stage === 'catalog-delivery') await expect(dialog.getByRole('link', { name: '官方要求', exact: true })).toHaveAttribute('href', guide)
  const bundlePath = info.outputPath(entry.id + '-' + stage + '-delivery.zip')
  const event = page.waitForEvent('download')
  await download.click()
  await (await event).saveAs(bundlePath)
  const bundle = await JSZip.loadAsync(await readFile(bundlePath), { checkCRC32: true })
  const report = submissionLayoutSchema.parse(JSON.parse(await bundle.file('report.json')!.async('string')))
  const manifest = JSON.parse(await bundle.file('manifest.json')!.async('string'))
  expect(report.templateOrigin?.id).toBe(entry.id)
  expect(report.delivery?.stage).toBe(stage)
  expect(report.delivery?.sourceMatch).toBe(external ? 'author-confirmed' : undefined)
  expect(report.findings.some(finding => finding.status === 'manual')).toBe(true)
  const pdf = await bundle.file('manuscript.pdf')!.async('nodebuffer')
  const source = await bundle.file('source.zip')!.async('nodebuffer')
  expect(hash(source)).toBe(report.sourceChecksum)
  expect(hash(pdf)).toBe(report.pdfChecksum)
  if (expectedSource) expect(hash(source)).toBe(hash(expectedSource))
  expect((await JSZip.loadAsync(source)).file(report.delivery!.entry)).toBeTruthy()
  expect(manifest.files['report.json']).toBe(hash(await bundle.file('report.json')!.async('nodebuffer')))
  if (attachment) {
    const item = report.materials?.[0]
    expect(item?.sha256).toBe(hash(attachment.bytes))
    expect(manifest.files[submissionMaterialPath(item!, 0)]).toBe(item?.sha256)
  }

  await dialog.getByLabel('Version name').fill(entry.id + ' ' + stage)
  await dialog.getByRole('button', { name: 'Save submission version' }).click()
  const record = dialog.getByRole('region', { name: 'Archived submissions' }).getByText(new RegExp('^' + entry.id + ' ' + stage + ' ·'))
  await expect(record).toBeVisible()
  await record.click()
  await record.locator('..').getByRole('button', { name: '复查归档版式报告' }).click()
  const opened = dialog.getByRole('region', { name: '归档版式报告' })
  await expect(opened).toContainText(report.pdfChecksum)
  await expect(opened).toContainText(report.sourceChecksum)
  if (attachment) await expect(opened).toContainText(hash(attachment.bytes))
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  return pdf
}

export async function compileCatalogDelivery(page: Page, info: TestInfo, entry: CatalogTemplate, stage: SubmissionStage = 'catalog-delivery', attachment?: { name: string; bytes: Buffer }) {
  const dialog = await openCatalogDelivery(page, stage)
  const request = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/latex/compile?'), { timeout: 90_000 })
  await dialog.getByRole('button', { name: 'Compile submission files', exact: true }).click()
  const response = await request
  expect(response.ok(), response.ok() ? undefined : (await response.text()).slice(0, 1800)).toBe(true)
  return verifyCatalogDelivery(page, dialog, info, entry, stage, response.request().postDataBuffer()!, false, attachment)
}
