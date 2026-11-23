import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { morningWalkZip } from '../fixtures/morning-walk'
import { testScenarios } from '../../src/lib/project/test-paper'

const source = (page: Page) => page.getByRole('region', { name: 'Source editor' })
const conflict = (page: Page) => page.getByRole('complementary', { name: 'Project save conflict' })

async function edit(page: Page, name: string, text: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}\\.tex\\b`) }).click()
  const editor = source(page).getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+Home')
  await page.keyboard.insertText(`% ${text}\n`)
  await expect(source(page).locator('.view-lines')).toContainText(text)
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('All changes saved to project')).toBeVisible()
}

async function openSnapshots(page: Page) {
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Snapshots' }).click()
  return page.getByRole('dialog', { name: 'Project snapshots', exact: false })
}

test('keeps independent chapter drafts and blocks a snapshot restore based on a stale tab', async ({ page, context }) => {
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'Morning Walk Study.zip', mimeType: 'application/zip', buffer: await morningWalkZip(),
  })
  await expect(page.getByRole('heading', { name: 'Morning Walk Study' })).toBeVisible()
  const original = await openSnapshots(page)
  await original.getByRole('textbox', { name: 'Snapshot name' }).fill('Before edits')
  await original.getByRole('button', { name: 'Create snapshot' }).click()
  await expect(original.getByRole('button', { name: 'Review restore Before edits' })).toBeVisible()
  await original.getByRole('button', { name: 'Close', exact: true }).click()
  const other = await context.newPage()
  await other.goto(page.url())
  await edit(other, 'results', 'Results draft from tab B')
  await edit(page, 'methods', 'Methods saved from tab A')
  await save(page)
  await expect(conflict(other)).toBeVisible()
  await other.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(other.getByRole('alert').filter({ hasText: 'Your drafts were kept' })).toBeVisible()
  await expect(source(other).locator('.view-lines')).toContainText('Results draft from tab B')
  await conflict(other).getByRole('button', { name: 'Compare saved project' }).click()
  const compare = other.getByRole('dialog', { name: 'Compare saved project' })
  await expect(compare.getByRole('button', { name: 'sections/methods.tex', exact: true })).toBeVisible()
  await compare.getByRole('button', { name: 'Load saved project' }).click()
  await expect(conflict(other)).toHaveCount(0)
  await other.getByRole('button', { name: /^results\.tex\b/ }).click()
  await expect(source(other).locator('.view-lines')).toContainText('Results draft from tab B')
  await save(other)

  const preview = await openSnapshots(other)
  await preview.getByRole('button', { name: 'Review restore Before edits' }).click()
  await expect(preview.getByRole('button', { name: 'Restore snapshot' })).toBeEnabled()
  await page.reload()
  await edit(page, 'methods', 'Newer Methods after snapshot preview')
  await save(page)
  await preview.getByRole('button', { name: 'Restore snapshot' }).click()
  await expect(preview.getByText(/Another tab saved a newer project version/)).toBeVisible()
  await page.reload()
  await expect(source(page).locator('.view-lines')).toContainText('Newer Methods after snapshot preview')
  await page.getByRole('button', { name: /^results\.tex\b/ }).click()
  await expect(source(page).locator('.view-lines')).toContainText('Results draft from tab B')
})

test('keeps a verified AI patch from saving over a change made in another tab', async ({ page, context }) => {
  await page.goto('/research-test?view=write')
  await expect(page.getByRole('heading', { name: 'Practice Paper' })).toBeVisible()
  const other = await context.newPage()
  await other.goto(page.url())
  await other.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await other.getByRole('textbox', { name: 'Message Writing AI' }).fill(testScenarios.pass)
  await other.getByRole('button', { name: 'Send', exact: true }).click()
  const proposal = other.getByRole('region', { name: 'Source change proposal' })
  await proposal.getByRole('button', { name: 'Verify selected changes' }).click()
  await expect(proposal.getByText(/^Verification passed\./)).toBeVisible()
  await edit(page, 'results', 'New saved result from tab A')
  await save(page)
  await expect(conflict(other)).toBeVisible()
  await proposal.getByRole('button', { name: 'Save verified changes' }).click()
  await expect(other.getByRole('alert').filter({ hasText: 'Your drafts were kept' })).toBeVisible()
  await expect(proposal.getByText('Saved to project', { exact: true })).toHaveCount(0)
})

test('a Canvas drag in a stale tab stays in that tab', async ({ page, context }) => {
  await page.goto('/research-test')
  await page.getByRole('button', { name: 'Add node' }).click()
  await page.getByRole('menuitem', { name: 'Section', exact: true }).click()
  const card = (tab: Page) => tab.locator('.react-flow__node').first()
  await expect(card(page)).toBeVisible()
  const other = await context.newPage()
  await other.goto(page.url())
  await expect(card(other)).toBeVisible()
  const position = (tab: Page) => card(tab).evaluate(element => (element as HTMLElement).style.transform)
  const original = await position(other)
  async function drag(tab: Page, dx: number, dy: number) {
    const box = await card(tab).boundingBox()
    expect(box).not.toBeNull()
    await tab.mouse.move(box!.x + 24, box!.y + 18)
    await tab.mouse.down()
    await tab.mouse.move(box!.x + 24 + dx, box!.y + 18 + dy, { steps: 8 })
    await tab.mouse.up()
  }
  await drag(page, 95, 54)
  await expect.poll(() => position(page)).not.toBe(original)
  await expect(conflict(other)).toBeVisible()
  const stored = await position(page)
  await drag(other, 160, 83)
  await expect.poll(() => position(other)).not.toBe(stored)
  const local = await position(other)
  await conflict(other).getByRole('button', { name: 'Back up this tab' }).click()
  const download = other.waitForEvent('download')
  const backup = other.getByRole('dialog', { name: 'Project Backup' })
  await backup.getByRole('button', { name: 'Download Backup' }).click()
  const archive = await JSZip.loadAsync(await readFile(await (await download).path()))
  const manifest = JSON.parse(await archive.file('project.json')!.async('text'))
  const { x, y } = manifest.canvas.pages[0].nodes[0].position
  expect(local).toContain(`${x}px, ${y}px`)
  await backup.getByRole('button', { name: 'Close', exact: true }).click()
  await conflict(other).getByRole('button', { name: 'Compare saved project' }).click()
  await other.getByRole('button', { name: 'Load saved project' }).click()
  await expect.poll(() => position(other)).toBe(stored)
})
