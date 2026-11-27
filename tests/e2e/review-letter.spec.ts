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
  test.setTimeout(240_000)
  const originalName = 'Original submission'
  const revisedName = 'Revised submission v2'
  const roundName = 'Editor and two reviewers'
  const originalLetter = await readFile(sample, 'utf8')
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Morning Walk Study.zip', mimeType: 'application/zip', buffer: await morningWalkZip(),
  })
  await expect(page.getByRole('heading', { name: 'Morning Walk Study', exact: true })).toBeVisible()
  if (process.env.RESEARCH_REVIEW_XELATEX === '1') {
    await page.getByRole('button', { name: 'Compile settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Compile settings' })
    await settings.getByLabel('Engine').selectOption('xelatex')
    await settings.getByRole('button', { name: 'Save compile settings' }).click()
  }
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
  // Correct persisted comments after replies already exist.
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('complementary', { name: 'Project navigation' }).getByTitle('sections/introduction.tex', { exact: true }).click()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  const review = page.getByRole('region', { name: 'Writing review' })
  await review.getByLabel('Source target').selectOption({ label: 'Section · Introduction · line 1' })
  const cardTitle = 'Clarify the scope on the introduction card'
  await review.getByLabel('Comment or task').fill(cardTitle)
  await review.getByRole('button', { name: 'Add linked card' }).click()
  await expect(review.getByRole('status')).toHaveText('Linked Canvas card created.')
  await page.getByRole('complementary', { name: 'Project navigation' }).getByTitle('sections/results.tex', { exact: true }).click()

  await page.getByRole('button', { name: 'Revision rounds', exact: true }).click()
  const row = (text: string) => saved.getByRole('listitem').filter({ hasText: text })
  const editorText = 'Clarify the scope of the findings in the introduction.'
  await row(editorText).getByRole('button', { name: 'Edit comment', exact: true }).click()
  const edit = revisions.getByRole('form', { name: 'Edit reviewer comment' })
  await edit.getByLabel('Reviewer or editor').fill('Handling editor')
  const updatedText = 'Clarify the scope in the first paragraph of the introduction.'
  await edit.getByLabel('Comment text').fill(updatedText)
  const cardOption = await edit.getByRole('option', { name: new RegExp(cardTitle) }).getAttribute('value', { timeout: 10_000 })
  await edit.getByLabel('Source or Canvas card').selectOption(cardOption!)
  await edit.getByRole('button', { name: 'Save comment changes' }).click()
  await expect(row(updatedText)).toContainText('Handling editor')
  await expect(row(updatedText)).toContainText('Needs review')
  const firstReviewer = 'State how many paired sessions went into the comparison.'
  const splitText = 'Keep the synthetic nature of the study explicit.'
  await row(firstReviewer).getByRole('button', { name: 'Split comment' }).click()
  const split = revisions.getByRole('form', { name: 'Split reviewer comment' })
  await expect(split.getByLabel('First comment')).toHaveValue(firstReviewer)
  await expect(split.getByLabel('Second comment')).toHaveValue(splitText)
  await split.getByRole('button', { name: 'Save split' }).click()
  await expect(saved.getByRole('listitem')).toHaveCount(4)
  await row(corrected).getByRole('button', { name: 'Move up' }).click()
  await expect(saved.getByRole('listitem').nth(2)).toContainText(corrected)
  const filter = saved.getByLabel('Response status')
  await filter.selectOption('ready')
  await expect(saved.getByRole('listitem')).toHaveCount(1)
  await expect(row(corrected)).toBeVisible()
  await filter.selectOption('awaiting')
  await expect(saved.getByRole('listitem')).toHaveCount(1)
  await expect(row(splitText)).toBeVisible()
  await filter.selectOption('review')
  await expect(saved.getByRole('listitem')).toHaveCount(2)
  await expect(row(updatedText).getByRole('button', { name: 'sections/introduction.tex:1', exact: true })).toBeVisible()
  await row(updatedText).getByRole('button', { name: 'sections/introduction.tex:1', exact: true }).click()
  await expect(revisions).toBeHidden()
  await expect(page.getByRole('region', { name: 'Source editor' }).getByText('sections/introduction.tex', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Revision rounds', exact: true }).click()
  await row(updatedText).getByRole('button', { name: 'Locate on Canvas' }).click()
  await expect(revisions).toBeHidden()
  const properties = page.getByRole('complementary', { name: 'Research node properties' })
  const details = page.getByRole('button', { name: 'Node details', exact: true })
  await expect(details).toBeEnabled()
  if (await details.getAttribute('aria-expanded') !== 'true') await details.click()
  await properties.getByRole('button', { name: 'Open reply and evidence', exact: true }).click()
  await expect(revisions.getByRole('region', { name: 'Revision responses' })).toBeVisible()
  await expect(revisions.getByRole('textbox', { name: 'Response', exact: true })).toHaveValue(fileChanges[0].response)
  await expect(revisions.getByText(updatedText, { exact: true })).toBeVisible()
  await expect(revisions.getByRole('button', { name: 'Confirm reviewed response' })).toBeDisabled()
  await expect(revisions.getByRole('button', { name: 'Download revision package' })).toBeDisabled()
  await revisions.getByRole('checkbox', { name: /^sections\/introduction\.tex ·/ }).check()
  await revisions.getByRole('button', { name: 'Confirm reviewed response' }).click()
  await revisions.getByRole('button', { name: 'Reviewer comments', exact: true }).click()
  await row(firstReviewer).getByRole('button', { name: 'Open reply and evidence' }).click()
  await expect(revisions.getByRole('textbox', { name: 'Response', exact: true })).toHaveValue(fileChanges[1].response)
  await revisions.getByRole('checkbox', { name: /^sections\/methods\.tex ·/ }).check()
  await revisions.getByRole('button', { name: 'Confirm reviewed response' }).click()
  await revisions.getByRole('button', { name: 'Reviewer comments', exact: true }).click()
  await row(splitText).getByRole('button', { name: 'Open reply and evidence' }).click()
  await revisions.getByLabel('Disposition').selectOption('retained')
  const retained = 'The manuscript already states that the observations are synthetic.'
  await revisions.getByLabel('Reason for keeping the text').fill(retained)
  await revisions.getByRole('button', { name: 'Save response' }).click()
  await expect(revisions.getByRole('button', { name: 'Download revision package' })).toBeEnabled()
  await revisions.getByRole('button', { name: 'Preview response letter' }).click()
  const updatedZip = await download(page, revisions.getByRole('button', { name: 'Download revision package' }), info.outputPath('workbench-revision.zip'))
  const updatedPackage = await JSZip.loadAsync(updatedZip, { checkCRC32: true })
  const updatedLetter = await updatedPackage.file('response.md')!.async('string')
  expect(updatedLetter).toContain('Comment 1 · Handling editor')
  expect(updatedLetter).toContain('Comment 3 · Reviewer 2')
  expect(updatedLetter).toContain(retained)
  expect(updatedLetter).not.toContain('needs review')
  expect(await updatedPackage.file('manuscript.pdf')!.async('nodebuffer')).toEqual(pdf)
  expect(await updatedPackage.file('source.zip')!.async('nodebuffer')).toEqual(source)
  const updatedManifest = JSON.parse(await updatedPackage.file('manifest.json')!.async('string'))
  expect(updatedManifest.round.comments).toBe(4)
  for (const entry of updatedManifest.files) expect(digest(await updatedPackage.file(entry.name)!.async('nodebuffer'))).toBe(entry.sha256)
  await writeFile(info.outputPath('workbench-response.md'), updatedLetter)
  await writeFile(info.outputPath('workbench-checks.json'), JSON.stringify({
    reviewers: ['Handling editor', 'Reviewer 1', 'Reviewer 2'], correctedComments: 4,
    filters: { ready: 1, awaiting: 1, review: 2 }, archiveSwitchRequiresReview: true, canvasToReply: true,
    originalSource: digest(originalSource), revisedSource: digest(source), revisedPdf: digest(pdf), package: digest(updatedZip),
  }, null, 2))
  await page.screenshot({ path: info.outputPath('workbench.png'), animations: 'disabled' })
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  await backup.getByRole('button', { name: 'Complete recovery backup' }).click()
  await download(page, backup.getByRole('button', { name: 'Download Backup' }), info.outputPath('workbench.research-canvas'))

})
