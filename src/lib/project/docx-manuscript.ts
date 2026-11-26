import { lineNumber, maskLatexCode } from './latex-source'
import type { ManuscriptSnapshot } from './template-export'
import type { SubmissionDocxId } from './submission-docx-config'

type Value = null | string | number | boolean | Value[] | { [key: string]: Value | undefined }
type Node = { t: string; c?: Value }
export type PandocDocument = { blocks: Node[]; meta: Record<string, Value>; 'pandoc-api-version': number[] }
type Attribute = [id: string, classes: string[], pairs: [string, string][]]
type Caption = [Value, Node[]]

export type WordToken =
  | { kind: 'heading'; tocBookmark: string; referenceBookmark?: string; appendix?: { number: string; firstLevel: boolean } }
  | { kind: 'caption'; bookmark?: string; chapter: string; sequence: number; object: 'Figure' | 'Table' }
  | { kind: 'equation'; bookmark?: string; chapter: string; sequence: number }
  | { kind: 'reference'; bookmark: string; cached: string; mode: 'text' | 'page' | 'number' | 'chapter-number'; prefix?: string; suffix?: string }
  | { kind: 'bibliography'; bookmark: string; number: string }

export type WordHeading = { level: number; number: string; title: string; bookmark: string; appendix?: boolean }

export function chineseChapterNumber(number: string) {
  if (Number(number) > 9999) return number
  const digits = '零一二三四五六七八九'
  const units = ['', '十', '百', '千']
  return [...number].map((digit, index) => digit === '0' ? '零' : digits[Number(digit)] + units[number.length - 1 - index])
    .join('').replace(/零+/g, '零').replace(/零$/, '').replace(/^一十/, '十')
}
const para = (nodes: Node[]): Node => ({ t: 'Para', c: nodes })
const attr = (value: Value | undefined) => value as Attribute
const nodes = (value: Value | undefined) => value as Node[]

function walk(value: Value | undefined, visit: (node: Node) => void) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
  } else {
    if (typeof value.t === 'string') visit(value as Node)
    for (const item of Object.values(value)) walk(item, visit)
  }
}

function nodeText(value: Value | undefined) {
  let text = ''
  walk(value, node => {
    if (node.t === 'Str') text += node.c
    if (node.t === 'Space' || node.t === 'SoftBreak') text += ' '
  })
  return text.trim()
}

export function docxSourceError(snapshot: ManuscriptSnapshot, part: 'body' | 'abstract', offset: number, message: string): never {
  const location = sourceLocation(snapshot, part, offset)
  throw new Error(location ? `${location.path}:${location.line} · ${message}` : message)
}

function sourceLocation(snapshot: ManuscriptSnapshot, part: 'body' | 'abstract', offset: number) {
  const lines = snapshot.lineSources[part]
  return lines.get(lineNumber(snapshot[part], offset)) ?? lines.values().next().value
}

export function docxLatexForPandoc(source: string) {
  // Preserve commands Pandoc's LaTeX reader otherwise discards.
  const masked = maskLatexCode(source, true)
  let text = ''
  let offset = 0
  for (const match of masked.matchAll(/\\(?:\\|appendix\b|pageref\s*\{([^{}\s]+)\})/g)) {
    if (match[0] === '\\\\') continue
    const replacement = match[1] ? '\\href{#' + match[1] + '}{WbxPageReferenceX}' : '\\par\\texttt{WbxBeginAppendicesX}\\par'
    text += source.slice(offset, match.index) + replacement + match[0].replace(/[^\r\n]/g, '')
    offset = match.index + match[0].length
  }
  return text + source.slice(offset)
}

export function validateDocxSource(snapshot: ManuscriptSnapshot) {
  const issue = docxSourceFindings(snapshot)[0]
  if (issue) throw new Error(issue.location ? `${issue.location.path}:${issue.location.line} · ${issue.message}` : issue.message)
}

const unsupportedCommands = /\\(?:begin\s*\{(?:align\*?|gather\*?|itemize|enumerate|description|verbatim\*?)\}|(?:footnote(?:mark|text)?|paragraph|tag)\b)/g
const equationEnvironment = /^\s*\\begin\s*\{equation\}([\s\S]*?)\\end\s*\{equation\}\s*$/
const equationLabel = /\\label\s*\{([^{}\s]+)\}/g

export function unsupportedDocxStructures(source: string) {
  return Array.from(maskLatexCode(source, true).matchAll(unsupportedCommands), match => ({
    offset: match.index, message: `${match[0]} 暂无法可靠导出为 Word。请改为支持的段落或单行公式。`,
  }))
}

export function docxSourceFindings(snapshot: ManuscriptSnapshot) {
  const findings: { location?: { path: string; line: number }; message: string }[] = []
  for (const part of ['body', 'abstract'] as const) {
    const text = maskLatexCode(snapshot[part], true)
    const add = (offset: number, message: string) => findings.push({ location: sourceLocation(snapshot, part, offset), message })
    for (const { offset, message } of unsupportedDocxStructures(snapshot[part])) add(offset, message)
    const appendices = [...text.matchAll(/\\(?:\\|(appendix)\b)/g)].filter(match => match[1])
    const start = appendices[0]
    if (start && (part === 'abstract' || !/\\section\*?\s*(?:\[[^\]]*\]\s*)?\{/.test(text.slice(start.index + start[0].length)))) {
      add(start.index, '附录须位于正文末尾，并至少包含一个一级标题。')
    }
    if (appendices[1]) add(appendices[1].index, '正文只支持一个附录起点。')
    for (const match of text.matchAll(/\\begin\s*\{equation\}([\s\S]*?)\\end\s*\{equation\}/g)) {
      if (part === 'abstract' || /\\(?:begin|nonumber|notag|tag)\b|\\\\/.test(match[1]) || [...match[1].matchAll(equationLabel)].length > 1) {
        add(match.index, '编号公式须位于正文，使用单个 equation 表达式，最多指定一个标签。')
      }
    }
    if (part === 'abstract') {
      const citation = /\\(?:cite[a-z]*|nocite)\b/i.exec(text)
      if (citation) add(citation.index, '提交版摘要暂不支持文献引用。')
    }
    const pdf = /\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g
    for (const match of text.matchAll(pdf)) {
      const asset = snapshot.assets.find(file => file.path === match[1] || !/\.[a-z]+$/i.test(match[1]) && file.path.replace(/\.[a-z]+$/i, '') === match[1])
      if (!asset || !/\.(?:png|jpe?g)$/i.test(asset.path)) {
        add(match.index, 'Word 图片需要项目内可读取的 PNG 或 JPEG；请先转换此素材。')
      }
    }
  }
  return findings
}

export function prepareDocxAst(body: PandocDocument, abstract: PandocDocument, snapshot: ManuscriptSnapshot, school: SubmissionDocxId) {
  const tokens = new Map<string, WordToken>()
  const headings: WordHeading[] = []
  const references = new Map<string, { name: string; value: string; kind: 'heading' | 'appendix' | 'figure' | 'table' | 'equation' | 'bibliography'; chineseChapter?: boolean }>()
  const marker = (data: WordToken): Node => {
    const key = 'WbxExport' + (tokens.size + 1) + 'X'
    tokens.set(key, data)
    return { t: 'Code', c: [['', [], []], key] }
  }
  const bookmark = () => 'WbxTarget' + (tokens.size + 1)
  const separator = school === 'suep-undergraduate' ? '-' : '.'
  const levels = [0, 0, 0]
  let appendixMode = false
  const appendixStart = para([{ t: 'Code', c: [['', [], []], 'WbxStartAppendicesX'] }])
  const chapter = () => {
    if (!appendixMode) return String(levels[0])
    let name = ''
    for (let index = levels[0]; index; index = Math.floor((index - 1) / 26)) {
      name = String.fromCharCode(65 + (index - 1) % 26) + name
    }
    return name
  }
  const counts = { Figure: 0, Table: 0, Equation: 0 }
  const numberedEquations = [...maskLatexCode(snapshot.body, true).matchAll(/\\begin\s*\{equation\}/g)]
  let equations = 0
  let floats = 0
  const bibliography: Node[] = []
  abstract.blocks = abstract.blocks.map(block => ({ t: 'Div', c: [['', [], [['custom-style', 'WbxAbstract']]], [block]] }))

  const blocks = (entries: Node[], inherited?: string): Node[] => entries.flatMap(entry => {
    const inlines = entry.t === 'Para' ? nodes(entry.c) : undefined
    if (inlines?.length === 1 && inlines[0].t === 'Code' && (inlines[0].c as Value[])[1] === 'WbxBeginAppendicesX') {
      appendixMode = true
      levels.fill(0)
      return [appendixStart]
    }
    if (inlines?.length === 1 && inlines[0].t === 'Math') {
      const value = inlines[0].c as [Node, string]
      const equation = equationEnvironment.exec(value[1])
      if (equation) {
        const offset = numberedEquations[equations++]?.index ?? 0
        if (!levels[0]) docxSourceError(snapshot, 'body', offset, '编号公式须位于章或附录标题之后。')
        const label = [...equation[1].matchAll(equationLabel)][0]?.[1]
        const name = label ? bookmark() : undefined
        const sequence = ++counts.Equation
        const number = chapter() + separator + sequence
        if (name && label) references.set(label, { name, value: number, kind: 'equation' })
        const formula = equation[1].replace(equationLabel, '').trim()
        if (!formula) docxSourceError(snapshot, 'body', offset, '编号公式为空。')
        // Inline OMML permits a centered formula and a right-aligned field in the same Word paragraph.
        value[0] = { t: 'InlineMath' }
        value[1] = formula
        inlines.push(marker({ kind: 'equation', bookmark: name, chapter: chapter(), sequence }))
        return [{ t: 'Div', c: [['', [], [['custom-style', 'WbxEquation']]], [entry]] }]
      }
    }
    if (entry.t === 'Header') {
      const [level, attributes, inlines] = entry.c as [number, Attribute, Node[]]
      const source = snapshot.sections[headings.length]
      if (level < 1 || level > 3 || level > 1 && !levels[level - 2]) {
        throw new Error(`${source?.path ?? 'main.tex'}:${source?.line ?? 1} · 请使用连续的三级标题，从一级标题开始。`)
      }
      levels[level - 1]++
      levels.fill(0, level)
      if (level === 1) counts.Figure = counts.Table = counts.Equation = 0
      const name = bookmark()
      const tocBookmark = 'WbxToc' + (headings.length + 1)
      const number = [chapter(), ...levels.slice(1, level)].join('.')
      const title = nodeText(inlines)
      const appendix = appendixMode ? { number, firstLevel: level === 1 } : undefined
      const tocTitle = appendix ? (appendix.firstLevel ? '附录 ' : '') + number + ' ' + title : title
      headings.push({ level, title: tocTitle, number: appendix ? '' : number, bookmark: tocBookmark, appendix: appendixMode })
      const referenceBookmark = attributes[0] ? name : undefined
      if (referenceBookmark) {
        const chineseChapter = !appendix && school !== 'zju-basic-medicine-undergraduate' && level === 1
        references.set(attributes[0], { name, value: chineseChapter ? chineseChapterNumber(number) : number,
          kind: appendix ? 'appendix' : 'heading', chineseChapter })
      }
      // Disable Pandoc's bookmark emission for the same heading.
      attributes[0] = ''
      inlines.unshift(marker({ kind: 'heading', tocBookmark, referenceBookmark, appendix }))
      return [entry]
    }
    if (entry.t === 'Div') {
      const [attributes, children] = entry.c as [Attribute, Node[]]
      if (attributes[0] === 'refs') {
        for (const item of children) {
          const [attributes, items] = item.c as [Attribute, Node[]]
          const paragraph = items.find(item => item.t === 'Para')
          const inlines = nodes(paragraph?.c)
          const left = inlines?.find(inline => inline.t === 'Span' && attr((inline.c as Value[])[0])[1].includes('csl-left-margin'))
          if (!left || !attributes[0].startsWith('ref-')) throw new Error('GB/T 7714 参考文献编号无法识别。')
          const number = /^\[(\d+)\]$/.exec(nodeText(left.c))?.[1]
          if (!number) throw new Error('GB/T 7714 参考文献编号无法识别。')
          const name = bookmark()
          references.set(attributes[0], { name, value: number, kind: 'bibliography' })
          left.c = [(left.c as Value[])[0], [marker({ kind: 'bibliography', bookmark: name, number }), { t: 'Space' }]]
          bibliography.push({ t: 'Div', c: [['', [], [['custom-style', 'WbxBibliography']]], items] })
        }
        return []
      }
      return blocks(children, attributes[0] || inherited)
    }
    if (entry.t !== 'Figure' && entry.t !== 'Table') return [entry]
    const parts = entry.c as Value[]
    const key = attr(parts[0])[0] || inherited
    const object = entry.t
    const caption = (parts[1] as Caption)[1]
    const position = snapshot.floats[floats++]
    if (!caption.length || !nodeText(caption) || !levels[0]) {
      throw new Error(`${position?.path ?? 'main.tex'}:${position?.line ?? 1} · 图表必须位于章内并有可读取的题注。`)
    }
    const sequence = ++counts[object]
    const name = key ? bookmark() : undefined
    if (name && key) references.set(key, { name, value: chapter() + separator + sequence, kind: object === 'Figure' ? 'figure' : 'table' })
    attr(parts[0])[0] = ''
    parts[1] = [null, []]
    const first = caption[0]
    if (caption.length !== 1 || !['Plain', 'Para'].includes(first.t)) {
      throw new Error(`${position?.path ?? 'main.tex'}:${position?.line ?? 1} · 题注须为一个段落。`)
    }
    const isLongTable = object === 'Table' && position?.longTable
    if (isLongTable) {
      const tableHead = parts[3] as Value[]
      if (!(tableHead?.[1] as Value[])?.length) {
        throw new Error(`${position.path}:${position.line} · longtable 缺少可重复表头。请在首行后使用 \\midrule 或 \\endhead。`)
      }
    }
    const cap: Node = { t: 'Div', c: [['', [], [['custom-style', isLongTable ? 'WbxLongTableCaption' : object === 'Table' ? 'WbxTableCaption' : 'WbxCaption']]],
      [para([marker({ kind: 'caption', chapter: chapter(), sequence, object, bookmark: name }), ...nodes(first.c)])]] }
    if (object === 'Table') return [cap, entry]
    return [...nodes(parts[2]), cap]
  })
  const isAcknowledgment = (entry: Node) => {
    if (entry.t !== 'Header' || school !== 'njupt-professional-masters') return false
    const [level, attributes, inlines] = entry.c as [number, Attribute, Node[]]
    return level === 1 && attributes[1].includes('unnumbered') &&
      /^(?:致谢|acknowledg(?:e)?ments?)$/i.test(nodeText(inlines).trim())
  }
  const acknowledgmentIndex = body.blocks.findIndex(isAcknowledgment)
  if (acknowledgmentIndex !== -1 && body.blocks.slice(acknowledgmentIndex + 1).some(entry => entry.t === 'Header')) {
    const location = snapshot.sections.find(section => /^(?:致谢|acknowledg(?:e)?ments?)$/i.test(section.title.trim()))
    throw new Error(`${location?.path ?? 'main.tex'}:${location?.line ?? 1} · 请将无编号的致谢放在稿件末尾。`)
  }
  const acknowledgmentBlocks = acknowledgmentIndex < 0 ? [] : body.blocks.slice(acknowledgmentIndex + 1)
  body.blocks = blocks(acknowledgmentIndex < 0 ? body.blocks : body.blocks.slice(0, acknowledgmentIndex))
  const acknowledgments = blocks(acknowledgmentBlocks)
  if (headings.length + Number(acknowledgmentIndex >= 0) !== snapshot.sections.length || floats !== snapshot.floats.length) {
    throw new Error('正文标题或图表的解析数量与原稿不一致，请检查源文件结构。')
  }
  if (!headings.length) throw new Error('请至少添加一个一级标题再导出。')
  if (equations !== numberedEquations.length) {
    const offset = numberedEquations[equations]?.index ?? 0
    docxSourceError(snapshot, 'body', offset, '请将编号 equation 单独成段，避免紧邻正文或其他公式。')
  }

  const assets = snapshot.assets.map((asset, index) => ({
    ...asset, name: 'asset-' + (index + 1) + '.' + asset.path.split('.').at(-1)!.toLowerCase(),
  }))
  let math = 0
  let images = 0
  const transform = (node: Node) => {
    if (node.t === 'Image') {
      const [attrs, , target] = node.c as [Attribute, Node[], [string, string]]
      for (const pair of attrs[2]) {
        const fraction = /^(\d*(?:\.\d+)?)\\(?:linewidth|textwidth|columnwidth)$/.exec(pair[1])
        if (fraction) pair[1] = Math.min(100, Number(fraction[1] || '1') * 100) + '%'
      }
      const asset = assets.find(item => item.path === target[0] || item.path.replace(/\.[a-z]+$/i, '') === target[0])
      if (!asset) throw new Error('找不到 Word 图片素材 ' + target[0] + '。')
      target[0] = asset.name
      images++
    }
    if (node.t === 'Math') math++
    if (node.t === 'RawInline' || node.t === 'RawBlock') throw new Error('发现无法可靠转换的 LaTeX 内容：' + (node.c as Value[])[1])
    if (node.t !== 'Link') return
    const [attributes, inlines, [href]] = node.c as [Attribute, Node[], [string, string]]
    const key = href.startsWith('#') ? href.slice(1) : ''
    const target = references.get(key)
    const mode = nodeText(inlines) === 'WbxPageReferenceX' ? 'pageref' : attributes[2].find(([name]) => name === 'reference-type')?.[1]
    if (!target) {
      if (key || mode) {
        const location = snapshot.references.find(item => item.key === key)
        throw new Error((location ? `${location.path}:${location.line} · ` : '') + '无法将引用 ' + key + ' 绑定到可更新的 Word 编号。')
      }
      if (!/^(?:https?:|mailto:)/i.test(href)) throw new Error('Word 导出仅支持 HTTP(S) 或电子邮件链接。')
      return
    }
    if (mode === 'eqref' && target.kind !== 'equation') {
      const location = snapshot.references.find(item => item.key === key && item.kind === 'eqref')
      throw new Error((location ? `${location.path}:${location.line} · ` : '') + '\\eqref 必须引用编号公式。')
    }
    const prefix = mode === 'eqref' ? '（' : mode === 'autoref' || mode === 'ref+label' ?
      ({ heading: '第 ', appendix: '附录 ', figure: '图 ', table: '表 ', equation: '式 ', bibliography: '' }[target.kind]) : undefined
    Object.assign(node, marker({ kind: 'reference', bookmark: target.name,
      cached: mode === 'pageref' ? '—' : target.kind === 'bibliography' ? nodeText(inlines) || target.value : target.value,
      mode: mode === 'pageref' ? 'page' : target.chineseChapter ? 'chapter-number' : target.kind === 'heading' ? 'number' : 'text',
      prefix, suffix: mode === 'eqref' ? '）' : undefined }))
  }
  walk(body.blocks, transform)
  walk(abstract.blocks, transform)
  walk(bibliography, transform)
  walk(acknowledgments, transform)

  // Use sentinel paragraphs to split the Pandoc output without serializing a second OOXML package.
  const sentinel = (title: string) => para([{ t: 'Code', c: [['', [], []], title] }])
  const appendixIndex = body.blocks.indexOf(appendixStart)
  const mainBlocks = appendixIndex < 0 ? body.blocks : body.blocks.slice(0, appendixIndex)
  const appendixBlocks = appendixIndex < 0 ? [appendixStart] : body.blocks.slice(appendixIndex)
  body.meta = {}
  body.blocks = [...abstract.blocks, sentinel('WbxStartBodyX'), ...mainBlocks,
    sentinel('WbxStartBibliographyX'), ...bibliography, ...appendixBlocks, ...(acknowledgmentIndex < 0 ? [] : [sentinel('WbxStartAcknowledgmentX'), ...acknowledgments])]
  return { body, tokens, headings, assets, math, images, tables: snapshot.floats.filter(item => item.kind === 'table').length }
}
