import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { morningWalkZip } from '../fixtures/morning-walk'

const sample = join(__dirname, 'fixtures', 'review-letter.txt')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function download(page: Page, action: Locator, path: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), action.click()])
  await file.saveAs(path)
  return readFile(path)
}

async function archiveVersion(page: Page, name: string) {
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  await dialog.getByRole('button', { name: 'Compile submission files', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Version name' }).fill(name)
  await dialog.getByRole('button', { name: 'Save submission version' }).click()
  const entry = dialog.getByText(new RegExp('^' + name + ' ·'))
  await expect(entry).toBeVisible({ timeout: 45_000 })
  await entry.click()
  return dialog
}

test('reviews a pasted editor letter and exports replies with verified manuscript changes', async ({ page }, info) => {
  test.setTimeout(140_000)
  const originalName = 'Original submission'
  const revisedName = 'Revised submission v2'
  const roundName = 'Editor and two reviewers'
  const originalLetter = await readFile(sample, 'utf8')
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Morning Walk Study.zip', mimeType: 'application/zip', buffer: await morningWalkZip(),
  })
  await expect(page.getByRole('heading', { name: 'Morning Walk Study', exact: true })).toBeVisible()
  const original = await archiveVersion(page, originalName)
  const originalSource = await download(page, original.getByRole('button', { name: 'Download archived ZIP' }), info.outputPath('original-source.zip'))
  await original.getByRole('button', { name: 'Start revision', exact: true }).click()
  const revisions = page.getByRole('dialog', { name: 'Revision rounds' })
  await revisions.getByRole('textbox', { name: 'Round name' }).fill(roundName)
  await revisions.getByRole('button', { name: 'Create revision round' }).click()
  await revisions.getByRole('button', { name: 'Paste review letter' }).click()
  const input = revisions.getByRole('textbox', { name: 'Review letter', exact: true })
  await input.fill(originalLetter)
  await revisions.getByRole('button', { name: 'Preview comments' }).click()
  const preview = revisions.getByRole('region', { name: 'Review letter preview' })
  await expect(preview.getByRole('heading')).toHaveText('Preview · 4 comments')
  await expect(revisions.getByText('No reviewer comments in this round.')).toBeVisible()
  await input.fill(originalLetter + '\n')
  await expect(preview.getByRole('button', { name: 'Add 4 comments to the round' })).toBeDisabled()
  await revisions.getByRole('button', { name: 'Preview comments' }).click()
  await preview.getByRole('group', { name: 'Comment 1', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click()
  const corrected = 'State that paired temperature gaps are reported in degrees Celsius.'
  const fileChanges = [
    { path: 'sections/introduction.tex', reviewer: 'Editor', sentence: 'The findings apply only to the four simulated paired sessions.', response: 'We limited the scope in the introduction to the simulated paired sessions.' },
    { path: 'sections/methods.tex', reviewer: 'Reviewer 1', sentence: 'Four paired sessions contributed one route average each.', response: 'We added the number of paired sessions in Methods.' },
    { path: 'sections/results.tex', reviewer: 'Reviewer 2', sentence: 'All paired temperature gaps reported here are in degrees Celsius.', response: 'We specified the unit of the paired gaps in Results.' },
  ]
  for (const [index, item] of fileChanges.entries()) {
    const row = preview.getByRole('group', { name: `Comment ${index + 1}`, exact: true })
    await expect(row.getByRole('textbox', { name: 'Reviewer or editor' })).toHaveValue(item.reviewer)
    if (index) await row.getByRole('combobox', { name: 'Source target' }).selectOption({ label: item.path })
    if (index === 2) await row.getByRole('textbox', { name: 'Comment text' }).fill(corrected)
  }
  await page.screenshot({ path: info.outputPath('review-letter-preview.png') })
  await preview.getByRole('button', { name: 'Add 3 comments to the round' }).click()
  await expect(revisions.getByRole('status').filter({ hasText: 'Added 3 comments to the round.' })).toBeVisible()
  await expect(revisions.getByText('Whole manuscript', { exact: true })).toBeVisible()
  await expect(revisions.getByText(corrected, { exact: true })).toBeVisible()
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Revision rounds', exact: true }).click()
  const saved = revisions.getByRole('region', { name: 'Round reviewer comments' })
  await expect(saved.getByRole('listitem')).toHaveCount(3)
  await expect(saved.getByText(corrected)).toBeVisible()
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()

  for (const { path, sentence } of fileChanges) {
    await page.getByRole('complementary', { name: 'Project navigation' }).getByTitle(path, { exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Project source editor' })
    if (path === 'sections/results.tex') {
      await editor.press('Control+Home')
      await page.keyboard.insertText('% Unrelated copyedit in the same file.\n')
    }
    await editor.press('Control+End')
    await page.keyboard.insertText(`\n${sentence}\n`)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('All changes saved to project')).toBeVisible()
  }
  const revised = await archiveVersion(page, revisedName)
  const source = await download(page, revised.getByRole('button', { name: 'Download archived ZIP' }), info.outputPath('revised-source.zip'))
  const pdf = await download(page, revised.getByRole('button', { name: 'Download archived PDF' }), info.outputPath('revised.pdf'))
  await revised.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Revision rounds', exact: true }).click()
  await revisions.getByRole('button', { name: 'Responses and letter' }).click()
  const choice = await revisions.getByRole('option', { name: /^Revised submission v2 ·/ }).getAttribute('value')
  await revisions.getByRole('combobox', { name: 'Revised submission' }).selectOption(choice!)
  await expect(revisions.getByRole('button', { name: 'Download revision package' })).toBeDisabled()
  let resultsLocation = ''
  let unrelatedLocation = ''
  for (const [index, item] of fileChanges.entries()) {
    await revisions.getByRole('combobox', { name: 'Comment to answer' }).selectOption({ label: `${index + 1}. ${item.reviewer} · Awaiting response` })
    await revisions.getByRole('textbox', { name: 'Response', exact: true }).fill(item.response)
    const candidates = revisions.getByRole('checkbox', { name: new RegExp('^' + item.path.replaceAll('.', '\\.') + ' · ') })
    await expect(candidates).toHaveCount(index === 2 ? 2 : 1)
    const target = candidates.last()
    if (index === 2) {
      const location = async (input: Locator) => (await input.locator('..').innerText()).split(' · ')[1]
      resultsLocation = await location(target)
      unrelatedLocation = await location(candidates.first())
      const change = target.locator('xpath=../..')
      await change.getByText('View changed text', { exact: true }).click()
      await expect(change.getByText(item.sentence, { exact: true })).toBeVisible()
    }
    await target.check()
    await revisions.getByRole('button', { name: 'Save response' }).click()
    await expect(revisions.getByRole('option', { name: `${index + 1}. ${item.reviewer} · Answered` })).toHaveCount(1)
  }
  await revisions.getByRole('button', { name: 'Preview response letter' }).click()
  await expect(revisions.getByRole('region', { name: 'Response letter preview' })).toContainText('Changes verified against the revised source ZIP')
  const letter = await download(page, revisions.getByRole('button', { name: 'Download response Markdown' }), info.outputPath('response.md'))
  const exported = await download(page, revisions.getByRole('button', { name: 'Download revision package' }), info.outputPath('revision-package.zip'))
  const archive = await JSZip.loadAsync(exported, { checkCRC32: true })
  const manifest = JSON.parse(await archive.file('manifest.json')!.async('string'))
  expect(manifest.round.comments).toBe(3)
  expect(manifest.original.sourceChecksum).toBe(digest(originalSource))
  expect(manifest.revised.sourceChecksum).toBe(digest(source))
  expect(await archive.file('response.md')!.async('nodebuffer')).toEqual(letter)
  expect(await archive.file('manuscript.pdf')!.async('nodebuffer')).toEqual(pdf)
  expect(await archive.file('source.zip')!.async('nodebuffer')).toEqual(source)
  for (const entry of manifest.files) expect(digest(await archive.file(entry.name)!.async('nodebuffer'))).toBe(entry.sha256)
  const text = letter.toString('utf8')
  const originalFiles = await JSZip.loadAsync(originalSource)
  const revisedFiles = await JSZip.loadAsync(source)
  for (const { reviewer, path, sentence, response } of fileChanges) {
    expect(text).toContain('· ' + reviewer)
    expect(text).toContain('Modified · ' + path)
    expect(text).toContain(response)
    expect(await originalFiles.file(path)!.async('string')).not.toContain(sentence)
    expect(await revisedFiles.file(path)!.async('string')).toContain(sentence)
  }
  expect(text).toContain(corrected)
  expect(text).not.toContain('through the journal portal')
  expect(text).toContain(`sections/results.tex (${resultsLocation})`)
  expect(text).not.toContain(`sections/results.tex (${unrelatedLocation})`)
  await writeFile(info.outputPath('acceptance.json'), JSON.stringify({ comments: 3, reviewers: fileChanges.map(item => item.reviewer),
    originalSource: digest(originalSource), revisedSource: digest(source), revisedPdf: digest(pdf), letter: digest(letter), package: digest(exported) }, null, 2))
  await page.screenshot({ path: info.outputPath('response-preview.png') })
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  const backup = page.getByRole('dialog', { name: 'Project Backup' })
  await backup.getByRole('button', { name: 'Complete recovery backup' }).click()
  await download(page, backup.getByRole('button', { name: 'Download Backup' }), info.outputPath('review-letter.research-canvas'))
  await backup.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('complementary', { name: 'Project navigation' }).getByTitle('sections/results.tex', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Project source editor' }).press('Control+Home')
  await page.keyboard.insertText('% Additional copyedit in the third archive.\n')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
  const other = await archiveVersion(page, 'Revised submission v3')
  await other.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Revision rounds', exact: true }).click()
  await revisions.getByRole('button', { name: 'Responses and letter' }).click()
  const select = revisions.getByRole('combobox', { name: 'Revised submission' })
  const third = await revisions.getByRole('option', { name: /^Revised submission v3 ·/ }).getAttribute('value')
  await select.selectOption(third!)
  await expect(revisions.getByRole('option', { name: /Evidence needs review/ })).toHaveCount(3)
  await expect(revisions.getByRole('button', { name: 'Download revision package' })).toBeDisabled()
  await select.selectOption(choice!)
  await expect(revisions.getByRole('option', { name: /Evidence needs review/ })).toHaveCount(3)
  await expect(revisions.getByRole('button', { name: 'Download revision package' })).toBeDisabled()
  for (const [index, item] of fileChanges.entries()) {
    await revisions.getByRole('combobox', { name: 'Comment to answer' }).selectOption({ label: `${index + 1}. ${item.reviewer} · Evidence needs review` })
    await expect(revisions.getByRole('textbox', { name: 'Response', exact: true })).toHaveValue(item.response)
    await revisions.getByRole('checkbox', { name: new RegExp('^' + item.path.replaceAll('.', '\\.') + ' · ') }).last().check()
    await revisions.getByRole('button', { name: 'Save response' }).click()
  }
  await expect(revisions.getByRole('button', { name: 'Download revision package' })).toBeEnabled()
  await writeFile(info.outputPath('archive-switch.json'), JSON.stringify({ changedFile: 'sections/results.tex', selected: resultsLocation,
    unrelated: unrelatedLocation, switchRequiresReview: true, switchBackRequiresReview: true, exportReenabled: true }, null, 2))
})
