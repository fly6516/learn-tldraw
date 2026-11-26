import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cwd } from 'node:process'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import sharp from 'sharp'
import { normalizeWordUnderlines, wordImportLimit, wordProfiles, wordRoles, type WordRole } from '@/lib/project/word-import'
import { applySuepWordLayout, normalizeSuepExampleHtml, suepExampleHash, suepGeometry, suepRunningTitle, suepTableContinuations, suepTexLayout } from '@/lib/project/suep-word-layout'
import { templateCatalog } from '@/lib/project/template-catalog'
import { zjuCaptionSetup, zjuLayout } from '@/lib/project/zju-layout'
import { sjtuLayout, sjtuWordPreamble } from '@/lib/project/sjtu-export-front'
import { fillSuepCover, suepCoverFields } from '@/lib/project/suep-cover'
import { suepUndergraduateSource } from '@/lib/project/suep-undergraduate-source'
import { draftWordLayout } from '@/lib/project/word-layout-extraction'
import { hasLayoutConflict, layoutKeys, layoutValues, wordLayoutSchema, type WordLayout } from '@/lib/project/word-layout'
import { customWordGeometry, customWordTex, formatCustomWord } from '@/lib/project/custom-word-tex'
import { submissionDocxConfig, submissionDocxFields, submissionDocxIdSchema, suepDocxMembers } from '@/lib/project/submission-docx-config'
import { captureManuscript } from '@/lib/project/template-export'
import { importSourceArchive } from '@/lib/project/source-archive'
import { docxLatexForPandoc, docxSourceError, prepareDocxAst, validateDocxSource, type PandocDocument } from '@/lib/project/docx-manuscript'
import { fillSubmissionDocx } from '@/lib/project/submission-docx-package'
import { projectSourceDigest } from '@/lib/project/external-template-build'
import type { GuidelinePage } from '@/lib/project/pdf-guideline'

export const runtime = 'nodejs'

const exec = promisify(execFile)
const officeSettings = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
  + '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
  + '<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>'
  + '</oor:items>'
let busy = false

class ImportError extends Error {}

async function documentBytes(file: File, role: WordRole) {
  const suffix = extname(file.name).toLowerCase()
  const bytes = Buffer.from(await file.arrayBuffer())
  let extension: '.doc' | '.docx' | undefined
  if (suffix === '.doc' || suffix === '.docx') {
    if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) extension = '.doc'
    if (bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) {
      const archive = await JSZip.loadAsync(bytes).catch(() => undefined)
      if (archive?.file('word/document.xml')) extension = '.docx'
    }
  }
  if (!extension) throw new ImportError(`Choose a valid .doc or .docx file for the ${role}.`)
  return { extension, bytes }
}

async function convertBodyHtml(work: string, archive: JSZip, example: boolean, custom: boolean) {
  const original = await readFile(join(work, 'body.html'), 'utf8').catch(() => {
    throw new ImportError('LibreOffice could not read the Word manuscript.')
  })
  if (original.length > wordImportLimit) throw new ImportError('The converted manuscript is too large.')
  // Only images emitted into the temporary job directory can enter the TeX project.
  const localImages = new Set((await readdir(work)).filter(name => /^body_html_[a-z\d]+\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(name)))
  const images = new Map<string, string>()
  let skipped = 0
  const manuscript = (example ? normalizeSuepExampleHtml(original) : original)
    .replace(/<div title="(?:header|footer)"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/\sdir="ltr"/gi, '')
  const html = manuscript.replace(/<img\b[^>]*>/gi, tag => {
    const source = /\bsrc\s*=\s*"([^"]+)"/i.exec(tag)?.[1]
    if (!source || !localImages.has(source)) { skipped++; return '' }
    if (!images.has(source)) images.set(source, `media/figure-${images.size + 1}.png`)
    return tag.replace(/\bsrc\s*=\s*"[^"]+"/i, `src="${images.get(source)}"`)
  }).replace(/\s+href\s*=\s*"([^"]*)"/gi, (attribute, target: string) =>
    target.startsWith('#') || /^https?:\/\//i.test(target) ? attribute : '')
  let mediaSize = 0
  for (const [source, target] of images) {
    const bytes = await sharp(await readFile(join(work, source)), { limitInputPixels: 32_000_000 }).png().toBuffer()
    mediaSize += bytes.length
    if (mediaSize > wordImportLimit) throw new ImportError('The converted figures exceed 16 MB. Reduce the image sizes and retry.')
    archive.file(target, bytes)
  }
  // Word often labels individual glyphs with unrelated proofing languages. In the
  // reusable layout, fonts are selected by the layout and don't require Babel packs.
  const editable = custom ? html.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/<[^>]+>/g, tag => tag.replace(/\s(?:xml:)?lang="[^"]*"/gi, '')) : html
  await writeFile(join(work, 'manuscript.html'), editable)
  return { images: images.size, skipped, header: suepRunningTitle(original) }
}

async function wordJob(work: string, signal: AbortSignal) {
  const profile = join(work, 'office')
  await mkdir(join(profile, 'user'), { recursive: true })
  await writeFile(join(profile, 'user', 'registrymodifications.xcu'), officeSettings)
  const run = (bin: string, args: string[]) => exec(bin, args, {
    cwd: work, timeout: 55_000, maxBuffer: 1024 * 1024, windowsHide: true, signal,
  })
  const office = (format: string, inputs: string[]) => run(process.env.LIBREOFFICE_BIN || 'soffice', [
    `-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--norestore',
    '--convert-to', format, '--outdir', work, ...inputs,
  ])
  return { run, office }
}

async function inspectWord(work: string, request: Request, data: FormData) {
  const source = data.get('body')
  if (!(source instanceof File) || !source.size) throw new ImportError('请选择 Word 样例。')
  const { extension, bytes } = await documentBytes(source, 'body')
  const { office } = await wordJob(work, request.signal)
  let docx: Uint8Array = bytes
  if (extension === '.doc') {
    await writeFile(join(work, 'sample.doc'), bytes)
    await office('docx:Office Open XML Text', ['sample.doc'])
    docx = await readFile(join(work, 'sample.docx')).catch(() => { throw new ImportError('不能读取旧版 Word 样例。') })
  }
  const standard = data.get('standard')
  let guidelines: GuidelinePage[] = []
  if (standard instanceof File && standard.size) {
    const suffix = extname(standard.name).toLowerCase()
    if (suffix === '.pdf') {
      const content = Buffer.from(await standard.arrayBuffer())
      if (!content.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new ImportError('请选择有效的规范 PDF。')
      const { readGuidelinePdf } = await import('@/lib/project/pdf-guideline')
      guidelines = await readGuidelinePdf(content, request.signal).catch((cause: unknown) => {
        throw new ImportError(cause instanceof Error && cause.message.startsWith('规范 PDF') ? cause.message
          : '无法读取规范 PDF。请确认文件可以打开，或上传文字版。')
      })
    } else if (suffix === '.txt') {
      await writeFile(join(work, 'standard.txt'), Buffer.from(await standard.arrayBuffer()))
    } else {
      const { bytes: standardBytes, extension: wordExtension } = await documentBytes(standard, 'body')
      const wordName = 'standard' + wordExtension
      await writeFile(join(work, wordName), standardBytes)
      await office('txt:Text (encoded):UTF8', [wordName])
    }
    if (suffix !== '.pdf') {
      const text = await readFile(join(work, 'standard.txt'), 'utf8').catch(() => '')
      if (text.trim()) guidelines = [{ text: text.slice(0, 260_000) }]
    }
    if (!guidelines.length) throw new ImportError('规范文件没有可读取的文字。可上传文字版或先仅使用 Word 样例。')
  }
  const draft = await draftWordLayout(docx, source.name.slice(0, 180), guidelines,
    standard instanceof File && standard.size ? standard.name.slice(0, 180) : undefined,
    data.get('assist') === '1', request.signal)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const registered = templateCatalog.find(entry => entry.workflow.kind === 'word' && entry.workflow.original.sha256 === digest)
  if (registered?.exportProfile === 'zju-undergraduate') return { ...draft, layout: zjuLayout(draft.layout) }
  if (registered?.exportProfile === 'sjtu-graduate-word') return { ...draft, layout: sjtuLayout(draft.layout) }
  return draft
}

async function importWord(work: string, request: Request, data: FormData, school: boolean, layout?: WordLayout) {
  const archive = new JSZip()
  const { run, office } = await wordJob(work, request.signal)
  const settings = layout && layoutValues(layout)
  const inputs: Partial<Record<WordRole, string>> = {}
  let example = false
  for (const role of wordRoles) {
    const file = data.get(role)
    if (!(file instanceof File) || !file.size) continue
    const { bytes, extension } = await documentBytes(file, role)
    if (school && role === 'body') example = createHash('sha256').update(bytes).digest('hex') === suepExampleHash
    const filename = role + extension
    await writeFile(join(work, filename), bytes)
    inputs[role] = filename
  }
  if (!inputs.body) throw new ImportError('Choose a Word manuscript to import.')
  await office('html:HTML (StarWriter)', [inputs.body])
  const media = await convertBodyHtml(work, archive, example, !!settings)
  const front = [inputs.cover, inputs.declaration].filter((value): value is string => Boolean(value))
  if (front.length) await office('pdf:writer_pdf_Export', front)
  for (const role of ['cover', 'declaration'] as const) {
    if (!inputs[role]) continue
    const bytes = await readFile(join(work, role + '.pdf')).catch(() => {
      throw new ImportError(`LibreOffice could not render the ${role}. Check that the Word file opens without a password.`)
    })
    archive.file(`front/${role}.pdf`, bytes)
  }
  const logo = data.get('logo')
  const useLogo = !!settings && logo instanceof File && logo.size > 0
  if (useLogo) {
    const bytes = Buffer.from(await logo.arrayBuffer())
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && !bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
      throw new ImportError('校徽仅支持 PNG 或 JPEG。')
    }
    archive.file('front/logo.png', await sharp(bytes, { limitInputPixels: 12_000_000 })
      .resize({ width: 800, withoutEnlargement: true }).png().toBuffer())
  }
  const pandoc = (args: string[]) => run(process.env.PANDOC_BIN || 'pandoc', ['--sandbox', ...args])
  const geometry = settings ? customWordGeometry(settings) : school ? suepGeometry : ['margin=2.54cm']
  let schoolLayout
  let formatted
  if (school || settings) {
    await pandoc(['--from=html-raw_html', '--to=json', '--output=manuscript.json', '--', 'manuscript.html'])
    const document = JSON.parse(await readFile(join(work, 'manuscript.json'), 'utf8'))
    if (settings) formatted = formatCustomWord(document, settings)
    else schoolLayout = applySuepWordLayout(document, example)
    await writeFile(join(work, 'manuscript.json'), JSON.stringify(document))
    if (settings) {
      const presentation = layout?.presentation
      const additions = presentation === 'zju-basic-medicine' ? zjuCaptionSetup(false)
        : presentation === 'sjtu-engineering' ? sjtuWordPreamble : []
      archive.file('word-layout.tex', [customWordTex(settings, media.header), ...additions].join('\n'))
      archive.file('layout.json', JSON.stringify(layout, null, 2))
    } else archive.file('suep-layout.tex', suepTexLayout(media.header))
  }
  await pandoc([
    school || settings ? '--from=json' : '--from=html-raw_html', '--to=latex', '--standalone',
    '--variable=documentclass:ctexart', '--variable=classoption:fontset=fandol',
    ...(settings?.runningHead === 'odd-chapter' || settings?.runningHead === 'even-chapter' || settings?.runningHead === 'odd-title'
      ? ['--variable=classoption:twoside', '--variable=geometry:asymmetric'] : []),
    `--variable=classoption:${settings?.paper ?? 'a4'}paper`,
    ...(school ? ['--variable=classoption:zihao=-4'] : []),
    ...geometry.map(option => `--variable=geometry:${option}`), '--output=converted.tex', '--',
    school || settings ? 'manuscript.json' : 'manuscript.html',
  ])
  const converted = await readFile(join(work, 'converted.tex'), 'utf8')
  const begin = '\\begin{document}'
  const start = converted.indexOf(begin)
  const end = converted.lastIndexOf('\\end{document}')
  if (start === -1 || end <= start || !converted.slice(start + begin.length, end).trim()) {
    throw new ImportError('The manuscript did not contain editable text, figures, or tables.')
  }
  const head = converted.slice(0, start).trimEnd()
  const pages = [
    ...(inputs.cover ? [`\\includepdf[pages={${school ? '1' : '-'}},pagecommand={\\thispagestyle{empty}}]{front/cover.pdf}`] : []),
    ...(inputs.declaration ? ['\\includepdf[pages=-,pagecommand={\\thispagestyle{empty}}]{front/declaration.pdf}'] : []),
    ...(useLogo && !inputs.cover ? ['\\begin{titlepage}\\centering\\vspace*{25mm}\\includegraphics[width=32mm]{front/logo.png}\\end{titlepage}'] : []),
  ]
  archive.file('main.tex', [
    head, ...(inputs.cover || inputs.declaration ? ['\\usepackage{pdfpages}'] : []),
    ...(useLogo && !head.includes('\\usepackage{graphicx}') ? ['\\usepackage{graphicx}'] : []),
    ...(settings ? ['\\input{word-layout}'] : school ? ['\\input{suep-layout}'] : []), '', begin, ...pages,
    ...(settings ? ['\\CustomWordSetup'] : school ? ['\\SuepSetup'] : pages.length ? ['\\pagenumbering{arabic}'] : []),
    '\\input{manuscript}', '\\end{document}', '',
  ].join('\n'))
  const manuscript = normalizeWordUnderlines(converted.slice(start + begin.length, end).trimStart())
  const captioned = school ? suepTableContinuations(manuscript) : manuscript
  // The official example refers to the two halves of its manually split Table 2-1
  // using stale numbers from an earlier draft.
  archive.file('manuscript.tex', example ? captioned.replace(
    /如表\\foreignlanguage\{american\}\{1-1\}和表\\foreignlanguage\{american\}\{1-2\}所列/,
    '如表 2-1 及其续表所列',
  ) : captioned)
  archive.file('Word import.md', [
    '# Word import', '',
    'Edit manuscript.tex, then compile main.tex with XeLaTeX.',
    'LibreOffice renders the optional cover and declaration as PDF pages. Replace the source Word files and import again to change those pages.',
    'Pandoc rebuilds the manuscript as TeX. Check the generated PDF for changes to line breaks, spacing, headers, numbering and floating objects.',
    `${media.images} image assets were exported from the original layout. Word drawing objects and embedded equations can be images.`,
    ...(media.skipped ? [`${media.skipped} unsupported or external image references were omitted. Check against the source Word file.`] : []),
    ...(school ? [
      'The undergraduate cover uses its first page. All declaration pages are retained. The editable manuscript uses the undergraduate layout.',
      'Edit the running title in suep-layout.tex if needed. Body page numbers start at the imported introduction or first chapter.',
    ] : []),
    ...(example ? ['Floating formatting callouts were removed from the university sample. Its original Word file is retained.'] : []),
    ...(schoolLayout && !schoolLayout.foundIntroduction ? ['No introduction or chapter heading was recognized. Body numbering starts on the first manuscript page.'] : []),
    ...(schoolLayout ? [
      schoolLayout.chineseAbstract
        ? `Chinese abstract: ${schoolLayout.chineseCharacters} Han characters; check against the approximate 300–500 character requirement.`
        : 'No Chinese abstract heading was recognized.',
      schoolLayout.englishAbstract
        ? 'English abstract recognized. Review its correspondence with the Chinese abstract.'
        : 'No English abstract heading was recognized.',
      `Keywords recognized: ${schoolLayout.chineseKeywords} Chinese and ${schoolLayout.englishKeywords} English (3–5 each).`,
      schoolLayout.hasToc ? 'The table of contents was rebuilt from recognized headings, through level 3.' : 'No table of contents was recognized.',
      `Recognized ${schoolLayout.appendices} appendix section(s).`,
      `References recognized: ${schoolLayout.references.count} distinct, ${schoolLayout.references.journalCount} marked as journal articles, ${schoolLayout.references.citations} matched in-text citations.`,
      'The school asks for at least 10 references, including at least 2 foreign-language references and 4 journal articles. Verify the bibliographic details against your sources.',
      ...(example && schoolLayout.references.duplicates ? ['The university example’s repeated bibliography entry was consolidated. Recognized citations and bibliography numbers were updated together.'] : []),
    ] : []),
    ...(schoolLayout?.unnamedTables ? [`${schoolLayout.unnamedTables} table(s) have no recognized caption. Add their chapter numbers and titles in manuscript.tex.`] : []),
    ...(schoolLayout?.unmatchedFigures ? [`${schoolLayout.unmatchedFigures} figure caption(s) need manual matching to their images.`] : []),
    ...(settings?.references === 'author-year' ? ['Author–year citations retain the manuscript’s data. Check correspondence and alphabetical order against the guidelines.'] : []),
    ...(formatted?.unmatchedCaptions ? [`${formatted.unmatchedCaptions} figure captions could not be paired. Review the document.`] : []),
    '',
  ].join('\n'))
  if (settings) {
    archive.file('word-layout-issues.json', JSON.stringify([
      ...(formatted?.unmatchedCaptions ? [{ path: 'manuscript.tex', message: `${formatted.unmatchedCaptions} 条图题未找到对应图片。` }] : []),
      ...(formatted?.unresolvedReferences ? [{ path: 'manuscript.tex', message: `${formatted.unresolvedReferences} 处图表引用未能唯一匹配，已保留原文。` }] : []),
      ...(formatted?.unmatchedCitations ? [{ path: 'manuscript.tex', message: `${formatted.unmatchedCitations} 个单独出现的数字引文编号未匹配到参考文献条目。` }] : []),
      ...(formatted?.keptNumericCitations ? [{ path: 'manuscript.tex', message: '稿件含数字引文。已保留原编号，请核对后再改为著者—出版年。' }] : []),
      ...(media.skipped ? [{ path: 'Word import.md', message: `${media.skipped} 张不受支持或外链图片未导入。` }] : []),
      ...(settings.references === 'author-year' ? [{ path: 'manuscript.tex', message: '请核对作者年份与文末条目的对应关系，以及文献排序。' }] : []),
    ], null, 2))
  }
  for (const filename of Object.values(inputs)) {
    archive.file(`word-original/${filename}`, await readFile(join(work, filename)))
  }
  const unpackedSize = await Promise.all(Object.values(archive.files).filter(file => !file.dir).map(file => file.async('uint8array').then(bytes => bytes.length)))
  if (unpackedSize.reduce((size, current) => size + current, 0) > 31 * 1024 * 1024) throw new ImportError('The converted project exceeds the local compiler size limit.')
  return archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

async function exportSubmissionWord(work: string, request: Request, data: FormData) {
  const target = submissionDocxIdSchema.safeParse(data.get('school'))
  if (!target.success) throw new ImportError('请选择支持的官方 Word 版本。')
  const config = submissionDocxConfig(target.data)
  let input: unknown
  try { input = JSON.parse(String(data.get('fields') ?? 'null')) }
  catch { throw new ImportError('封面字段格式不正确。') }
  const parsed = submissionDocxFields.safeParse(input)
  if (!parsed.success) throw new ImportError('请核对封面、摘要及关键词中的必填字段。')
  const fields = parsed.data
  const source = data.get('source')
  const original = data.get('original')
  const entry = String(data.get('main') ?? '')
  if (!(source instanceof File) || !(original instanceof File) || !source.size || !original.size) throw new ImportError('缺少当前稿件源包或官方原件。')
  const pinned = async (file: Blob, sha256: string, label: string) => {
    const bytes = Buffer.from(await file.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new ImportError(label + '的 SHA-256 与登记版不一致。')
    return bytes
  }
  const registered = await pinned(original, config.original.sha256, '官方原件')
  const project = await importSourceArchive(source, wordImportLimit)
  const manuscript = captureManuscript(project.files, entry, { allowLongtable: true })
  validateDocxSource(manuscript)
  const { run, office } = await wordJob(work, request.signal)
  let reference: Uint8Array = registered
  let cover: Uint8Array | undefined
  let declaration: Uint8Array | undefined
  let provenance = config.name + ' · ' + config.version + '\n' + config.sourceUrl + '\n官方原件 SHA-256 ' + config.original.sha256
  if (config.guideline) {
    const guide = data.get('guideline')
    if (!(guide instanceof File)) throw new ImportError('缺少浙大官方规范 PDF。')
    await pinned(guide, config.guideline.sha256, '官方规范')
    provenance += '\n官方规范 ' + config.guideline.url + ' · SHA-256 ' + config.guideline.sha256
  } else {
    await writeFile(join(work, 'official.rar'), registered)
    const contents = {} as Record<keyof typeof suepDocxMembers, Buffer>
    for (const [key, member] of Object.entries(suepDocxMembers)) {
      const { stdout } = await exec(process.env.BSDTAR_BIN || 'bsdtar', ['-xOf', 'official.rar',
        '附件：毕业设计、论文相关20261013/' + member.name],
      { cwd: work, encoding: 'buffer', timeout: 15_000, maxBuffer: wordImportLimit, signal: request.signal })
      if (createHash('sha256').update(stdout).digest('hex') !== member.sha256) throw new ImportError(member.name + ' 的 SHA-256 与登记版不一致。')
      contents[key as keyof typeof suepDocxMembers] = stdout
      provenance += '\n' + member.name + ' · SHA-256 ' + member.sha256
    }
    for (const key of ['cover', 'declaration', 'body'] as const) {
      await writeFile(join(work, key + '.doc'), contents[key])
    }
    await office('docx:Office Open XML Text', ['cover.doc', 'declaration.doc', 'body.doc'])
    reference = await readFile(join(work, 'body.docx'))
    cover = await fillSuepCover(await readFile(join(work, 'cover.docx')), suepCoverFields.parse(fields))
    declaration = await readFile(join(work, 'declaration.docx'))
  }
  provenance += '\n稿件快照 SHA-256 ' + await projectSourceDigest(project.files, entry)
  const deliveryId = data.get('delivery-id')
  if (typeof deliveryId === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(deliveryId)) provenance += '\n交付标识 ' + deliveryId
  provenance += '\n' + config.status

  async function runPandoc(args: string[], part: 'body' | 'abstract') {
    try { await run(process.env.PANDOC_BIN || 'pandoc', args) }
    catch (cause) {
      const failure = cause as NodeJS.ErrnoException & { stderr?: string; killed?: boolean }
      if (failure.code === 'ENOENT' || failure.killed) throw cause
      const message = (failure.stderr ?? '').trim().slice(0, 500)
      const line = Number(/(?:line |\.tex"? \(line )(\d+)/i.exec(message)?.[1] ?? 1)
      const location = manuscript.lineSources[part].get(line) ?? [...manuscript.lineSources[part].values()][0]
      const formula = /math|formula/i.test(message) ? /\$|\\(?:\[|\(|begin\s*\{equation)/.exec(manuscript[part]) : undefined
      if (formula) docxSourceError(manuscript, part, formula.index, '公式无法转换为可编辑的 Word 公式。' + message)
      throw new ImportError((location ? `${location.path}:${location.line} · ` : '') + 'Pandoc 无法可靠转换稿件。' + message)
    }
  }
  for (const part of ['body', 'abstract'] as const) {
    await writeFile(join(work, part + '.tex'), docxLatexForPandoc(manuscript[part]))
    await runPandoc(['--sandbox', '--fail-if-warnings', '-f', 'latex', '-t', 'json', part + '.tex', '-o', part + '.json'], part)
  }
  if (manuscript.bibliography.length) {
    await writeFile(join(work, 'references.bib'), manuscript.bibliography.map(item => item.content).join('\n'))
    const csl = await readFile(join(cwd(), 'src/lib/project/docx-assets/gbt7714-numeric.csl'))
    if (createHash('sha256').update(csl).digest('hex') !== 'd9cd04f94bc21a99dc320d0a2230d5a1fb47e3634c17c5820cf975c40db3c0c7') {
      throw new ImportError('参考文献格式配置 SHA-256 校验失败。')
    }
    await writeFile(join(work, 'style.csl'), csl)
    await runPandoc(['--sandbox', '--fail-if-warnings', '-f', 'json', '-t', 'json', '--citeproc',
      '--bibliography=references.bib', '--csl=style.csl', '--metadata=link-citations:true', 'body.json', '-o', 'citations.json'], 'body')
  }
  const parse = async (name: string) => JSON.parse(await readFile(join(work, name + '.json'), 'utf8')) as PandocDocument
  const converted = prepareDocxAst(await parse(manuscript.bibliography.length ? 'citations' : 'body'), await parse('abstract'), manuscript, config.id)
  for (const { blob, name } of converted.assets) await writeFile(join(work, name), new Uint8Array(await blob.arrayBuffer()))
  await writeFile(join(work, 'render.json'), JSON.stringify(converted.body))
  // The JSON writer only receives locally staged, validated image names.
  await runPandoc(['--fail-if-warnings', '-f', 'json', '-t', 'docx', 'render.json', '-o', 'draft.docx'], 'body')
  return fillSubmissionDocx({ ...converted, id: config.id, original: reference, draft: await readFile(join(work, 'draft.docx')),
    cover, declaration, fields, englishTitle: manuscript.title.replace(/\\([&%#$ _])/g, '$1'), provenance })
}

export async function POST(request: Request) {
  if (process.env.WORD_IMPORT_ENABLED !== '1') {
    return Response.json({ error: 'Enable WORD_IMPORT_ENABLED=1 on the local server with LibreOffice and Pandoc installed.' }, { status: 503 })
  }
  const host = request.headers.get('host') ?? ''
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) || request.headers.get('origin') !== `http://${host}`) {
    return Response.json({ error: 'Word import is available from the local workbench only.' }, { status: 403 })
  }
  const length = Number(request.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length <= 0 || length > wordImportLimit + 64 * 1024) {
    return Response.json({ error: 'Upload Word documents totaling at most 16 MB.' }, { status: 413 })
  }
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) {
    return Response.json({ error: 'Expected Word files from the import form.' }, { status: 400 })
  }
  if (busy) return Response.json({ error: 'Another Word import is in progress. Try again shortly.' }, { status: 429 })
  busy = true
  let work: string | undefined
  try {
    const data = await request.formData().catch(() => { throw new ImportError('Invalid Word upload.') })
    const fileFields = [...wordRoles, 'logo', 'standard']
    const files = fileFields.flatMap(key => data.getAll(key))
    if (files.some(file => !(file instanceof File))
        || files.reduce((size, file) => size + (file instanceof File ? file.size : 0), 0) > wordImportLimit
        || fileFields.some(role => data.getAll(role).length > 1)) {
      throw new ImportError('Choose one Word file per field, totaling at most 16 MB.')
    }
    work = await mkdtemp(join(tmpdir(), 'research-word-'))
    if (data.get('intent') === 'export-submission-docx') {
      try {
        return new Response(await exportSubmissionWord(work, request, data), { headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Cache-Control': 'no-store',
        } })
      } catch (cause) {
        const failure = cause as NodeJS.ErrnoException
        if (failure.code === 'ENOENT') throw new ImportError('缺少 LibreOffice、Pandoc 或 bsdtar。请检查本机安装。')
        // Application-level diagnostics include source locations. Child process commands and paths stay local.
        if (failure.code !== undefined && !(cause instanceof ImportError)) throw new ImportError('本地 Word 转换失败，请核对编译工具和登记的原件。')
        throw new ImportError(cause instanceof Error ? cause.message : '提交版 DOCX 导出失败。')
      }
    }
    if (data.get('intent') === 'inspect') {
      return Response.json(await inspectWord(work, request, data), { headers: { 'Cache-Control': 'no-store' } })
    }
    if (data.get('intent') === 'normalize-docx') {
      const source = data.get('body')
      if (!(source instanceof File) || !source.size) throw new ImportError('请选择官方 Word 原件。')
      const { extension, bytes } = await documentBytes(source, 'body')
      if (extension === '.docx') return new Response(new Uint8Array(bytes))
      await writeFile(join(work, 'normalized.doc'), bytes)
      const { office } = await wordJob(work, request.signal)
      await office('docx:Office Open XML Text', ['normalized.doc'])
      const normalized = await readFile(join(work, 'normalized.docx')).catch(() => { throw new ImportError('原件无法转换为 DOCX。') })
      if (normalized.length > wordImportLimit) throw new ImportError('转换后的 DOCX 原件超过大小限制。')
      return new Response(new Uint8Array(normalized), { headers: { 'Cache-Control': 'no-store' } })
    }
    if (data.get('intent') === 'render-front') {
      const cover = data.get('cover')
      if (!(cover instanceof File) || !cover.size) throw new ImportError('缺少 Word 封面。')
      const { extension, bytes } = await documentBytes(cover, 'cover')
      const name = 'front' + extension
      await writeFile(join(work, name), bytes)
      const { office } = await wordJob(work, request.signal)
      let renderName = name
      const fields = data.get('suep-cover-fields')
      if (typeof fields === 'string') {
        if (extension !== '.doc' || createHash('sha256').update(bytes).digest('hex') !== suepUndergraduateSource.switchAssets.cover.sha256) {
          throw new ImportError('上电封面必须使用已登记的官方 DOC 原件。')
        }
        const parsed = suepCoverFields.safeParse(JSON.parse(fields))
        if (!parsed.success) throw new ImportError('请核对上电封面字段长度和格式。')
        await office('docx:Office Open XML Text', [name])
        renderName = 'front.docx'
        const wordFile = join(work, renderName)
        try { await writeFile(wordFile, await fillSuepCover(await readFile(wordFile), parsed.data)) }
        catch (cause) { throw new ImportError(cause instanceof Error ? cause.message : '无法填写上电封面。') }
      }
      await office('pdf:writer_pdf_Export', [renderName])
      const pdf = await readFile(join(work, 'front.pdf')).catch(() => { throw new ImportError('Word 封面无法生成 PDF。') })
      return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
    }
    const style = data.get('profile')
    let layout: WordLayout | undefined
    if (style === 'custom') {
      let raw: unknown
      try { raw = JSON.parse(String(data.get('layout') ?? 'null')) } catch { throw new ImportError('版式配置不是有效的 JSON。') }
      const parsed = wordLayoutSchema.safeParse(raw)
      if (!parsed.success || layoutKeys.some(key => hasLayoutConflict(parsed.data.rules[key]))) {
        throw new ImportError('版式配置无效，或还有未处理的冲突。')
      }
      layout = parsed.data
    } else if (!wordProfiles.some(profile => profile === style)) throw new ImportError('Choose a valid TeX layout.')
    return new Response(await importWord(work, request, data, style === 'suep-undergraduate', layout), {
      headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' },
    })
  } catch (cause) {
    const failure = cause as NodeJS.ErrnoException & { killed?: boolean }
    if (failure.code === 'ENOENT') return Response.json({ error: 'Install LibreOffice and Pandoc, or set LIBREOFFICE_BIN and PANDOC_BIN.' }, { status: 503 })
    return Response.json({ error: cause instanceof ImportError ? cause.message : failure.killed
      ? 'Word conversion timed out. Try smaller files.' : 'Word conversion failed. Check that the files open in LibreOffice, then try again.' }, { status: 422 })
  } finally {
    if (work) await rm(work, { recursive: true, force: true }).catch(() => {})
    busy = false
  }
}
