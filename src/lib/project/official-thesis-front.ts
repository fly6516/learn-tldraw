import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import JSZip from 'jszip'
import type { WordLayout, LayoutKey, LayoutValues } from './word-layout'
import { wordHeaderOffsetForGap } from './custom-word-tex'

const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const xmlNs = 'http://www.w3.org/XML/1998/namespace'
const elements = (node: Element | undefined, tag: string) => node ? Array.from(node.getElementsByTagNameNS(ns, tag)) : []
const text = (node: Element | undefined) => elements(node, 't').map(run => run.textContent ?? '').join('')
const write = (run: Element, value: string) => {
  run.setAttributeNS(xmlNs, 'xml:space', 'preserve')
  run.textContent = value
}

async function editFront(original: File, edit: (nodes: Element[]) => Element[]) {
  const archive = await JSZip.loadAsync(await original.arrayBuffer())
  const part = 'word/document.xml'
  const source = await archive.file(part)?.async('text')
  if (!source || /<!DOCTYPE/i.test(source)) throw new Error('官方 Word 原件缺少可读取的正文。')
  const document = new DOMParser().parseFromString(source, 'application/xml')
  const body = document.getElementsByTagNameNS(ns, 'body').item(0)
  if (!body) throw new Error('官方 Word 原件缺少正文节。')
  const nodes = Array.from(body.childNodes).filter((node): node is Element => node.nodeType === 1 && node.namespaceURI === ns)
  const front = edit(nodes)
  const properties = elements(body, 'sectPr')[0]?.cloneNode(true) as Element | undefined
  if (!properties) throw new Error('官方 Word 原件缺少页面配置。')
  for (const child of Array.from(properties.childNodes)) {
    if (child.nodeType === 1 && ['headerReference', 'footerReference', 'pgNumType', 'type'].includes(child.localName ?? '')) properties.removeChild(child)
  }
  while (body.firstChild) body.removeChild(body.firstChild)
  for (const node of front) body.appendChild(node)
  body.appendChild(properties)
  archive.file(part, new XMLSerializer().serializeToString(document))
  return new File([await archive.generateAsync({ type: 'arraybuffer' })], 'cover.docx')
}

export type OfficialThesisFields = {
  title: string; name: string; chineseTitle: string; advisor: string; englishAdvisor?: string
  affiliation: string; englishAffiliation?: string; program: string; studentNumber: string; date: string
  direction?: string; degree?: string; englishDegree?: string; studyMode?: string; declarations: boolean
}

export function thesisDate(value: string) {
  const date = /^(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})日?$/.exec(value.trim())
  if (!date) throw new Error('请使用 YYYY-MM-DD 或年月日填写提交日期。')
  const [year, month, day] = date.slice(1).map(Number)
  const instant = new Date(Date.UTC(year, month - 1, day))
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) throw new Error('提交日期无效。')
  return { chinese: `${year}年${month}月${day}日`, year, month, day,
    english: new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(instant) }
}

export function njuptLayout(layout: WordLayout, professional = false, resolveConflicts = false): WordLayout {
  const rules = { ...layout.rules }
  const selected: Partial<LayoutValues> = {
    frontPages: 'Roman', footer: 'center', chapterBreak: 'new-page',
    runningHead: 'even-chapter', header: 'left', fixedHeader: professional ? '南京邮电大学专业学位硕士研究生学位论文' : '南京邮电大学硕士学位论文',
    figures: 'chapter', tables: 'chapter', captionSeparator: 'hyphen', references: 'numbered', tocDepth: 3,
  }
  for (const key of Object.keys(selected) as LayoutKey[]) {
    const sample = { value: selected[key]!, origin: 'sample' as const, source: '南邮 2025 硕士 Word 样例及研究生院撰写标准。' }
    if (!rules[key].standard) rules[key] = { ...rules[key], sample, chosen: sample }
  }
  if (!professional) return { ...layout, presentation: 'njupt-academic', rules }
  const guide = '南京邮电大学研究生学位论文撰写标准（研发2012[8]号）'
  const sections: readonly [Partial<LayoutValues>, string][] = [
    [{ paper: 'a4', top: 20, bottom: 20, left: 20, right: 20, gutter: 0 }, '二（三）1 · 纸张与页面设置'],
    [{ cjkFont: 'song', latinFont: 'times', bodySize: 12, lineMode: 'multiple', spacing: 1.5,
      heading1: 18, heading2: 15, heading3: 14 }, '二（一） · 标题和字体'],
    [{ figures: 'chapter', tables: 'chapter', captionSeparator: 'dot' }, '二（二） · 图表和公式'],
    [{ header: 'left', headerSize: 10.5, runningHead: 'split', fixedHeader: selected.fixedHeader },
      '二（三）2 · 专业学位硕士左侧页眉及章标题'],
    [{ frontPages: 'Roman', footer: 'center' }, '二（三）3 · 前置页和正文页脚'],
    [{ references: 'numbered' }, '一（六） · 顺序编码制及正文上标'],
  ]
  for (const [values, section] of sections) {
    for (const key of Object.keys(values) as LayoutKey[]) {
      const standard = { value: values[key]!, origin: 'standard' as const, source: guide + ' · ' + section }
      const sample = layout.rules[key].sample ?? layout.rules[key].chosen
      rules[key] = { sample, standard, chosen: standard, decision: resolveConflicts || sample.value === standard.value ? 'standard' : undefined,
        confirmed: sample.value === standard.value }
    }
  }
  const headerOffset = layout.rules.headerOffset
  const adequateOffset = wordHeaderOffsetForGap(Number(rules.top.chosen.value), Number(rules.headerSize.chosen.value), 5)
  if (Number(headerOffset.chosen.value) > adequateOffset) {
    rules.headerOffset = { sample: headerOffset.sample ?? headerOffset.chosen,
      chosen: { value: adequateOffset, origin: 'pending', source: '排版预设。正文上边距为 20 mm，页眉横线与正文之间留出 5 mm。官方网页未指定这一间距。' } }
  }
  return { ...layout, presentation: 'njupt-professional', standardName: guide, rules }
}

function alignNjuptCoverRows(nodes: Element[], fieldStart: number, rows: (string | undefined)[]) {
  const labels = elements(elements(nodes[fieldStart], 'txbxContent')[0], 'p').map(text).filter(label => label.trim())
  if (labels.length !== rows.length) throw new Error('无法定位南邮中文封面字段。')
  for (const [i, value] of rows.entries()) {
    const paragraph = nodes[fieldStart + i]
    const add = (parent: Element, tag: string, attrs: Record<string, string> = {}) => {
      const child = paragraph.ownerDocument!.createElementNS(ns, 'w:' + tag)
      for (const [key, value] of Object.entries(attrs)) child.setAttributeNS(ns, 'w:' + key, value)
      parent.appendChild(child)
      return child
    }
    // The Word sample uses a floating label box over underlined blank rows.
    // Lay out the same labels and values together so LibreOffice keeps them aligned.
    while (paragraph.firstChild) paragraph.removeChild(paragraph.firstChild)
    const props = add(paragraph, 'pPr')
    const tabs = add(props, 'tabs')
    add(tabs, 'tab', { val: 'left', pos: '1230' })
    add(tabs, 'tab', { val: 'left', pos: '3580' })
    add(props, 'spacing', { before: '0', after: '0', line: '365', lineRule: 'exact' })
    const run = add(paragraph, 'r')
    const style = add(run, 'rPr')
    add(style, 'rFonts', { eastAsia: '宋体', ascii: 'Times New Roman' })
    add(style, 'sz', { val: '28' })
    add(run, 'tab')
    write(add(run, 't'), labels[i])
    add(run, 'tab')
    write(add(run, 't'), (value ?? '').trim())
  }
}

export function njuptBlindExportFront(original: File, fields: OfficialThesisFields) {
  return editFront(original, nodes => {
    if (!/专\s*业\s*学\s*位\s*硕\s*士\s*论\s*文/.test(text(nodes[5])) ||
      !nodes.slice(14).some(node => text(node).replace(/\s+/g, '').includes('全日制专业学位硕士盲审论文使用此封面'))) {
      throw new Error('南邮盲审封面结构与已核对的官方原件不同。')
    }
    const title = elements(nodes[8], 't').at(-1)
    if (!title || !text(nodes[8]).includes('论文题目')) throw new Error('无法定位南邮盲审题名。')
    write(title, (title.textContent ?? '').trimEnd() + ' ' + fields.chineseTitle.trim())
    alignNjuptCoverRows(nodes, 10, [fields.degree, '全日制', fields.program])
    return nodes.slice(0, 13)
  })
}

export function njuptExportFront(original: File, fields: OfficialThesisFields, professional = false) {
  const date = thesisDate(fields.date)
  return editFront(original, nodes => {
    const titlePattern = professional ? /专\s*业\s*学\s*位\s*硕\s*士\s*论\s*文/ : /学\s*术\s*学\s*位\s*硕\s*士\s*论\s*文/
    if (!titlePattern.test(text(nodes[6])) ||
      !/Thesis Submitted to Nanjing University/.test(text(nodes[27])) ||
      !text(nodes[36]).includes('不要打印')) throw new Error('候选 Word 的南邮中英文封面结构与已支持样式不同。')
    const title = elements(nodes[9], 't').at(-1)
    if (!title) throw new Error('无法定位南邮中文题名。')
    write(title, ' ' + fields.chineseTitle.trim())
    const rows = professional
      ? [fields.studentNumber, fields.name, fields.advisor, fields.degree, fields.studyMode === 'full-time' ? '全日制' : '非全日制', fields.program, date.chinese]
      : [fields.studentNumber, fields.name, fields.advisor, fields.program, fields.direction, fields.degree, date.chinese]
    const fieldStart = professional ? 11 : 13
    alignNjuptCoverRows(nodes, fieldStart, rows)
    for (const [index, value] of [[22, fields.title], [28, fields.englishDegree], [33, fields.name],
      [34, 'Supervisor: ' + fields.englishAdvisor], [35, date.english]] as const) {
      const runs = elements(nodes[index], 't')
      if (!runs.length) throw new Error('无法定位南邮英文封面字段。')
      write(runs[0], value ?? '')
      for (const run of runs.slice(1)) write(run, '')
    }
    const titleProperties = elements(nodes[22], 'pPr')[0]
    if (!titleProperties) throw new Error('无法定位南邮英文封面页。')
    const pageBreak = nodes[22].ownerDocument!.createElementNS(ns, 'w:pageBreakBefore')
    titleProperties.insertBefore(pageBreak, titleProperties.firstChild)
    return nodes.slice(0, 36).filter((_node, index) => !(professional ? [18, 20, 21, 23, 24] : [20, 21, 23, 24]).includes(index))
  })
}

export const additionalWordThesisIds = ['suep-masters', 'ustc-graduate-word', 'scau-undergraduate'] as const
export type AdditionalWordThesisId = typeof additionalWordThesisIds[number]

function replaceRuns(node: Element, value: string, replacement: string) {
  const runs = elements(node, 't')
  const raw = runs.map(run => run.textContent ?? '').join('')
  const index = raw.indexOf(value)
  if (index < 0) throw new Error('官方 Word 前置页缺少已登记的字段。')
  let offset = 0
  for (const run of runs) {
    const previous = run.textContent ?? ''
    const next = offset + previous.length
    if (next > index && offset < index + value.length) {
      write(run, previous.slice(0, Math.max(0, index - offset))
        + (offset <= index ? replacement : '') + previous.slice(Math.min(previous.length, index + value.length - offset)))
    }
    offset = next
  }
}

function removeNotes(node: Element, marker: RegExp) {
  for (const box of elements(node, 'txbxContent').filter(item => marker.test(text(item).trim()))) {
    let draw = box.parentNode as Element | null
    while (draw && !['drawing', 'pict'].includes(draw.localName ?? '')) draw = draw.parentNode as Element | null
    draw?.parentNode?.removeChild(draw)
  }
}

function fillParagraph(node: Element, value: string) {
  const current = elements(node, 't')
  if (current.length) {
    write(current[0], value)
    for (const item of current.slice(1)) write(item, '')
  } else {
    const paragraph = node.localName === 'p' ? node : elements(node, 'p')[0]
    if (!paragraph) throw new Error('官方前置页字段缺少段落。')
    const run = paragraph.ownerDocument!.createElementNS(ns, 'w:r')
    const content = paragraph.ownerDocument!.createElementNS(ns, 'w:t')
    write(content, value)
    run.appendChild(content)
    paragraph.appendChild(run)
  }
}

function fillCells(table: Element, values: Record<string, string>) {
  for (const row of elements(table, 'tr')) {
    const cells = Array.from(row.childNodes).filter((node): node is Element => node.nodeType === 1 && node.localName === 'tc')
    if (cells.length !== 2) continue
    const title = text(cells[0]).replace(/[\s：:]/g, '')
    if (Object.hasOwn(values, title)) fillParagraph(cells[1], values[title])
  }
}

function thesisFrontPages(nodes: Element[], until: number | undefined) {
  if (!until || until < 2) throw new Error('候选 Word 的封面或声明结构与已登记样式不同。')
  return nodes.slice(0, until)
}

function startWordPage(paragraph: Element) {
  const document = paragraph.ownerDocument!
  const props = elements(paragraph, 'pPr')[0] ?? paragraph.insertBefore(document.createElementNS(ns, 'w:pPr'), paragraph.firstChild)
  if (!elements(props, 'pageBreakBefore').length) {
    props.insertBefore(document.createElementNS(ns, 'w:pageBreakBefore'), props.firstChild)
  }
}

function emptySpacer(node: Element) {
  return node.localName === 'p' && !text(node).trim() &&
    !['drawing', 'pict', 'br', 'sectPr'].some(tag => elements(node, tag).length)
}

function fitFrontPages(nodes: Element[]) {
  const result = [...nodes]
  while (result.length && emptySpacer(result[result.length - 1])) result.pop()
  for (const paragraph of result.filter(emptySpacer)) {
    const document = paragraph.ownerDocument!
    const props = elements(paragraph, 'pPr')[0] ?? paragraph.insertBefore(document.createElementNS(ns, 'w:pPr'), paragraph.firstChild)
    const spacing = elements(props, 'spacing')[0] ?? props.appendChild(document.createElementNS(ns, 'w:spacing'))
    for (const [key, value] of Object.entries({ before: '0', after: '0', line: '245', lineRule: 'exact' })) {
      spacing.setAttributeNS(ns, 'w:' + key, value)
    }
  }
  return result
}

function scauFront(nodes: Element[], fields: OfficialThesisFields) {
  const start = nodes.findIndex(node => /华南农业大学本科毕业论文.*原创性声明/.test(text(node)))
  const abstract = nodes.findIndex(node => /^摘\s*要$/.test(text(node).trim()))
  if (start !== 18 || abstract < start) throw new Error('华南农大官方前置页结构与已登记样式不同。')
  fillParagraph(nodes[3], fields.chineseTitle)
  replaceRuns(nodes[10], '××学院', fields.affiliation)
  for (const [index, value] of [[11, fields.program], [12, fields.name], [13, fields.studentNumber], [14, fields.advisor]] as const) {
    const current = text(nodes[index])
    const label = current.split(':')[0]
    fillParagraph(nodes[index], label + ':    ' + value)
  }
  fillParagraph(nodes[15], '提交日期：    ' + thesisDate(fields.date).chinese)
  return fitFrontPages(thesisFrontPages(nodes, fields.declarations ? abstract - 1 : start - 1))
}

type GraduateFields = OfficialThesisFields & { track: 'academic' | 'professional'; englishProgram?: string; classification?: string; udc?: string; confidentiality?: string }

function suepMasterFront(nodes: Element[], fields: GraduateFields) {
  const professional = fields.track === 'professional'
  const start = professional ? 35 : 0
  if (!/学位论文/.test(text(nodes[professional ? 41 : 7]).replace(/\s/g, '')) ||
      !/上海电力大学学位论文原创性声明/.test(text(nodes[76]))) throw new Error('上电硕士官方前置页结构与已登记样式不同。')
  const cover = nodes.slice(start, professional ? 67 : 34)
  const declarations = fields.declarations ? [...nodes.slice(76, 85), ...nodes.slice(107, 120)] : []
  if (fields.declarations) for (const index of [76, 107]) startWordPage(nodes[index])
  const pages = [...cover, ...declarations]
  for (const node of pages) removeNotes(node, /^(?:注[：:]|中文题目黑体|单面印刷)/)
  const { chinese, year, month } = thesisDate(fields.date)
  const data = {
    学位申请人: fields.name, 指导教师: fields.advisor, 学科专业: fields.program, 专业名称: fields.program,
    学位类别: fields.degree ?? '', 所属院系: fields.affiliation, 论文定稿日期: chinese,
  }
  for (const [index, node] of pages.entries()) {
    const value = text(node).trim()
    if (/硕（博）士/.test(value)) replaceRuns(node, '硕（博）士', '硕士')
    if (value.includes('Master’s（Doctor’s）')) replaceRuns(node, 'Master’s（Doctor’s）', 'Master’s')
    if (value.includes('MASTER (DOCTOR)')) replaceRuns(node, 'MASTER (DOCTOR)', 'MASTER')
    if (value.replace(/\s/g, '').includes('填写中图分类号')) replaceRuns(node, '填写中图分类号', fields.classification ?? '')
    if (/学\s*号\s*$/.test(value) && value.includes('10256')) {
      const run = elements(node, 't').at(-1)
      if (run) write(run, (run.textContent ?? '').trimEnd() + '  ' + fields.studentNumber)
    }
    if (node.localName !== 'tbl' || index > 34) continue
    if (value.includes('中文题目')) {
      replaceRuns(node, '中文题目', fields.chineseTitle)
      if (text(node).includes('英文题目')) replaceRuns(node, '英文题目', '')
    } else if (/^年\s*月$/.test(value)) fillParagraph(node, `${year} 年 ${month} 月`)
    else fillCells(node, data)
  }
  return fitFrontPages(pages)
}

function ustcFront(nodes: Element[], fields: GraduateFields) {
  if (!/博士\/硕士学位论文/.test(text(nodes[2])) || !text(nodes[48]).includes('中国科学技术大学学位论文原创性声明')) {
    throw new Error('中科大官方前置页结构与已登记样式不同。')
  }
  const pages = thesisFrontPages(nodes, fields.declarations ? 63 : 47)
  for (const table of [nodes[17], nodes[31]]) {
    for (const lineBreak of elements(table, 'br').filter(item => item.getAttributeNS(ns, 'type') === 'page')) {
      lineBreak.parentNode?.removeChild(lineBreak)
    }
  }
  for (const node of pages) removeNotes(node, /^【注/)
  const { chinese, year, month, day } = thesisDate(fields.date)
  const doctoral = fields.degree === '博士'
  const professional = fields.track === 'professional'
  for (const index of [2, 20]) replaceRuns(nodes[index], '博士/硕士', doctoral ? '博士' : '硕士')
  for (const index of [3, 21]) replaceRuns(nodes[index], '学术/专业', professional ? '专业' : '学术')
  replaceRuns(nodes[23], '论文题名（中文）', fields.chineseTitle)
  fillParagraph(nodes[35], doctoral ? 'Doctoral Dissertation' : 'Master’s Dissertation')
  replaceRuns(nodes[36], 'Academic / Professional', professional ? 'Professional' : 'Academic')
  replaceRuns(nodes[39], 'Title', fields.title)
  const entries: [number, Record<string, string>][] = [
    [9, { 论文题名: fields.chineseTitle, 学生姓名: fields.name, 导师: fields.advisor, 提交日期: chinese }],
    [29, { 学生姓名: fields.name, 学号: fields.studentNumber, 导师姓名: fields.advisor, 院系: fields.affiliation,
      学科专业: fields.program, 研究方向: fields.direction ?? '', 论文提交日期: chinese }],
    [44, { 'Student Name': fields.name, 'Student ID': fields.studentNumber, Supervisor: fields.englishAdvisor ?? '',
      'School/Department': fields.englishAffiliation ?? '', 'Discipline & Major': fields.englishProgram ?? '',
      'Research Direction': fields.direction ?? '', 'Dissertation Submission Date': `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }],
  ]
  for (const [index, values] of entries) {
    for (const box of elements(nodes[index], 'txbxContent')) {
      for (const paragraph of elements(box, 'p')) {
        const raw = text(paragraph)
        const label = raw.split(/[：:]/, 1)[0].trim().replace(/^导\s+师$/, '导师')
        if (/^(?:实践导师|Practice Supervisor)/.test(label)) fillParagraph(paragraph, '')
        else if (Object.hasOwn(values, label)) fillParagraph(paragraph, label + (index === 44 ? ':  ' : '：  ') + values[label])
      }
    }
  }
  for (const index of [17, 31]) for (const cell of elements(nodes[index], 'tc')) {
    const raw = text(cell).trim()
    if (/^(?:中图分类号|CLC No\.)/.test(raw)) fillParagraph(cell, raw + ' ' + (fields.classification ?? ''))
    if (/^(?:UDC分类号|UDC No\.)/.test(raw)) fillParagraph(cell, raw + ' ' + (fields.udc ?? ''))
    if (/^(?:密级|Security Level)/.test(raw)) fillParagraph(cell, raw + ' ' + (fields.confidentiality ?? ''))
  }
  return fitFrontPages(pages.filter(node => ![nodes[47], nodes[62]].includes(node)))
}

export function additionalThesisFront(original: File, variant: AdditionalWordThesisId, fields: GraduateFields) {
  const handlers = { 'suep-masters': suepMasterFront, 'scau-undergraduate': scauFront, 'ustc-graduate-word': ustcFront }
  return editFront(original, nodes => handlers[variant](nodes, fields))
}
