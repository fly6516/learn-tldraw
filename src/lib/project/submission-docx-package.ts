import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { fillZjuCoverNodes } from './zju-export-cover'
import { chineseChapterNumber, type WordHeading, type WordToken } from './docx-manuscript'
import type { SubmissionDocxFields, SubmissionDocxId } from './submission-docx-config'

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const math = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const dc = 'http://purl.org/dc/elements/1.1/'
const main = 'word/document.xml'
const relationships = 'word/_rels/document.xml.rels'
const xml = 'http://www.w3.org/XML/1998/namespace'
const serializer = new XMLSerializer()

const children = (node: Element) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1)
const all = (node: Element | Document, name: string) => Array.from(node.getElementsByTagNameNS(w, name))
const first = (node: Element | Document, name: string) => all(node, name)[0]
const text = (node: Element) => all(node, 't').map(item => item.textContent ?? '').join('')
const val = (node: Element | undefined, name = 'val') => node?.getAttributeNS(w, name)
const set = (node: Element, name: string, value: string) => node.setAttributeNS(w, 'w:' + name, value)

async function readXml(zip: JSZip, path: string) {
  const data = await zip.file(path)?.async('string')
  if (!data || /<!DOCTYPE/i.test(data)) throw new Error('Word 部件无法读取：' + path)
  return new DOMParser().parseFromString(data, 'application/xml')
}

const save = (zip: JSZip, path: string, doc: Document) => zip.file(path, serializer.serializeToString(doc))
function el(doc: Document, name: string, attrs: Record<string, string> = {}, value?: string) {
  const node = doc.createElementNS(w, 'w:' + name)
  for (const [key, item] of Object.entries(attrs)) set(node, key, item)
  if (value !== undefined) node.textContent = value
  return node
}

function prop(parent: Element, name: string) {
  return children(parent).find(child => child.namespaceURI === w && child.localName === name) ?? parent.appendChild(el(parent.ownerDocument!, name)) as Element
}

function strip(node: Element, names: readonly string[]) {
  for (const name of names) for (const item of all(node, name)) item.parentNode?.removeChild(item)
}

function replaceText(paragraph: Element, value: string) {
  const runs = all(paragraph, 't')
  const target = [...runs].sort((a, b) => (b.textContent?.trim().length ?? 0) - (a.textContent?.trim().length ?? 0))[0]
  if (!target) throw new Error('官方 Word 原件的文字位置与登记结构不同。')
  for (const run of runs) run.textContent = run === target ? value : ''
  target.setAttributeNS(xml, 'xml:space', 'preserve')
}

function run(doc: Document, value: string) {
  const wrapper = el(doc, 'r')
  const node = el(doc, 't', {}, value)
  node.setAttributeNS(xml, 'xml:space', 'preserve')
  wrapper.appendChild(node)
  return wrapper
}

function tabRun(doc: Document) {
  const run = el(doc, 'r')
  run.appendChild(el(doc, 'tab'))
  return run
}

function field(doc: Document, instruction: string, value: string) {
  const node = el(doc, 'fldSimple', { instr: instruction })
  node.appendChild(run(doc, value))
  return node
}

function para(doc: Document, style: string, value?: string) {
  const node = el(doc, 'p')
  prop(node, 'pPr').appendChild(el(doc, 'pStyle', { val: style }))
  if (value !== undefined) node.appendChild(run(doc, value))
  return node
}

function pageBreak(p: Element) {
  const doc = p.ownerDocument!
  const pr = prop(p, 'pPr')
  pr.insertBefore(el(doc, 'pageBreakBefore'), children(pr).find(node => !['pStyle', 'keepNext', 'keepLines'].includes(node.localName ?? '')) ?? null)
}

function sectionEnd(doc: Document, section: Element) {
  const p = el(doc, 'p')
  prop(p, 'pPr').appendChild(section)
  return p
}

async function copyLinkedContent(target: JSZip, targetRels: Document, targetTypes: Document, source: JSZip, incoming: Element[], prefix: string) {
  const sourceRels = await readXml(source, relationships)
  const sourceTypes = await readXml(source, '[Content_Types].xml')
  const mapped = new Map<string, string>()
  const root = targetRels.documentElement!
  const extensions = targetTypes.documentElement!
  const relationshipsList = children(sourceRels.documentElement!)
  const types = children(sourceTypes.documentElement!)
  for (const node of incoming) for (const item of [node, ...Array.from(node.getElementsByTagName('*'))]) {
    for (const attribute of Array.from(item.attributes)) {
      if (attribute.namespaceURI !== r) continue
      const previous = attribute.value
      let id = mapped.get(previous)
      if (!id) {
        const relationship = relationshipsList.find(row => row.getAttribute('Id') === previous)
        const type = relationship?.getAttribute('Type')
        const href = relationship?.getAttribute('Target')
        if (!type || !href) throw new Error('Word 素材关系无法读取。')
        let targetPath = href
        const external = relationship?.getAttribute('TargetMode') === 'External'
        if (external && (!type.endsWith('/hyperlink') || !/^(?:https?:|mailto:)/i.test(href))) {
          throw new Error('Word 原件含无法安全保留的外部素材链接。')
        }
        if (!external) {
          if (!type.endsWith('/image') || !/^media\/[a-z\d_.-]+$/i.test(href)) throw new Error('Word 导出遇到无法保留的嵌入对象。')
          const part = source.file('word/' + href)
          if (!part) throw new Error('Word 包缺少图片 ' + href + '。')
          targetPath = 'media/' + prefix + '-' + href.slice(6)
          target.file('word/' + targetPath, await part.async('uint8array'))
          const ext = href.split('.').at(-1)!.toLowerCase()
          if (!children(extensions).some(row => row.getAttribute('Extension')?.toLowerCase() === ext)) {
            const type = types.find(row => row.getAttribute('Extension')?.toLowerCase() === ext)
            if (!type) throw new Error('图片缺少 Word 内容类型。')
            extensions.appendChild(targetTypes.importNode(type, true))
          }
        }
        id = 'rIdWbx' + prefix + (mapped.size + 1)
        mapped.set(previous, id)
        const added = targetRels.createElementNS(relNs, 'Relationship')
        added.setAttribute('Id', id)
        added.setAttribute('Type', type)
        added.setAttribute('Target', targetPath)
        if (external) added.setAttribute('TargetMode', 'External')
        root.appendChild(added)
      }
      item.setAttributeNS(r, attribute.name, id)
    }
  }
}

function styleDocument(styles: Document, zju: boolean, bodySection: Element) {
  const root = styles.documentElement!
  const base = zju ? 'af8' : 'Normal'
  const mainSize = '24'
  function add(id: string, size: string, spacing: string, font: string, options: { center?: boolean; bold?: boolean; indent?: boolean; outline?: boolean; keep?: boolean } = {}) {
    const style = el(styles, 'style', { type: 'paragraph', styleId: id, customStyle: '1' })
    style.appendChild(el(styles, 'name', { val: id }))
    style.appendChild(el(styles, 'basedOn', { val: base }))
    const p = prop(style, 'pPr')
    if (options.keep) p.appendChild(el(styles, 'keepNext'))
    p.appendChild(el(styles, 'snapToGrid', { val: 'false' }))
    p.appendChild(el(styles, 'spacing', { before: '0', after: '0', line: spacing, lineRule: 'auto' }))
    p.appendChild(el(styles, 'ind', { left: '0', right: '0', firstLine: options.indent ? '480' : '0', firstLineChars: options.indent ? '200' : '0' }))
    p.appendChild(el(styles, 'jc', { val: options.center ? 'center' : 'left' }))
    if (options.outline) p.appendChild(el(styles, 'outlineLvl', { val: '0' }))
    const fontProps = prop(style, 'rPr')
    fontProps.appendChild(el(styles, 'rFonts', { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: font, cs: 'Times New Roman' }))
    if (options.bold) fontProps.appendChild(el(styles, 'b'))
    fontProps.appendChild(el(styles, 'sz', { val: size }))
    fontProps.appendChild(el(styles, 'szCs', { val: size }))
    root.appendChild(style)
  }
  add('WbxBody', mainSize, zju ? '360' : '300', zju ? '仿宋' : '宋体', { indent: true })
  add('WbxCaption', '21', '240', '宋体', { bold: zju, center: true })
  add('WbxTableCaption', '21', '240', '宋体', { bold: zju, center: true, keep: true })
  add('WbxLongTableCaption', '21', '240', '宋体', { bold: zju, center: true, keep: true })
  add('WbxImage', mainSize, '240', '宋体', { center: true, keep: true })
  add('WbxCell', '21', '240', '宋体')
  add('WbxAbstract', '24', '360', zju ? '仿宋' : '宋体', { indent: true })
  add('WbxFrontTitle', '30', '360', zju ? '仿宋' : '黑体', { center: true, bold: true, keep: true })
  add('WbxKeywords', '24', '360', zju ? '仿宋' : '宋体')
  add('WbxBibliography', '21', '240', '宋体')
  add('WbxBibliographyHeading', zju ? '32' : '30', '360', zju ? '仿宋' : '黑体', { center: true, bold: true, outline: true, keep: true })
  add('WbxEquation', mainSize, '360', '宋体')
  const equationStyle = all(styles, 'style').find(style => val(style, 'styleId') === 'WbxEquation')!
  const equationParagraph = first(equationStyle, 'pPr')
  const margins = first(bodySection, 'pgMar')
  const width = Number(val(first(bodySection, 'pgSz'), 'w')) - Number(val(margins, 'left')) - Number(val(margins, 'right')) - Number(val(margins, 'gutter') ?? 0)
  if (!Number.isSafeInteger(width) || width < 1000) throw new Error('无法确定官方原件的正文版心宽度。')
  const equationTabs = el(styles, 'tabs')
  equationTabs.appendChild(el(styles, 'tab', { val: 'center', pos: String(Math.floor(width / 2)) }))
  equationTabs.appendChild(el(styles, 'tab', { val: 'right', pos: String(width) }))
  equationParagraph.insertBefore(equationTabs, equationParagraph.firstChild)
  for (const level of [1, 2, 3]) {
    const id = 'WbxAppendix' + level
    const style = el(styles, 'style', { type: 'paragraph', styleId: id, customStyle: '1' })
    style.appendChild(el(styles, 'name', { val: id }))
    style.appendChild(el(styles, 'basedOn', { val: zju ? String(level) : 'Heading' + level }))
    const paragraph = prop(style, 'pPr')
    const numbering = el(styles, 'numPr')
    numbering.appendChild(el(styles, 'numId', { val: '0' }))
    paragraph.appendChild(numbering)
    paragraph.appendChild(el(styles, 'outlineLvl', { val: String(level - 1) }))
    root.appendChild(style)
  }
  const tocStyles = all(styles, 'style').filter(style => /^TOC[1-3]$/.test(val(style, 'styleId') ?? ''))
  const firstLevel = tocStyles.find(style => val(style, 'styleId') === 'TOC1')
  const pageTab = firstLevel && all(firstLevel, 'tab').find(node => val(node) === 'right')
  if (pageTab) for (const style of tocStyles) {
    const properties = prop(style, 'pPr')
    if (all(properties, 'tab').some(node => val(node) === 'right')) continue
    const tabs = first(properties, 'tabs') ?? properties.insertBefore(el(styles, 'tabs'), children(properties).find(node =>
      ['suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN',
        'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'jc', 'outlineLvl'].includes(node.localName ?? '')) ?? null) as Element
    tabs.appendChild(pageTab.cloneNode(true))
  }
  if (!zju) for (const [index, size] of ['30', '28', '24'].entries()) {
    const original = all(styles, 'style').find(node => val(node, 'styleId') === 'Heading' + (index + 1))
    if (!original) throw new Error('上电示范原件缺少标题样式。')
    const p = prop(original, 'pPr')
    const ordered = (name: string, later: readonly string[]) => first(p, name) ?? p.insertBefore(el(styles, name),
      children(p).find(child => later.includes(child.localName ?? '')) ?? null) as Element
    const afterAlignment = ['textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle']
    const afterIndent = ['contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', ...afterAlignment]
    const spacing = ordered('spacing', ['ind', ...afterIndent])
    set(spacing, 'line', '360')
    set(spacing, 'lineRule', 'auto')
    set(spacing, 'before', index === 0 ? '0' : '120')
    set(spacing, 'after', index === 0 ? '120' : '0')
    set(ordered('jc', afterAlignment), 'val', index === 0 ? 'center' : 'left')
    if (index === 2) set(ordered('ind', afterIndent), 'left', '480')
    const formatting = prop(original, 'rPr')
    set(prop(formatting, 'rFonts'), 'eastAsia', '黑体')
    const bold = prop(formatting, 'b')
    const fontSize = first(formatting, 'sz')
    if (fontSize) formatting.insertBefore(bold, fontSize)
    set(bold, 'val', 'true')
    set(prop(formatting, 'sz'), 'val', size)
    set(prop(formatting, 'szCs'), 'val', size)
  }

}

function remapParagraphs(nodes: Element[], doc: Document, zju: boolean, numberingId: string, tokens: ReadonlyMap<string, WordToken>) {
  for (const node of nodes) for (const p of node.localName === 'p' ? [node, ...all(node, 'p')] : all(node, 'p')) {
    let pr = first(p, 'pPr')
    if (!pr) {
      pr = el(doc, 'pPr')
      p.insertBefore(pr, p.firstChild)
    }
    const style = first(pr, 'pStyle') ?? pr.insertBefore(el(doc, 'pStyle'), pr.firstChild) as Element
    const level = /^Heading([1-3])$/.exec(val(style) ?? '')?.[1]
    if (level) {
      const heading = tokens.get(all(p, 't')[0]?.textContent ?? '')
      if (heading?.kind === 'heading' && heading.appendix) {
        set(style, 'val', 'WbxAppendix' + level)
        if (level === '1') pageBreak(p)
        continue
      }
      set(style, 'val', zju ? level : 'Heading' + level)
      if (level === '1') pageBreak(p)
      const num = el(doc, 'numPr')
      num.appendChild(el(doc, 'ilvl', { val: String(Number(level) - 1) }))
      num.appendChild(el(doc, 'numId', { val: numberingId }))
      pr.insertBefore(num, children(pr).find(child => !['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore'].includes(child.localName ?? '')) ?? null)
    } else if (!(val(style) ?? '').startsWith('Wbx')) {
      set(style, 'val', all(p, 'drawing').length ? 'WbxImage' : node.localName === 'tbl' ? 'WbxCell' : 'WbxBody')
    }
    for (const rStyle of all(p, 'rStyle')) {
      // Pandoc's private style IDs do not exist in the pinned school package.
      rStyle.parentNode?.removeChild(rStyle)
    }
  }
  for (const table of nodes.filter(node => node.localName === 'tbl')) {
    for (const style of all(table, 'tblStyle')) style.parentNode?.removeChild(style)
    const properties = first(table, 'tblPr')
    const columns = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const
    if (!properties) continue
    const alignment = first(properties, 'jc') ?? properties.insertBefore(el(doc, 'jc'), children(properties).find(item =>
      ['tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription'].includes(item.localName ?? '')) ?? null) as Element
    set(alignment, 'val', 'center')
    strip(properties, ['tblBorders'])
    const borders = el(doc, 'tblBorders')
    for (const name of columns) borders.appendChild(el(doc, name, name === 'top' || name === 'bottom'
      ? { val: 'single', sz: '8', color: '000000' } : { val: 'nil' }))
    properties.insertBefore(borders, children(properties).find(item =>
      ['shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription'].includes(item.localName ?? '')) ?? null)
    const header = all(table, 'tr').find(row => first(row, 'tblHeader'))
    if (header) for (const cell of all(header, 'tc')) {
      const props = first(cell, 'tcPr')
      if (!props) continue
      const border = prop(props, 'tcBorders')
      const next = children(props).find(item =>
        ['shd', 'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark'].includes(item.localName ?? ''))
      if (next) props.insertBefore(border, next)
      border.appendChild(el(doc, 'bottom', { val: 'single', sz: '4', color: '000000' }))
    }
  }
}

function repeatLongTableTitles(doc: Document, nodes: Element[]) {
  const moved = new Set<Element>()
  for (const [index, caption] of nodes.entries()) {
    if (caption.localName !== 'p' || val(first(caption, 'pStyle')) !== 'WbxLongTableCaption') continue
    const table = nodes[index + 1]
    if (table?.localName !== 'tbl') throw new Error('无法定位跨页表格及表题。')
    const rows = children(table).filter(item => item.localName === 'tr')
    const firstRow = rows[0]
    const grid = first(table, 'tblGrid')
    const columns = grid ? all(grid, 'gridCol').length : 0
    if (!firstRow || !first(firstRow, 'tblHeader') || !columns) throw new Error('跨页表格必须有可重复的表头。')
    for (const row of rows) {
      const props = first(row, 'trPr') ?? row.insertBefore(el(doc, 'trPr'), first(row, 'tc')) as Element
      if (!first(props, 'cantSplit')) props.insertBefore(el(doc, 'cantSplit'),
        children(props).find(item => ['trHeight', 'tblHeader', 'tblCellSpacing', 'jc'].includes(item.localName ?? '')) ?? null)
    }
    const outerBorder = first(first(table, 'tblPr'), 'tblBorders')
    set(first(outerBorder, 'top'), 'val', 'nil')
    for (const cell of children(firstRow).filter(item => item.localName === 'tc')) {
      const border = first(cell, 'tcBorders')
      border.insertBefore(el(doc, 'top', { val: 'single', sz: '8', color: '000000' }), border.firstChild)
    }
    const row = el(doc, 'tr')
    const props = prop(row, 'trPr')
    props.appendChild(el(doc, 'cantSplit'))
    props.appendChild(el(doc, 'tblHeader'))
    const cell = el(doc, 'tc')
    if (columns > 1) prop(cell, 'tcPr').appendChild(el(doc, 'gridSpan', { val: String(columns) }))
    cell.appendChild(caption)
    row.appendChild(cell)
    table.insertBefore(row, firstRow)
    moved.add(caption)
  }
  return moved
}

function assignTokens(doc: Document, tokens: ReadonlyMap<string, WordToken>, zju: boolean) {
  let number = Math.max(0, ...all(doc, 'bookmarkStart').map(node => Number(val(node, 'id')) || 0))
  const seen = new Set<string>()
  for (const element of all(doc, 't')) {
    const key = element.textContent ?? ''
    const token = tokens.get(key)
    if (!token) continue
    const original = element.parentNode
    const parent = original?.parentNode
    if (!original || !parent || seen.has(key)) throw new Error('Word 引用字段的位置无法确定。')
    seen.add(key)
    const result: Element[] = []
    const anchor = (name: string | undefined, content: Element[]) => {
      if (!name) return content
      const id = String(++number)
      return [el(doc, 'bookmarkStart', { id, name }), ...content, el(doc, 'bookmarkEnd', { id })]
    }
    if (token.kind === 'heading') {
      // Word replaces cached TOC bookmarks on a full refresh. Body REF fields
      // need an independent bookmark on the same numbered paragraph.
      result.push(...anchor(token.tocBookmark, []))
      if (token.appendix) {
        if (token.appendix.firstLevel) result.push(run(doc, '附录 '))
        result.push(...anchor(token.referenceBookmark, [run(doc, token.appendix.number)]), run(doc, ' '))
      } else result.push(...anchor(token.referenceBookmark, []))
    } else if (token.kind === 'caption') {
      const restart = !/^\d+$/.test(token.chapter) && token.sequence === 1 ? ' \\r 1' : ' \\s 1'
      result.push(run(doc, token.object === 'Figure' ? '图 ' : '表 '), ...anchor(token.bookmark, [
        run(doc, String(token.chapter) + (zju ? '.' : '-')),
        field(doc, 'SEQ Wbx' + token.object + restart, String(token.sequence)),
      ]), run(doc, '　'))
    } else if (token.kind === 'equation') {
      const formula = (parent as Element).getElementsByTagNameNS(math, 'oMath')[0]
      if (!formula || formula.parentNode !== parent) throw new Error('不能将编号与 Word 公式放在同一段落。')
      parent.insertBefore(tabRun(doc), formula)
      const restart = !/^\d+$/.test(token.chapter) && token.sequence === 1 ? ' \\r 1' : ' \\s 1'
      result.push(tabRun(doc), run(doc, '（'), ...anchor(token.bookmark, [
        run(doc, token.chapter + (zju ? '.' : '-')),
        field(doc, 'SEQ WbxEquation' + restart, String(token.sequence)),
      ]), run(doc, '）'))
    } else if (token.kind === 'bibliography') {
      result.push(run(doc, '['), ...anchor(token.bookmark, [run(doc, token.number)]), run(doc, ']'))
    } else {
      if (token.prefix) result.push(run(doc, token.prefix))
      const numbering = token.mode === 'chapter-number' ? ' \\n \\t' : token.mode === 'number' ? ' \\n' : ''
      const reference = field(doc, (token.mode === 'page' ? 'PAGEREF' : 'REF') + ' ' + token.bookmark +
        numbering + ' \\h', token.cached)
      const alignment = first(original as Element, 'vertAlign')
      if (alignment) {
        const formatting = el(doc, 'rPr')
        formatting.appendChild(alignment.cloneNode(true))
        const target = first(reference, 'r')
        target.insertBefore(formatting, target.firstChild)
      }
      result.push(reference)
      if (token.suffix) result.push(run(doc, token.suffix))
    }
    for (const node of result) parent.insertBefore(node, original)
    parent.removeChild(original)
  }
  if (seen.size !== tokens.size) throw new Error('一个或多个目录、题注或引用字段在转换时丢失。')
}

function tableOfContents(doc: Document, headings: WordHeading[], zju: boolean) {
  const fields = (kind: string, instruction?: string) => {
    const row = el(doc, 'r')
    row.appendChild(instruction ? el(doc, 'instrText', {}, instruction) : el(doc, 'fldChar', { fldCharType: kind }))
    return row
  }
  return headings.map((heading, index) => {
    const row = para(doc, 'TOC' + heading.level)
    if (index === 0) {
      row.appendChild(fields('begin'))
      row.appendChild(fields('', 'TOC \\o "1-3" \\h \\z \\u'))
      row.appendChild(fields('separate'))
    }
    const hyperlink = el(doc, 'hyperlink', { anchor: heading.bookmark })
    const prefix = heading.number && !zju && heading.level === 1 ? '第' + chineseChapterNumber(heading.number) + '章' : heading.number
    hyperlink.appendChild(run(doc, [prefix, heading.title].filter(Boolean).join(' ')))
    row.appendChild(hyperlink)
    const tab = el(doc, 'r')
    tab.appendChild(el(doc, 'tab'))
    row.appendChild(tab)
    row.appendChild(field(doc, 'PAGEREF ' + heading.bookmark + ' \\h', '—'))
    if (index === headings.length - 1) row.appendChild(fields('end'))
    return row
  })
}

async function discardUnusedParts(zip: JSZip, rels: Document, document: Document, types: Document) {
  const used = new Set<string>()
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    for (const attribute of Array.from(element.attributes)) if (attribute.namespaceURI === r) used.add(attribute.value)
  }
  const implicit = /\/(?:styles|stylesWithEffects|settings|webSettings|fontTable|numbering|theme)$/
  for (const row of children(rels.documentElement!)) {
    if (!used.has(row.getAttribute('Id') ?? '') && !implicit.test(row.getAttribute('Type') ?? '')) row.parentNode!.removeChild(row)
  }
  save(zip, relationships, rels)
  const root = await readXml(zip, '_rels/.rels')
  for (const row of children(root.documentElement!)) {
    if (/\/(?:thumbnail|custom-properties)$/.test(row.getAttribute('Type') ?? '')) row.parentNode!.removeChild(row)
  }
  save(zip, '_rels/.rels', root)
  const reachable = new Set(['[Content_Types].xml'])
  async function follow(path: string) {
    if (reachable.has(path) || !zip.file(path)) return
    reachable.add(path)
    const doc = await readXml(zip, path)
    const base = path.slice(0, path.lastIndexOf('_rels/'))
    for (const row of children(doc.documentElement!)) {
      const target = row.getAttribute('Target')
      if (!target || row.getAttribute('TargetMode') === 'External') continue
      const resolved = new URL(target, 'https://package.invalid/' + base).pathname.slice(1)
      if (!zip.file(resolved)) throw new Error('Word 原件引用缺少部件：' + resolved)
      reachable.add(resolved)
      const slash = resolved.lastIndexOf('/')
      await follow(resolved.slice(0, slash + 1) + '_rels/' + resolved.slice(slash + 1) + '.rels')
    }
  }
  await follow('_rels/.rels')
  for (const file of Object.values(zip.files)) if (!file.dir && !reachable.has(file.name)) zip.remove(file.name)
  for (const item of children(types.documentElement!)) {
    const part = item.getAttribute('PartName')
    if (part && !reachable.has(part.slice(1))) item.parentNode!.removeChild(item)
  }
  save(zip, '[Content_Types].xml', types)
}

async function documentNumbering(zip: JSZip, zju: boolean) {
  const numbering = await readXml(zip, 'word/numbering.xml')
  const number = all(numbering, 'num').find(item => val(item, 'numId') === '1')
  const abstract = number && all(numbering, 'abstractNum').find(item => val(item, 'abstractNumId') === val(first(number, 'abstractNumId')))
  if (!number || !abstract) throw new Error('原件缺少章、节三级编号定义。')
  for (const level of all(abstract, 'lvl')) {
    const rank = Number(val(level, 'ilvl'))
    if (rank > 2) continue
    if (!zju) {
      set(first(level, 'numFmt'), 'val', rank === 0 ? 'chineseCounting' : 'decimal')
      set(first(level, 'lvlText'), 'val', rank === 0 ? '第%1章' : ['%1', '%2', '%3'].slice(0, rank + 1).join('.'))
      if (rank > 0 && !first(level, 'isLgl')) level.insertBefore(el(numbering, 'isLgl'), first(level, 'suff') ?? first(level, 'lvlText'))
    }
    const suffix = first(level, 'suff') ?? level.insertBefore(el(numbering, 'suff'), first(level, 'lvlText')) as Element
    set(suffix, 'val', 'space')
  }
  save(zip, 'word/numbering.xml', numbering)
  return val(number, 'numId')!
}

export async function fillSubmissionDocx(opts: {
  id: SubmissionDocxId; original: Uint8Array; draft: Uint8Array; cover?: Uint8Array; declaration?: Uint8Array
  fields: SubmissionDocxFields; englishTitle: string; tokens: ReadonlyMap<string, WordToken>; headings: WordHeading[]
  math: number; images: number; tables: number; provenance: string
}) {
  const { fields, tokens, headings } = opts
  const zju = opts.id === 'zju-basic-medicine-undergraduate'
  const zip = await JSZip.loadAsync(opts.original)
  const draft = await JSZip.loadAsync(opts.draft)
  const doc = await readXml(zip, main)
  const body = first(doc, 'body')
  const parts = children(body)
  const rels = await readXml(zip, relationships)
  const styles = await readXml(zip, 'word/styles.xml')
  const types = await readXml(zip, '[Content_Types].xml')
  const raw = children(first(await readXml(draft, main), 'body')).filter(item => item.localName !== 'sectPr')
  const frontLimit = raw.findIndex(item => text(item) === 'WbxStartBodyX')
  const bibliographyStart = raw.findIndex(item => text(item) === 'WbxStartBibliographyX')
  const appendixStart = raw.findIndex(item => text(item) === 'WbxStartAppendicesX')
  if (frontLimit < 1 || bibliographyStart <= frontLimit || appendixStart <= bibliographyStart) throw new Error('无法定位稿件的摘要、正文、参考文献和附录。')
  const imported = raw.map(item => doc.importNode(item, true))
  await copyLinkedContent(zip, rels, types, draft, imported, 'Body')
  for (const item of imported) strip(item, ['bookmarkStart', 'bookmarkEnd'])

  const bodySection = zju ? parts[150] && first(parts[150], 'sectPr') : parts.at(-1)
  if (!bodySection || bodySection.localName !== 'sectPr') throw new Error('官方原件缺少正文分节。')
  styleDocument(styles, zju, bodySection)
  save(zip, 'word/styles.xml', styles)
  remapParagraphs(imported, doc, zju, await documentNumbering(zip, zju), tokens)
  const repeatedTitles = repeatLongTableTitles(doc, imported)
  const firstHeading = imported.slice(frontLimit + 1).find(item => /^(?:1|Heading1)$/.test(val(first(item, 'pStyle')) ?? ''))
  if (firstHeading) strip(firstHeading, ['pageBreakBefore'])
  const selected: Element[] = []
  let ending: Element
  const cnSummary = fields.chineseAbstract.split(/\n\s*\n/).map(value => para(doc, 'WbxAbstract', value.replace(/\s*\n\s*/g, ' ')))
  const cnKeywords = para(doc, 'WbxKeywords', '关键词：' + fields.chineseKeywords)
  const enKeywords = para(doc, 'WbxKeywords', (zju ? 'Keywords: ' : 'Key Words: ') + fields.englishKeywords)
  const tail: Element[] = []
  const tocHeadings = headings.filter(item => !item.appendix)
  let landmarkId = Math.max(0, ...all(doc, 'bookmarkStart').map(item => Number(val(item, 'id')) || 0))
  function backMatter(title: string, bookmark: string, content: Element[]) {
    const heading = para(doc, 'WbxBibliographyHeading', title)
    pageBreak(heading)
    const id = String(++landmarkId)
    heading.insertBefore(el(doc, 'bookmarkStart', { id, name: bookmark }), first(heading, 'r'))
    heading.appendChild(el(doc, 'bookmarkEnd', { id }))
    tocHeadings.push({ level: 1, number: '', title, bookmark })
    tail.push(heading, ...content)
  }
  if (!zju && fields.acknowledgment) backMatter('致谢', 'WbxAcknowledgment',
    fields.acknowledgment.split(/\n+/).filter(Boolean).map(value => para(doc, 'WbxBody', value)))
  if (bibliographyStart < appendixStart - 1) backMatter('参考文献', 'WbxBibliography', imported.slice(bibliographyStart + 1, appendixStart))
  tocHeadings.push(...headings.filter(item => item.appendix))
  tail.push(...imported.slice(appendixStart + 1))
  const toc = tableOfContents(doc, tocHeadings, zju)
  if (zju) {
    if (!text(parts[15]).includes('原创性声明') || !text(parts[39]).includes('目录') || !first(parts[150], 'sectPr')) {
      throw new Error('浙大原件的封面、声明或正文分节与登记版不同。')
    }
    fillZjuCoverNodes(parts, [fields.title, fields.author + '  ' + fields.studentNumber, fields.advisor, fields.program, fields.affiliation, fields.date], true)
    replaceText(parts[0], fields.confidentiality === 'restricted' ? '涉密论文 ☒　公开论文 □' : '涉密论文 □　公开论文 ☒')
    replaceText(parts[15], '毕业论文（设计）原创性声明')
    replaceText(parts[31], '摘要')
    replaceText(parts[35], 'Abstract')
    replaceText(parts[39], '目录')
    const authorizationDates = parts.slice(15, 28).find(paragraph => text(paragraph).split('签字日期').length === 3)
    if (authorizationDates) replaceText(authorizationDates, text(authorizationDates).replace(/ {3,}/g, '  '))
    // The original starts separate recto sections for the declarations and front matter.
    // The compatibility grid on the preserved cover and declaration sections can stretch the original form.
    for (const index of [14, 27, 30, 34, 38, 63]) strip(parts[index], ['docGrid'])
    strip(parts[14], ['headerReference', 'footerReference'])
    for (const paragraph of parts.slice(15, 28)) {
      const pr = first(paragraph, 'pPr')
      const spacing = pr && (first(pr, 'spacing') ?? pr.insertBefore(el(doc, 'spacing'),
        children(pr).find(node => ['ind', 'contextualSpacing', 'jc', 'rPr', 'sectPr'].includes(node.localName ?? '')) ?? null) as Element)
      if (spacing) { set(spacing, 'line', '240'); set(spacing, 'lineRule', 'auto') }
    }
    selected.push(...parts.slice(0, 28).filter((_, index) => ![8, 13].includes(index)))
    if (fields.acknowledgment) {
      replaceText(parts[28], '致谢')
      selected.push(parts[28], para(doc, 'WbxAbstract', fields.acknowledgment), parts[30])
    }
    selected.push(parts[31], ...cnSummary, cnKeywords, parts[34], parts[35], ...imported.slice(0, frontLimit),
      enKeywords, parts[38], parts[39], ...toc, parts[63], ...parts.slice(65, 77))
    ending = first(parts[150], 'sectPr').cloneNode(true) as Element
    const defaultFooter = first(ending, 'footerReference')
    const even = defaultFooter.cloneNode(true) as Element
    set(even, 'type', 'even')
    ending.insertBefore(even, defaultFooter)
    for (const file of Object.values(zip.files)) {
      if (!/^word\/header\d+\.xml$/.test(file.name)) continue
      const header = await readXml(zip, file.name)
      for (const paragraph of all(header, 'p')) {
        const content = text(paragraph).replace(/\s+/g, '')
        if (content && !/^浙江大学本科生毕业论文/.test(content)) replaceText(paragraph, fields.title)
      }
      save(zip, file.name, header)
    }
  } else {
    if (!opts.cover || !opts.declaration || !text(parts[1]).replace(/\s/g, '').includes('摘要') || !first(parts[33], 'sectPr')) {
      throw new Error('上电封面、声明或正文示范与登记版不同。')
    }
    for (const [prefix, source] of [['Cover', opts.cover], ['Declaration', opts.declaration]] as const) {
      const front = await JSZip.loadAsync(source)
      const frontNodes = children(first(await readXml(front, main), 'body')).map(node => doc.importNode(node, true))
      const section = frontNodes.pop()
      if (section?.localName !== 'sectPr') throw new Error('上电原件缺少独立分节。')
      while (frontNodes.length > 1 && frontNodes.at(-1)?.localName === 'p' &&
        !text(frontNodes.at(-1)!).trim() && !all(frontNodes.at(-1)!, 'drawing').length && !all(frontNodes.at(-1)!, 'pict').length) frontNodes.pop()
      await copyLinkedContent(zip, rels, types, front, frontNodes, prefix)
      const last = frontNodes.at(-1)!
      if (last.localName === 'p') {
        const pr = first(last, 'pPr') ?? last.insertBefore(el(doc, 'pPr'), last.firstChild) as Element
        pr.appendChild(section)
        selected.push(...frontNodes)
      } else selected.push(...frontNodes, sectionEnd(doc, section))
    }
    strip(parts[33], ['docGrid'])
    const englishTitle = para(doc, 'WbxFrontTitle', opts.englishTitle)
    pageBreak(englishTitle)
    const tocTitle = para(doc, 'WbxFrontTitle', '目录')
    pageBreak(tocTitle)
    selected.push(para(doc, 'WbxFrontTitle', '摘 要'), ...cnSummary, cnKeywords,
      englishTitle, para(doc, 'WbxFrontTitle', 'Abstract'), ...imported.slice(0, frontLimit), enKeywords,
      tocTitle, ...toc, parts[33])
    ending = parts.at(-1)!.cloneNode(true) as Element
    for (const path of ['word/header1.xml', 'word/header2.xml']) {
      const header = await readXml(zip, path)
      const paragraph = all(header, 'p').find(item => text(item).trim())
      if (!paragraph) throw new Error('无法找到上电正文运行页眉。')
      replaceText(paragraph, fields.title)
      const props = prop(paragraph, 'pPr')
      const justify = first(props, 'jc') ?? props.insertBefore(el(header, 'jc'), first(props, 'rPr') ?? null) as Element
      set(justify, 'val', 'center')
      save(zip, path, header)
    }
  }
  selected.push(...imported.slice(frontLimit + 1, bibliographyStart))
  selected.push(...tail)
  while (body.firstChild) body.removeChild(body.firstChild)
  for (const item of selected) if (!repeatedTitles.has(item)) body.appendChild(item)
  strip(ending, ['docGrid'])
  body.appendChild(ending)
  strip(body, ['commentRangeStart', 'commentRangeEnd', 'commentReference', 'proofErr'])
  assignTokens(doc, tokens, zju)
  Array.from(doc.getElementsByTagNameNS(drawing, 'docPr')).forEach((item, index) => item.setAttribute('id', String(index + 1)))
  if (doc.getElementsByTagNameNS(math, 'oMath').length < opts.math || all(body, 'tbl').length < opts.tables ||
    imported.reduce((count, item) => count + all(item, 'drawing').length, 0) !== opts.images) {
    throw new Error('公式、图像或表格转换不完整。请检查是否有 Pandoc 无法读取的结构。')
  }
  const settings = await readXml(zip, 'word/settings.xml')
  const root = settings.documentElement!
  // The source parser rejects notes. Remove the template's separator references
  // before dropping the unused note parts, or Word repairs the resulting package.
  strip(root, ['footnote', 'endnote'])
  // Word asks about external links on open when this option is set, even for
  // the local TOC and bookmark fields. Let authors request a field refresh explicitly.
  strip(root, ['updateFields'])
  save(zip, 'word/settings.xml', settings)
  const core = await readXml(zip, 'docProps/core.xml')
  const coreRoot = core.documentElement!
  while (coreRoot.firstChild) coreRoot.removeChild(coreRoot.firstChild)
  for (const [name, value] of [['title', fields.title], ['creator', fields.author], ['description', opts.provenance]]) {
    const node = core.createElementNS(dc, 'dc:' + name)
    node.textContent = value
    coreRoot.appendChild(node)
  }
  save(zip, 'docProps/core.xml', core)
  // The original Word application properties can contain complete sample title lists.
  const rootRels = await readXml(zip, '_rels/.rels')
  for (const row of children(rootRels.documentElement!)) {
    if (row.getAttribute('Type')?.endsWith('/extended-properties')) row.parentNode!.removeChild(row)
  }
  save(zip, '_rels/.rels', rootRels)
  save(zip, main, doc)
  await discardUnusedParts(zip, rels, doc, types)
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
