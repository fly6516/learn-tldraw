import JSZip from 'jszip'
import { importCatalogTemplate, templateCatalog, type CatalogTemplate } from './template-catalog'
import { customWordGeometry, customWordTex } from './custom-word-tex'
import { createTemplateProject, templateDigest } from './paper-templates'
import { njuptBlindCover, omitBlindAcknowledgments, type SubmissionStage } from './submission-stages'
import { fetchOfficialFile } from './official-template-client'
import { activeTemplateSchema, activeTemplateEngine, type ActiveTemplate, type TemplateFields } from './active-template'
import type { ProjectFileSystem } from './types'
import { importSourceArchive } from './source-archive'
import { maskLatexCode } from './latex-source'
import { captureManuscript, type ManuscriptSnapshot } from './template-export'
import { compileWordProjectWithSync, readWordTemplate, wordRequest } from './word-conversion-client'
import { hasLayoutConflict, layoutKeys, layoutValues, wordLayoutSchema, type WordLayout } from './word-layout'
import { joinMappedTex, manuscriptRegions, type LineSources, type MappedTex } from './template-source-map'
import { numericPublisherBibliography, publisherArticle, publisherArticleIds, type PublisherArticleId } from './publisher-article'
import { suepGeometry, suepTexLayout } from './suep-word-layout'
import { suepUndergraduateSource } from './suep-undergraduate-source'
import { sjtuExportFront, sjtuLayout, sjtuWordPreamble } from './sjtu-export-front'
import { zjuCaptionSetup, zjuLayout } from './zju-layout'
import { zjuExportCover } from './zju-export-cover'
import type { OfficialTemplateRelease } from './template-release'
import { additionalThesisFront, additionalWordThesisIds, njuptBlindExportFront, njuptExportFront, njuptLayout } from './official-thesis-front'
import { findPdfRegion, findSourceRegion, type SyncRegion } from './source-sync'
import { packageExternalTemplate, projectSourceDigest } from './external-template-build'

export type ExportTarget = { entry: CatalogTemplate; version: string; sha256: string; release?: OfficialTemplateRelease }
export const exportTargets: readonly ExportTarget[] = templateCatalog.flatMap<ExportTarget>(entry => {
  if (entry.delivery === 'built-in') return [{ entry, version: entry.template.version, sha256: entry.workflow.sha256 }]
  return entry.exportProfile && (entry.workflow.kind === 'word' || entry.workflow.kind === 'zip' || entry.workflow.kind === 'word-import')
    ? [{ entry, version: entry.workflow.version, sha256: entry.workflow.original.sha256 }] : []
})

export function catalogSwitchStatus(entry: CatalogTemplate) {
  if (entry.workflow.kind === 'reference') return 'reference'
  if (entry.exportProfile === 'mit-thesis') return 'external-switch'
  if (!entry.exportProfile) return 'external'
  return entry.workflow.kind === 'word' || entry.workflow.kind === 'zip' ? 'versioned' : 'pinned'
}
export const supportsSwitchRelease = (id: string) => exportTargets.some(({ entry }) =>
  entry.id === id && catalogSwitchStatus(entry) === 'versioned')

export function switchTargetForRelease(release: OfficialTemplateRelease): ExportTarget | undefined {
  const base = exportTargets.find(({ entry }) => entry.id === release.id && entry.workflow.kind === release.kind)
  return base && supportsSwitchRelease(release.id) && (release.kind === 'zip' || release.original)
    ? { entry: base.entry, version: release.version, sha256: release.sha256, release } : undefined
}
export type ExportFields = Readonly<TemplateFields & { original?: File; guideline?: File; cover?: File; declaration?: File }>
type JmlrTemplate = Extract<ActiveTemplate, { kind: 'jmlr-article' }>
type WordThesisTemplate = Extract<ActiveTemplate, { kind: 'zju-undergraduate' | 'sjtu-graduate-word' | 'njupt-masters' | 'official-thesis' }>

type Files = Map<string, string | Blob>
type Build = { files: Files; lines: LineSources; command: string; dependencies: string; notes: string }

async function officialFile(target: ExportTarget, signal: AbortSignal, upload?: File, guideline?: string) {
  const sha = guideline ?? target.sha256
  if (target.release && !guideline) {
    const { release } = target
    const original = release.kind === 'zip' ? release.archive : release.original
    if (!original || await templateDigest(await original.arrayBuffer()) !== sha) throw new Error('已发布版本的原件校验失败。')
    signal.throwIfAborted()
    return new File([original], release.sourceName)
  }
  if (!upload) return fetchOfficialFile(target.entry.id, sha, guideline ? 'guideline' : undefined, signal)
  if (upload.size > 128 * 1024 * 1024 || await templateDigest(await upload.arrayBuffer()) !== sha) {
    throw new Error(`本地${guideline ? '规范' : '原件'}的 SHA-256 与所选版本不一致。`)
  }
  const ext = guideline ? 'pdf' : target.entry.workflow.kind === 'word' ? 'docx' : 'zip'
  return new File([upload], 'official.' + ext)
}

async function snapshotDigest({ assets, lineSources: _lineSources, ...text }: ManuscriptSnapshot) {
  const assetsWithHashes = await Promise.all(assets.map(async ({ path, blob }) =>
    [path, await templateDigest(await blob.arrayBuffer())]))
  const serialized = JSON.stringify({ ...text, assets: assetsWithHashes })
  return templateDigest(new TextEncoder().encode(serialized).buffer)
}

function plainTex(text: string) {
  const escapes: Record<string, string> = {
    '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
  }
  return text.replace(/[\\{}%#&_$^~]/g, char => escapes[char] ?? '\\' + char)
}

function plainTitle(text: string) {
  return text.replace(/\\([&%#$ _])/g, '$1')
}

function bibliography(manuscript: ManuscriptSnapshot) {
  return manuscript.bibliography.length
    ? '\\bibliography{' + manuscript.bibliography.map(item => item.path.slice(0, -4)).join(',') + '}' : ''
}

function requireFields(fields: string[]) {
  return fields.every(value => value.trim())
}

function assertEnglishManuscript(manuscript: ManuscriptSnapshot, publication: string) {
  if (manuscript.unicodeLocation) {
    const { path, line } = manuscript.unicodeLocation
    throw new Error(`${path}:${line} · 官方 ${publication} pdfLaTeX 样式暂不支持稿件中的中日韩文字。`)
  }
}

async function prepareJmlr(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { entry } = target
  if (entry.delivery !== 'archive' || entry.workflow.checks.kind !== 'latex-class' || entry.workflow.compile.compileProfile.engine !== 'pdflatex') {
    throw new Error('目标模板缺少 pdfLaTeX 样式配置。')
  }
  if (!fields.affiliation.trim()) throw new Error('请输入作者单位。')
  if ([fields.affiliation, fields.email].some(value => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(value))) {
    throw new Error('JMLR 的作者单位和联系邮箱请使用英文。')
  }
  const original = await officialFile(target, signal, fields.original)
  const base = await importCatalogTemplate(entry, original, entry.name, target.release)
  const { compile, checks } = entry.workflow
  const entryPath = base.metadata.mainFile ?? compile.mainFile
  const folder = entryPath.slice(0, entryPath.lastIndexOf('/') + 1)
  const style = base.files.get(folder + checks.package + '.sty')
  const styleText = style?.type !== 'directory' && (style?.content ?? await style?.blob?.text())
  if (!styleText) throw new Error('固定版本缺少官方样式文件。')
  return { kind: 'jmlr-article' as const, fields: { affiliation: fields.affiliation, email: fields.email },
    main: entryPath.split('/').at(-1)!, documentClass: checks.documentClass, options: [...checks.options],
    packageName: checks.package, style: styleText }
}

function manuscriptPart(manuscript: ManuscriptSnapshot, name: keyof ManuscriptSnapshot['lineSources']): MappedTex {
  return { text: manuscript[name], lines: manuscript.lineSources[name] }
}

function jmlrBuild(template: JmlrTemplate, manuscript: ManuscriptSnapshot): Build {
  assertEnglishManuscript(manuscript, 'JMLR')
  const { fields, options, documentClass, packageName, style, main } = template
  const author = manuscript.authors.map(name => {
    const email = fields.email.trim() ? ' \\email ' + plainTex(fields.email.trim()) : ''
    return '\\name ' + name + email + ' \\\\\n\\addr ' + plainTex(fields.affiliation.trim())
  }).join('\n\\AND\n')
  const source = joinMappedTex([
    `\\documentclass[${options.join(',')}]{${documentClass}}`,
    `\\usepackage[preprint]{${packageName}}`, '\\usepackage{amsmath,booktabs,array}',
    '\\setcitestyle{authoryear}',
    '\\begin{document}',
    `\\title{${manuscript.title}}`, `\\author{${author}}`,
    `\\ShortHeadings{${manuscript.title}}{${manuscript.authors.join(', ')}}`,
    '\\firstpageno{1}', '\\maketitle',
    '\\begin{abstract}', manuscriptPart(manuscript, 'abstract'), '\\end{abstract}',
    manuscript.keywords && joinMappedTex(['\\begin{keywords}', manuscriptPart(manuscript, 'keywords'), '\\end{keywords}'], ''),
    manuscriptPart(manuscript, 'body'), bibliography(manuscript), '\\end{document}',
  ])
  return {
    files: new Map([[main, source.text + '\n'], [packageName + '.sty', style]]),
    lines: source.lines,
    command: 'latexmk -pdf -no-shell-escape -interaction=nonstopmode ' + main,
    dependencies: 'TeX Live with pdfLaTeX, BibTeX, latexmk, and packages amsmath, amssymb, array, booktabs, epsfig, graphicx, hyperref, natbib. The official jmlr2e.sty is included.',
    notes: 'Uses the official jmlr2e preprint option for a manuscript without journal-assigned editor, dates, volume, or paper ID.',
  }
}

async function prepareZju(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { entry } = target
  const { workflow } = entry
  if (workflow.kind !== 'word' || !workflow.guideline || workflow.compile.compileProfile.engine !== 'xelatex') throw new Error('目标模板缺少官方 Word 和规范配置。')
  if (!requireFields([fields.affiliation, fields.advisor, fields.studentNumber, fields.program, fields.date, fields.chineseTitle, fields.chineseAbstract, fields.chineseKeywords])) {
    throw new Error('请填写浙大封面字段、中文题目、中文摘要和中文关键词。')
  }
  const [word, guide] = await Promise.all([
    officialFile(target, signal, fields.original),
    officialFile(target, signal, fields.guideline, workflow.guideline.sha256),
  ])
  const form = new FormData()
  form.set('intent', 'inspect')
  form.set('body', word)
  form.set('standard', guide)
  const layout = target.release ? await exportWordLayout(target, word, signal)
    : wordLayoutSchema.parse((await (await wordRequest(form, signal)).json()).layout)
  const conflict = layoutKeys.find(key => hasLayoutConflict(layout.rules[key]))
  if (conflict) throw new Error(`此版原件与规范存在未确认的冲突（${layout.rules[conflict].standard?.source}）。请先在模板工作台核对版式。`)
  const { original: _original, guideline: _guideline, email: _email, cover: _cover, declaration: _declaration, ...coverFields } = fields
  return { kind: 'zju-undergraduate' as const, main: workflow.compile.mainFile, fields: coverFields,
    layout: zjuLayout(layout), guidelineSha256: workflow.guideline.sha256, word: await encodeDocument(word) }
}

async function prepareSjtu(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { workflow } = target.entry
  if (workflow.kind !== 'word' || workflow.checks.kind !== 'sjtu-word') throw new Error('缺少上交大官方 Word 配置。')
  if (!requireFields([fields.affiliation, fields.advisor, fields.studentNumber, fields.program, fields.date,
    fields.chineseTitle, fields.chineseAbstract, fields.chineseKeywords, fields.englishAdvisor ?? '', fields.englishAffiliation ?? ''])) {
    throw new Error('请填写上交大中英文题名页字段、中文摘要及关键词。')
  }
  const word = await officialFile(target, signal, fields.original)
  const layout = await exportWordLayout(target, word, signal)
  const { original: _original, guideline: _guideline, email: _email, cover: _cover, declaration: _declaration, ...coverFields } = fields
  return { kind: 'sjtu-graduate-word' as const, main: workflow.compile.mainFile, fields: coverFields,
    layout, word: await encodeDocument(word) }
}

async function exportWordLayout(target: ExportTarget, word: File, signal: AbortSignal): Promise<WordLayout> {
  if (target.release?.kind === 'word') {
    const stored = target.release.layout
    const origin = stored.origin
    if (origin?.id !== target.entry.id || origin.version !== target.version || origin.sha256 !== target.sha256) {
      throw new Error('已发布 Word 版式的版本或哈希不一致。')
    }
    const bundle = await readWordTemplate(stored)
    if (Object.values(bundle.assets).some(Boolean)) throw new Error('该候选使用独立封面或校徽，目前无法复用到项目换模板。')
    return bundle.layout
  } else {
    const form = new FormData()
    form.set('intent', 'inspect')
    form.set('body', word)
    return wordLayoutSchema.parse((await (await wordRequest(form, signal)).json()).layout)
  }
}

async function prepareNjupt(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { workflow } = target.entry
  if (workflow.kind !== 'word' || !workflow.declaration) throw new Error('缺少南邮官方附件配置。')
  const { direction, degree, englishDegree, englishAdvisor } = fields
  const professional = workflow.njuptTrack === 'professional'
  if ((professional ? !fields.studyMode : !direction?.trim()) || !requireFields([fields.advisor, fields.studentNumber, fields.program, fields.date, fields.chineseTitle,
    fields.chineseAbstract, fields.chineseKeywords, degree ?? '', englishDegree ?? '', englishAdvisor ?? ''])) {
    throw new Error('请填写南邮中英文题名页字段、研究方向、学位类别及中文摘要。')
  }
  const word = await officialFile(target, signal, fields.original)
  const layout = await exportWordLayout(target, word, signal)
  const spec = workflow.declaration
  let declaration: File | undefined
  if (fields.declarations) {
    declaration = fields.declaration ?? await fetchOfficialFile(target.entry.id, spec.sha256, 'declaration', signal)
    if (await templateDigest(await declaration.arrayBuffer()) !== spec.sha256) {
      throw new Error('南邮声明原件的 SHA-256 与目录登记值不一致。')
    }
  }
  const { original: _original, guideline: _guideline, email: _email, cover: _cover, declaration: _declaration, ...coverFields } = fields
  return { kind: 'njupt-masters' as const, main: workflow.compile.mainFile, fields: coverFields,
    layout: layout.presentation === (professional ? 'njupt-professional' : 'njupt-academic') ? layout : njuptLayout(layout, professional, true), word: await encodeDocument(word),
    declaration: declaration && await encodeDocument(declaration), declarationSha256: declaration && spec.sha256 }
}

async function normalizedWord(word: File, signal: AbortSignal) {
  const signature = new Uint8Array(await word.slice(0, 4).arrayBuffer())
  if (signature[0] === 0x50 && signature[1] === 0x4b) return word
  const form = new FormData()
  form.set('intent', 'normalize-docx')
  form.set('body', word)
  return (await wordRequest(form, signal)).blob()
}

async function prepareAdditionalThesis(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { workflow } = target.entry
  const variant = additionalWordThesisIds.find(id => id === target.entry.id)
  if (workflow.kind !== 'word' || !variant) throw new Error('缺少该校的官方前置页配置。')
  if (!requireFields([fields.affiliation, fields.advisor, fields.studentNumber, fields.program, fields.date, fields.chineseTitle,
    fields.chineseAbstract, fields.chineseKeywords])) throw new Error('请填写封面字段、中文摘要及关键词。')
  if (variant !== 'scau-undergraduate' && !fields.degree?.trim()) throw new Error('请选择学位类别。')
  if (variant !== 'scau-undergraduate' && !fields.track) throw new Error('请选择学术或专业学位。')
  if (variant === 'ustc-graduate-word' && (!['硕士', '博士'].includes(fields.degree ?? '')
    || !requireFields([fields.englishAdvisor ?? '', fields.englishAffiliation ?? '', fields.englishProgram ?? '', fields.direction ?? '']))) {
    throw new Error('请填写中科大中英文题名页字段，并选择硕士或博士。')
  }
  const word = await officialFile(target, signal, fields.original)
  let layout: WordLayout
  if (workflow.guideline && !target.release) {
    const guideline = await officialFile(target, signal, fields.guideline, workflow.guideline.sha256)
    const form = new FormData()
    form.set('intent', 'inspect')
    form.set('body', word)
    form.set('standard', guideline)
    layout = wordLayoutSchema.parse((await (await wordRequest(form, signal)).json()).layout)
  } else layout = await exportWordLayout(target, word, signal)
  if (variant === 'suep-masters' && /硕士\s*[/／]\s*博士/.test(String(layout.rules.fixedHeader.chosen.value))) {
    const rule = layout.rules.fixedHeader
    layout = { ...layout, rules: { ...layout.rules, fixedHeader: { ...rule,
      chosen: { ...rule.chosen, value: String(rule.chosen.value).replace(/硕士\s*[/／]\s*博士/, '硕士') } } } }
  }
  if (variant === 'scau-undergraduate') {
    const rule = layout.rules.references
    const standard = rule.standard ?? { value: 'author-year', origin: 'standard' as const, source: '华南农大 2024 规范 · 参考文献著录规则。' }
    layout = { ...layout, rules: { ...layout.rules, references: { ...rule, chosen: { ...standard, value: 'author-year' },
      decision: 'standard' } } }
  }
  const { original: _original, guideline: _guideline, email: _email, cover: _cover, declaration: _declaration, ...coverFields } = fields
  return { kind: 'official-thesis' as const, variant, main: workflow.compile.mainFile, fields: { ...coverFields, track: fields.track ?? 'academic' },
    layout, word: await encodeDocument(await normalizedWord(word, signal)) }
}

async function encodeDocument(word: Blob) {
  const bytes = new Uint8Array(await word.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

async function wordThesisBuild(template: WordThesisTemplate, manuscript: ManuscriptSnapshot, signal: AbortSignal, blindCover?: File): Promise<Build> {
  const { fields, main } = template
  const zju = template.kind === 'zju-undergraduate'
  const njupt = template.kind === 'njupt-masters'
  const additional = template.kind === 'official-thesis'
  const njuptProfessional = njupt && template.layout.presentation === 'njupt-professional'
  const layout = njupt || additional ? template.layout : zju ? zjuLayout(template.layout) : template.layout.presentation === 'sjtu-engineering' ? template.layout : sjtuLayout(template.layout)
  const word = new File([Uint8Array.from(atob(template.word), char => char.charCodeAt(0))], 'official.docx')
  const values = layoutValues(layout)
  const manuscriptTitle = plainTitle(manuscript.title)
  const authorName = manuscript.authors.map(plainTitle).join('、')
  const cover = blindCover && njupt ? await njuptBlindExportFront(blindCover, { ...template.fields, title: manuscriptTitle, name: '' })
    : zju ? await zjuExportCover(word, fields.declarations, [
    fields.chineseTitle.trim(), authorName + '  ' + fields.studentNumber.trim(),
    fields.advisor.trim(), fields.program.trim(), fields.affiliation.trim(), fields.date.trim(),
  ]) : njupt ? await njuptExportFront(word, { ...template.fields, title: manuscriptTitle, name: authorName }, njuptProfessional)
    : additional ? await additionalThesisFront(word, template.variant, { ...template.fields, title: manuscriptTitle, name: authorName })
      : await sjtuExportFront(word, { ...template.fields, title: manuscriptTitle, name: authorName })
  const front = new FormData()
  front.set('intent', 'render-front')
  front.set('cover', cover)
  const frontPdf = await (await wordRequest(front, signal)).blob()
  let declarationPdf: Blob | undefined
  if (!blindCover && njupt && template.declaration) {
    const declaration = Uint8Array.from(atob(template.declaration), char => char.charCodeAt(0))
    if (await templateDigest(declaration.buffer) !== template.declarationSha256) throw new Error('南邮声明原件校验失败。')
    front.set('cover', new File([declaration], 'declaration.docx'))
    declarationPdf = await (await wordRequest(front, signal)).blob()
  }
  const bibliographyStyle = values.references === 'author-year' ? 'gbt7714-author-year' : 'gbt7714-numerical'
  const counters = (['figure', 'table'] as const).map(kind => {
    if (values[kind === 'figure' ? 'figures' : 'tables'] !== 'chapter') return ''
    return `\\counterwithin{${kind}}{section}\n\\renewcommand{\\the${kind}}{\\thesection${values.captionSeparator === 'dot' ? '.' : '-'}\\arabic{${kind}}}`
  })
  const abstract = (title: string, text: string | MappedTex, label: string, keywords: string | MappedTex) => joinMappedTex([
    `\\CustomWordAbstract{${title}}`, text,
    (typeof keywords === 'string' ? keywords : keywords.text) && joinMappedTex([`\\par\\medskip\\noindent\\textbf{${label}} `, keywords], ''),
  ], '\n\n')
  const body = manuscriptPart(manuscript, 'body')
  const source = joinMappedTex([
    `\\documentclass[fontset=fandol,${values.paper}paper,twoside]{ctexart}`,
    `\\usepackage[${customWordGeometry(values).concat('asymmetric').join(',')}]{geometry}`,
    '\\usepackage{graphicx,booktabs,array,amsmath,amssymb,pdfpages}',
    `\\usepackage[${values.references === 'author-year' ? 'authoryear' : njupt ? 'super,sort&compress' : 'numbers,sort&compress'}]{natbib}`,
    '\\usepackage[hypertexnames=false]{hyperref}', '\\input{word-layout}',
    ...(zju ? zjuCaptionSetup(true) : ['\\captionsetup{labelformat=simple}']), ...counters,
    zju ? '\\renewcommand{\\sectionmark}[1]{\\markboth{#1}{#1}}'
      : '\\renewcommand{\\sectionmark}[1]{\\markboth{第 \\thesection{} 章\\quad #1}{}}',
    ...(njupt ? [String.raw`\ctexset{section={name={第,章},number=\chinese{section},format+=\bfseries\centering}}`,
      String.raw`\renewcommand{\thesubsection}{\arabic{section}.\arabic{subsection}}`]
      : zju || additional ? [] : sjtuWordPreamble),
    '\\begin{document}', '\\CustomWordSetup',
    '\\includepdf[pages=-,pagecommand={\\thispagestyle{empty}}]{template-front/cover.pdf}',
    !!declarationPdf && '\\includepdf[pages=-,pagecommand={\\thispagestyle{empty}}]{template-front/declaration.pdf}',
    '\\CustomWordFront',
    abstract('摘要', plainTex(fields.chineseAbstract.trim()).replace(/\n\s*\n/g, '\n\n'), '关键词：', plainTex(fields.chineseKeywords.trim())),
    '\\clearpage', `\\begin{center}\\textbf{${manuscript.title}}\\end{center}`,
    abstract('Abstract', manuscriptPart(manuscript, 'abstract'), 'Keywords:', manuscriptPart(manuscript, 'keywords')),
    values.tocDepth && '\\CustomWordToc', '\\CustomWordBody',
    values.chapterBreak === 'new-page' && '\\let\\OriginalSection\\section\n\\def\\section{\\clearpage\\OriginalSection}',
    blindCover ? { ...body, text: omitBlindAcknowledgments(body.text) } : body,
    values.chapterBreak === 'new-page' && '\\let\\section\\OriginalSection',
    manuscript.bibliography.length && '\\clearpage\n\\fontsize{10.5bp}{12.6bp}\\selectfont\\songti',
    !zju && manuscript.bibliography.length && '\\markboth{参考文献}{}',
    `\\bibliographystyle{${bibliographyStyle}}`, bibliography(manuscript), '\\end{document}',
  ])
  return {
    files: new Map<string, string | Blob>([
      [main, source.text + '\n'], ['layout.json', JSON.stringify(layout)], ['word-layout.tex', customWordTex(values, fields.chineseTitle.trim())],
      ['template-front/cover.pdf', frontPdf], ...(declarationPdf ? [['template-front/declaration.pdf', declarationPdf] as const] : []),
    ]),
    lines: source.lines,
    command: 'latexmk -xelatex -no-shell-escape -interaction=nonstopmode ' + main,
    dependencies: 'TeX Live with XeLaTeX, BibTeX, latexmk, ctex, xeCJK, Fandol fonts, fontspec, TeX Gyre Termes, geometry, graphicx, booktabs, array, amsmath, amssymb, pdfpages, fancyhdr, caption, hyperref, natbib, and the GB/T 7714 bibliography style. To reproduce the original fonts, install SimSun, SimHei and Times New Roman. The rendered cover is included, so recompiling the source ZIP does not require LibreOffice.',
    notes: blindCover ? 'NJUPT anonymous review cover SHA-256: ' + njuptBlindCover.sha256 + '. The source contains the review cover and the anonymous rendering only.'
      : zju ? 'Word and guideline SHA-256 were checked independently. Guideline SHA-256: ' + template.guidelineSha256 + '. The exported cover is rendered from the original artwork and text runs. LibreOffice uses automatic front-matter flow to avoid a split cover.'
      : njupt ? 'NJUPT master title pages use the verified Word original; unsigned declarations use the separate registered attachment. Declaration SHA-256: ' + (template.declarationSha256 ?? 'not included')
      : additional ? 'Front pages prepared from the registered university Word original; verify degree, signatures and final submission metadata.'
      : 'Shanghai Jiao Tong University engineering master example. Title pages and optional declarations are rendered from the verified Word file, which uses real author, advisor and institution fields.' ,
  }
}

async function preparePrl(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { entry } = target
  if (entry.delivery !== 'archive' || entry.workflow.prepare !== 'revtex') throw new Error('缺少官方 REVTeX 配置。')
  if (!fields.affiliation.trim()) throw new Error('请输入作者单位。')
  const source = await officialFile(target, signal, fields.original)
  const project = await importCatalogTemplate(entry, source, entry.name, target.release)
  const main = entry.workflow.compile.mainFile
  const folder = main.slice(0, main.lastIndexOf('/') + 1)
  const styles: Record<string, string> = {}
  for (const [path, file] of project.files) {
    if (!path.startsWith(folder) || file.type === 'directory') continue
    const name = path.slice(folder.length)
    if (/^[\w.-]+\.(?:cls|rtx|bst|sty|def)$/.test(name)) {
      const content = file.content ?? await file.blob?.text()
      if (content) styles[name] = content
    }
  }
  if (!styles['revtex4-2.cls'] || !styles['aps4-2.rtx'] || !styles['apsrev4-2.bst']) throw new Error('官方源包缺少 PRL 编译文件。')
  return { kind: 'prl-article' as const, main: main.slice(folder.length), styles,
    fields: { affiliation: fields.affiliation, email: fields.email } }
}

function prlBuild(template: Extract<ActiveTemplate, { kind: 'prl-article' }>, manuscript: ManuscriptSnapshot): Build {
  assertEnglishManuscript(manuscript, 'PRL')
  const { fields, main, styles } = template
  if ([fields.affiliation, fields.email].some(value => /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(value))) {
    throw new Error('PRL 的作者单位和联系邮箱请使用英文。')
  }
  const source = joinMappedTex([
    '\\documentclass[aps,prl,preprint,groupedaddress]{revtex4-2}',
    '\\usepackage{graphicx,booktabs,array,amsmath,amssymb,hyperref}',
    '\\begin{document}', `\\title{${manuscript.title}}`,
    ...manuscript.authors.flatMap(author => [`\\author{${author}}`, fields.email && `\\email{${plainTex(fields.email.trim())}}`,
      `\\affiliation{${plainTex(fields.affiliation.trim())}}`]),
    '\\begin{abstract}', manuscriptPart(manuscript, 'abstract'), '\\end{abstract}',
    manuscript.keywords && joinMappedTex(['\\keywords{', manuscriptPart(manuscript, 'keywords'), '}'], ''),
    '\\maketitle', manuscriptPart(manuscript, 'body'), bibliography(manuscript), '\\end{document}',
  ])
  return { files: new Map([...Object.entries(styles), [main, source.text + '\n']]), lines: source.lines,
    command: 'latexmk -pdf -no-shell-escape -interaction=nonstopmode ' + main,
    dependencies: 'pdfLaTeX, BibTeX, latexmk, natbib, graphicx, booktabs, array, amsmath, amssymb, hyperref and REVTeX dependencies.',
    notes: 'Uses the official APS PRL preprint submission option and the verified REVTeX class and bibliography style.' }
}

async function prepareSuep(target: ExportTarget, fields: ExportFields, signal: AbortSignal, manuscript: ManuscriptSnapshot) {
  const { workflow } = target.entry
  if (workflow.kind !== 'word-import' || workflow.profile !== 'suep-undergraduate') throw new Error('缺少上电本科 Word 配置。')
  if (!requireFields([fields.chineseTitle, fields.chineseAbstract, fields.chineseKeywords])) throw new Error('请填写中文题目、摘要与关键词。')
  async function render(file: File | undefined, role: 'cover' | 'declaration') {
    const expected = suepUndergraduateSource.switchAssets[role].sha256
    const label = role === 'cover' ? '本科封面' : '原创性及使用授权声明'
    if (!file?.size || await templateDigest(await file.arrayBuffer()) !== expected) {
      throw new Error(`请上传与登记版本一致的官方${label} DOC 原件。`)
    }
    const form = new FormData()
    form.set('intent', 'render-front')
    form.set('cover', new File([file], role + '.doc'))
    if (role === 'cover') form.set('suep-cover-fields', JSON.stringify({
      title: fields.chineseTitle, affiliation: fields.affiliation, program: fields.program,
      author: manuscript.authors.map(plainTitle).join('、'), studentNumber: fields.studentNumber,
      advisor: fields.advisor, date: fields.date,
    }))
    return encodeDocument(await (await wordRequest(form, signal)).blob())
  }
  const cover = await render(fields.cover, 'cover')
  const declaration = await render(fields.declaration, 'declaration')
  const { chineseTitle, chineseAbstract, chineseKeywords, affiliation, program, studentNumber, advisor, date } = fields
  return { kind: 'suep-undergraduate' as const, main: workflow.compile.mainFile,
    cover, declaration, fields: { chineseTitle, chineseAbstract, chineseKeywords, affiliation, program, studentNumber, advisor, date },
    coverSha256: suepUndergraduateSource.switchAssets.cover.sha256, declarationSha256: suepUndergraduateSource.switchAssets.declaration.sha256 }
}

function suepBuild(template: Extract<ActiveTemplate, { kind: 'suep-undergraduate' }>, manuscript: ManuscriptSnapshot): Build {
  const { fields, main } = template
  const source = joinMappedTex([
    '\\documentclass[fontset=fandol,a4paper,zihao=-4]{ctexart}',
    `\\usepackage[${suepGeometry.join(',')}]{geometry}`,
    '\\usepackage{graphicx,booktabs,array,amsmath,amssymb,pdfpages}',
    '\\usepackage[super,sort&compress]{natbib}',
    '\\usepackage[hidelinks,hypertexnames=false]{hyperref}', '\\input{suep-layout}',
    '\\captionsetup{labelformat=simple}',
    '\\captionsetup[figure]{labelformat=simple}', '\\captionsetup[table]{position=top,font=suep,labelformat=simple}',
    '\\counterwithin{figure}{section}', '\\counterwithin{table}{section}',
    '\\renewcommand{\\thefigure}{\\thesection-\\arabic{figure}}',
    '\\renewcommand{\\thetable}{\\thesection-\\arabic{table}}',
    '\\begin{document}',
    '\\includepdf[pages=1,pagecommand={\\thispagestyle{empty}}]{template-front/cover.pdf}',
    '\\includepdf[pages=-,pagecommand={\\thispagestyle{empty}}]{template-front/declaration.pdf}',
    '\\SuepSetup', '\\begin{SuepChineseAbstract}', plainTex(fields.chineseAbstract.trim()), '\\end{SuepChineseAbstract}',
    `\\SuepKeywords{关键词：}{${plainTex(fields.chineseKeywords.trim())}}`,
    `\\SuepEnglishTitle{${manuscript.title}}`,
    '\\begin{SuepEnglishAbstract}', manuscriptPart(manuscript, 'abstract'), '\\end{SuepEnglishAbstract}',
    manuscript.keywords && joinMappedTex(['\\SuepKeywords{Keywords: }{', manuscriptPart(manuscript, 'keywords'), '}'], ''),
    '\\clearpage\\tableofcontents', '\\SuepStartBody',
    '\\let\\OriginalSection\\section\\def\\section{\\clearpage\\OriginalSection}',
    manuscriptPart(manuscript, 'body'), '\\let\\section\\OriginalSection',
    manuscript.bibliography.length > 0 && '\\clearpage\\zihao{5}\\songti\\bibliographystyle{gbt7714-numerical}',
    bibliography(manuscript), '\\end{document}',
  ])
  const pdf = (data: string) => new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: 'application/pdf' })
  return { files: new Map<string, string | Blob>([
    [main, source.text + '\n'], ['suep-layout.tex', suepTexLayout(fields.chineseTitle.trim())],
    ['template-front/cover.pdf', pdf(template.cover)], ['template-front/declaration.pdf', pdf(template.declaration)],
  ]), lines: source.lines,
  command: 'latexmk -xelatex -no-shell-escape -interaction=nonstopmode ' + main,
  dependencies: 'XeLaTeX, BibTeX, latexmk, ctex, Fandol or school fonts, geometry, pdfpages, fancyhdr, caption, natbib and gbt7714.',
  notes: 'Verified official cover SHA-256: ' + template.coverSha256 + '. Declaration SHA-256: ' + template.declarationSha256 + '.' }
}

async function prepareStarter(target: ExportTarget) {
  const { entry } = target
  if (entry.delivery !== 'built-in') throw new Error('缺少内置论文格式。')
  const source = await createTemplateProject(entry.template.id, entry.name)
  if (source.metadata.templateOrigin?.sha256 !== target.sha256) throw new Error('内置模板的源包版本未登记。')
  return { kind: 'starter-article' as const, main: entry.workflow.compile.mainFile, variant: entry.template.id, fields: {} }
}

function starterBuild(template: Extract<ActiveTemplate, { kind: 'starter-article' }>, manuscript: ManuscriptSnapshot): Build {
  const chinese = template.variant === 'chinese-article'
  if (!chinese) assertEnglishManuscript(manuscript, template.name)
  const source = joinMappedTex([
    chinese ? String.raw`\documentclass[UTF8,fontset=fandol]{ctexart}` : String.raw`\documentclass{article}`,
    String.raw`\usepackage{graphicx,booktabs,array,amsmath,amssymb,hyperref}`,
    String.raw`\usepackage[numbers,sort&compress]{natbib}`,
    `\\title{${manuscript.title}}`, `\\author{${manuscript.authors.join(' \\and ')}}`,
    String.raw`\date{}`, String.raw`\begin{document}`, String.raw`\maketitle`,
    String.raw`\begin{abstract}`, manuscriptPart(manuscript, 'abstract'), String.raw`\end{abstract}`,
    manuscriptPart(manuscript, 'keywords'), manuscriptPart(manuscript, 'body'),
    String.raw`\bibliographystyle{plainnat}`, bibliography(manuscript), String.raw`\end{document}`,
  ])
  const { main } = template
  return {
    files: new Map([[main, source.text + '\n']]), lines: source.lines,
    command: 'latexmk ' + (chinese ? '-xelatex' : '-pdf') + ' -no-shell-escape -interaction=nonstopmode ' + main,
    dependencies: chinese ? 'XeLaTeX, latexmk, BibTeX, ctex and Fandol.' : 'pdfLaTeX, latexmk, BibTeX, booktabs and natbib.',
    notes: 'The built-in article layout includes the manuscript and its original references.',
  }
}

async function prepareThuThesis(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { entry } = target
  if (entry.delivery !== 'archive') throw new Error('缺少 ThuThesis 源包配置。')
  if (!requireFields([fields.chineseTitle, fields.chineseAbstract, fields.chineseKeywords, fields.advisor,
    fields.englishAdvisor ?? '', fields.program, fields.englishProgram ?? '', fields.date, fields.affiliation])
    || !['bachelor', 'master', 'doctor'].includes(fields.degree ?? '')) throw new Error('请填写 ThuThesis 学位、培养单位和中英文字段。')
  if (fields.degree !== 'bachelor' && (!fields.degreeTitle?.includes(fields.degree === 'master' ? '硕士' : '博士')
    || !fields.englishDegree?.trim())) throw new Error('请填写与所选学位匹配的中英文学位类别。')
  const original = await officialFile(target, signal, fields.original)
  const project = await importCatalogTemplate(entry, original, entry.name, target.release)
  const root = project.metadata.mainFile.slice(0, project.metadata.mainFile.lastIndexOf('/') + 1)
  const style = (path: string) => project.files.get(root + path)
  const cls = style('thuthesis.cls')
  const bst = style('thuthesis-numeric.bst')
  const figLogo = style('thu-fig-logo.pdf')
  const textLogo = style('thu-text-logo.pdf')
  if (cls?.type === 'directory' || bst?.type === 'directory' || !cls?.content || !bst?.content
    || figLogo?.type === 'directory' || textLogo?.type === 'directory' || !figLogo?.blob || !textLogo?.blob) {
    throw new Error('源包缺少原版 ThuThesis 类、参考文献样式或校徽。')
  }
  return { kind: 'thuthesis' as const, main: 'main.tex', fields: { ...fields, date: fields.date.trim() },
    styles: { 'thuthesis.cls': cls.content, 'thuthesis-numeric.bst': bst.content },
    logos: { 'thu-fig-logo.pdf': await encodeDocument(figLogo.blob), 'thu-text-logo.pdf': await encodeDocument(textLogo.blob) } }
}


function thesisChapterBody(manuscript: ManuscriptSnapshot): MappedTex {
  const body = manuscriptPart(manuscript, 'body')
  const headings = { section: 'chapter', subsection: 'section', subsubsection: 'subsection' }
  let cursor = 0
  const parts: string[] = []
  for (const match of maskLatexCode(body.text).matchAll(/\\(section|subsection|subsubsection)(?![A-Za-z@])/g)) {
    parts.push(body.text.slice(cursor, match.index), '\\' + headings[match[1] as keyof typeof headings])
    cursor = match.index + match[0].length
  }
  parts.push(body.text.slice(cursor))
  return { ...body, text: parts.join('') }
}

async function prepareMit(target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  if (target.entry.delivery !== 'archive') throw new Error('缺少 MIT 官方源包配置。')
  const { affiliation, advisor, date, degree, advisorTitle, acceptor, acceptorTitle, acceptorRole, degreeDate } = fields
  if (!requireFields([affiliation, advisor, date, degree ?? '', advisorTitle ?? '', acceptor ?? '', acceptorTitle ?? '', acceptorRole ?? ''])) {
    throw new Error('请填写 MIT 封面和学位信息。')
  }
  if (!/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(degreeDate ?? '')) {
    throw new Error('学位授予时间请用英文月份和四位年份。')
  }
  const original = await officialFile(target, signal, fields.original)
  const source = await importCatalogTemplate(target.entry, original, target.entry.name)
  const style = source.files.get('mitthesis/mitthesis.cls')
  if (style?.type === 'directory' || !style?.content) throw new Error('MIT 官方源包缺少文档类。')
  return { kind: 'mit-thesis' as const, main: 'main.tex', style: style.content,
    fields: { affiliation, advisor, date, degree, advisorTitle, acceptor, acceptorTitle, acceptorRole, degreeDate } }
}

function mitBuild(template: Extract<ActiveTemplate, { kind: 'mit-thesis' }>, manuscript: ManuscriptSnapshot): Build {
  const { fields, main, style } = template
  if (manuscript.unicodeLocation) {
    const { path, line } = manuscript.unicodeLocation
    throw new Error(path + ':' + line + ' · 当前 MIT 目录版未配置中日韩字体。')
  }
  const [month, year] = fields.degreeDate.split(' ')
  const braces = (...values: string[]) => values.map(value => '{' + plainTex(value.trim()) + '}').join('')
  const hasBib = manuscript.bibliography.length > 0
  const source = joinMappedTex([
    '\\DocumentMetadata{lang=en-US,pdfstandard=A-2b}', '\\documentclass[twoside]{mitthesis}',
    '\\usepackage{graphicx,booktabs,array}', hasBib && '\\usepackage[natbib=true,style=ext-numeric-comp,giveninits=true,sorting=none,language=american]{biblatex}',
    ...manuscript.bibliography.map(item => '\\addbibresource{' + item.path + '}'),
    '\\title{' + manuscript.title + '}',
    ...manuscript.authors.map(author => '\\Author{' + author + '}' + braces(fields.affiliation)),
    '\\Degree' + braces(fields.degree, fields.affiliation),
    '\\Supervisor' + braces(fields.advisor, fields.advisorTitle),
    '\\Acceptor' + braces(fields.acceptor, fields.acceptorTitle, fields.acceptorRole, ''),
    '\\DegreeDate' + braces(month, year), '\\ThesisDate' + braces(fields.date),
    '\\begin{document}', '\\maketitle',
    '\\begin{abstract}', manuscriptPart(manuscript, 'abstract'), '\\end{abstract}',
    manuscript.keywords && joinMappedTex(['\\noindent\\textbf{Keywords: }', manuscriptPart(manuscript, 'keywords')], ''),
    '\\tableofcontents', thesisChapterBody(manuscript),
    hasBib && '\\printbibliography[title={References},heading=bibintoc]', '\\end{document}',
  ])
  return { files: new Map([[main, source.text + '\n'], ['mitthesis.cls', style]]), lines: source.lines,
    command: 'latexmk -norc -lualatex -synctex=1 -latexoption=-no-shell-escape main.tex',
    dependencies: 'Node.js, LuaLaTeX, latexmk, Biber and the current TeX Live packages required by MIT.',
    notes: 'Run node compile-mit.mjs for a verified workbench preview when the script is included.' }
}

export async function prepareExternalTemplate(manuscript: ManuscriptSnapshot, files: ProjectFileSystem['files'],
  main: string, target: ExportTarget, fields: ExportFields, signal: AbortSignal,
  current?: Extract<ActiveTemplate, { kind: 'mit-thesis' }>) {
  const registered = exportTargets.find(item => item.entry.exportProfile === 'mit-thesis'
    && item.entry.id === target.entry.id && item.version === target.version && item.sha256 === target.sha256)
  if (!registered) throw new Error('MIT 版本与目录登记原件不匹配。')
  const { entry, version, sha256 } = registered
  const configuration = current && !fields.original ? { ...current, fields } : await prepareMit(registered, fields, signal)
  const template = activeTemplateSchema.parse({ ...configuration, selectionId: crypto.randomUUID(),
    name: entry.name, origin: { id: entry.id, version, sha256 } })
  if (template.kind !== 'mit-thesis') throw new Error('缺少 MIT 编译配置。')
  const { files: rendered, lines } = await assembleTemplate(manuscript, template, signal)
  const sourceSha256 = await projectSourceDigest(files, main)
  const build = await packageExternalTemplate(rendered, lines, manuscript.lineSources.body, sourceSha256)
  signal.throwIfAborted()
  return { build, template }
}


function thuThesisBuild(template: Extract<ActiveTemplate, { kind: 'thuthesis' }>, manuscript: ManuscriptSnapshot): Build {
  const { fields, main, styles, logos } = template
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) throw new Error('ThuThesis 提交日期请使用 YYYY-MM-DD 格式。')
  const source = joinMappedTex([
    `\\documentclass[degree=${fields.degree},fontset=fandol]{thuthesis}`, '\\usepackage{graphicx,booktabs,array}',
    '\\thusetup{',
    `title={${plainTex(fields.chineseTitle)}}, title*={${manuscript.title}},`,
    `author={${manuscript.authors.join('、')}}, author*={${manuscript.authors.join(', ')}},`,
    `department={${plainTex(fields.affiliation)}}, discipline={${plainTex(fields.program)}}, discipline*={${plainTex(fields.englishProgram)}},`,
    fields.degree !== 'bachelor' && `degree-category={${plainTex(fields.degreeTitle ?? (fields.degree === 'master' ? '硕士' : '博士'))}},`,
    fields.degree !== 'bachelor' && `degree-category*={${plainTex(fields.englishDegree ?? (fields.degree === 'master' ? 'Master’s Degree' : 'Doctoral Degree'))}},`,
    `supervisor={${plainTex(fields.advisor)}}, supervisor*={${plainTex(fields.englishAdvisor)}}, date={${fields.date}},`,
    `keywords={${plainTex(fields.chineseKeywords.replace(/[；;，]/g, ','))}},`,
    manuscript.keywords && joinMappedTex(['keywords*={', manuscriptPart(manuscript, 'keywords'), '},'], ''), '}',
    '\\begin{document}', '\\maketitle', '\\frontmatter',
    '\\begin{abstract}', plainTex(fields.chineseAbstract), '\\end{abstract}',
    '\\begin{abstract*}', manuscriptPart(manuscript, 'abstract'), '\\end{abstract*}',
    '\\tableofcontents', '\\mainmatter', thesisChapterBody(manuscript),
    '\\bibliographystyle{thuthesis-numeric}', bibliography(manuscript), '\\end{document}',
  ])
  return {
    files: new Map<string, string | Blob>([[main, source.text + '\n'], ...Object.entries(styles),
      ...Object.entries(logos).map(([path, data]) => [path, new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))])] as const)]),
    lines: source.lines, command: 'latexmk -xelatex -no-shell-escape -interaction=nonstopmode ' + main,
    dependencies: 'XeLaTeX, latexmk, BibTeX, Fandol and XITS fonts, and the TeX Live packages required by ThuThesis.',
    notes: 'The community ThuThesis class handles the degree-specific cover, chapters, pagination and citations.',
  }
}

async function preparePublisher(target: ExportTarget, fields: ExportFields, signal: AbortSignal, manuscript: ManuscriptSnapshot) {
  const { entry } = target
  const variant = publisherArticleIds.find(id => id === entry.id)
  if (entry.delivery !== 'archive' || !variant) throw new Error('缺少官方期刊源包配置。')
  assertEnglishManuscript(manuscript, entry.name)
  if (!fields.affiliation.trim()) throw new Error('请输入作者单位。')
  const original = await officialFile(target, signal, fields.original)
  const project = await importCatalogTemplate(entry, original, entry.name, target.release)
  const entryPath = entry.workflow.compile.mainFile
  let preamble: string | undefined
  if (variant === 'plos-one') {
    const entry = project.files.get(entryPath)
    const body = entry?.type !== 'directory' && entry?.content
    const start = body && /^\\begin\{document\}/m.exec(body)
    if (!body || !start || !body.includes('\\usepackage{cite}')) throw new Error('PLOS 官方导言区不匹配。')
    preamble = body.slice(0, start.index).replace('\\usepackage{cite}', '\\usepackage[numbers,sort&compress]{natbib}').trimEnd()
      + '\n\\usepackage{booktabs}'
  }
  const { affiliation, email, keyPoint, keyPoint2, keyPoint3, plainLanguageSummary, openResearch } = fields
  if (variant === 'agu-jgr-atmospheres' && !requireFields([email, keyPoint ?? '', plainLanguageSummary ?? '', openResearch ?? ''])) {
    throw new Error('请填写通讯邮箱、Key Points、通俗摘要和 Open Research 声明。')
  }
  const selection = { affiliation, email, keyPoint, keyPoint2, keyPoint3, plainLanguageSummary, openResearch }
  const recipe = publisherArticle(variant, manuscript, selection, plainTex, preamble)
  const styles: Record<string, string> = {}
  const artwork: Record<string, string> = {}
  for (const name of [...recipe.packages, ...('artwork' in recipe ? recipe.artwork ?? [] : [])]) {
    const candidates = [...project.files.values()].filter(file => file.name === name && file.type !== 'directory')
    if (candidates.length !== 1) throw new Error('官方源包缺少唯一的 ' + name)
    const file = candidates[0]
    if (file.type === 'directory') continue
    if (name.endsWith('.pdf')) {
      if (!file.blob) throw new Error('不能读取官方 ' + name)
      artwork[name] = await encodeDocument(file.blob)
      continue
    }
    const content = file.content ?? await file.blob?.text()
    if (!content) throw new Error('不能读取官方 ' + name)
    styles[name] = content
  }
  return { kind: 'publisher-article' as const, variant, main: entryPath.split('/').at(-1)!, fields: selection, preamble, styles, artwork: Object.keys(artwork).length ? artwork : undefined }
}

function publisherBuild(template: Extract<ActiveTemplate, { kind: 'publisher-article' }>, manuscript: ManuscriptSnapshot, lineNumberedDraft: boolean): Build {
  assertEnglishManuscript(manuscript, template.name)
  const { variant, fields, main, styles, preamble } = template
  const recipe = publisherArticle(variant, manuscript, fields, plainTex, preamble, lineNumberedDraft)
  const files = new Map<string, string | Blob>(Object.entries(styles))
  for (const [path, value] of Object.entries(template.artwork ?? {})) {
    files.set(path, new Blob([Uint8Array.from(atob(value), char => char.charCodeAt(0))], { type: 'application/pdf' }))
  }
  if (variant === 'plos-one' || variant === 'ieee-compsoc') {
    const plos = variant === 'plos-one'
    const original = files.get(plos ? 'plos2025.bst' : 'IEEEtran.bst')
    if (typeof original !== 'string') throw new Error('缺少已校验的官方参考文献样式。')
    files.set(recipe.bibStyle + '.bst', numericPublisherBibliography(original, plos ? 'output.bibitem' : 'start.entry'))
  }
  const body = manuscriptPart(manuscript, 'body')
  // MNRAS decides float placement in the class. Its float environments can print a placement argument as text.
  if (variant === 'mnras') body.text = body.text.replace(/(\\begin\{(?:figure|table)\*?\})[ \t]*\[[htbp!H ]+\]/g, '$1')
  const source = joinMappedTex([
    ...recipe.beforeBody, body, ...(recipe.afterBody ?? []),
    recipe.bibStyle && '\\bibliographystyle{' + recipe.bibStyle + '}',
    bibliography(manuscript), '\\end{document}',
  ])
  files.set(main, source.text + '\n')
  return { files, lines: source.lines,
    command: 'latexmk -pdf -no-shell-escape -interaction=nonstopmode ' + main,
    dependencies: 'pdfLaTeX, BibTeX, latexmk, and the TeX Live packages required by the selected official publishing template.',
    notes: 'Publisher source package for ' + (variant satisfies PublisherArticleId) + ' is pinned to the catalog version.' }
}

export async function exportWithTemplate(manuscript: ManuscriptSnapshot, requested: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const target = requested.release ? requested.release.switchAcceptance?.protocol === 1 && switchTargetForRelease(requested.release)
    : exportTargets.find(item => item.entry.id === requested.entry.id && item.version === requested.version && item.sha256 === requested.sha256)
  if (!target) throw new Error('该模板版本尚未开放跨模板导出。')
  if (target.entry.exportProfile === 'mit-thesis') throw new Error('请通过 MIT 外部编译回传预览。')
  const result = await compileTemplateTarget(manuscript, target, fields, signal)
  if (target.release) {
    const lines = new Set([...manuscript.lineSources.body.values()].map(line => line.path + '\0' + line.line))
    const { regions } = result.preview
    if (!regions.some(region => lines.has(region.path + '\0' + region.line) && roundTripRegion(regions, region))) {
      throw new Error('此稿件的候选 PDF 缺少可用的正文双向定位。项目仍使用当前版本。')
    }
  }
  return result
}

function roundTripRegion(regions: SyncRegion[], region: SyncRegion) {
  const back = findSourceRegion(regions, region.page, region.x + region.width / 2, region.y + region.height / 2)
  return back?.path === region.path && back.line === region.line
}

/** Verify the switch renderer with an independent manuscript before recording acceptance. */
export async function acceptTemplateSwitchRelease(release: OfficialTemplateRelease, signal: AbortSignal): Promise<OfficialTemplateRelease> {
  const target = switchTargetForRelease(release)
  if (!target) return release
  const sections = [
    { path: 'sections/method.tex', text: 'The method uses three independent observations.', heading: 'Study design' },
    { path: 'sections/results.tex', text: 'Independent results confirm the calibration.', heading: 'Results' },
  ]
  const zip = new JSZip()
  const main = 'main.tex'
  zip.file(main, [
    '\\documentclass{article}', '\\title{Independent Template Acceptance}', '\\author{Casey Lin}',
    '\\begin{document}', '\\maketitle', '\\begin{abstract}', 'This calibration manuscript verifies the compiled template.',
    '\\end{abstract}', ...sections.map(({ path }) => '\\input{' + path + '}'), '\\end{document}',
  ].join('\n'))
  for (const { path, heading, text } of sections) zip.file(path, '\\section{' + heading + '}\n' + text + '\n')
  const project = await importSourceArchive(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'acceptance.zip'))
  const fields: ExportFields = {
    track: 'academic', englishProgram: 'Electrical Engineering', affiliation: '工程学院', englishAffiliation: 'School of Engineering', englishAdvisor: 'Ming Li', email: '',
    direction: '测量方法', degree: '工学硕士', englishDegree: 'Master of Science in Engineering',
    advisor: '李明', studentNumber: '20260001', program: '电气工程', date: '2026-11-26',
    studyMode: 'full-time', keyPoint: 'Independent measurements reproduce the calibration.',
    plainLanguageSummary: 'We compared independent measurements against a shared reference.', openResearch: 'The synthetic acceptance observations are listed in the manuscript.',
    chineseTitle: '独立校准研究', chineseAbstract: '使用独立稿验证当前版式及正文定位。', chineseKeywords: '校准；测量', declarations: true,
  }
  const { preview } = await compileTemplateTarget(captureManuscript(project.files, main), target,
    release.id === 'tsinghua-thesis' ? { ...fields, degree: 'master', degreeTitle: '工学硕士' }
      : release.kind === 'zip' ? { ...fields, affiliation: 'Calibration Methods Laboratory', email: 'casey@example.org' }
      : release.id === 'ustc-graduate-word' ? { ...fields, degree: '硕士' } : fields, signal)
  const { readPdfLayout } = await import('./pdf-layout-client')
  const pages = await readPdfLayout(preview.pdf, signal)
  const anchors = sections.map(({ path, text }) => {
    const line = 2
    const region = findPdfRegion(preview.regions, path, line)
    if (region?.line !== line || !roundTripRegion(preview.regions, region)
      || !pages[region.page - 1]?.text.replace(/\s+/g, ' ').includes(text)) {
      throw new Error(`候选版双向定位验收失败（${path}:${line}）。`)
    }
    return { path, line, page: region.page }
  })
  return { ...release, switchAcceptance: { protocol: 1, anchors, pdfSha256: await preview.pdf.arrayBuffer().then(templateDigest) } }
}

async function compileTemplateTarget(manuscript: ManuscriptSnapshot, target: ExportTarget, fields: ExportFields, signal: AbortSignal) {
  const { entry, version, sha256 } = target
  const prepare = { 'publisher-article': preparePublisher, 'zju-undergraduate': prepareZju, 'jmlr-article': prepareJmlr,
    'suep-undergraduate': prepareSuep, 'prl-article': preparePrl, 'njupt-masters': prepareNjupt, 'official-thesis': prepareAdditionalThesis, 'thuthesis': prepareThuThesis, 'starter-article': prepareStarter, 'sjtu-graduate-word': prepareSjtu, 'mit-thesis': prepareMit }[entry.exportProfile!]
  const configuration = await prepare(target, fields, signal, manuscript)
  const template = activeTemplateSchema.parse({ ...configuration, selectionId: crypto.randomUUID(),
    name: entry.name, origin: { id: entry.id, version, sha256 } })
  const { project, archive, lines } = await renderTemplate(manuscript, template, signal)
  const name = template.origin.id + '-' + template.origin.version
  const { pdf, regions } = await compileWordProjectWithSync(project, signal)
  signal.throwIfAborted()
  return { archive, preview: { pdf, regions: manuscriptRegions(regions, template.main, lines) }, name, template }
}

export async function projectWithActiveTemplate(project: ProjectFileSystem, main: string, signal: AbortSignal,
  stage?: SubmissionStage, uploadedCover?: File) {
  const template = project.metadata.activeTemplate
  if (!template) return { project }
  const manuscript = captureManuscript(project.files, main)
  if (stage !== 'njupt-blind') return renderTemplate(manuscript, template, signal, stage && { stage })
  if (template.kind !== 'njupt-masters' || template.origin.id !== 'njupt-professional-masters' || template.fields.studyMode !== 'full-time') {
    throw new Error('已核验的南邮专硕盲审封面适用于全日制。请先在「更换模板」中启用南邮专硕版式并填写适用字段。')
  }
  const cover = uploadedCover ?? await fetchOfficialFile(template.origin.id, njuptBlindCover.sha256, 'blind-cover', signal)
  if (await templateDigest(await cover.arrayBuffer()) !== njuptBlindCover.sha256) throw new Error('盲审封面原件 SHA-256 校验失败。请选择学校发布的全日制专硕盲审封面。')
  const result = await renderTemplate(manuscript, template, signal, { stage, blindCover: new File([await normalizedWord(cover, signal)], 'blind-cover.docx') })
  return { ...result, blind: { coverVerified: true, identifiers: [
    ...manuscript.authors.map(plainTitle), template.fields.studentNumber, template.fields.advisor, template.fields.englishAdvisor ?? '',
  ] } }
}

type SubmissionRender = { stage: SubmissionStage; blindCover?: File }

async function assembleTemplate(manuscript: ManuscriptSnapshot, template: ActiveTemplate, signal: AbortSignal, submission?: SubmissionRender) {
  signal.throwIfAborted()
  let build: Build
  switch (template.kind) {
    case 'jmlr-article': build = jmlrBuild(template, manuscript); break
    case 'zju-undergraduate':
    case 'official-thesis':
    case 'njupt-masters':
    case 'sjtu-graduate-word': build = await wordThesisBuild(template, manuscript, signal, submission?.blindCover); break
    case 'suep-undergraduate': build = suepBuild(template, manuscript); break
    case 'starter-article': build = starterBuild(template, manuscript); break
    case 'mit-thesis': build = mitBuild(template, manuscript); break;
    case 'thuthesis': build = thuThesisBuild(template, manuscript); break
    case 'publisher-article': build = publisherBuild(template, manuscript, submission?.stage === 'agu-initial'); break
    case 'prl-article': build = prlBuild(template, manuscript); break
  }
  const { name, origin: { version, sha256 } } = template
  const manuscriptSha256 = await snapshotDigest(manuscript)
  const buildInstructions = [
    '# Compile this export', '', name, '', 'Template version: ' + version, 'Source SHA-256: ' + sha256, 'Manuscript SHA-256: ' + manuscriptSha256,
    '', 'Run in this directory:', '', '```sh', build.command, '```', '', build.dependencies, '', build.notes, '',
  ].join('\n')
  build.files.set('BUILD.md', buildInstructions)
  for (const { path, content } of manuscript.bibliography) {
    if (build.files.has(path)) throw new Error(`参考文献路径 ${path} 与目标模板文件冲突。`)
    build.files.set(path, content)
  }
  for (const { path, blob } of manuscript.assets) {
    if (build.files.has(path)) throw new Error(`素材路径 ${path} 与目标模板文件冲突。`)
    build.files.set(path, blob)
  }
  return build
}

async function renderTemplate(manuscript: ManuscriptSnapshot, template: ActiveTemplate, signal: AbortSignal, submission?: SubmissionRender) {
  const build = await assembleTemplate(manuscript, template, signal, submission)
  const { main, origin: { id, version } } = template
  const zip = new JSZip()
  for (const [path, data] of build.files) zip.file(path, data instanceof Blob ? await data.arrayBuffer() : data)
  const archive = new File([await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })],
    id + '-' + version + '.zip', { type: 'application/zip' })
  const project = await importSourceArchive(archive)
  signal.throwIfAborted()
  project.metadata.mainFile = main
  project.metadata.compileProfile = template.kind === 'mit-thesis' ? { engine: 'lualatex', bibliography: 'auto' }
    : { engine: activeTemplateEngine(template) === 'xelatex' ? 'xelatex' : 'pdflatex', bibliography: manuscript.bibliography.length ? 'bibtex' : 'none' }
  project.metadata.templateOrigin = template.origin
  return { project, archive, lines: build.lines }
}
