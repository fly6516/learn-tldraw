import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, firefox, test, type Download, type Page } from '@playwright/test'

const workspace = process.env.RESEARCH_HISTORY_TEST_PATH ?? '/research-test?view=write'
const isFixture = workspace.startsWith('/research-test')

async function download(page: Page, button: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button, exact: true }).click()])
  return file
}

async function digest(file: Download) {
  return createHash('sha256').update(await readFile(await file.path())).digest('hex')
}

async function openMenu(page: Page, item: string) {
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function archiveVersion(page: Page, name: string) {
  await page.getByRole('button', { name: 'Prepare submission' }).click()
  const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
  await dialog.getByRole('button', { name: 'Compile submission files' }).click()
  await dialog.getByRole('textbox', { name: 'Version name' }).fill(name)
  await dialog.getByRole('button', { name: 'Save submission version' }).click()
  await dialog.getByText(new RegExp('^' + name + ' ·')).click()
  return dialog
}

test('restores archived submission files and reviewer replies from Chromium into Firefox', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000)
  await page.goto(workspace)
  let submission = await archiveVersion(page, 'Submission v1')
  const originalPdf = await digest(await download(page, 'Download archived PDF'))
  const originalZip = await digest(await download(page, 'Download archived ZIP'))
  await submission.getByRole('button', { name: 'Start revision' }).click()
  let revisions = page.getByRole('dialog', { name: 'Revision rounds' })
  await revisions.getByRole('textbox', { name: 'Round name' }).fill('First review')
  await revisions.getByRole('button', { name: 'Create revision round' }).click()
  await revisions.getByRole('textbox', { name: 'Reviewer comment' }).fill('Clarify the reported results.')
  await revisions.getByRole('combobox', { name: 'Source target' }).selectOption({ label: 'sections/results.tex' })
  await revisions.getByRole('button', { name: 'Add reviewer comment' }).click()
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()

  if (isFixture) {
    await page.getByRole('button', { name: 'results.tex', exact: true }).click()
    await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message Writing AI' }).fill('Test: passing proposal')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const proposal = page.getByRole('region', { name: 'Source change proposal' })
    await proposal.getByRole('button', { name: 'Save if verification passes' }).click()
    await expect(proposal.getByRole('status').filter({ hasText: /^Saved to project$/ })).toBeVisible()
    await page.getByRole('combobox', { name: 'Approval mode' }).selectOption('draft')
    await page.getByRole('button', { name: 'Approve this scope' }).click()
    await page.getByRole('button', { name: 'Close Writing AI' }).click()
  } else {
    await page.getByRole('button', { name: 'results.tex', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Project source editor' })
    await editor.press('Control+End')
    await page.keyboard.insertText('\nThe reported values summarize all paired sessions.\n')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('All changes saved to project')).toBeVisible()
  }

  submission = await archiveVersion(page, 'Submission v2')
  const revisedPdf = await digest(await download(page, 'Download archived PDF'))
  const revisedZip = await digest(await download(page, 'Download archived ZIP'))
  await submission.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Revision rounds', exact: true }).click()
  revisions = page.getByRole('dialog', { name: 'Revision rounds' })
  await revisions.getByRole('button', { name: 'Responses and letter' }).click()
  const revisedLabel = await revisions.getByRole('option', { name: /^Submission v2 ·/ }).getAttribute('value')
  await revisions.getByRole('combobox', { name: 'Revised submission' }).selectOption(revisedLabel!)
  await revisions.getByRole('textbox', { name: 'Response', exact: true }).fill('We clarified how the results were summarized.')
  await revisions.getByRole('checkbox', { name: /^sections\/results\.tex/ }).check()
  await revisions.getByRole('button', { name: 'Save response' }).click()
  await expect(revisions.getByText('Response saved.')).toBeVisible()
  await revisions.getByRole('button', { name: 'Close', exact: true }).click()

  await openMenu(page, 'Project Snapshots')
  const snapshots = page.getByRole('dialog', { name: 'Project snapshots', exact: false })
  await snapshots.getByRole('textbox', { name: 'Snapshot name' }).fill('Before transfer')
  await snapshots.getByRole('button', { name: 'Create snapshot' }).click()
  await expect(snapshots.getByText('Before transfer', { exact: true })).toBeVisible()
  await snapshots.getByRole('button', { name: 'Close', exact: true }).click()

  await openMenu(page, 'Project Backup')
  await page.getByRole('checkbox', { name: 'Include submissions and revision rounds' }).check()
  await page.getByRole('checkbox', { name: 'Include project snapshots' }).check()
  if (isFixture) await page.getByRole('checkbox', { name: 'Include AI conversations and task history' }).check()
  const backup = await download(page, 'Download Backup')
  const archive = info.outputPath('historical.research-canvas')
  await backup.saveAs(archive)

  const other = await firefox.launch()
  try {
    const restored = await other.newPage({ baseURL, viewport: { width: 1440, height: 900 } })
    await restored.goto(workspace)
    await openMenu(restored, 'Project Backup')
    await restored.getByLabel('Choose a Research Canvas backup').setInputFiles(archive)
    await expect(restored.getByText('2 submission versions, 1 revision rounds', { exact: true })).toBeVisible()
    await restored.getByRole('button', { name: 'Replace Project' }).click()
    await expect(restored.getByText('Project restored.')).toBeVisible()
    await restored.getByRole('dialog', { name: 'Project Backup' }).getByRole('button', { name: 'Close', exact: true }).click()
    await restored.reload()

    await restored.getByRole('button', { name: 'Prepare submission' }).click()
    for (const [name, pdf, zip] of [['Submission v1', originalPdf, originalZip], ['Submission v2', revisedPdf, revisedZip]]) {
      const title = restored.getByText(new RegExp('^' + name + ' ·'))
      await title.click()
      expect(await digest(await download(restored, 'Download archived PDF'))).toBe(pdf)
      expect(await digest(await download(restored, 'Download archived ZIP'))).toBe(zip)
      await title.click()
    }
    await restored.getByRole('dialog', { name: 'Prepare submission' }).getByRole('button', { name: 'Close', exact: true }).click()
    await restored.getByRole('button', { name: 'Revision rounds', exact: true }).click()
    const restoredRound = restored.getByRole('dialog', { name: 'Revision rounds' })
    await expect(restoredRound.getByText('Clarify the reported results.')).toBeVisible()
    await restoredRound.getByRole('button', { name: 'Compare files' }).click()
    await restoredRound.getByRole('checkbox', { name: 'Compare the revised submission ZIP' }).check()
    await expect(restoredRound.getByText('Compare the files in the original and revised submission ZIPs.')).toBeVisible()
    await restoredRound.getByRole('button', { name: 'Modified · sections/results.tex', exact: true }).click()
    await expect(restoredRound.getByRole('heading', { name: 'sections/results.tex', exact: true })).toBeVisible()
    await restoredRound.getByRole('button', { name: 'Responses and letter' }).click()
    const reply = await readFile(await (await download(restored, 'Download response Markdown')).path(), 'utf8')
    expect(reply).toContain('We clarified how the results were summarized.')
    expect(reply).toContain('Modified · sections/results.tex')
    await restoredRound.getByRole('button', { name: 'Reviewer comments' }).click()
    await restoredRound.getByRole('button', { name: 'sections/results.tex', exact: true }).click()
    await expect(restored.getByRole('region', { name: 'Source editor' }).getByText('sections/results.tex', { exact: true })).toBeVisible()
    if (isFixture) {
      await restored.getByRole('button', { name: 'Writing AI', exact: true }).click()
      await expect(restored.getByRole('region', { name: 'AI task record' }).getByText(/^Task activity/)).toBeVisible()
      await expect(restored.getByRole('combobox', { name: 'Approval mode' })).toHaveValue('manual')
    }
    await openMenu(restored, 'Project Snapshots')
    await expect(restored.getByText('Before transfer', { exact: true })).toBeVisible()
  } finally {
    await other.close()
  }
})
