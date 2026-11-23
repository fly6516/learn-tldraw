import { expect, test, type Page } from '@playwright/test'
import { testResultLine, testScenarios } from '../../src/lib/project/test-paper'

const writing = '/research-test?view=write'
const storage = 'research-canvas-projects'
const previousProject = 'research-flow-v2'
const editable = 'sections/results.tex'

function source(page: Page) {
  return page.getByRole('region', { name: 'Source editor' })
}

async function appendDraft(page: Page, text: string) {
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  await editor.press('Control+End')
  await page.keyboard.insertText('\n' + text + '\n')
  await expect(page.getByText('1 local draft · Not saved to project', { exact: true })).toBeVisible()
}

async function backToProjects(page: Page) {
  await page.getByRole('link', { name: 'Back to projects' }).click()
  await expect(page.getByRole('heading', { name: 'Research projects', exact: true })).toBeVisible()
}

test('leaving a project revokes a pending AI save while keeping the proposal for review', async ({ page }) => {
  await page.goto('/research')
  const fixture = await page.request.get('/api/latex/test-fixture')
  expect(fixture.ok()).toBe(true)
  const input = page.getByLabel('Choose project ZIP or backup')
  await input.setInputFiles({ name: 'Approval study.zip', mimeType: 'application/zip', buffer: await fixture.body() })
  await expect(page.getByRole('heading', { name: 'Approval study', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/research\?project=[a-f0-9-]+&view=write$/)
  const approvalUrl = page.url()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await page.getByRole('textbox', { name: 'Message Writing AI' }).fill(testScenarios.pass)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const proposal = page.getByRole('region', { name: 'Source change proposal' })
  let started!: () => void
  let release!: () => void
  const intercepted = new Promise<void>(resolve => { started = resolve })
  const proceed = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/latex/compile?*', async route => {
    const built = await route.fetch()
    started()
    await proceed
    await route.fulfill({ response: built }).catch(() => {})
  }, { times: 1 })
  try {
    await proposal.getByRole('button', { name: 'Save if verification passes' }).click()
    await intercepted
    await backToProjects(page)
    await input.setInputFiles({ name: 'Separate study.zip', mimeType: 'application/zip', buffer: await fixture.body() })
    await expect(page.getByRole('heading', { name: 'Separate study' })).toBeVisible()
  } finally { release() }
  await backToProjects(page)
  await page.goto(approvalUrl)
  await expect(page.getByRole('heading', { name: 'Approval study', level: 1 })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(proposal.getByRole('button', { name: 'Save if verification passes' })).toBeVisible()
  await expect(proposal.getByText('Saved to project', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'results.tex', exact: true }).click()
  await expect(source(page).locator('.view-lines')).toContainText(testResultLine)
})

test('migrates the existing project and keeps imported copies, drafts and history isolated', async ({ page }, info) => {
  test.setTimeout(120_000)
  await page.goto(writing)
  await expect(page.getByRole('heading', { name: 'Practice Paper' })).toBeVisible()
  await page.evaluate(async ({ storage, previousProject, editable }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(storage)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
        const store = transaction.objectStore('projects')
        const get = store.get('research-release-test-v1')
        get.onsuccess = () => {
          const project = get.result
          project.metadata.projectName = 'Existing study'
          const date = project.metadata.createdAt
          const entry = [previousProject, date]
          const base = project.files.get(editable).content
          store.put(project, previousProject)
          store.put({ base, text: base + '\nExisting study draft.\n' }, ['draft', ...entry, editable])
          store.put({ path: editable, lineNumber: 2, column: 1 }, ['view', ...entry])
          store.put({ selected: 'chat', conversations: [{ id: 'chat', title: 'Legacy question', messages: [
            { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Check legacy notes.' }] },
          ], runs: {} }] }, ['ai-history', ...entry])
          store.put([{ id: 'initial', name: 'Existing snapshot', createdAt: date }], ['snapshots', ...entry])
          store.put(project, ['snapshot', ...entry, 'initial'])
        }
      })
    } finally { db.close() }
  }, { storage, previousProject, editable })

  await page.goto('/research?view=write')
  await expect(page).toHaveURL(/project=legacy.*view=write/)
  await expect(source(page).getByText(editable, { exact: true })).toBeVisible()
  await expect(source(page).locator('.view-lines')).toContainText('Existing study draft.')
  await expect(source(page).locator('.line-numbers.active-line-number')).toHaveText('2')
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(page.getByRole('article', { name: 'You' }).getByText('Check legacy notes.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close Writing AI' }).click()
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  await page.getByRole('checkbox', { name: /^Include 1 local draft/ }).check()
  await page.getByRole('checkbox', { name: 'Include AI conversations and task history' }).check()
  await page.getByRole('checkbox', { name: 'Include project snapshots' }).check()
  const [backup] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Download Backup' }).click(),
  ])
  const backupPath = info.outputPath('existing.research-canvas')
  await backup.saveAs(backupPath)
  await page.getByRole('dialog', { name: 'Project Backup' }).getByRole('button', { name: 'Close', exact: true }).click()

  async function importCopy() {
    await backToProjects(page)
    await page.getByLabel('Choose project ZIP or backup').setInputFiles(backupPath)
    await page.getByRole('button', { name: 'Import as new project' }).click()
    await expect(page).toHaveURL(/project=[a-f0-9-]+.*view=write/)
    await expect(page.getByRole('heading', { name: 'Existing study' })).toBeVisible()
    return page.url()
  }
  const first = await importCopy()
  await appendDraft(page, 'Only the first copy has this line.')
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  await page.getByLabel('Choose a Research Canvas backup').setInputFiles(backupPath)
  await page.getByRole('button', { name: 'Import as new project' }).click()
  await expect(page).not.toHaveURL(first)
  await expect(page).toHaveURL(/project=[a-f0-9-]+.*view=write/)
  const second = page.url()
  expect(new URL(first).searchParams.get('project')).not.toBe(new URL(second).searchParams.get('project'))
  await expect(source(page).locator('.view-lines')).toContainText('Existing study draft.')
  await expect(source(page).locator('.view-lines')).not.toContainText('Only the first copy')
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Snapshots', exact: true }).click()
  await expect(page.getByText('Existing snapshot', { exact: true })).toBeVisible()
  await page.getByRole('dialog', { name: 'Project Snapshots' }).getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Writing AI', exact: true }).click()
  await expect(page.getByRole('article', { name: 'You' }).getByText('Check legacy notes.', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Approval mode' })).toHaveValue('manual')

  await backToProjects(page)
  await page.goto(first)
  await page.reload()
  await expect(source(page).getByText(editable, { exact: true })).toBeVisible()
  await expect(source(page).locator('.view-lines')).toContainText('Only the first copy')
  await page.goto('/research?project=legacy&view=write')
  await expect(source(page).locator('.view-lines')).toContainText('Existing study draft.')
  await expect(source(page).locator('.view-lines')).not.toContainText('Only the first copy')
})

test('creates, renames, archives, trashes and restores a project while preserving its address', async ({ page }) => {
  await page.goto('/research')
  await page.getByRole('button', { name: 'New project' }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('New paper')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { name: 'New paper', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/project=[a-f0-9-]+/)
  const created = page.url()
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await backToProjects(page)
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: 'Project name' }).fill('Renamed paper')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('link', { name: 'Open Renamed paper' })).toHaveAttribute('href', /view=write/)
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await page.getByRole('button', { name: 'Archived', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Renamed paper' })).toBeVisible()
  await page.getByRole('button', { name: 'Move to Trash' }).click()
  await page.getByRole('button', { name: 'Trash', exact: true }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('button', { name: 'Projects', exact: true }).click()
  await page.getByRole('link', { name: 'Open Renamed paper' }).click()
  await expect(page.getByRole('heading', { name: 'Renamed paper', exact: true })).toBeVisible()
  await expect(page).toHaveURL(created + '&view=write')
  await expect(source(page)).toBeVisible()
  await page.getByRole('button', { name: 'Canvas', exact: true }).click()
  const viewport = page.locator('.react-flow__viewport:visible')
  const prior = await viewport.evaluate(element => getComputedStyle(element).transform)
  await page.getByRole('button', { name: /^zoom in$/i }).click()
  await expect.poll(() => viewport.evaluate(element => getComputedStyle(element).transform)).not.toBe(prior)
  await expect.poll(() => viewport.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(1.2, 2)
  const viewportBefore = await viewport.evaluate(element => getComputedStyle(element).transform)
  await backToProjects(page)
  await page.getByRole('link', { name: 'Open Renamed paper' }).click()
  await expect(page).toHaveURL(created)
  await expect(viewport).toHaveCSS('transform', viewportBefore)
})
