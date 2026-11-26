import { expect, test, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import sharp from 'sharp'
import { decodeProjectBackup, encodeProjectBackup } from '../../src/lib/project/backup'
import { emptyCanvas } from '../../src/lib/project/research-graph'
import { submissionMaterialPath } from '../../src/lib/project/submission-materials'
import { importSourceArchive } from '../../src/lib/project/source-archive'
import { externalTexCommand } from '../fixtures/external-tex'
import { compileProject, confirmTemplatePublication, manageOfficialVersion, replaceProjectSource, reviewArchive, saveCompiledPdf, templateCard } from './support/official-template'
import { servePinnedTemplateFixtures } from './support/official-template'

test.beforeEach(async ({ page }) => { await servePinnedTemplateFixtures(page) })

const acceptance = process.env.RESEARCH_TEMPLATE_EXPORT_ACCEPTANCE
const title = 'Reproducible Calibration of Three Measurement Channels'
const name = 'Template export calibration study'
const manuscript = String.raw`\documentclass{article}
\usepackage{graphicx,booktabs,natbib,hyperref}
\title{Reproducible Calibration of Three Measurement Channels}
\author{Casey Lin}
\begin{document}
\maketitle
\begin{abstract}
We compare three measurement channels against a common calibration procedure.
\end{abstract}
\input{sections/study}
\input{sections/results}
\bibliographystyle{plainnat}
\bibliography{refs/measurement}
\end{document}
`

const study = String.raw`\section{Study design}\label{sec:study}
The channels were sampled through a common procedure.
\subsection{Observation protocol}
Each observation was recorded with a fixed sampling interval.
\subsubsection{Calibration check}
The reference instrument was verified before each measurement session.
`

const resultMarker = 'Independent measurements confirmed calibration.'
const results = String.raw`\section{Results}
See Section~\ref{sec:study}, Figure~\ref{fig:calibration}, and Table~\ref{tab:counts}.
The information criterion follows \citet{shannon1948}, and the tree approximation follows \citet{chow1968}.

${resultMarker}

\begin{figure}[htbp]
\centering
\includegraphics[width=.55\linewidth]{figures/channels.png}
\caption{Calibration observations by channel.}\label{fig:calibration}
\end{figure}
\begin{table}[htbp]
\centering
\caption{Independent observation counts.}\label{tab:counts}
\begin{tabular}{lr}
\toprule
Channel & Observations \\
\midrule
Alpha & 12 \\
Beta & 16 \\
Gamma & 20 \\
\bottomrule
\end{tabular}
\end{table}
`

const references = `@article{shannon1948,
  author = {Shannon, Claude E.},
  title = {A Mathematical Theory of Communication},
  journal = {Bell System Technical Journal},
  year = {1948},
  volume = {27},
  number = {3},
  pages = {379--423}
}
@article{chow1968,
  author = {Chow, C. K. and Liu, C. N.},
  title = {Approximating Discrete Probability Distributions with Dependence Trees},
  journal = {IEEE Transactions on Information Theory},
  year = {1968},
  volume = {14},
  number = {3},
  pages = {462--467}
}
`

const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

async function seedProject(studySource = study, resultsSource = results) {
  const zip = new JSZip()
  zip.file('main.tex', manuscript)
  zip.file('sections/study.tex', studySource)
  zip.file('sections/results.tex', resultsSource)
  zip.file('refs/measurement.bib', references)
  zip.file('figures/channels.png', await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="246" viewBox="0 0 480 246">' +
    '<rect width="480" height="246" fill="white"/><path d="M55 16v181h398M55 110h398M55 23h398" fill="none" stroke="#c5c7cf"/>' +
    '<g fill="#512e91"><rect x="93" y="93" width="64" height="104"/><rect x="222" y="58" width="64" height="139"/><rect x="351" y="23" width="64" height="174"/></g>' +
    '<g font-size="16" font-family="sans-serif" fill="#272132"><text x="24" y="28">20</text><text x="24" y="116">10</text><text x="35" y="201">0</text>' +
    '<text x="105" y="224">Alpha</text><text x="235" y="224">Beta</text><text x="350" y="224">Gamma</text></g></svg>',
  )).png().toBuffer())
  const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], name + '.zip')
  const project = await importSourceArchive(file)
  project.metadata.compileProfile = { engine: 'pdflatex', bibliography: 'bibtex' }
  project.metadata.templateOrigin = { id: 'calibration-article', version: '1.0.0', sha256: hash(manuscript) }
  const history = { snapshots: [{ id: 'baseline', name: 'Saved calibration study', createdAt: project.metadata.createdAt, project }] }
  return Buffer.from(await (await encodeProjectBackup(emptyCanvas, project, undefined, history)).arrayBuffer())
}

async function backup(page: Page, output: string) {
  await page.getByRole('button', { name: 'Project menu' }).click()
  await page.getByRole('menuitem', { name: 'Project Backup', exact: true }).click()
  await page.getByLabel('Include project snapshots').check()
  await page.getByLabel('Include submissions and revision rounds').check()
  const dialog = page.getByRole('dialog', { name: 'Project Backup' })
  const download = page.waitForEvent('download', { timeout: 20_000 }).catch(() => undefined)
  await dialog.getByRole('button', { name: 'Download Backup', exact: true }).click()
  const file = await Promise.race([download, dialog.getByRole('alert').waitFor({ timeout: 20_000 }).then(() => undefined).catch(() => undefined)])
  if (!file) throw new Error('Project backup failed: ' + await dialog.getByRole('alert').allTextContents())
  await file.saveAs(output)
  await page.getByRole('dialog', { name: 'Project Backup' }).getByRole('button', { name: 'Close', exact: true }).click()
  const zip = await JSZip.loadAsync(await readFile(output))
  const manifest = JSON.parse(await zip.file('project.json')!.async('text'))
  // ZIP headers include download times. Fingerprint the actual archived payload.
  const files = Object.fromEntries(await Promise.all(Object.values(zip.files).filter(file => !file.dir && file.name !== 'project.json')
    .sort((a, b) => a.name.localeCompare(b.name)).map(async file => {
      if (!file.name.startsWith('history/snapshots/')) return [file.name, hash(await file.async('nodebuffer'))]
      const contents = await JSZip.loadAsync(await file.async('nodebuffer'))
      const normalized = await Promise.all(Object.values(contents.files).filter(entry => !entry.dir)
        .sort((a, b) => a.name.localeCompare(b.name)).map(async entry => [entry.name, hash(await entry.async('nodebuffer'))]))
      return [file.name, hash(JSON.stringify(normalized))]
    })))
  const snapshots = (manifest.history?.snapshots ?? []).map(({ archive, ...metadata }: { archive: unknown; name: string }) => {
    // The nested archive is already compared by member payload above.
    void archive
    return metadata
  })
  return { project: manifest.project, snapshots, files, publication: manifest.history?.publication }
}

function pdfText(pdf: string, cwd: string) {
  return externalTexCommand('pdftotext', ['-layout', pdf, '-'], cwd).replace(/(\p{L})-\s*\r?\n\s*(\p{L})/gu, '$1$2').replace(/\s+/g, ' ')
}

async function fillZju(dialog: Locator, program = '年级与专业') {
  await dialog.getByLabel('中文题目').fill('三组测量通道的可复现校准')
  await dialog.getByLabel('学号').fill('20260001')
  await dialog.getByLabel('指导教师').fill('李老师')
  await dialog.getByLabel(program).fill(program === '年级与专业' ? '2026级基础医学' : '电子信息')
  await dialog.getByLabel('所在学院').fill('医学院')
  await dialog.getByLabel('提交日期').fill('2026年11月26日')
  await dialog.getByLabel('中文摘要').fill('本研究采用统一校准流程比较三组测量通道。')
  await dialog.getByLabel('中文关键词').fill('校准；测量；重复性')
}

test('switches the same project between ZJU and JMLR without writing to it', async ({ page }, info) => {
  test.skip(acceptance !== '1', 'Requires the loopback compile service, LibreOffice and an external TeX installation.')
  test.setTimeout(240_000)
  const output = info.outputPath('verified')
  await mkdir(output, { recursive: true })
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: name + '.research-canvas', mimeType: 'application/zip', buffer: await seedProject(),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  const open = page.getByRole('button', { name: '更换模板', exact: true })
  await expect(open).toBeEnabled()
  const baseline = await backup(page, info.outputPath('before.research-canvas'))
  expect(baseline.project.metadata.templateOrigin.id).toBe('calibration-article')
  expect(baseline.snapshots).toHaveLength(1)
  const route = page.url()
  const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })

  await open.click()
  await fillZju(dialog)

  const download = async (label: string, path: string) => {
    const event = page.waitForEvent('download')
    await dialog.getByRole('link', { name: label, exact: true }).click()
    await (await event).saveAs(path)
  }
  const render = async (target: string) => {
    await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
    await expect(dialog.getByRole('link', { name: '下载 PDF' }).or(dialog.getByRole('alert'))).toBeVisible({ timeout: 85_000 })
    expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    await expect(dialog.getByRole('region', { name: '目标模板预览' })).toBeVisible()
    await download('下载 PDF', join(output, target + '.pdf'))
    await download('下载 LaTeX 源包', join(output, target + '.zip'))
  }
  await render('zju')
  await dialog.getByRole('combobox', { name: '目标模板' }).selectOption('jmlr')
  await dialog.getByLabel('作者单位').fill('Calibration Methods Laboratory')
  await dialog.getByLabel('通讯邮箱（选填）').fill('casey@example.org')
  await render('jmlr')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const afterSuccess = await backup(page, info.outputPath('after-success.research-canvas'))
  expect(afterSuccess).toEqual(baseline)

  const chooseJmlr = async () => {
    await open.click()
    await dialog.getByRole('combobox', { name: '目标模板' }).selectOption('jmlr')
    await dialog.getByLabel('作者单位').fill('Calibration Methods Laboratory')
  }
  const compileRoute = '**/api/latex/compile?**'
  await page.route(compileRoute, route => route.fulfill({ status: 422, json: { error: 'Acceptance: compiler failure' } }))
  await chooseJmlr()
  await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Acceptance: compiler failure', { timeout: 45_000 })
  await expect(dialog.getByRole('link', { name: '下载 PDF' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const afterFailure = await backup(page, info.outputPath('after-failure.research-canvas'))
  expect(afterFailure).toEqual(baseline)
  await page.unroute(compileRoute)

  const sourceRoute = '**/api/templates/source?**'
  let releaseRequest: () => void = () => {}
  const delayedSource = new Promise<void>(resolve => { releaseRequest = resolve })
  await page.route(sourceRoute, async route => {
    await delayedSource
    await route.abort().catch(() => {})
  })
  await chooseJmlr()
  const started = page.waitForRequest(url => url.url().includes('/api/templates/source?'))
  await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
  await started
  await dialog.getByRole('button', { name: '取消导出', exact: true }).click()
  releaseRequest()
  await expect(dialog.getByRole('button', { name: '编译预览' })).toBeEnabled()
  await expect(dialog.getByRole('link', { name: '下载 PDF' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const afterCancel = await backup(page, info.outputPath('after-cancel.research-canvas'))
  expect(afterCancel).toEqual(baseline)
  expect(page.url()).toBe(route)

  let manuscriptSha256: string | undefined
  for (const [target, engine, main] of [['zju', '-xelatex', 'main.tex'], ['jmlr', '-pdf', 'sample.tex']]) {
    const cwd = join(output, target + '-clean')
    const archive = await JSZip.loadAsync(await readFile(join(output, target + '.zip')), { checkCRC32: true })
    for (const file of Object.values(archive.files)) {
      if (file.dir) continue
      const destination = join(cwd, file.name)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, await file.async('nodebuffer'))
    }
    const instructions = await archive.file('BUILD.md')?.async('text')
    const digest = /Manuscript SHA-256: ([a-f0-9]{64})/.exec(instructions ?? '')?.[1]
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    if (manuscriptSha256) expect(digest).toEqual(manuscriptSha256)
    manuscriptSha256 = digest
    expect(archive.file('figures/channels.png')).not.toBeNull()
    expect(await archive.file('refs/measurement.bib')?.async('text')).toBe(references)
    expect(archive.file(target === 'zju' ? 'word-layout.tex' : 'jmlr2e.sty')).not.toBeNull()
    externalTexCommand('latexmk', ['-norc', engine, '-latexoption=-no-shell-escape', '-interaction=nonstopmode', main], cwd)
    const original = pdfText(join(output, target + '.pdf'), cwd)
    const rebuilt = pdfText(main.replace('.tex', '.pdf'), cwd)
    expect(rebuilt).toBe(original)
    expect(rebuilt).toContain(title)
    expect(rebuilt).toContain('We compare three measurement channels against a common calibration procedure.')
    const body = rebuilt.lastIndexOf('Study design')
    expect(body).toBeGreaterThan(0)
    expect(rebuilt.indexOf('Observation protocol', body)).toBeGreaterThan(body)
    expect(rebuilt.indexOf('Calibration check', body)).toBeGreaterThan(rebuilt.indexOf('Observation protocol', body))
    expect(rebuilt).toContain('Calibration observations by channel.')
    expect(rebuilt).toContain('Independent observation counts.')
    expect(rebuilt).toMatch(/Alpha\s+12.*Beta\s+16.*Gamma\s+20/)
    expect(rebuilt).toMatch(/See Section 1, Figure [\d.-]+, and Table [\d.-]+/)
    expect(rebuilt).toMatch(/Mathematical Theory of Communication/i)
    expect(rebuilt).toMatch(/Approximating Discrete Probability Distributions with Dependence Trees/i)
    expect(rebuilt).not.toContain('??')
    if (target === 'jmlr') {
      expect(rebuilt).toContain('Calibration Methods Laboratory')
      expect(rebuilt).toContain('Shannon (1948)')
      expect(rebuilt).toContain('Chow and Liu (1968)')
    } else {
      expect(archive.file('template-front/cover.pdf')).not.toBeNull()
      expect(rebuilt).toContain('三组测量通道的可复现校准')
      expect(rebuilt).toContain('20260001')
      const cover = pdfText(join(cwd, 'template-front/cover.pdf'), cwd)
      const coverText = externalTexCommand('pdftotext', ['-f', '1', '-l', '1', '-layout', join(cwd, 'template-front/cover.pdf'), '-'], cwd)
      expect(cover).toContain('原创性声明')
      expect(externalTexCommand('pdfinfo', [join(cwd, 'template-front/cover.pdf')], cwd)).toMatch(/Pages:\s+2\b/)
      expect(cover).toContain('导师签名')
      expect(coverText).toMatch(/2026\s*年\s*11\s*月\s*26\s*日/)
      expect(rebuilt).toMatch(/Figure 2\.1, and Table 2\.1/)
      expect(rebuilt).toContain('原创性声明')
      expect(rebuilt).toContain('使用授权书')
      expect(rebuilt).toMatch(/1\s+Study design\s+1/)
      expect(rebuilt).toMatch(/1\.1\s+Observation protocol/)
    }
  }
  const evidence = Object.fromEntries(Object.entries({ before: baseline, afterSuccess, afterFailure, afterCancel })
    .map(([step, value]) => [step, hash(JSON.stringify(value))]))
  await writeFile(join(output, 'acceptance.json'), JSON.stringify({
    project: name, originalTemplate: baseline.project.metadata.templateOrigin, originalCompileProfile: baseline.project.metadata.compileProfile,
    savedSnapshots: baseline.snapshots.map((snapshot: { name: string }) => snapshot.name), fingerprints: evidence,
    manuscriptSha256,
    checks: ['One project and snapshot', 'Same text from fresh source builds', 'PDF headings, citations and cross-references',
      'Project unchanged after successful builds, compiler rejection and in-flight cancel'],
  }, null, 2) + '\n')
})

test('persists the current template and restores the original without rewriting the manuscript or archives', async ({ page }, info) => {
  test.skip(acceptance !== '1', 'Requires the loopback compiler, LibreOffice, and Poppler.')
  test.setTimeout(240_000)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: name + '.research-canvas', mimeType: 'application/zip', buffer: await seedProject(),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await page.getByRole('button', { name: 'Writing', exact: true }).click()

  const switchButton = page.getByRole('button', { name: '更换模板', exact: true })
  const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
  const current = page.getByLabel('当前编译模板')
  const submission = page.getByRole('dialog', { name: 'Prepare submission' })
  const originalVersion = 'Before switching templates'

  async function archive(label: string) {
    await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    await submission.getByRole('button', { name: 'Compile submission files', exact: true }).click()
    await expect(submission.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
    await submission.getByLabel('Version name').fill(label)
    await submission.getByRole('button', { name: 'Save submission version' }).click()
    await expect(submission.getByText(new RegExp('^' + label + ' ·'))).toBeVisible()
    await submission.getByRole('button', { name: 'Close', exact: true }).click()
  }

  async function saveCurrent() {
    const confirm = dialog.getByRole('button', { name: '设为当前模板', exact: true })
    await expect(confirm).toHaveCount(0)
    await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
    await expect(confirm.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 75_000 })
    expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    await confirm.click()
    await expect(dialog).toHaveCount(0)
  }

  let upstreamRequests = 0
  const rejectUpstream = (route: import('@playwright/test').Route) => {
    upstreamRequests++
    return route.fulfill({ status: 503, json: { error: 'Acceptance fixture: upstream unavailable' } })
  }

  const navigation = page.getByRole('complementary', { name: 'Project navigation' })
  const editor = page.getByRole('textbox', { name: 'Project source editor' })
  const showPdf = page.getByRole('button', { name: 'Show in PDF', exact: true })
  const pdfPane = page.getByRole('region', { name: 'PDF Preview', exact: true })
  const pdfPage = pdfPane.getByRole('region', { name: /^Compiled PDF, page / })
  const jumps: { layout: string; path: string; line: number; page: number }[] = []

  async function roundTrip(layout: string, path: string, line: number, sentence: string) {
    await navigation.getByRole('button', { name: 'Search', exact: true }).click()
    const search = navigation.getByRole('region', { name: 'Project source search' })
    await search.getByLabel('Search project source').fill(sentence)
    const result = search.getByRole('button').filter({ hasText: path.split('/').at(-1) + ':' + line })
    await result.click()
    await expect(editor).toBeFocused()
    await editor.press('Home')
    await navigation.getByRole('button', { name: 'Files', exact: true }).click()
    await showPdf.click()
    const forward = pdfPane.getByRole('status').filter({ hasText: new RegExp(`^Source line ${line} · PDF page \\d+$`) })
    await expect(forward).toBeVisible()
    const pageNumber = Number((await forward.innerText()).split(' ').at(-1))
    const text = pdfPage.getByText(sentence, { exact: true })
    await expect(text).toBeVisible()
    const highlight = pdfPage.locator('div[aria-hidden="true"]')
    await expect(highlight).toBeVisible()
    // Compare both elements in the same browser layout after page centering.
    await expect(async () => {
      const mark = await highlight.elementHandle()
      const intersects = await text.evaluate((word, overlay) => {
        const a = word.getBoundingClientRect()
        const b = overlay.getBoundingClientRect()
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      }, mark)
      expect(intersects).toBe(true)
    }).toPass({ timeout: 4000 })
    const wordBox = (await text.boundingBox())!

    // Move to a different source tab so the click must restore the file as well as the line.
    await navigation.getByTitle(path === 'main.tex' ? 'sections/results.tex' : 'main.tex', { exact: true }).click()
    await text.click({ position: { x: Math.min(12, wordBox.width / 2), y: wordBox.height / 2 } })
    await expect(pdfPane.getByRole('status').filter({ hasText: path + ':' + line })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Source editor', exact: true }).getByTitle(path, { exact: true })).toBeVisible()
    await showPdf.click()
    await expect(forward).toBeVisible()
    jumps.push({ layout, path, line, page: pageNumber })
  }

  async function checkBody(layout: string) {
    await roundTrip(layout, 'sections/study.tex', 2, 'The channels were sampled through a common procedure.')
    await roundTrip(layout, 'sections/results.tex', 5, resultMarker)
  }

  async function reloadAndCompile(engine: string, main: string, pdf: string) {
    await page.route('**/api/templates/source?**', rejectUpstream)
    try {
      await page.reload()
      const response = page.waitForResponse(result => result.request().method() === 'POST' && result.url().includes('/api/latex/compile?'), { timeout: 60_000 })
      await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
      const compiled = await response
      const query = new URL(compiled.url()).searchParams
      expect(query.get('main')).toBe(main)
      expect(query.get('engine')).toBe(engine)
      expect(compiled.ok(), compiled.ok() ? '' : (await compiled.text()).slice(0, 1800)).toBe(true)
      await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 45_000 })
      await saveCompiledPdf(page, pdf)
      expect(upstreamRequests).toBe(0)
      return pdfText(pdf, info.outputDir)
    } finally {
      await page.unroute('**/api/templates/source?**', rejectUpstream)
    }
  }

  async function state(stage: string) {
    return backup(page, info.outputPath(stage + '.research-canvas'))
  }

  await archive(originalVersion)
  const original = await state('original')
  expect(original.publication.submissions).toHaveLength(1)
  expect(original.snapshots).toHaveLength(1)

  await switchButton.click()
  await fillZju(dialog)
  await saveCurrent()
  await checkBody('ZJU preview applied')
  const zjuPdf = await reloadAndCompile('xelatex', 'main.tex', info.outputPath('active-zju.pdf'))
  await expect(current).toContainText('浙江大学')
  expect(zjuPdf).toContain('三组测量通道的可复现校准')
  expect(zjuPdf).toContain('原创性声明')
  expect(zjuPdf).toContain('Figure 2.1, and Table 2.1')
  await checkBody('ZJU reopened')
  await switchButton.click()
  await expect(dialog.getByLabel('指导教师')).toHaveValue('李老师')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  const zju = await state('zju')
  const { activeTemplate: zjuSettings, ...zjuOriginalMetadata } = zju.project.metadata
  expect(zjuSettings.origin.id).toBe('zju-basic-medicine-undergraduate')
  expect({ ...zju, project: { ...zju.project, metadata: zjuOriginalMetadata } }).toEqual(original)
  const portableZju = new Blob([new Uint8Array(await readFile(info.outputPath('zju.research-canvas')))])
  expect((await decodeProjectBackup(portableZju)).project.metadata.activeTemplate?.origin).toEqual(zjuSettings.origin)

  await switchButton.click()
  await dialog.getByRole('combobox', { name: '目标模板' }).selectOption('jmlr')
  await dialog.getByLabel('作者单位').fill('Calibration Methods Laboratory')
  await saveCurrent()
  await checkBody('JMLR preview applied')
  const jmlrPdf = await reloadAndCompile('pdflatex', 'sample.tex', info.outputPath('active-jmlr.pdf'))
  await expect(current).toContainText('JMLR')
  expect(jmlrPdf).toContain('Calibration Methods Laboratory')
  expect(jmlrPdf).toContain('Shannon (1948)')
  expect(jmlrPdf).toContain('Figure 1, and Table 1')
  await checkBody('JMLR reopened')
  const jmlr = await state('jmlr')
  const { activeTemplate: jmlrSettings, ...jmlrOriginalMetadata } = jmlr.project.metadata
  expect(jmlrSettings.origin.id).toBe('jmlr')
  expect({ ...jmlr, project: { ...jmlr.project, metadata: jmlrOriginalMetadata } }).toEqual(original)

  const jmlrVersion = 'Archived with JMLR'
  await archive(jmlrVersion)
  const beforeRestore = await state('before-restore')
  const savedReport = beforeRestore.publication.submissions.find((item: { name: string }) => item.name === jmlrVersion).layoutReport
  expect(savedReport.templateOrigin).toEqual(jmlrSettings.origin)
  await switchButton.click()
  await dialog.getByRole('button', { name: '切回原模板', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const restoredPdf = await reloadAndCompile('pdflatex', 'main.tex', info.outputPath('restored-original.pdf'))
  await expect(current).toHaveCount(0)
  expect(restoredPdf).toContain('See Section 1, Figure 1, and Table 1')
  expect(restoredPdf).not.toContain('Calibration Methods Laboratory')
  await checkBody('Original restored')
  const restored = await state('restored')
  expect(restored.project).toEqual(original.project)
  expect(restored.files).toEqual(beforeRestore.files)
  expect(restored.publication).toEqual(beforeRestore.publication)
  expect(restored.snapshots).toEqual(original.snapshots)

  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const archivePanel = submission.getByRole('region', { name: 'Archived submissions' })
  await archivePanel.getByText(new RegExp('^' + jmlrVersion + ' ·')).click()
  await archivePanel.getByRole('button', { name: '复查归档版式报告' }).click()
  await expect(archivePanel.getByRole('region', { name: '归档版式报告' })).toContainText('jmlr · f413f63')
  await expect(archivePanel.getByRole('region', { name: '归档版式报告' })).toContainText('原 PDF 和源包校验通过')
  await submission.getByRole('button', { name: 'Close', exact: true }).click()

  // An active renderer uses the current draft whenever the ordinary compile action is invoked.
  await switchButton.click()
  await dialog.getByRole('combobox', { name: '目标模板' }).selectOption('jmlr')
  await dialog.getByLabel('作者单位').fill('Calibration Methods Laboratory')
  await saveCurrent()
  const marker = 'Fresh manuscript text after selection.'
  await replaceProjectSource(page, 'sections/results.tex', results + '\n' + marker + '\n')
  await expect(page.getByText(/1 local draft/)).toBeVisible()
  await expect(showPdf).toBeDisabled()
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  await expect(page.getByText(/Last successful compile.*Up to date.*Includes local drafts/)).toBeVisible({ timeout: 60_000 })
  const updatedPdf = info.outputPath('active-jmlr-latest-draft.pdf')
  await saveCompiledPdf(page, updatedPdf)
  expect(pdfText(updatedPdf, info.outputDir)).toContain(marker)

  await writeFile(info.outputPath('active-template-acceptance.json'), JSON.stringify({
    project: name, original: original.project.metadata.templateOrigin, zju: zjuSettings.origin, jmlr: jmlrSettings.origin,
    sourceAndAssetsIdenticalAcrossSwitches: true, archivedSubmissionsAndSnapshotsIdenticalAfterRestore: true,
    reloadedCompilesWithoutFetchingOriginals: upstreamRequests === 0, compiledLatestDraft: true,
    jumps, originalArchive: original.publication.submissions[0].sourceChecksum, jmlrArchive: savedReport,
  }, null, 2) + '\n')
})

test('switches a single independent project across official school and publisher layouts and restores source navigation', async ({ page }, info) => {
  const word = process.env.RESEARCH_WORD_FIXTURE_DIR
  const originals = process.env.RESEARCH_UNIFIED_TEMPLATE_FIXTURES
  test.skip(acceptance !== '1' || !word || !originals, 'Requires the verified SUEP DOCs and official REVTeX package.')
  test.setTimeout(420_000)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: name + '.research-canvas', mimeType: 'application/zip', buffer: await seedProject(),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  const open = page.getByRole('button', { name: '更换模板', exact: true })
  const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
  await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Prepare submission' })
  await archive.getByRole('button', { name: 'Compile submission files' }).click()
  await expect(archive.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
  await archive.getByLabel('Version name').fill('Original calibration archive')
  await archive.getByRole('button', { name: 'Save submission version' }).click()
  await expect(archive.getByText(/^Original calibration archive ·/)).toBeVisible()
  await archive.getByRole('button', { name: 'Close', exact: true }).click()
  const original = await backup(page, info.outputPath('priority-original.research-canvas'))
  expect(original.publication.submissions).toHaveLength(1)

  async function verifyJump() {
    const path = 'sections/study.tex'
    const match = 'The channels were sampled through a common procedure.'
    const navigation = page.getByRole('complementary', { name: 'Project navigation' })
    await navigation.getByRole('button', { name: 'Search', exact: true }).click()
    const search = navigation.getByRole('region', { name: 'Project source search' })
    await search.getByLabel('Search project source').fill(match)
    await search.getByRole('button').filter({ hasText: 'study.tex:2' }).click()
    await page.getByRole('textbox', { name: 'Project source editor' }).press('Home')
    await navigation.getByRole('button', { name: 'Files', exact: true }).click()
    const show = page.getByRole('button', { name: 'Show in PDF', exact: true })
    await show.click()
    const preview = page.getByRole('region', { name: 'PDF Preview', exact: true })
    const forward = preview.getByText(/^Source line 2 · PDF page \d+$/)
    await expect(forward).toBeVisible()
    const pageNumber = Number((await forward.innerText()).split(' ').at(-1))
    const sheet = preview.getByRole('region', { name: 'Compiled PDF, page ' + pageNumber, exact: true })
    const sentence = sheet.getByText(match, { exact: true })
    await expect(sentence).toBeVisible()
    await expect(sheet.locator('div[aria-hidden="true"]')).toBeVisible()
    await navigation.getByTitle('main.tex', { exact: true }).click()
    const box = (await sentence.boundingBox())!
    await sentence.click({ position: { x: 12, y: box.height / 2 } })
    await expect(preview.getByText(path + ':2', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Source editor', exact: true }).getByTitle(path, { exact: true })).toBeVisible()
    await show.click()
    await expect(forward).toBeVisible()
    return pageNumber
  }

  const cases = [
    ['suep-undergraduate', 'xelatex', 'main.tex'],
    ['sjtu-graduate-word', 'xelatex', 'main.tex'],
    ['aps-prl', 'pdflatex', 'apstemplate.tex'],
    ['mnras', 'pdflatex', 'mnras_template.tex'],
    ['elsevier-cas-sc', 'pdflatex', 'cas-sc-sample.tex'],
    ['plos-one', 'pdflatex', 'plos_latex_template.tex'],
    ['ieee-compsoc', 'pdflatex', 'bare_jrnl_compsoc.tex'],
    ['suep-masters', 'xelatex', 'main.tex'],
    ['ustc-graduate-word', 'xelatex', 'main.tex'],
    ['scau-undergraduate', 'xelatex', 'main.tex'],
    ['springer-nature', 'pdflatex', 'sn-article.tex'],
    ['tsinghua-thesis', 'xelatex', 'main.tex'],
    ['english-article', 'pdflatex', 'main.tex'],
    ['chinese-article', 'xelatex', 'main.tex'],
  ] as const
  const proof: Record<string, unknown> = {}
  const only = process.env.RESEARCH_SWITCH_TARGETS?.split(',')
  for (const [id, engine, main] of cases.filter(([id]) => !only || only.includes(id))) {
    await open.click()
    await dialog.getByRole('combobox', { name: '目标模板' }).selectOption(id)
    if (id === 'suep-undergraduate') {
      await expect(dialog.getByLabel('官方本科封面 DOC')).toBeVisible()
      await dialog.getByLabel('中文题目').fill('三组测量通道的可复现校准')
      await dialog.getByLabel('学号').fill('20260001')
      await dialog.getByLabel('指导教师').fill('李老师')
      await dialog.getByLabel('年级与专业').fill('2026 级电气工程')
      await dialog.getByLabel('所在院系').fill('电气工程学院')
      await dialog.getByLabel('提交日期').fill('2026年11月26日')
      await dialog.getByLabel('中文摘要').fill('本研究采用统一校准流程比较三组测量通道。')
      await dialog.getByLabel('中文关键词').fill('校准；测量；重复性')
      await dialog.getByLabel('官方本科封面 DOC').setInputFiles(join(word!, 'current-cover.doc'))
      await dialog.getByLabel('官方声明 DOC').setInputFiles(join(word!, 'declaration.doc'))
    } else if (id === 'sjtu-graduate-word') {
      await expect(dialog.getByLabel('导师英文姓名')).toBeVisible()
      await fillZju(dialog)
      await dialog.getByLabel('导师英文姓名').fill('Ming Li')
      await dialog.getByLabel('学院英文全称').fill('School of Engineering')
      await dialog.getByText('手动上传官方原件').click()
      await dialog.getByLabel('官方 Word', { exact: true }).setInputFiles(join(originals!, 'sjtu-graduate-word.docx'))
    } else if (id === 'suep-masters' || id === 'ustc-graduate-word' || id === 'scau-undergraduate') {
      await fillZju(dialog)
      if (id !== 'scau-undergraduate') {
        await dialog.getByLabel('培养类型').selectOption('academic')
        await dialog.getByLabel(id === 'ustc-graduate-word' ? '学位（硕士或博士）' : '申请学位类别').fill(id === 'ustc-graduate-word' ? '硕士' : '工学硕士')
      }
      if (id === 'ustc-graduate-word') {
        await dialog.getByLabel('导师英文姓名').fill('Ming Li')
        await dialog.getByLabel('学院英文全称').fill('School of Engineering')
        await dialog.getByLabel('学科专业英文全称').fill('Electrical Engineering')
        await dialog.getByLabel('研究方向').fill('Calibration methods')
      }
      await dialog.getByText('手动上传官方原件').click()
      await dialog.getByLabel('官方 Word', { exact: true }).setInputFiles(join(originals!, id + (id === 'ustc-graduate-word' ? '.docx' : '.doc')))
      if (id === 'scau-undergraduate') await dialog.getByLabel('官方规范 PDF').setInputFiles(join(originals!, id + '-guidelines.pdf'))
    } else if (id === 'tsinghua-thesis') {
      await dialog.getByLabel('中文题目').fill('三组测量通道的可复现校准')
      await dialog.getByLabel('中文摘要').fill('本研究采用统一校准流程比较三组测量通道。')
      await dialog.getByLabel('中文关键词').fill('校准；测量；重复性')
      await dialog.getByLabel('指导教师').fill('李明')
      await dialog.getByLabel('导师英文姓名').fill('Ming Li')
      await dialog.getByLabel('培养单位').fill('电子工程系')
      await dialog.getByLabel('学科专业', { exact: true }).fill('电气工程')
      await dialog.getByLabel('学科专业英文全称').fill('Electrical Engineering')
      await dialog.getByLabel('提交日期（YYYY-MM-DD）').fill('2026-11-26')
      await dialog.getByLabel('学位', { exact: true }).selectOption('master')
      await dialog.getByLabel('学位类别中文全称').fill('工学硕士')
      await dialog.getByLabel('学位类别英文全称').fill('Master of Science')
      await dialog.getByText('手动上传官方原件').click()
      await dialog.getByLabel('官方 ZIP').setInputFiles(join(originals!, id + '.zip'))
    } else if (id !== 'english-article' && id !== 'chinese-article') {
      await dialog.getByLabel('作者单位').fill('Calibration Methods Laboratory')
      if (id === 'springer-nature') await dialog.getByLabel('通讯邮箱（选填）').fill('casey@example.org')
      await dialog.getByText('手动上传官方原件').click()
      await dialog.getByLabel('官方 ZIP').setInputFiles(join(originals!, id + '.zip'))
    }
    await dialog.getByRole('button', { name: '编译预览' }).click()
    const set = dialog.getByRole('button', { name: '设为当前模板' })
    await expect(set.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 75_000 })
    expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    const signal = page.waitForEvent('download')
    await dialog.getByRole('link', { name: '下载 LaTeX 源包' }).click()
    await (await signal).saveAs(info.outputPath(id + '.zip'))
    if (id === 'tsinghua-thesis') {
      const archive = await JSZip.loadAsync(await readFile(info.outputPath(id + '.zip')))
      expect(await archive.file('main.tex')!.async('string')).toContain('degree-category={工学硕士}')
      expect(await archive.file('main.tex')!.async('string')).toContain('department={电子工程系}')
    }
    await set.click()
    await expect(dialog).toBeHidden()
    const previewPage = await verifyJump()
    await page.reload()
    const compiled = page.waitForResponse(response => response.url().includes('/api/latex/compile?') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
    const response = await compiled
    expect(response.ok(), response.ok() ? undefined : await response.text()).toBe(true)
    expect(new URL(response.url()).searchParams.get('engine') ?? 'tectonic').toBe(engine)
    expect(new URL(response.url()).searchParams.get('main')).toBe(main)
    await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 45_000 })
    const pdf = info.outputPath(id + '.pdf')
    await saveCompiledPdf(page, pdf)
    const text = pdfText(pdf, info.outputDir)
    expect(text).toContain(resultMarker)
    expect(text).toMatch(/Bell System Technical Journal/i)
    expect(text).toContain('Calibration observations by channel.')
    expect(text).not.toMatch(/\((?:author|year)\?\)/i)
    if (id === 'ieee-compsoc' || id === 'plos-one') expect(text.replace(/\s+/g, ' ')).toMatch(/follows Shannon\s*\[1\]/)
    if (id === 'suep-undergraduate' || id === 'sjtu-graduate-word') {
      expect(text).toContain('20260001')
      expect(text).toContain('原创性声明')
      expect(text).toMatch(/使用授权(?:声明|书)/)
    }
    if (id === 'suep-masters' || id === 'ustc-graduate-word' || id === 'scau-undergraduate') {
      expect(text.replace(/\s/g, '')).toContain('20260001')
      expect(text.replace(/\s/g, '')).toContain('原创性声明')
      expect(text.replace(/\s/g, '')).toMatch(/使用授权(?:声明|书)/)
    }
    if (id === 'scau-undergraduate') {
      expect(text).toMatch(/Shannon\s*[（(]1948/)
      expect(text).toMatch(/Chow.*1968/)
    }
    if (id === 'sjtu-graduate-word') {
      const pages = externalTexCommand('pdftotext', ['-layout', pdf, '-'], info.outputDir).split('\f')
        .map(page => page.replace(/\s+/g, ' '))
      const first = pages.findIndex(page => page.includes('The channels were sampled through a common procedure.'))
      const second = pages.findIndex(page => page.includes(resultMarker))
      expect(first).toBeGreaterThanOrEqual(0)
      expect(second).toBeGreaterThan(first)
      expect(pages[first]).toMatch(/上海交通大学硕士学位论文\s+第\s*1\s*章\s+Study design/)
      expect(pages[second]).toMatch(/上海交通大学硕士学位论文\s+第\s*2\s*章\s+Results/)
    }
    const reopenedPage = await verifyJump()
    const saved = await backup(page, info.outputPath(id + '.research-canvas'))
    const { activeTemplate, ...metadata } = saved.project.metadata
    expect(activeTemplate.origin.id).toBe(id)
    expect({ ...saved, project: { ...saved.project, metadata } }).toEqual(original)
    proof[id] = { previewPage, reopenedPage, path: 'sections/study.tex', line: 2, origin: activeTemplate.origin }
  }
  await open.click()
  await dialog.getByRole('button', { name: '切回原模板' }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  await page.getByRole('button', { name: 'Compile PDF', exact: true }).click()
  await expect(page.getByText(/Last successful compile.*Up to date/)).toBeVisible({ timeout: 45_000 })
  proof.originalRestored = { page: await verifyJump(), path: 'sections/study.tex', line: 2 }
  expect(await backup(page, info.outputPath('priority-restored.research-canvas'))).toEqual(original)
  await writeFile(info.outputPath('priority-switch.json'), JSON.stringify(proof, null, 2) + '\n')
})

for (const id of ['sjtu-graduate-word', 'jmlr', 'njupt-academic-masters', 'njupt-humanities-masters', 'njupt-professional-masters', 'agu-jgr-atmospheres'] as const) {
  test(`upgrades and rolls back a published ${id} version with verified source navigation`, async ({ page }, info) => {
    const schools = process.env.RESEARCH_CATALOG_ADDITIONS_FIXTURES
    const journals = process.env.RESEARCH_OFFICIAL_EXPANSION_FIXTURES
    test.skip(acceptance !== '1' || !schools || !journals, 'Requires the verified originals and local TeX.')
    test.setTimeout(300_000)
    const njupt = id.startsWith('njupt-')
    const njuptFixtures = process.env.RESEARCH_NJUPT_SWITCH_FIXTURES
    test.skip(njupt && !njuptFixtures, 'Requires the registered NJUPT originals and declaration.')
    const professional = id === 'njupt-professional-masters'
    const agu = id === 'agu-jgr-atmospheres'
    const word = id !== 'jmlr' && !agu
    const revision = agu ? 'Accepted AGU revision.' : 'Accepted JMLR revision.'
    const baseVersion = njupt ? '2025-05-08' : word ? '2024-07-01' : agu ? '3550522' : 'f413f63'
    const nextVersion = baseVersion + '-switch-qa.1'
    const basename = njupt ? id + '.doc' : word ? 'sjtu.docx' : agu ? id + '.zip' : 'jmlr-pinned.zip'
    const base = await readFile(join(njupt ? njuptFixtures! : word ? schools! : journals!, basename))
    const declaration = njupt && await readFile(join(njuptFixtures!, 'njupt-declaration.doc'))
    if (declaration) await page.route(url => url.pathname === '/api/templates/source' && url.searchParams.get('asset') === 'declaration', route =>
      route.fulfill({ body: declaration, headers: { 'Content-Disposition': 'attachment; filename="njupt-declaration.docx"' } }))
    await page.goto('/research')
    await page.getByLabel('Choose project ZIP or backup').setInputFiles({
      name: 'version-acceptance.research-canvas', mimeType: 'application/zip',
      buffer: await seedProject(study, agu ? results.replace(resultMarker,
        resultMarker + ' The reference note is retained \\citep[for example][p. 381]{shannon1948}.') : results),
    })
    await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
    await page.waitForURL(url => url.searchParams.has('project'))
    await page.getByRole('button', { name: 'Writing', exact: true }).click()
    const projectUrl = page.url()
    const open = page.getByRole('button', { name: '更换模板', exact: true })
    const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
    const selectTemplate = dialog.getByRole('combobox', { name: '目标模板' })
    const versions = dialog.getByRole('combobox', { name: '模板版本' })
    const confirm = dialog.getByRole('button', { name: '设为当前模板', exact: true })
    const current = page.getByLabel('当前编译模板')
    const options = !word ? { name: '官方 ZIP' } : { name: '官方 Word', exact: true }

    async function useBaseline() {
      await dialog.getByText('手动上传官方原件').click()
      await dialog.getByLabel(options.name, { exact: true }).setInputFiles({ name: basename,
        mimeType: word ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/zip', buffer: base })
    }

    async function preview() {
      await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
      await expect(confirm.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 95_000 })
      expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
    }

    async function setCurrent() {
      await confirm.click()
      await expect(dialog).toBeHidden()
    }

    await open.click()
    await selectTemplate.selectOption(id)
    await expect(versions).toHaveValue(baseVersion)
    if (word) {
      await fillZju(dialog, professional ? '专业（领域）' : undefined)
      await dialog.getByLabel('导师英文姓名').fill('Ming Li')
      if (njupt) {
        const humanities = id === 'njupt-humanities-masters'
        if (professional) await dialog.getByLabel('培养类型').selectOption('full-time')
        else await dialog.getByLabel('研究方向').fill('可复现测量')
        await dialog.getByLabel('申请学位类别').fill(professional ? '电子信息硕士' : humanities ? '管理学硕士' : '工学硕士')
        await dialog.getByLabel('学位类别英文全称').fill(professional ? 'Master of Electronic Information' : humanities ? 'Master of Management' : 'Master of Science in Engineering')
      } else await dialog.getByLabel('学院英文全称').fill('School of Engineering')
    } else {
      await dialog.getByLabel('作者单位').fill('Calibration Methods Laboratory')
      if (agu) {
        await dialog.getByLabel('通讯邮箱').fill('casey@example.org')
        await dialog.getByLabel('Key Point').fill('Three channels reproduced the calibration.')
        await dialog.getByLabel('Plain Language Summary').fill('We compared independent measurements against a common reference.')
        await dialog.getByLabel('Open Research Statement').fill('The synthetic acceptance observations are provided in the manuscript.')
      }
    }
    await useBaseline()
    await preview()
    await setCurrent()
    await expect(current).toContainText(baseVersion)
    const submission = page.getByRole('dialog', { name: 'Prepare submission' })
    await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    await submission.getByRole('button', { name: 'Compile submission files', exact: true }).click()
    await expect(submission.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
    if (njupt || agu) {
      const summary = submission.getByText('提交前版式检查', { exact: true })
      if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
      await submission.getByRole('checkbox', { name: agu ? '人工确认 · AGU 投稿阶段人工核对' : '人工确认 · 南邮声明签署', exact: true }).check()
    }
    await submission.getByLabel('Version name').fill('Fixed version before release')
    await submission.getByRole('button', { name: 'Save submission version' }).click()
    await expect(submission.getByText(/^Fixed version before release ·/)).toBeVisible()
    await submission.getByRole('button', { name: 'Close', exact: true }).click()
    const before = await backup(page, info.outputPath('before.research-canvas'))
    const original = before.project.metadata.activeTemplate.origin
    expect(original).toMatchObject({ id, version: baseVersion, sha256: hash(base) })
    expect(before.publication.submissions).toHaveLength(1)
    if (njupt) {
      const report = before.publication.submissions[0].layoutReport
      expect(report.templateOrigin).toEqual(original)
      expect(report.manualReview).toEqual([{ ruleId: 'njupt-declaration-signatures', confirmedAt: expect.any(String) }])
    }

    const changed = await JSZip.loadAsync(base)
    if (word) {
      const path = 'word/document.xml'
      changed.file(path, (await changed.file(path)!.async('string')).replace(/(<w:pgMar\b[^>]*\bw:left=")\d+/g, (_match, prefix: string) => prefix + '1701'))
    } else {
      const path = Object.keys(changed.files).find(path => path.endsWith(agu ? '/agujournal2025.cls' : '/jmlr2e.sty'))!
      const style = await changed.file(path)!.async('string')
      changed.file(path, '\\AtEndDocument{\\par\\noindent ' + revision + '\\par}\n' + style)
    }
    const bytes = await changed.generateAsync({ type: 'nodebuffer' })
    const digest = hash(bytes)
    await page.goto(templateCard(word ? 'school' : 'journal', id))
    await manageOfficialVersion(page)
    const candidate = page.getByRole('dialog', { name: '验收模板候选' })
    await candidate.getByLabel('候选版本号').fill(nextVersion)
    if (word) {
      await candidate.getByLabel('Word 样例').setInputFiles({ name: 'candidate.docx', mimeType: 'application/octet-stream', buffer: bytes })
      await candidate.getByRole('button', { name: '生成版式配置' }).click()
      if (professional) {
        const left = candidate.getByLabel('左边距（mm）')
        await expect(left).toBeVisible({ timeout: 35_000 })
        const row = left.locator('xpath=../..')
        await row.getByRole('button', { name: '采用样例' }).click()
        const remaining = candidate.getByText('样例与规范不一致，请选择', { exact: true }).locator('..')
        while (await remaining.count()) await remaining.first().getByRole('button', { name: '采用规范' }).click()
      }
      await expect(candidate.getByLabel('左边距（mm）')).toHaveValue('30', { timeout: 35_000 })
      await candidate.getByRole('button', { name: '编译 PDF 预览' }).click()
      await expect(candidate.getByRole('link', { name: '下载预览 PDF' })).toBeVisible({ timeout: 60_000 })
    } else {
      await candidate.getByLabel('候选官方 ZIP').setInputFiles({ name: 'candidate.zip', mimeType: 'application/zip', buffer: bytes })
      await candidate.getByRole('button', { name: '编译候选' }).click()
      await expect(candidate.getByRole('link', { name: '查看候选 PDF' })).toBeVisible({ timeout: 60_000 })
    }
    await candidate.getByRole('button', { name: '发布新版本' }).click()
    if (!word) {
      const confirmation = page.getByRole('alertdialog', { name: '确认发布模板版本' })
      await page.route(url => url.pathname === '/api/latex/compile' && url.searchParams.get('sync') === '1',
        route => route.fulfill({ status: 422, json: { error: 'QA rejected publication acceptance compile' } }), { times: 1 })
      await confirmation.getByRole('button', { name: '确认发布', exact: true }).click()
      await expect(confirmation.getByRole('alert')).toContainText('QA rejected publication acceptance compile', { timeout: 60_000 })
      await expect(page.getByText('当前发布版 ' + baseVersion, { exact: true })).toBeVisible()
    }
    await confirmTemplatePublication(page, nextVersion, baseVersion)
    await expect(page.getByText('已通过独立稿编译和双向定位验收。', { exact: true })).toBeVisible()

    if (agu || professional) await reviewArchive(page, projectUrl, 'Fixed version before release', id + ' · ' + baseVersion)
    else await page.goto(projectUrl)
    await expect(current).toContainText(baseVersion)
    await compileProject(page)
    let upstreamRequests = 0
    await page.route('**/api/templates/source?**', async route => {
      if (new URL(route.request().url()).searchParams.get('asset') === 'declaration') return route.fallback()
      upstreamRequests++
      await route.fulfill({ status: 503, json: { error: 'QA unavailable upstream' } })
    })
    await open.click()
    await expect(versions).toHaveValue(baseVersion)
    await versions.selectOption(nextVersion)
    await expect(dialog.getByText('SHA-256 ' + digest, { exact: true })).toBeVisible()

    const compileUrl = '**/api/latex/compile?**'
    await page.route(compileUrl, route => route.fulfill({ status: 422, json: { error: 'QA preview compile rejected' } }), { times: 1 })
    await dialog.getByRole('button', { name: '编译预览', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('QA preview compile rejected', { timeout: 45_000 })
    await expect(confirm).toHaveCount(0)
    await preview()
    await dialog.getByRole('button', { name: '定位正文' }).click()
    await expect(dialog.getByRole('status').filter({ hasText: /sections\/study\.tex:\d+ · PDF/ })).toBeVisible()
    const download = page.waitForEvent('download')
    await dialog.getByRole('link', { name: '下载 LaTeX 源包' }).click()
    const source = info.outputPath('upgraded.zip')
    await (await download).saveAs(source)
    if (word) {
      const rendered = await JSZip.loadAsync(await readFile(source))
      const tex = await rendered.file('main.tex')!.async('string')
      expect(tex).toContain('left=30mm')
      if (professional) expect(tex).toMatch(/headsep=5(?:\.0+)?mm/)
    }
    await setCurrent()
    await expect(current).toContainText(nextVersion)
    await page.reload()
    await expect(current).toContainText(nextVersion)
    await compileProject(page)
    const upgradedPdf = info.outputPath('upgraded.pdf')
    await saveCompiledPdf(page, upgradedPdf)
    if (!word) {
      const text = pdfText(upgradedPdf, info.outputDir)
      expect(text).toContain(revision)
      if (agu) {
        for (const marker of ['Key Points', 'Plain Language Summary', 'Open Research Statement', 'Shannon', '1948',
          'Dependence Trees', 'Calibration observations by channel.', 'Independent observation counts.',
          'See Section 1, Figure 1, and Table 1.', 'for example', 'p. 381']) expect(text.toLowerCase()).toContain(marker.toLowerCase())
      }
    }
    if (njupt) {
      const pages = externalTexCommand('pdftotext', ['-layout', upgradedPdf, '-'], info.outputDir).split('\f')
      const compact = (page: string) => page.replace(/\s+/g, '')
      expect(compact(pages[0])).toContain('20260001')
      expect(compact(pages[0])).toContain(professional ? '全日制' : '可复现测量')
      if (professional) expect(compact(pages[0])).toContain('电子信息硕士')
      expect(pages[1]).toContain(professional ? 'Master of Electronic Information' : id === 'njupt-humanities-masters' ? 'Master of Management' : 'Master of Science in Engineering')
      expect(compact(pages[2])).toContain('南京邮电大学学位论文原创性声明')
      expect(compact(pages[2])).toContain('南京邮电大学学位论文使用授权声明')
      expect(pages.join(' ')).toContain('Bell System Technical Journal')
      expect(compact(pages.join(' '))).toContain(professional ? '图2.1' : '图2-1')
      expect(compact(pages.join(' '))).toContain(professional ? '表2.1' : '表2-1')
    }
    expect(upstreamRequests).toBe(0)

    const nav = page.getByRole('complementary', { name: 'Project navigation' })
    const sentence = 'The channels were sampled through a common procedure.'
    await nav.getByRole('button', { name: 'Search', exact: true }).click()
    const search = nav.getByRole('region', { name: 'Project source search' })
    await search.getByLabel('Search project source').fill(sentence)
    await search.getByRole('button').filter({ hasText: 'study.tex:2' }).click()
    await page.getByRole('textbox', { name: 'Project source editor' }).press('Home')
    await nav.getByRole('button', { name: 'Files', exact: true }).click()
    await page.getByRole('button', { name: 'Show in PDF', exact: true }).click()
    const pdf = page.getByRole('region', { name: 'PDF Preview', exact: true })
    const forward = pdf.getByText(/^Source line 2 · PDF page \d+$/)
    await expect(forward).toBeVisible()
    const pdfPage = Number((await forward.innerText()).split(' ').at(-1))
    const text = pdf.getByRole('region', { name: 'Compiled PDF, page ' + pdfPage }).getByText(sentence, { exact: true })
    await expect(text).toBeVisible()
    await nav.getByTitle('main.tex', { exact: true }).click()
    const box = (await text.boundingBox())!
    await text.click({ position: { x: 12, y: box.height / 2 } })
    await expect(pdf.getByText('sections/study.tex:2', { exact: true })).toBeVisible()
    const upgraded = await backup(page, info.outputPath('upgraded.research-canvas'))
    const { activeTemplate, ...metadata } = upgraded.project.metadata
    expect(activeTemplate.origin).toEqual({ id, version: nextVersion, sha256: digest })
    expect({ ...upgraded, project: { ...upgraded.project, metadata } }).toEqual({
      ...before, project: { ...before.project, metadata: { ...before.project.metadata, activeTemplate: undefined } },
    })

    await open.click()
    await expect(versions).toHaveValue(nextVersion)
    await versions.selectOption(baseVersion)
    await useBaseline()
    await preview()
    await setCurrent()
    await page.reload()
    await expect(current).toContainText(baseVersion)
    const reverted = await backup(page, info.outputPath('rolled-back.research-canvas'))
    expect(reverted.project.metadata.activeTemplate.origin).toEqual(original)
    expect(reverted.files).toEqual(before.files)
    expect(reverted.publication).toEqual(before.publication)
    await compileProject(page)
    await open.click()
    await dialog.getByRole('button', { name: '切回原模板' }).click()
    await expect(dialog).toBeHidden()
    await compileProject(page)
    await writeFile(info.outputPath('version-acceptance.json'), JSON.stringify({
      original, upgraded: activeTemplate.origin, preUpgradeArchive: before.publication.submissions[0],
      archivedAttachments: Object.fromEntries(Object.entries(before.files).filter(([path]) => path.startsWith('history/submissions/'))),
      jump: { path: 'sections/study.tex', line: 2, pdfPage }, previewFailureKeptProject: true,
      snapshotAndAttachmentsIdentical: true, reopenedWithoutOfficialRequests: upstreamRequests === 0,
      rolledBackToBaselineAndOriginal: true,
    }, null, 2) + '\n')
  })
}

test('reports a nonportable source command without changing the original compiler or project', async ({ page }, info) => {
  test.skip(acceptance !== '1', 'Requires local pdfLaTeX.')
  const source = study + '\\parbox{30mm}{An original layout block.}\n'
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: 'command-acceptance.research-canvas', mimeType: 'application/zip', buffer: await seedProject(source),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  await compileProject(page)
  const before = await backup(page, info.outputPath('before.research-canvas'))
  await page.getByRole('button', { name: '更换模板', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
  const alert = dialog.getByRole('alert')
  await expect(alert).toContainText('sections/study.tex:7')
  await expect(alert).toContainText('\\parbox')
  await expect(dialog.getByRole('button', { name: '设为当前模板', exact: true })).toHaveCount(0)
  await dialog.press('Escape')
  await expect(dialog).toBeHidden()
  await compileProject(page)
  expect(await backup(page, info.outputPath('after.research-canvas'))).toEqual(before)
})

test('returns a real MIT build and restores exact PDF jumps without changing the project', async ({ page }, info) => {
  const fixtures = process.env.RESEARCH_UNIFIED_TEMPLATE_FIXTURES
  test.skip(acceptance !== '1' || !fixtures, 'Requires the pinned MIT ZIP and real LuaLaTeX/Biber.')
  test.setTimeout(260_000)
  await page.goto('/research')
  await page.getByLabel('Choose project ZIP or backup').setInputFiles({
    name: name + '.research-canvas', mimeType: 'application/zip', buffer: await seedProject(),
  })
  await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
  await page.waitForURL(url => url.searchParams.has('project'))
  await page.getByRole('button', { name: 'Writing', exact: true }).click()
  const original = await backup(page, info.outputPath('original.research-canvas'))
  const open = page.getByRole('button', { name: '更换模板', exact: true })
  const dialog = page.getByRole('dialog', { name: '更换模板', exact: true })
  const current = page.getByLabel('当前编译模板')
  const select = dialog.getByRole('combobox', { name: '目标模板' })
  const start = dialog.getByRole('button', { name: '准备外部编译源包' })
  const attach = dialog.getByRole('button', { name: '核验并预览外部 PDF' })
  const activate = dialog.getByRole('button', { name: '设为当前模板' })
  const zipLink = dialog.getByRole('link', { name: '下载外部编译源包' })
  await open.click()
  await select.selectOption('mit-thesis')
  for (const [label, value] of [
    ['MIT Department', 'Department of Electrical Engineering and Computer Science'],
    ['Degree name', 'Master of Science in Electrical Engineering and Computer Science'],
    ['Thesis supervisor name', 'Ming Li'], ['Thesis supervisor title', 'Professor of Engineering'],
    ['Departmental acceptor name', 'Avery Chen'], ['Departmental acceptor title', 'Professor of Engineering'],
    ['Departmental acceptor role', 'Graduate Officer'], ['Degree month and year', 'May 2027'],
    ['Thesis submission date', 'November 26, 2026'],
  ]) await dialog.getByLabel(label, { exact: true }).fill(value)
  await dialog.getByText('手动上传官方原件').click()
  await dialog.getByLabel('官方 ZIP').setInputFiles(join(fixtures!, 'mit-thesis.zip'))
  await start.click()
  await expect(zipLink.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 45_000 })
  expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
  const [download] = await Promise.all([page.waitForEvent('download'), zipLink.click()])
  const bundle = info.outputPath('mit-external.zip')
  await download.saveAs(bundle)
  const directory = info.outputPath('mit-local')
  const contents = await JSZip.loadAsync(await readFile(bundle))
  for (const item of Object.values(contents.files)) {
    if (item.dir) continue
    const path = join(directory, item.name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await item.async('nodebuffer'))
  }
  const main = join(directory, 'main.tex')
  const source = await readFile(main)
  await writeFile(main, Buffer.concat([source, Buffer.from('\n% Changed after export\n')]))
  expect(() => externalTexCommand('node', ['compile-mit.mjs'], directory)).toThrow(/Exported file changed: main.tex/)
  await writeFile(main, source)
  const log = externalTexCommand('node', ['compile-mit.mjs'], directory)
  await writeFile(info.outputPath('external-build.log'), log)
  const pdf = join(directory, 'workbench-preview.pdf')
  const sync = join(directory, 'workbench-preview.synctex.gz')
  const receipt = join(directory, 'workbench-result.json')
  const text = pdfText(pdf, directory)
  expect(text).toContain('MASSACHUSETTS INSTITUTE OF TECHNOLOGY')
  expect(text).toContain('Ming Li')
  for (const marker of [title, 'Study design', 'Observation protocol', 'Calibration observations by channel.',
    'Independent observation counts.', 'Bell System Technical Journal', 'Dependence Trees']) expect(text).toContain(marker)
  await dialog.getByLabel('外部编译 PDF', { exact: true }).setInputFiles(pdf)
  const unrelatedSync = Buffer.concat([await readFile(sync), Buffer.from('other-build')])
  await dialog.getByLabel('外部编译 SyncTeX', { exact: true }).setInputFiles({
    name: 'workbench-preview.synctex.gz', mimeType: 'application/gzip', buffer: unrelatedSync,
  })
  await dialog.getByLabel('外部编译记录', { exact: true }).setInputFiles(receipt)
  await attach.click()
  await expect(dialog.getByRole('alert')).toContainText('PDF 或 SyncTeX 与编译记录不匹配')
  await expect(activate).toHaveCount(0)
  await dialog.getByLabel('外部编译 SyncTeX', { exact: true }).setInputFiles(sync)
  await attach.click()
  await expect(activate.or(dialog.getByRole('alert'))).toBeVisible({ timeout: 45_000 })
  expect(await dialog.getByRole('alert').allTextContents()).toEqual([])
  await activate.click()
  await expect(dialog).toBeHidden()
  await expect(current).toContainText('MIT Thesis · 1.24')

  const preview = page.getByRole('region', { name: 'PDF Preview', exact: true })
  const nav = page.getByRole('complementary', { name: 'Project navigation' })
  const sentence = 'The channels were sampled through a common procedure.'
  const status = preview.getByText(/^Source line 2 · PDF page \d+$/)
  const compile = page.getByRole('button', { name: 'Compile PDF', exact: true })
  await page.reload()
  await expect(current).toContainText('MIT Thesis · 1.24')
  await compile.click()
  await expect(preview.getByRole('link', { name: 'Download PDF' })).toBeVisible()
  await nav.getByRole('button', { name: 'Search', exact: true }).click()
  await nav.getByLabel('Search project source').fill(sentence)
  await nav.getByRole('button').filter({ hasText: 'study.tex:2' }).click()
  await page.getByRole('textbox', { name: 'Project source editor' }).press('Home')
  await nav.getByRole('button', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Show in PDF', exact: true }).click()
  await expect(status).toBeVisible()
  const pdfPage = Number((await status.innerText()).split(' ').at(-1))
  const target = preview.getByRole('region', { name: 'Compiled PDF, page ' + pdfPage }).getByText(sentence, { exact: true })
  await expect(target).toBeVisible()
  await nav.getByTitle('main.tex', { exact: true }).click()
  const textBox = (await target.boundingBox())!
  await target.click({ position: { x: 12, y: textBox.height / 2 } })
  await expect(preview.getByText('sections/study.tex:2', { exact: true })).toBeVisible()

  await replaceProjectSource(page, 'sections/study.tex', study.replace('common procedure', 'changed procedure'))
  await compile.click()
  await expect(dialog).toBeVisible()
  await expect(select).toHaveValue('mit-thesis')
  await start.click()
  await expect(zipLink).toBeVisible()
  await dialog.getByLabel('外部编译 PDF', { exact: true }).setInputFiles(pdf)
  await dialog.getByLabel('外部编译 SyncTeX', { exact: true }).setInputFiles(sync)
  await dialog.getByLabel('外部编译记录', { exact: true }).setInputFiles(receipt)
  await attach.click()
  await expect(dialog.getByRole('alert')).toContainText('编译记录与本次源包不匹配')
  await expect(activate).toHaveCount(0)
  await dialog.getByRole('button', { name: '切回原模板' }).click()
  await expect(dialog).toBeHidden()
  await expect(current).toHaveCount(0)
  await replaceProjectSource(page, 'sections/study.tex', study)
  await compileProject(page)
  const restored = await backup(page, info.outputPath('restored.research-canvas'))
  expect(restored).toEqual(original)
  await writeFile(info.outputPath('acceptance.json'), JSON.stringify({ pdfSha256: hash(await readFile(pdf)),
    syncSha256: hash(await readFile(sync)), pdfPage, sourcePath: 'sections/study.tex', line: 2, originalRestored: true }, null, 2))
})

for (const school of [
  { id: 'suep-masters', word: 'suep-masters.doc', label: '上电硕士声明签署', pending: '上电硕士院系与送审要求', source: 'https://yjsc.shiep.edu.cn/7e/07/c955a228871/page.htm' },
  { id: 'ustc-graduate-word', word: 'ustc-graduate-word.docx', label: '中科大 AI 使用声明', pending: '中科大声明签署', source: 'https://gradschool.ustc.edu.cn/static/upload/article/file/1779088544462/1779088544462-671405.pdf' },
]) {
  test('archives explicit author confirmation for ' + school.id, async ({ page }, info) => {
    const originals = process.env.RESEARCH_UNIFIED_TEMPLATE_FIXTURES
    test.skip(acceptance !== '1' || !originals, 'Requires verified graduate templates and real XeLaTeX.')
    test.setTimeout(180_000)
    await page.goto('/research')
    await page.getByLabel('Choose project ZIP or backup').setInputFiles({
      name: name + '.research-canvas', mimeType: 'application/zip', buffer: await seedProject(),
    })
    await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
    await page.waitForURL(url => url.searchParams.has('project'))
    await page.getByRole('button', { name: 'Writing', exact: true }).click()
    const editor = page.url()
    await page.getByRole('button', { name: '更换模板', exact: true }).click()
    const switcher = page.getByRole('dialog', { name: '更换模板' })
    await switcher.getByRole('combobox', { name: '目标模板' }).selectOption(school.id)
    const version = await switcher.getByRole('combobox', { name: '模板版本' }).inputValue()
    await fillZju(switcher)
    await switcher.getByLabel('培养类型').selectOption('academic')
    if (school.id === 'ustc-graduate-word') {
      await switcher.getByLabel('学位（硕士或博士）').fill('硕士')
      await switcher.getByLabel('导师英文姓名').fill('Ming Li')
      await switcher.getByLabel('学院英文全称').fill('School of Engineering')
      await switcher.getByLabel('学科专业英文全称').fill('Electrical Engineering')
      await switcher.getByLabel('研究方向').fill('Calibration methods')
    } else await switcher.getByLabel('申请学位类别').fill('工学硕士')
    await switcher.getByText('手动上传官方原件').click()
    await switcher.getByLabel('官方 Word', { exact: true }).setInputFiles(join(originals!, school.word))
    await switcher.getByRole('button', { name: '编译预览', exact: true }).click()
    await switcher.getByRole('button', { name: '设为当前模板' }).click({ timeout: 75_000 })
    await expect(switcher).toBeHidden()
    await page.getByRole('button', { name: 'Prepare submission', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
    await dialog.getByRole('button', { name: 'Compile submission files' }).click()
    await expect(dialog.getByRole('button', { name: 'Download submission PDF' })).toBeVisible({ timeout: 60_000 })
    const summary = dialog.getByText('提交前版式检查', { exact: true })
    if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await summary.click()
    const choice = dialog.getByRole('checkbox', { name: '人工确认 · ' + school.label, exact: true })
    await expect(choice).not.toBeChecked()
    await choice.check()
    await dialog.getByLabel('Version name').fill('Graduate manual checks')
    await dialog.getByRole('button', { name: 'Save submission version' }).click()
    await expect(dialog.getByText(/^Graduate manual checks ·/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await reviewArchive(page, editor, 'Graduate manual checks', school.id + ' · ' + version, async report => {
      const row = report.getByRole('listitem').filter({ hasText: school.label })
      await expect(row).toContainText(/归档前已人工核对 · .+/)
      await expect(row.getByRole('link', { name: '查看规则来源' })).toHaveAttribute('href', school.source)
      await expect(report.getByRole('listitem').filter({ hasText: school.pending })).toContainText('待人工核对')
    })
    const data = await backup(page, info.outputPath('manual-checks.research-canvas'))
    const report = data.publication.submissions[0].layoutReport
    expect(report.templateOrigin.id).toBe(school.id)
    expect(report.manualReview).toHaveLength(1)
    await writeFile(info.outputPath('manual-review.json'), JSON.stringify(report, null, 2))
  })
}

type Delivery = {
  stage: string
  buildId: string
  snapshotSha256: string
  entry: string
  engine: string
  attachmentSha256?: string
}

async function readDelivery(page: Page, button: Locator, output: string, stage: string, archived = false) {
  const download = page.waitForEvent('download')
  await button.click()
  const path = join(output, stage + (archived ? '-archived' : '') + '-delivery.zip')
  await (await download).saveAs(path)
  const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true })
  const pdf = await zip.file('manuscript.pdf')!.async('nodebuffer')
  const source = await zip.file('source.zip')!.async('nodebuffer')
  const json = await zip.file('report.json')!.async('string')
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  const report = JSON.parse(json) as import('../../src/lib/project/submission-layout').SubmissionLayout & { delivery: Delivery }
  expect(report.delivery.stage).toBe(stage)
  expect(report.delivery.snapshotSha256).toMatch(/^[a-f0-9]{64}$/)
  const attachmentHashes: Record<string, string> = {}
  for (const [index, item] of (report.materials ?? []).entries()) {
    const path = submissionMaterialPath(item, index)
    const bytes = await zip.file(path)!.async('nodebuffer')
    expect(bytes.length).toBe(item.bytes)
    expect(hash(bytes)).toBe(item.sha256)
    attachmentHashes[path] = hash(bytes)
  }
  expect(manifest).toEqual({ ...report.delivery, template: report.templateOrigin,
    files: { 'manuscript.pdf': hash(pdf), 'source.zip': hash(source), 'report.json': hash(json), ...attachmentHashes } })
  expect(report.pdfChecksum).toBe(hash(pdf))
  expect(report.sourceChecksum).toBe(hash(source))
  if (!archived) {
    await writeFile(join(output, stage + '.pdf'), pdf)
    await writeFile(join(output, stage + '-source.zip'), source)
    await writeFile(join(output, stage + '-report.json'), json)
    const clean = join(output, stage + '-clean')
    const sourceZip = await JSZip.loadAsync(source, { checkCRC32: true })
    expect(sourceZip.file('figures/channels.png')).toBeTruthy()
    expect(sourceZip.file('refs/measurement.bib')).toBeTruthy()
    expect(sourceZip.file('BUILD.md')).toBeTruthy()
    expect(sourceZip.file(report.delivery.entry)).toBeTruthy()
    for (const file of Object.values(sourceZip.files)) {
      if (!file.dir) {
        const destination = join(clean, file.name)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, await file.async('nodebuffer'))
      }
    }
    externalTexCommand('latexmk', ['-norc', report.delivery.engine === 'xelatex' ? '-xelatex' : '-pdf',
      '-latexoption=-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode', report.delivery.entry], clean)
    const filename = report.delivery.entry.replace(/\.tex$/i, '.pdf')
    const text = pdfText(join(output, stage + '.pdf'), output)
    const rebuilt = pdfText(join(clean, filename), clean)
    expect(rebuilt).toEqual(text)
    expect(text).toContain(resultMarker)
    expect(text).toContain('Calibration observations by channel.')
    expect(text).toContain('Independent observation counts.')
    expect(text).toContain('Shannon')
  }
  return { report, pdf: hash(pdf), source: hash(source), reportDigest: hash(json) }
}

for (const pilot of ['njupt', 'agu'] as const) {
  test('validates ' + pilot + ' submission stage delivery and archival against the original build', async ({ page }, info) => {
    const fixtures = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES
    test.skip(acceptance !== '1' || !fixtures, 'Requires pinned originals, loopback compile and an external TeX installation.')
    test.setTimeout(300_000)
    const output = info.outputPath('delivery')
    await mkdir(output, { recursive: true })
    const njupt = pilot === 'njupt'
    const id = njupt ? 'njupt-professional-masters' : 'agu-jgr-atmospheres'
    const originalResults = njupt ? results + '\n\\section*{Acknowledgments}\nCasey Lin thanks the instrumentation team.\n' : results
    await page.goto('/research')
    await page.getByLabel('Choose project ZIP or backup').setInputFiles({
      name: 'submission-stage.research-canvas', mimeType: 'application/zip', buffer: await seedProject(study, originalResults),
    })
    await page.getByRole('button', { name: 'Import as new project', exact: true }).click()
    await page.waitForURL(url => url.searchParams.has('project'))
    await page.getByRole('button', { name: 'Writing', exact: true }).click()
    await page.getByRole('button', { name: '更换模板', exact: true }).click()
    const template = page.getByRole('dialog', { name: '更换模板', exact: true })
    await template.getByRole('combobox', { name: '目标模板' }).selectOption(id)
    if (njupt) {
      await fillZju(template, '专业（领域）')
      await template.getByLabel('导师英文姓名').fill('Ming Li')
      await template.getByLabel('培养类型').selectOption('full-time')
      await template.getByLabel('申请学位类别').fill('电子信息硕士')
      await template.getByLabel('学位类别英文全称').fill('Master of Electronic Information')
    } else {
      await template.getByLabel('作者单位').fill('Calibration Methods Laboratory')
      await template.getByLabel('通讯邮箱').fill('casey@example.org')
      await template.getByLabel('Key Point').fill('Three channels reproduced the calibration.')
      await template.getByLabel('第二条要点（选填）').fill('A fixed sampling interval was used across measurements.')
      await template.getByLabel('第三条要点（选填）').fill('Independent observations supported the measurement results.')
      await template.getByLabel('Plain Language Summary').fill('We compared independent measurements against a common reference.')
      await template.getByLabel('Open Research Statement').fill('The synthetic acceptance observations are provided in the manuscript.')
    }
    await template.getByRole('button', { name: '编译预览', exact: true }).click()
    const apply = template.getByRole('button', { name: '设为当前模板', exact: true })
    await expect(apply.or(template.getByRole('alert'))).toBeVisible({ timeout: 95_000 })
    expect(await template.getByRole('alert').allTextContents()).toEqual([])
    await apply.click()
    await expect(template).toBeHidden()
    const projectUrl = page.url()
    await writeFile(join(output, 'project-url.txt'), projectUrl + '\n')

    const open = page.getByRole('button', { name: 'Prepare submission', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Prepare submission' })
    const choose = dialog.getByRole('combobox', { name: '提交阶段' })
    const download = dialog.getByRole('button', { name: '下载交付包', exact: true })
    const compile = dialog.getByRole('button', { name: 'Compile submission files' })
    const archive = dialog.getByRole('region', { name: 'Archived submissions' })
    const close = () => dialog.getByRole('button', { name: 'Close', exact: true }).click()
    const first = njupt ? 'njupt-blind' : 'agu-initial'
    const second = njupt ? 'njupt-deposit' : 'agu-revision'
    const legacyTitle = njupt ? 'Verified blind review submission' : 'Verified initial AGU submission'
    const secondTitle = njupt ? 'Verified formal deposit' : 'Verified revised AGU submission'
    async function save(name: string) {
      await dialog.getByLabel('Version name').fill(name)
      await dialog.getByRole('button', { name: 'Save submission version' }).click()
      await expect(archive.getByText(new RegExp('^' + name + ' ·'))).toBeVisible()
    }
    async function verifyArchive(name: string, stage: string, expected: Awaited<ReturnType<typeof readDelivery>>) {
      const details = archive.getByText(new RegExp('^' + name + ' ·')).locator('..')
      if (await details.getAttribute('open') === null) await details.locator('summary').first().click()
      await details.getByRole('button', { name: '复查归档版式报告' }).click()
      const report = details.getByRole('region', { name: '归档版式报告' })
      await expect(report).toContainText('原 PDF 和源包校验通过')
      await expect(report).toContainText(expected.report.delivery.snapshotSha256)
      await expect(report).toContainText(expected.report.templateOrigin!.sha256)
      expect(await readDelivery(page, report.getByRole('button', { name: '下载归档交付包' }), output, stage, true)).toEqual(expected)
    }
    async function compileAndInspect() {
      const response = page.waitForResponse(match => match.url().includes('/api/latex/compile?') && match.request().method() === 'POST')
      await compile.click()
      await expect(download.or(dialog.getByRole('alert')).or(dialog.getByText('Compilation failed', { exact: true }))).toBeVisible({ timeout: 110_000 })
      const error = await dialog.getByRole('alert').allTextContents()
      const log = await dialog.getByText('Compiler output', { exact: true }).locator('..').allTextContents()
      expect(await download.count(), [...error, ...log].join('\n')).toBe(1)
      const completed = await response
      expect(completed.ok()).toBe(true)
      const compiledSource = completed.request().postDataBuffer()
      expect(compiledSource).not.toBeNull()
      const summary = dialog.getByText('提交前版式检查', { exact: true })
      if (await summary.locator('..').getAttribute('open') === null) await summary.click()
      return hash(compiledSource!)
    }

    await open.click()
    await choose.selectOption(first)
    const firstCompileSha = await compileAndInspect()
    const confirmRule = njupt ? '图表、成果及隐藏身份信息' : '初投稿系统信息'
    await dialog.getByRole('checkbox', { name: '人工确认 · ' + confirmRule, exact: true }).check()
    const initial = await readDelivery(page, download, output, first)
    expect(initial.source).toBe(firstCompileSha)
    const finding = (delivery: typeof initial, rule: string) => delivery.report.findings.find(row => row.ruleId === rule)?.status
    for (const rule of njupt ? ['blind-cover', 'blind-front', 'blind-identities'] : ['agu-key-points', 'agu-plain-language', 'agu-open-research', 'agu-initial-line-numbers']) {
      expect(finding(initial, rule), rule).toBe('pass')
    }
    expect(initial.report.manualReview).toEqual([{ ruleId: njupt ? 'blind-assets' : 'agu-initial-form', confirmedAt: expect.any(String) }])
    if (njupt) {
      expect(initial.report.delivery.attachmentSha256).toBe(hash(await readFile(join(fixtures!, 'njupt-blind-cover.doc'))))
      const cover = pdfText(join(output, first + '.pdf'), output)
      expect(cover.replace(/\s/g, '')).toContain('专业学位硕士论文')
      for (const secret of ['Casey Lin', '20260001', 'Ming Li', '原创性声明', '使用授权声明', 'instrumentation team',
        'Thesis Submitted to Nanjing University']) expect(cover).not.toContain(secret)
      const rendered = await JSZip.loadAsync(await readFile(join(output, first + '-source.zip')))
      expect(rendered.file('template-front/declaration.pdf')).toBeNull()
      expect(await rendered.file(initial.report.delivery.entry)!.async('string')).not.toMatch(/Casey Lin|20260001|Acknowledgments/)
    }
    await save(legacyTitle)
    await close()

    const marker = 'This paragraph belongs to the revised manuscript only.'
    await replaceProjectSource(page, 'sections/study.tex', study + '\n' + marker + '\n')
    await expect(page.getByText(/1 local draft/)).toBeVisible()
    await open.click()
    await expect(dialog.getByText(/稿件已修改。请重新编译/)).toBeVisible()
    await expect(download).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Save submission version' })).toHaveCount(0)
    await verifyArchive(legacyTitle, first, initial)
    await choose.selectOption(second)
    await dialog.getByRole('radio', { name: /Include local drafts/ }).check()
    const secondCompileSha = await compileAndInspect()
    const revised = await readDelivery(page, download, output, second)
    expect(revised.source).toBe(secondCompileSha)
    expect(revised.report.delivery.buildId).not.toBe(initial.report.delivery.buildId)
    expect(revised.report.delivery.snapshotSha256).not.toBe(initial.report.delivery.snapshotSha256)
    expect(revised.report.templateOrigin).toEqual(initial.report.templateOrigin)
    expect(revised.report.confirmed).toEqual([])
    expect(pdfText(join(output, second + '.pdf'), output)).toContain(marker)
    expect(pdfText(join(output, first + '.pdf'), output)).not.toContain(marker)
    if (njupt) {
      expect(finding(revised, 'deposit-title')).toBe('pass')
      expect(finding(revised, 'deposit-declaration')).toBe('pass')
      expect(finding(revised, 'deposit-signatures')).toBe('manual')
      expect(pdfText(join(output, second + '.pdf'), output)).toContain('Casey Lin')
    } else {
      expect(finding(revised, 'agu-clean-revision')).toBe('pass')
      expect(finding(revised, 'agu-marked-version')).toBe('manual')
      expect(finding(revised, 'agu-review-response')).toBe('manual')
      expect(finding(revised, 'agu-revision-figures')).toBe('manual')
    }
    const formal = dialog.getByRole('region', { name: '正式提交材料' })
    const local = dialog.getByRole('region', { name: '本地核验材料' })
    await expect(local.getByRole('button', { name: '下载交付包' })).toBeVisible()
    let updated: typeof revised | undefined
    const replacementArchive = 'Verified AGU replacement attachment'
    if (njupt) {
      const fonts = revised.report.findings.find(item => item.ruleId === 'deposit-embedded-fonts')
      expect(fonts?.page).toBeGreaterThan(1)
      expect(fonts?.observed).toMatch(/TimesNewRoman/)
      expect(fonts?.status).toMatch(/pass|issue/)
      if (process.env.RESEARCH_NJUPT_REQUIRE_DEPOSIT_FONTS === '1') expect(fonts?.status, fonts?.detail).toBe('pass')
      if (fonts?.status === 'issue') await expect(formal).toContainText('材料待核对')
      await expect(formal.getByRole('button', { name: '下载稿件 PDF' })).toBeVisible()
      await formal.getByLabel('正式归档 Word').setInputFiles(join(fixtures!, 'independent.docx'))
      await expect(formal.getByRole('button', { name: 'independent.docx' })).toBeVisible()
      await dialog.getByRole('checkbox', { name: '人工确认 · 学校系统和图书馆交稿' }).check()
    } else {
      await expect(formal.getByRole('button', { name: '下载清洁版 LaTeX 源包' })).toBeVisible()
      const payload = await readFile(join(output, first + '.pdf'))
      for (const [label, filename] of [['修订痕迹对照稿', 'tracked.pdf'], ['逐条回复审稿意见', 'response.pdf'], ['修回图件（有图时）', 'figure.pdf']]) {
        await formal.getByLabel(label, { exact: true }).setInputFiles({ name: filename, mimeType: 'application/pdf', buffer: payload })
        await expect(formal.getByRole('button', { name: filename, exact: true })).toBeVisible()
        await dialog.getByRole('checkbox', { name: '人工确认 · ' + label.replace('（有图时）', ''), exact: true }).check()
      }
    }
    const attachmentOutput = join(output, 'with-attachments')
    await mkdir(attachmentOutput, { recursive: true })
    const attached = await readDelivery(page, download, attachmentOutput, second, true)
    expect(attached.source).toBe(revised.source)
    expect(attached.report.materials?.length).toBe(njupt ? 1 : 3)
    await save(secondTitle)
    if (!njupt) {
      const responseCheck = dialog.getByRole('checkbox', { name: '人工确认 · 逐条回复审稿意见', exact: true })
      const payload = await readFile(join(output, second + '.pdf'))
      await formal.getByLabel('逐条回复审稿意见', { exact: true }).setInputFiles({ name: 'response.pdf', mimeType: 'application/pdf', buffer: payload })
      await expect(responseCheck).not.toBeChecked()
      await expect(dialog.getByRole('checkbox', { name: '人工确认 · 修订痕迹对照稿', exact: true })).toBeChecked()
      const replacement = join(output, 'replacement')
      await mkdir(replacement, { recursive: true })
      updated = await readDelivery(page, download, replacement, second, true)
      expect(updated.report.delivery).toEqual(attached.report.delivery)
      expect(updated.report.materials?.find(item => item.slot === 'response')?.sha256).toBe(hash(payload))
      expect(updated.report.materials?.find(item => item.slot === 'response')?.sha256).not.toBe(attached.report.materials?.find(item => item.slot === 'response')?.sha256)
      await save(replacementArchive)
    }
    await close()
    await page.goto(projectUrl)
    await open.click()
    await verifyArchive(secondTitle, second, attached)
    if (updated) {
      await verifyArchive(replacementArchive, second, updated)
      await expect(dialog.getByRole('region', { name: '归档附件' })).toContainText('response.pdf')
    }
    await verifyArchive(legacyTitle, first, initial)
    await close()
    const proof = await backup(page, join(output, 'demo-project.research-canvas'))
    expect(proof.publication.submissions).toHaveLength(njupt ? 2 : 3)
    expect(proof.publication.submissions.some((entry: { layoutReport?: { materials?: unknown[] } }) => entry.layoutReport?.materials?.length === (njupt ? 1 : 3))).toBe(true)
    expect(proof.project.metadata.activeTemplate.origin).toEqual(initial.report.templateOrigin)
  })
}
