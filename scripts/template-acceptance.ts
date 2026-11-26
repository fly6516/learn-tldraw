import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { templateCatalog } from '../src/lib/project/template-catalog'
import { suepDocxMembers, suepUndergraduateSource } from '../src/lib/project/suep-undergraduate-source'
import { catalogWordAttachments, njuptAttachmentTemplate, zjuAttachmentTemplate } from '../src/lib/project/word-release-attachments'

const groups: Record<string, string> = {
  catalog: '(?:WORD|ZIP|STARTER|REFERENCE) [a-z0-9-]+ (?:builds|creates|exposes)|EXTERNAL Springer|imports the original SUEP|MIGRATION preserves the registered catalog',
  switch: 'persists the current template|switches a single independent project|returns a real MIT build',
  release: 'published njupt-|published agu-jgr-atmospheres|publishes a verified PRL ZIP',
  expansion: '(?:WORD|ZIP) (?:njupt-professional-masters|agu-jgr-atmospheres) (?:builds|creates)|published (?:njupt-professional-masters|agu-jgr-atmospheres)',
  manual: 'archives explicit author confirmation|published njupt-',
  attachments: 'ZJU publishes a changed guideline|NJUPT publishes a changed declaration',
}
const group = process.argv[2] ?? 'all'
if (group !== 'all' && !Object.hasOwn(groups, group)) throw new Error('Choose all, catalog, switch, release, manual, expansion or attachments.')
const expansionIds = new Set(['njupt-professional-masters', 'agu-jgr-atmospheres'])
const releaseIds = new Set(['njupt-academic-masters', 'njupt-humanities-masters', 'aps-prl', ...expansionIds])
const manualIds = new Set(['njupt-academic-masters', 'njupt-humanities-masters', 'suep-masters', 'ustc-graduate-word', 'njupt-professional-masters'])
const fullCatalog = group === 'all' || group === 'catalog'
const needsAttachments = ['all', 'release', 'attachments'].includes(group)
const attachmentIds = [zjuAttachmentTemplate, njuptAttachmentTemplate]
const needsCatalogManuscript = fullCatalog || group === 'expansion' || needsAttachments
const fixtures = resolve(process.env.RESEARCH_TEMPLATE_ACCEPTANCE_FIXTURES ?? '.cache/template-acceptance')
const out = resolve(process.env.RESEARCH_TEMPLATE_ACCEPTANCE_OUTPUT ?? join('test-results', 'template-acceptance', group))
await mkdir(fixtures, { recursive: true })
const preparation = await mkdtemp(join(fixtures, '.prepare-'))
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const pins: Record<string, string> = {}
const testEnv: NodeJS.ProcessEnv = { ...process.env, RESEARCH_TEMPLATE_EXPORT_ACCEPTANCE: '1', RESEARCH_TEMPLATE_PINNED_FIXTURES: fixtures,
  RESEARCH_UNIFIED_TEMPLATE_FIXTURES: fixtures, RESEARCH_WORD_FIXTURE_DIR: fixtures, RESEARCH_NJUPT_SWITCH_FIXTURES: fixtures,
  RESEARCH_CATALOG_ADDITIONS_FIXTURES: fixtures, RESEARCH_OFFICIAL_EXPANSION_FIXTURES: fixtures, WORD_IMPORT_ENABLED: '1' }
delete testEnv.RESEARCH_SWITCH_TARGETS
if (process.platform === 'darwin' && !testEnv.FONTCONFIG_FILE) {
  testEnv.FONTCONFIG_FILE = resolve('tests/e2e/fixtures/official-template-acceptance/macos-fonts.conf')
}
const pandoc = testEnv.PANDOC_BIN || 'pandoc'
const office = testEnv.LIBREOFFICE_BIN || 'soffice'

const wsl = process.platform === 'win32' ? testEnv.RESEARCH_BIBER_WSL ?? testEnv.LATEX_SYSTEM_TEX_WSL : undefined

function checkCommand(command: string, args: string[], linux: boolean) {
  const options = { env: testEnv, timeout: 12_000, stdio: 'ignore' as const }
  return linux && wsl
    ? spawnSync('wsl.exe', ['-d', wsl, '--exec', command, ...args], options)
    : spawnSync(command, args, options)
}

function requireCommand(command: string, argument = '--version', linux = true) {
  const check = checkCommand(command, [argument], linux)
  if (check.status !== 0) throw new Error('模板验收环境无法运行 ' + command + '。请将它加入 PATH 或修正指定的工具路径。')
}

async function checkEnvironment() {
  for (const command of [pandoc, office]) requireCommand(command, '--version', false)
  for (const command of ['pdflatex', 'xelatex', 'bibtex', 'kpsewhich']) requireCommand(command)
  for (const command of ['pdftotext', 'pdffonts']) requireCommand(command, '-v')
  if (fullCatalog || group === 'switch') {
    requireCommand('tectonic', '--version', false)
    for (const command of ['lualatex', 'biber', 'latexmk', 'node']) requireCommand(command)
  }
  if (fullCatalog) requireCommand('gs')
  if (fullCatalog || group === 'release' || group === 'expansion') {
    for (const dependency of ['apacite.sty', 'listofitems.sty', 'marginnote.sty', 'placeins.sty', 'xifthen.sty']) {
      if (checkCommand('kpsewhich', [dependency], true).status !== 0) {
        throw new Error('AGU 官方模板缺少 TeX Live 文件 ' + dependency + '，请先安装对应宏包。')
      }
    }
  }

  const document = join(preparation, 'font-probe.docx')
  const pdf = join(preparation, 'font-probe.pdf')
  const words = '论文封面 中文字体 南京邮电大学'
  execFileSync(pandoc, ['-f', 'markdown', '-o', document], { input: words, env: testEnv, timeout: 15_000 })
  if (testEnv.RESEARCH_TRIAL_E2E_URL) {
    const target = new URL(testEnv.RESEARCH_TRIAL_E2E_URL)
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port) throw new Error('验收工作台必须监听本机回环地址。')
    const form = new FormData()
    form.set('intent', 'render-front')
    form.set('cover', new File([new Uint8Array(await readFile(document))], 'font-probe.docx'))
    const response = await fetch(new URL('/api/word/import', target), {
      method: 'POST', headers: { Origin: target.origin }, body: form, signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error('验收工作台无法渲染 Word 字体探针（HTTP ' + response.status + '）。请检查 WORD_IMPORT_ENABLED 和 LibreOffice。')
    await writeFile(pdf, new Uint8Array(await response.arrayBuffer()))
  } else {
    execFileSync(office, ['-env:UserInstallation=' + pathToFileURL(join(preparation, 'office')).href,
      '--headless', '--convert-to', 'pdf', '--outdir', preparation, document], { env: testEnv, stdio: 'inherit', timeout: 30_000 })
  }
  const pdfOptions = { encoding: 'utf8' as const, env: testEnv }
  const pdfPath = wsl ? execFileSync('wsl.exe', ['-d', wsl, '--exec', 'wslpath', '-a', pdf], pdfOptions).trim() : pdf
  const runPdf = (command: string, args: string[]) => wsl
    ? execFileSync('wsl.exe', ['-d', wsl, '--exec', command, ...args], pdfOptions)
    : execFileSync(command, args, pdfOptions)
  const output = runPdf('pdftotext', [pdfPath, '-'])
  const fonts = runPdf('pdffonts', [pdfPath])
  if (!output.replace(/\s+/g, '').includes(words.replace(/\s+/g, '')) ||
      !fonts.trim().split('\n').slice(2).some(line => /CID|Unicode|CJK|Song|Hei|Fandol|Kai|PingFang|Chinese|Han|Gothic|Ming|STKaiti|WenQuanYi/i.test(line))) {
    throw new Error('验收工作台的 LibreOffice 未正确嵌入中文字体。请按贡献指南配置 FONTCONFIG_FILE 或安装中文字体后重启。')
  }
  console.log('模板验收环境通过：编译器、PDF 工具及 LibreOffice 中文字体。')
}

async function original(name: string, asset: { url: string; sha256: string }) {
  const path = join(fixtures, name)
  const cached = await readFile(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (cached) {
    if (sha256(cached) !== asset.sha256) throw new Error('Wrong SHA-256 for cached original ' + path)
  } else {
    const pending = join(preparation, name)
    try {
      execFileSync('curl', ['-fsSL', '--retry', '1', '--max-time', '75', '--max-filesize', '134217728',
        '-o', pending, asset.url], { stdio: 'inherit' })
      const bytes = await readFile(pending)
      if (sha256(bytes) !== asset.sha256) throw new Error('Official response did not match the registered SHA-256.')
      await writeFile(path, bytes, { flag: 'wx' })
    } catch (cause) {
      throw new Error('无法取得登记版原件 ' + name + '。请在缓存中提供 SHA-256 ' + asset.sha256 + ' 对应的文件。' , { cause })
    }
  }
  pins[name] = asset.sha256
}

async function reuse(name: string, from: string) {
  if (name === from) return
  await writeFile(join(fixtures, name), await readFile(join(fixtures, from)))
}

async function extractCover() {
  const { sha256: expected } = suepDocxMembers.cover
  const path = join(fixtures, 'current-cover.doc')
  let current = await readFile(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!current) {
    const target = join(preparation, 'suep')
    await mkdir(target)
    execFileSync('bsdtar', ['-xf', join(fixtures, 'suep-undergraduate.rar'), '-C', target])
    for (const candidate of await readdir(target, { recursive: true })) {
      if (!candidate.toLowerCase().endsWith('.doc')) continue
      const bytes = await readFile(join(target, candidate))
      if (sha256(bytes) === expected) { current = bytes; break }
    }
    if (!current) throw new Error('上电官方附件包缺少登记版封面。')
    await writeFile(path, current)
  }
  if (sha256(current) !== expected) throw new Error('上电登记版封面校验失败。')
  pins['current-cover.doc'] = expected
}

try {
  await checkEnvironment()
  for (const { id, workflow } of templateCatalog) {
    if (group === 'attachments' && !attachmentIds.includes(id) || group === 'release' && !releaseIds.has(id) && !attachmentIds.includes(id) ||
        group === 'manual' && !manualIds.has(id) || group === 'expansion' && !expansionIds.has(id)) continue
    if (workflow.kind === 'word' || workflow.kind === 'zip') {
      const ext = workflow.kind === 'zip' ? '.zip' : workflow.original.url.endsWith('.doc') ? '.doc' : '.docx'
      await original(id + ext, workflow.original)
      if (workflow.kind === 'word' && workflow.guideline) await original(id + '-guidelines.pdf', workflow.guideline)
      if (workflow.kind === 'word' && workflow.declaration) await original('njupt-declaration.doc', workflow.declaration)
    } else if (workflow.kind === 'word-import') await original(id + '.rar', workflow.original)
  }
  if (needsAttachments) await original('njupt-blind-cover.doc', catalogWordAttachments(njuptAttachmentTemplate)!.find(item => item.role === 'blind-cover')!)
  if (fullCatalog || group === 'switch') {
    await original('declaration.doc', { ...suepDocxMembers.declaration, url: suepUndergraduateSource.officialFiles[1].url })
    await extractCover()
  }
  if (group === 'all' || group === 'release') await reuse('revtex.zip', 'aps-prl.zip')
  if (fullCatalog) {
    await original('example.doc', { sha256: '682978def76fb275f269355ea178fbbc06bd8ba1275d49d286bd93f5e45904ff',
      url: suepUndergraduateSource.officialFiles[2].url })
  }
  if (needsCatalogManuscript) {
    const graphic = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="white"/><path d="M20 15v90h200" fill="none" stroke="#555"/><path d="M48 100V50h38v50m32 0V23h38v77m32 0V65h30v35" fill="#6840aa"/></svg>'
    await sharp(Buffer.from(graphic)).png().toFile(join(preparation, 'catalog-calibration.png'))
    execFileSync(pandoc, [resolve('tests/e2e/fixtures/official-template-acceptance/catalog-manuscript.md'),
      '--resource-path', preparation, '-o', join(fixtures, 'independent.docx')], { stdio: 'inherit' })
  }
  await writeFile(join(fixtures, 'registered-sha256.json'), JSON.stringify(pins, null, 2) + '\n')
} finally {
  await rm(preparation, { force: true, recursive: true })
}

function runBrowser(files: string[], grep: string, output: string, env: NodeJS.ProcessEnv) {
  const { status, error } = spawnSync('bun', ['x', 'playwright', 'test', ...files, '--grep', grep, '--output', output, '--reporter', 'line'],
    { stdio: 'inherit', env })
  if (error) throw error
  return status ?? 1
}

let status = 0
if (group !== 'attachments') {
  const grep = group === 'all' ? Object.values(groups).map(pattern => '(?:' + pattern + ')').join('|') : groups[group]
  status = runBrowser(['unified-template-catalog.spec.ts', 'template-export.spec.ts', 'template-release.spec.ts', 'word-import.spec.ts'], grep, out, testEnv)
}
if (needsAttachments) {
  const sandbox = await mkdtemp(join(fixtures, '.attachment-run-'))
  const state = join(sandbox, 'upstream')
  try {
    await writeFile(state, 'baseline')
    const env = { ...testEnv, RESEARCH_TRIAL_E2E_URL: undefined, RESEARCH_ATTACHMENT_ACCEPTANCE: '1',
      RESEARCH_ATTACHMENT_UPSTREAM_STATE: state, OFFICIAL_ATTACHMENT_CACHE_DIR: join(sandbox, 'cache'),
      NODE_OPTIONS: [testEnv.NODE_OPTIONS, '--require="' + resolve('tests/e2e/fixtures/word-attachment-upstream.cjs') + '"'].filter(Boolean).join(' ') }
    const attachStatus = runBrowser(['word-attachment-release.spec.ts'], groups.attachments, group === 'attachments' ? out : join(out, 'attachments'), env)
    status ||= attachStatus
  } finally { await rm(sandbox, { recursive: true, force: true }) }
}
await mkdir(out, { recursive: true })
await writeFile(join(out, 'registered-sha256.json'), JSON.stringify(pins, null, 2) + '\n')
process.exitCode = status
