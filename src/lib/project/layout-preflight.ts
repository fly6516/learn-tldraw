import { indexCrossReferences } from './cross-references'
import { groupEnd, lineNumber, maskLatexCode } from './latex-source'
import { findPdfRegion, type SyncRegion } from './source-sync'
import type { CompileReport } from './compile-diagnostics'
import type { ProjectFileSystem } from './types'
import { compareLayoutRule, formatStandard, layoutState, matchesStandard, wordLayoutSchema,
  type LayoutComparison, type LayoutKey, type WordLayout } from './word-layout'
import { buildProjectOutline } from './outline'
import { assessBibliography } from './layout-bibliography'
import { suepMargins } from './suep-word-layout'
import { readCompiledGeometry, type GeometryMargins } from './layout-geometry'
import { templateCatalog } from './template-catalog'
import { thesisManualChecks } from './thesis-manual-checks'

export type LayoutFinding = {
  label: string
  status: 'pass' | 'issue' | 'manual'
  detail: string
  evidence: string
  ruleId?: string
  sourceUrl?: string
  expected?: string
  observed?: string
  comparisons?: LayoutComparison[]
  page?: number
  path?: string
  line?: number
}

export type PdfLayoutPage = {
  width: number
  height: number
  text: string
  runningLineNumbers?: boolean
  footer?: string
  footerPosition?: 'left' | 'center' | 'right'
  header?: string
  toc?: boolean
  bibliographyHeading?: boolean
  bodyInTwoColumns?: boolean
  figureCaption?: boolean
  tableCaption?: boolean
  links?: { printed?: string; target?: number; title?: string }[]
}

const paperSizes = { a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4] }
const marginNames = { left: '左', right: '右', top: '上', bottom: '下', binding: '装订线' } as const
const marginKeys = Object.keys(marginNames) as (keyof GeometryMargins)[]
const marginRule = (key: keyof GeometryMargins) => key === 'binding' ? 'gutter' : key
const pdfPtToMm = 25.4 / 72

function assessMargins(expected: GeometryMargins, pages: PdfLayoutPage[], bodyPage: number | undefined,
  sources: ReadonlyMap<string, string>, main: string, report: CompileReport | undefined, ruleSource: string, layout?: WordLayout): LayoutFinding {
  const format = (values: GeometryMargins) => marginKeys.map(key => `${marginNames[key]} ${Number(values[key].toFixed(1))} mm`).join(' · ')
  const configured = report?.geometry ?? readCompiledGeometry(report?.log ?? '')
  const measured = configured.at(-1)
  const decoded = bodyPage ? pages[bodyPage - 1] : undefined
  const rules = /\\(?:geometry|newgeometry)\s*\{|\\usepackage\s*\[[^\]]*\]\s*\{geometry\}/
  const override = /\\(?:(?:setlength|addtolength)\s*\{\s*|advance\s*)\\(?:textwidth|textheight|oddsidemargin|evensidemargin|topmargin|hoffset|voffset)\b/
  const anchors = [...sources].flatMap(([path, value]) => {
    const source = maskLatexCode(value)
    const match = override.exec(source) ?? rules.exec(source)
    return match ? [{ path, line: lineNumber(source, match.index), override: override.test(source) }] : []
  })
  const anchor = anchors.find(item => item.override) ?? anchors.at(-1)
  const dimensionsAgree = measured && decoded && Math.abs(decoded.width * pdfPtToMm - measured.width) <= 1
    && Math.abs(decoded.height * pdfPtToMm - measured.height) <= 1
  const different = configured.some(values => marginKeys.some(key => {
    const standard = layout?.rules[marginRule(key)].standard
    return standard ? !matchesStandard(standard, values[key], 0.001) : Math.abs(values[key] - expected[key]) > 0.5
  }))
  const comparisons = marginKeys.flatMap(key => {
    const comparison = layout && compareLayoutRule(layout, marginRule(key), dimensionsAgree && !anchor?.override && configured.length === 1
      ? measured[key] : undefined)
    return comparison ? [comparison] : []
  })
  const expectedText = comparisons.length ? marginKeys.map(key => {
    const standard = layout?.rules[marginRule(key)].standard
    return marginNames[key] + ' ' + (standard ? formatStandard(standard, value => value + ' mm') : expected[key] + ' mm')
  }).join(' · ') : format(expected)
  const evidence = ruleSource + ' · TeX geometry 编译记录与 PDF 实际页宽、页高'
  const common = { label: '正文页边距', expected: expectedText, evidence, path: anchor?.path ?? main, line: anchor?.line, page: bodyPage,
    comparisons: comparisons.length ? comparisons : undefined }
  if (!dimensionsAgree || anchor?.override || configured.length > 1) {
    return { ...common, status: 'manual', observed: measured && format(measured),
      detail: '无法将编译记录中的边距可靠对应到正文。请确认正文页及中途调整的边距。' }
  }
  return { ...common, status: different ? 'issue' : 'pass', observed: format(measured),
    detail: different ? '编译使用的边距与该项目的版式规则不符。' : '编译使用的边距与该项目的版式规则一致，PDF 页面尺寸相符。' }
}

function standardFinding(layout: WordLayout, key: LayoutKey, label: string, actual: string | undefined,
  evidence: string, location: Pick<LayoutFinding, 'path' | 'line' | 'page'>): LayoutFinding | undefined {
  const standard = layout.rules[key].standard
  const comparison = compareLayoutRule(layout, key, actual)
  if (!standard || !comparison) return
  const status = actual === undefined ? 'manual' : matchesStandard(standard, actual) ? 'pass' : 'issue'
  return { label, status, detail: status === 'manual' ? '编译证据不足，请对照规范原文核对。'
    : status === 'pass' ? '编译检测值满足规范要求。' : '编译检测值与规范要求不符。',
    evidence, comparisons: [comparison], ...location }
}

export function layoutPreflightProfile(files: ProjectFileSystem['files'], templateId?: string) {
  const workflow = templateId ? templateCatalog.find(entry => entry.id === templateId)?.workflow : undefined
  const checks = workflow && 'checks' in workflow ? workflow.checks : undefined
  if (checks?.kind === 'latex-class') return { latexClass: checks }
  if (checks?.kind === 'prl') return { prl: true as const }
  if (checks?.kind === 'elsevier-cas') return { elsevierCas: true as const }
  if (checks?.kind === 'mnras') return { mnras: true as const }
  if (checks?.kind === 'agu-journal') return { agu: true as const }
  const file = files.get('layout.json')
  if (files.has('word-layout.tex') && file && 'content' in file && file.content) {
    try { return { layout: wordLayoutSchema.parse(JSON.parse(file.content)), sjtu: checks?.kind === 'sjtu-word' } } catch { return undefined }
  }
  if (files.has('suep-layout.tex') && (files.has('manuscript.tex') || templateId === 'suep-undergraduate')) return { suep: true as const }
  if (templateId === 'ieee-compsoc' || templateId === 'plos-one') return { nativeArticle: templateId }
  if (thesisManualChecks(templateId).length) return { manualOnly: true as const }

}

function romanPage(value: number) {
  let result = ''
  for (const [unit, digit] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'],
    [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as const) {
    result += digit.repeat(Math.floor(value / unit))
    value %= unit
  }
  return result
}

export function assessLayout(files: ProjectFileSystem['files'], main: string, pages: PdfLayoutPage[],
  regions: SyncRegion[], report?: CompileReport, templateId?: string): LayoutFinding[] {
  const profile = layoutPreflightProfile(files, templateId)
  if (!profile) return []
  const manual = thesisManualChecks(templateId).map(({ id, ...rule }): LayoutFinding => ({ ...rule, ruleId: id, status: 'manual' }))
  if ('manualOnly' in profile) return manual
  const { layout, suep } = profile
  const sources = new Map<string, string>()
  const add = (path: string, source: string) => { sources.set(path, source) }
  buildProjectOutline({ files }, main, undefined, add, add)
  for (const path of [main, 'manuscript.tex']) {
    const file = files.get(path)
    if (file && 'content' in file && typeof file.content === 'string' && /\.tex$/i.test(path)) sources.set(path, file.content)
  }
  const manuscriptPath = sources.has('manuscript.tex') ? 'manuscript.tex' : main
  const manuscript = maskLatexCode(sources.get(manuscriptPath) ?? '')
  if (profile.agu) {
    const source = maskLatexCode(sources.get(main) ?? '')
    const check = (label: string, found: boolean): LayoutFinding => ({
      label, status: found ? 'pass' : 'issue', detail: found ? '在编译源中找到对应结构。' : '请在编译源中补齐该结构。',
      evidence: 'AGU 作者提交清单和 2025 官方 LaTeX 类', path: main,
    })
    return [
      check('AGU 官方文档类', /\\documentclass\s*(?:\[[^\]]*\])?\s*\{agujournal2025\}/.test(source)),
      check('AGU Key Points', Boolean(/\\keypoints\s*\{([^}]*)\}/.exec(source)?.[1].trim())),
      check('AGU Plain Language Summary', Boolean(/\\begin\s*\{plainlanguagesummary\}([\s\S]*?)\\end\s*\{plainlanguagesummary\}/.exec(source)?.[1].trim())),
      check('AGU Open Research Statement', /\\section\*\s*\{Open Research Statement\}/i.test(source)),
      ...assessBibliography(files, main, sources, pages, regions, true),
      { label: 'AGU 投稿阶段人工核对', status: 'manual',
        detail: '核对 Key Points 篇幅与内容、通俗摘要、数据或软件访问声明以及指定文章类型的提交材料。',
        evidence: 'AGU Journals Submission Checklists', sourceUrl: 'https://www.agu.org/publications/authors/journals/submission-checklists' },
    ]
  }
  if (profile.nativeArticle) {
    const ieee = profile.nativeArticle === 'ieee-compsoc'
    const source = maskLatexCode(sources.get(main) ?? '')
    const hasStyle = ieee ? /\\documentclass\s*\[[^\]]*compsoc[^\]]*\]\s*\{IEEEtran\}/.test(source)
      : /\\bibliographystyle\s*\{plos2025\}/.test(source)
    return [{
      label: ieee ? 'IEEE Computer Society 文档类' : 'PLOS ONE 文献样式', status: hasStyle ? 'pass' : 'issue',
      detail: hasStyle ? '入口使用目录登记的官方配置。' : '编译入口的配置与目录登记版本不一致。',
      evidence: '官方源包 · TeX 编译入口', path: main,
    }, ...assessBibliography(files, main, sources, pages, regions, false), {
      label: '投稿格式人工复查', status: 'manual',
      detail: ieee ? '请核对目标期刊的 Computer Society 变体、作者单位及栏宽。'
        : '请核对图件单独提交要求、参考文献著录及作者信息。',
      evidence: '发布方作者指南',
    }]
  }
  if (profile.mnras) {
    const source = maskLatexCode(sources.get(main) ?? '')
    const declaration = /\\documentclass\s*(?:\[([^\]]*)\]\s*)?\{\s*([^{}\s]+)\s*\}/.exec(source)
    const options = declaration?.[1]?.split(',').map(option => option.trim()) ?? []
    const override = /\\onecolumn\b/.exec(source)
    const single = options.find(option => option === 'onecolumn' || option === 'referee') ?? override?.[0]
    const printed = pages.findIndex(page => page.bodyInTwoColumns)
    const classCorrect = declaration?.[2] === 'mnras'
    const visual = classCorrect && !single && printed >= 0
    const layoutStatus = !classCorrect || single ? 'issue' : visual ? 'pass' : 'manual'
    const figures = pages.findIndex(page => page.figureCaption)
    const tables = pages.findIndex(page => page.tableCaption)
    return [{
      label: 'MNRAS 正文双栏', status: layoutStatus,
      detail: !classCorrect ? '请使用发布方的 mnras 文档类。'
        : single ? '入口使用会切换到单栏的命令或选项。请对照期刊的单栏例外要求。'
          : visual ? '从正文 PDF 识别到并排的两列文字。'
            : pages.length ? '已识别 mnras 双栏配置。当前 PDF 的正文文字证据不足。' : '已识别 mnras 默认双栏配置。',
      expected: 'mnras 正文双栏', observed: single ?? (visual ? 'PDF 正文两列文字' : declaration?.[2]),
      evidence: 'MNRAS 作者须知第 6.1 节 · TeX 入口与 PDF 正文位置',
      path: main, line: lineNumber(source, override?.index ?? declaration?.index ?? 0), page: printed >= 0 ? printed + 1 : undefined,
    }, {
      label: 'MNRAS 图表显示', status: figures >= 0 && tables >= 0 ? 'pass' : 'manual',
      detail: figures >= 0 && tables >= 0 ? `PDF 第 ${figures + 1} 页有图题，第 ${tables + 1} 页有表题。` : '请核对适用的图表、题注和引用。',
      evidence: '编译后的 PDF 图表题注文本', page: figures >= 0 ? figures + 1 : tables >= 0 ? tables + 1 : undefined,
    }, ...assessBibliography(files, main, sources, pages, regions, false), {
      label: 'MNRAS 投稿细则', status: 'manual',
      detail: '请对照作者须知核对文章类型、插图质量、单栏例外与补充材料。',
      evidence: 'Oxford Academic · MNRAS 作者须知',
    }]
  }
  if (profile.elsevierCas) {
    const source = maskLatexCode(sources.get(main) ?? '')
    const declaration = /\\documentclass\s*(?:\[[^\]]*\]\s*)?\{\s*([^{}\s]+)\s*\}/.exec(source)
    const actual = declaration?.[1]
    return [{
      label: 'Elsevier CAS 文档类', status: actual === 'cas-sc' ? 'pass' : 'issue',
      detail: actual === 'cas-sc' ? '编译入口采用 CAS 单栏类。' : '请在此版式的编译入口使用 cas-sc。',
      expected: 'cas-sc', observed: actual ?? '未识别',
      evidence: 'Elsevier CAS 模板说明 · 本次编译的 TeX 入口',
      path: main, line: declaration ? lineNumber(source, declaration.index) : 1,
    }, ...assessBibliography(files, main, sources, pages, regions, false), {
      label: 'Elsevier 目标期刊要求', status: 'manual',
      detail: '请在目标期刊作者指南中核对 CAS 单栏适用性、参考文献体例、声明及附加材料。',
      evidence: 'Elsevier CAS 模板说明与目标期刊作者指南',
    }]
  }
  if (profile.latexClass) {
    const checks = profile.latexClass
    const source = maskLatexCode(sources.get(main) ?? '')
    const documentClass = /\\documentclass\s*(?:\[([^\]]*)\]\s*)?\{([^{}]+)\}/.exec(source)
    const options = documentClass?.[1]?.split(',').map(option => option.trim()) ?? []
    const packages = [...source.matchAll(/\\usepackage\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/g)]
      .flatMap(([, names]) => names.split(',').map(name => name.trim()))
    const correct = documentClass?.[2].trim() === checks.documentClass
      && checks.options.every(option => options.includes(option)) && packages.includes(checks.package)
    const expected = checks.documentClass + ' [' + checks.options.join(', ') + '] · ' + checks.package
    return [{
      label: checks.label, status: correct ? 'pass' : 'issue',
      detail: correct ? '编译入口包含所要求的文档类、选项和样式。' : '请在编译入口使用指定的文档类、选项和样式。',
      expected, evidence: checks.evidence + ' · 本次编译的 TeX 入口', path: main,
      line: documentClass ? lineNumber(source, documentClass.index) : 1,
    }, {
      label: checks.manualLabel, status: 'manual',
      detail: checks.manualDetail, evidence: checks.evidence,
    }, ...assessBibliography(files, main, sources, pages, regions, false)]
  }
  if (profile.prl) {
    const source = maskLatexCode(sources.get(main) ?? '')
    const match = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/.exec(source)
    const options = match?.[1]?.split(',').map(option => option.trim()) ?? []
    const configured = match?.[2] === 'revtex4-2' && options.includes('aps') && options.includes('prl')
    const line = match && lineNumber(source, match.index)
    const dataHeading = /\bdata[\s~-]+availability(?:[\s~-]+statement)?\b/i
    const namedSection = /\\(?:section|subsection|paragraph|textit|textbf|emph)\*?\s*\{\s*data[\s~-]+availability(?:[\s~-]+statement)?\s*[.:]?\s*\}/i
    const dataMarker = [...sources].flatMap(([path, content]) => {
      const location = namedSection.exec(maskLatexCode(content))
      return location ? [{ path, line: lineNumber(content, location.index) }] : []
    })[0]
    const dataPage = dataMarker ? pages.findIndex(page => dataHeading.test(page.text)) : -1
    return [{
      label: 'PRL 期刊选项', status: configured ? 'pass' : 'issue',
      detail: configured ? '当前编译入口使用 REVTeX 的 aps、prl 选项。' : '请将编译入口的文档类设为 revtex4-2，并启用 aps、prl 选项。',
      evidence: 'APS 期刊选项指南 · 本次编译的 TeX 入口', path: main, line: line ?? undefined,
      page: pages.length ? 1 : undefined,
    }, {
      label: 'PRL 数据可用性声明', status: dataPage >= 0 ? 'pass' : 'manual',
      detail: dataPage >= 0 ? 'PDF 中找到数据可用性声明标题。请核对内容及投稿系统中的填写项。'
        : '请在投稿系统填写数据可用性声明，并核对稿件中的对应内容。',
      evidence: 'Physical Review Letters 作者指南 · Data Availability Statements',
      path: dataMarker?.path ?? main, line: dataMarker?.line ?? (source ? lineNumber(source, source.lastIndexOf('\\end{document}') >= 0
        ? source.lastIndexOf('\\end{document}') : source.length) : undefined),
      page: dataPage >= 0 ? dataPage + 1 : undefined,
    }, {
      label: '期刊投稿细则', status: 'manual', detail: '请按 PRL 投稿要求核对篇幅、补充材料和数据可用性声明。',
      evidence: 'Physical Review Letters 作者指南',
    }]
  }
  const findings: LayoutFinding[] = []
  const paper = layout?.rules.paper.chosen.value as keyof typeof paperSizes | undefined
  const expectedPaper = paper ?? 'a4'
  const dimensions = paperSizes[expectedPaper]
  const badPage = pages.findIndex(({ width, height }) => Math.abs(width * 25.4 / 72 - dimensions[0]) > 1
    || Math.abs(height * 25.4 / 72 - dimensions[1]) > 1)
  findings.push({ label: '纸张尺寸', status: !pages.length ? 'manual' : badPage >= 0 ? 'issue' : 'pass',
    detail: badPage >= 0 ? `第 ${badPage + 1} 页的实际尺寸与 ${expectedPaper.toUpperCase()} 不符。`
      : pages.length ? `已核对 ${pages.length} 页，纸张为 ${expectedPaper.toUpperCase()}。` : '当前 PDF 的页面尺寸无法读取。',
    evidence: layout ? layoutState[layout.rules.paper.chosen.origin] + ' · ' + layout.rules.paper.chosen.source : '上电本科导入版式 · A4',
    path: main, page: badPage >= 0 ? badPage + 1 : undefined })

  const font = report?.diagnostics.filter(item => /font.*(?:unavailable|substitut)|(?:unavailable|substitut).*font|unavailable; substituting/i.test(item.message)) ?? []
  for (const item of font) findings.push({ label: '字体替代', status: 'issue', detail: item.message, evidence: '本次 PDF 的编译诊断', path: item.path, line: item.line })
  if (!font.length) findings.push({ label: '字体替代', status: 'manual', detail: '当前诊断未识别到字体替代。请按模板核对实际使用的字体。', evidence: '本次 PDF 的编译诊断' })

  const marker = /\\(?:CustomWordBody|SuepStartBody)\b/.exec(manuscript)
  const heading = marker && /\\section\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]{1,120})\}/.exec(manuscript.slice(marker.index))
  const bodyLine = marker ? lineNumber(manuscript, marker.index + (heading?.index ?? 0)) : undefined
  const bodyRegion = bodyLine === undefined ? undefined : findPdfRegion(regions, manuscriptPath, bodyLine)
  const closeRegion = bodyRegion && bodyLine !== undefined && Math.abs(bodyRegion.line - bodyLine) <= 3 ? bodyRegion.page : undefined
  const normalized = (value: string) => value.replace(/\s+/g, '')
  const matchingPage = heading && pages.findIndex(page => !page.toc && normalized(page.text).includes(normalized(heading[1])))
  const bodyPage = closeRegion ?? (typeof matchingPage === 'number' && matchingPage >= 0 ? matchingPage + 1 : undefined)
  const oddOpening = layout?.rules.bodyOpening.chosen.value === 'odd'
  if (oddOpening) {
    const definition = sources.get('word-layout.tex') ?? ''
    const location = definition.indexOf('\\newcommand{\\CustomWordBody}')
    const odd = bodyPage !== undefined && bodyPage % 2 === 1
    findings.push({ label: '正文奇数页起排', status: bodyPage === undefined ? 'manual' : odd ? 'pass' : 'issue',
      detail: bodyPage === undefined ? '请在 PDF 中确认第一章所在的物理页。'
        : `第一章位于 PDF 第 ${bodyPage} 页。`, expected: '第一章从 PDF 奇数页开始',
      observed: bodyPage === undefined ? undefined : `第 ${bodyPage} 页`,
      evidence: layoutState[layout.rules.bodyOpening.chosen.origin] + ' · ' + layout.rules.bodyOpening.chosen.source,
      page: bodyPage, path: 'word-layout.tex', line: location >= 0 ? lineNumber(definition, location) : undefined })
  }
  if (layout) {
    const { left, right, top, bottom, gutter } = layout.rules
    const ruleSource = [...new Set([left, right, top, bottom, gutter]
      .map(rule => layoutState[rule.chosen.origin] + ' · ' + rule.chosen.source))].join(' / ')
    findings.push(assessMargins({ left: Number(left.chosen.value), right: Number(right.chosen.value), top: Number(top.chosen.value),
      bottom: Number(bottom.chosen.value), binding: Number(gutter.chosen.value) }, pages, bodyPage, sources, main, report, ruleSource, layout))
  } else if (suep) {
    findings.push(assessMargins(suepMargins, pages, bodyPage, sources, main, report, '上电本科导入版式'))
  }
  if (layout) {
    const footer = standardFinding(layout, 'footer', '规范页码位置', bodyPage ? pages[bodyPage - 1]?.footerPosition : undefined,
      '正文首页 PDF 页脚坐标', { page: bodyPage, path: 'word-layout.tex' })
    if (footer) findings.push(footer)
  }
  const footerExpected = suep || (layout && layout.rules.footer.chosen.value !== 'none')
  if (footerExpected) {
    const footer = bodyPage ? pages[bodyPage - 1]?.footer : undefined
    const matches = footer === '1'
    findings.push({ label: '正文起始页码', status: !footer ? 'manual' : matches ? 'pass' : 'issue',
      detail: footer ? `正文首页显示页码 ${footer}，预期为 1。` : '无法可靠定位正文首页或读取其页脚。',
      evidence: '导入版式中的正文起点 · PDF 页脚', page: bodyPage, path: manuscriptPath, line: bodyLine })
  }

  const front = layout?.rules.frontPages.chosen.value
  if (front === 'Roman' || front === 'roman') {
    const start = pages.findIndex(page => /^(摘要|Abstract)/i.test(normalized(page.text)))
    const expected = front === 'Roman' ? 'I' : 'i'
    const actual = start >= 0 ? pages[start].footer : undefined
    findings.push({ label: '前置页码', status: !actual ? 'manual' : actual === expected ? 'pass' : 'issue',
      detail: actual ? `摘要起始页显示 ${actual}，预期为 ${expected}。` : '无法可靠核对摘要的罗马数字页码。',
      evidence: '导入版式中的前置页设置 · PDF 页脚', page: start >= 0 ? start + 1 : undefined })
    if (oddOpening && start >= 0 && bodyPage && bodyPage > start + 1) {
      const frontFooters = pages.slice(start, bodyPage - 1).map(page => page.footer)
      const expectedFooters = frontFooters.map((_, index) => front === 'Roman' ? romanPage(index + 1) : romanPage(index + 1).toLowerCase())
      const firstWrong = frontFooters.findIndex((footer, index) => footer && footer !== expectedFooters[index])
      findings.push({ label: '前置连续页码', status: firstWrong >= 0 ? 'issue' : frontFooters.some(footer => !footer) ? 'manual' : 'pass',
        detail: '从摘要页到正文首页之前核对各页页脚，包含补白页。',
        expected: expectedFooters.join('、'), observed: frontFooters.map(footer => footer ?? '未读出').join('、'),
        evidence: 'PDF 前置页与补白页的实际页脚', path: 'word-layout.tex', page: start + (firstWrong >= 0 ? firstWrong : frontFooters.length - 1) + 1 })
    }
  }

  const tocPages = pages.map((page, index) => ({ page, index })).filter(({ page }) => page.toc)
  if (suep || (layout && Number(layout.rules.tocDepth.chosen.value) > 0)) {
    let checked = 0
    let unknown = 0
    let incorrect = 0
    for (const { page, index } of tocPages) {
      for (const entry of page.links ?? []) {
        const actual = entry.target ? pages[entry.target - 1]?.footer : undefined
        if (!actual || !entry.printed) { unknown++; continue }
        checked++
        if (actual !== entry.printed) {
          incorrect++
          if (incorrect <= 15) findings.push({ label: '目录页码', status: 'issue', page: index + 1,
            detail: `${entry.title ? '「' + entry.title + '」' : '目录'}显示 ${entry.printed}，链接目标第 ${entry.target} 页的页脚为 ${actual}。`,
            expected: `目标页页脚 ${actual}`, observed: `目录印刷页码 ${entry.printed}`, evidence: 'PDF 目录链接与目标页脚' })
        }
      }
    }
    if (!incorrect || unknown) findings.push({ label: '目录页码', status: !checked || unknown ? 'manual' : 'pass', page: tocPages[0] && tocPages[0].index + 1,
      detail: checked ? `已对照 ${checked} 条目录链接。${unknown ? `另有 ${unknown} 条无法读取链接目标或页脚。` : ''}`
        : '未读取到可比对的目录页码和链接，请核对目录与实际页脚。', evidence: 'PDF 目录链接与目标页脚' })
  }

  const references = indexCrossReferences(sources)
  for (const issue of references.issues.slice(0, 25)) {
    findings.push({ label: '交叉引用', status: 'issue', detail: issue.kind === 'missing' ? `找不到标签 ${issue.key}。` : `标签 ${issue.key} 重复。`,
      evidence: '本次编译的 TeX 源码', path: issue.path, line: issue.line, page: findPdfRegion(regions, issue.path, issue.line)?.page })
  }
  const normalizeId = (name: string, id: string) => (/^(?:图|Fig)/i.test(name) ? '图' : '表') + id.replace(/[.－–]/g, '-')
  const captions = new Map<string, { line: number; pdfPage?: number; separator?: 'dot' | 'hyphen' }[]>()
  const captionLines = new Set<number>()
  for (const match of manuscript.matchAll(/\\(?:caption(?:\s*\[[^\]]*\])?|SuepDetachedCaption)\s*\{\s*(图|表|Fig(?:ure)?\.?|Table)\s*((?:[A-Z][.－–-]?)?\d+(?:[.－–-]\d+)?)/gi)) {
    const id = normalizeId(match[1], match[2])
    const line = lineNumber(manuscript, match.index)
    const end = groupEnd(manuscript, match.index + match[0].lastIndexOf('{'), '{', '}')
    const title = end < 0 ? '' : manuscript.slice(match.index + match[0].length, end).trim()
    const phrase = normalized(match[1] + match[2] + title)
    const pageIndex = title.length >= 3 && !/[{}\\]/.test(title)
      ? pages.findIndex(page => !page.toc && normalized(page.text).includes(phrase)) : -1
    const matches = captions.get(id) ?? []
    const separator = /\d\.\d/.test(match[2]) ? 'dot' : /\d[－–-]\d/.test(match[2]) ? 'hyphen' : undefined
    matches.push({ line, pdfPage: pageIndex >= 0 ? pageIndex + 1 : undefined, separator })
    captions.set(id, matches)
    captionLines.add(line)
  }
  let literalChecked = 0
  let literalIssues = 0
  let figuresInPdf = 0
  for (const [id, matches] of captions) {
    figuresInPdf += matches.filter(match => match.pdfPage).length
    if (matches.length < 2 || ++literalIssues > 20) continue
    const { line, pdfPage } = matches[1]
    findings.push({ label: '图表题注与引用', status: 'issue', detail: `题注 ${id} 重复。`,
      expected: '同类图表编号唯一', observed: `${id} 出现 ${matches.length} 次`,
      evidence: '本次 TeX 的显式题注编号', path: manuscriptPath, line, page: findPdfRegion(regions, manuscriptPath, line)?.page ?? pdfPage })
  }
  for (const match of manuscript.matchAll(/(?:见|如|参见|按|由|对照|与|\bsee\b)\s*(图|表|Fig(?:ure)?\.?|Table)\s*((?:[A-Z][.－–-]?)?\d+(?:[.－–-]\d+)?)(?!\d|[.－–-]\d)/gi)) {
    const line = lineNumber(manuscript, match.index)
    if (captionLines.has(line)) continue
    const id = normalizeId(match[1], match[2])
    literalChecked++
    const count = captions.get(id)?.length ?? 0
    if (count !== 1 && ++literalIssues <= 20) findings.push({ label: '图表题注与引用', status: 'issue',
      detail: count ? `引用 ${id} 对应多条题注。` : `引用 ${id} 找不到编号相同的题注。`,
      evidence: '本次 TeX 的显式图表编号', expected: '正文编号与唯一题注一致', observed: `${id} 对应 ${count} 条题注`,
      path: manuscriptPath, line, page: findPdfRegion(regions, manuscriptPath, line)?.page })
  }
  if (!literalIssues) findings.push({ label: '图表题注与引用', status: literalChecked ? 'pass' : 'manual',
    detail: literalChecked ? `已核对 ${literalChecked} 处可识别的正文图表编号。` : '未找到能自动匹配的正文图表编号，请人工核对题注和引用。',
    observed: figuresInPdf ? `PDF 中找到 ${figuresInPdf} 条同文题注` : undefined,
    evidence: figuresInPdf ? '本次 TeX 的显式图表编号与 PDF 题注文本' : '本次 TeX 的显式图表编号' })

  if (layout?.rules.captionSeparator.standard) {
    const found = [...captions.values()].flat().filter(item => item.separator)
    const bad = found.find(item => !matchesStandard(layout.rules.captionSeparator.standard!, item.separator!))
    const first = bad ?? found[0]
    const caption = standardFinding(layout, 'captionSeparator', '规范图表章号分隔符', first?.separator,
      first?.pdfPage ? '本次编译的 TeX 与 PDF 题注文本' : '本次编译的 TeX 显式题注编号',
      { path: manuscriptPath, line: first?.line, page: first?.pdfPage ?? (first ? findPdfRegion(regions, manuscriptPath, first.line)?.page : undefined) })
    if (caption) findings.push(caption)
  }
  if (layout?.rules.references.standard) {
    const heading = /\\(?:section|chapter)\*?\s*\{\s*(?:参考文献|References|Bibliography)\s*\}/i.exec(manuscript)
    const entries = heading ? manuscript.slice(heading.index + heading[0].length) : ''
    const referencePage = pages.findIndex(page => page.bibliographyHeading)
    const numbered = /\\CustomWordReference\{(?:[1-9]\d*\}|\}\s*\{?\s*(?:\{\[\}|\[)\s*[1-9]\d*)/.test(entries)
    const authors = /\\CustomWordReference\{\}\s*[\p{L}][^\n]{1,70}[(（](?:18|19|20)\d{2}[)）]/u.test(entries)
    const style = referencePage < 0 ? undefined : numbered && authors ? 'mixed' : numbered ? 'numbered' : authors ? 'author-year' : undefined
    const reference = standardFinding(layout, 'references', '规范参考文献制式', style,
      'PDF 文献章节与本次编译的显式参考文献条目',
      { path: manuscriptPath, line: heading ? lineNumber(manuscript, heading.index) : undefined,
        page: referencePage >= 0 ? referencePage + 1 : undefined })
    if (reference) findings.push(reference)
  }

  if (suep) {
    const cover = pages[0] && /上海电力大学/.test(normalized(pages[0].text)) && /本科毕业设计/.test(normalized(pages[0].text))
    const preface = pages.slice(1, bodyPage ? bodyPage - 1 : 6)
    for (const [label, token] of [['原创性声明', '原创性声明'], ['使用授权声明', '使用授权声明']] as const) {
      const index = preface.findIndex(page => normalized(page.text).includes(token))
      findings.push({ label, status: !pages.length ? 'manual' : index >= 0 ? 'pass' : 'issue', detail: index >= 0 ? '在正文前找到学校声明。'
        : '在正文前未找到学校声明标题。', evidence: '上电本科导入版式 · PDF 可提取文本', path: main, page: index >= 0 ? index + 2 : undefined })
    }
    findings.push({ label: '本科封面', status: !pages.length ? 'manual' : cover ? 'pass' : 'issue',
      detail: cover ? 'PDF 首页找到上海电力大学本科封面标识。' : 'PDF 首页未识别到上海电力大学本科封面标识。',
      evidence: '上电本科导入版式 · PDF 首页文本', page: pages.length ? 1 : undefined, path: main })
    findings.push({ label: '校徽与声明版面', status: 'manual', detail: '请对照官方原件核对校徽和声明位置。', evidence: '上电本科官方原件', page: pages.length ? 1 : undefined })
  }
  if (layout && templateId && (['njupt-academic', 'njupt-professional'].some(name => layout.presentation === name) || templateId === 'sjtu-graduate-word' || templateId.startsWith('njupt-'))) {
    const sjtu = profile.sjtu
    const abstractIndex = pages.findIndex(page => /^(摘要|Abstract)/i.test(normalized(page.text)))
    const frontEnd = abstractIndex >= 0 ? abstractIndex : bodyPage ? bodyPage - 1 : Math.min(6, pages.length)
    const frontPages = pages.slice(0, frontEnd)
    const entry = maskLatexCode(sources.get(main) ?? '')
    const ruleEvidence = (sjtu ? '上海交通大学研究生院撰写指南' : '南京邮电大学研究生学位论文撰写标准') + ' · 学位论文组成部分'
    for (const [label, asset, token, scan] of [
      [sjtu ? '上交大封面' : '南邮封面', 'cover', sjtu ? /上海交通大学.*(?:硕士|博士)?学位论文/ : /(?:南京邮电大学.*(?:硕士|博士)?学位论文|专业学位硕士论文)/, frontPages.slice(0, 1)],
      ['原创性声明', 'declaration', /(?:原创性|独创性)声明/, frontPages],
      ['使用授权书', 'declaration', /使用授权(?:书|声明)/, frontPages],
    ] as const) {
      const found = scan.findIndex(page => token.test(normalized(page.text)))
      const attached = files.has('front/' + asset + '.pdf') || files.has('template-front/' + asset + '.pdf')
      const included = new RegExp('\\\\includepdf(?:\\s*\\[[^\\]]*\\])?\\s*\\{(?:template-)?front/' + asset + '\\.pdf\\}').test(entry)
      const missing = attached && !included && found < 0
      findings.push({ label, status: found >= 0 ? 'pass' : missing ? 'issue' : 'manual',
        detail: found >= 0 ? '在正文前找到相应文本，请核对版式和签署情况。'
          : missing ? '源包含该附件，请核对主文件中的插入命令。'
            : 'PDF 未识别到相应标题，请按归档稿或盲审稿要求核对。',
        evidence: ruleEvidence, path: main, page: found >= 0 ? found + 1 : undefined })
    }
    const fixed = String(layout.rules.fixedHeader.chosen.value)
    if (fixed && layout.rules.header.chosen.value !== 'none') {
      const offset = ['odd-chapter', 'odd-title'].includes(String(layout.rules.runningHead.chosen.value)) ? 1 : 0
      const pageNumber = bodyPage && bodyPage + offset <= pages.length ? bodyPage + offset : undefined
      const body = pageNumber ? pages[pageNumber - 1] : undefined
      const found = body?.header && normalized(body.header).includes(normalized(fixed))
      findings.push({ label: '正文固定页眉', status: !body?.text.trim() || body.header === undefined ? 'manual' : found ? 'pass' : 'issue',
        detail: found ? '已在正文页眉区域找到模板设置的固定文字。'
          : body?.header !== undefined ? '正文页眉区域未找到模板设置的固定文字。' : '无法核对固定页眉，请查看正文页。',
        evidence: 'Word 版式设置 · ' + layout.rules.fixedHeader.chosen.source, page: pageNumber, path: 'word-layout.tex' })
    }
    const abstract = abstractIndex >= 0 ? pages[abstractIndex] : undefined
    findings.push({ label: '摘要页页眉', status: 'manual',
      detail: abstract?.header?.trim() ? '摘要区上方可提取到文字，请对照学校 Word 样例确认其页眉。'
        : '请对照学校 Word 样例核对摘要页页眉和学院要求。',
      evidence: '研究生院 Word 样例', page: abstractIndex >= 0 ? abstractIndex + 1 : undefined })
  }
  findings.push(...assessBibliography(files, main, sources, pages, regions, true))
  findings.push(...manual)
  findings.push({ label: '其余版式规范', status: 'manual', detail: '请对照学校文件核对字体细节和报告中证据不足的规则。', evidence: '版式来源与人工确认记录' })
  return findings.sort((a, b) => ({ issue: 0, manual: 1, pass: 2 })[a.status] - ({ issue: 0, manual: 1, pass: 2 })[b.status])
}
