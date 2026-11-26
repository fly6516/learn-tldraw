import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import JSZip from 'jszip'

const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export async function zjuExportCover(original: File, includeDeclarations: boolean, fields: readonly string[]) {
  const zip = await JSZip.loadAsync(await original.arrayBuffer())
  const main = 'word/document.xml'
  const xml = await zip.file(main)?.async('string')
  if (!xml) throw new Error('官方 Word 原件缺少正文部件。')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const body = doc.getElementsByTagNameNS(word, 'body').item(0)
  const nodes = body && Array.from(body.childNodes).filter((node): node is Element => node.nodeType === 1 && node.namespaceURI === word)
  const end = includeDeclarations ? 27 : 14
  const section = nodes?.[end]?.getElementsByTagNameNS(word, 'sectPr').item(0)
  if (!body || !nodes || !section || !nodes[15]?.textContent?.includes('原创性声明')) {
    throw new Error('此版官方 Word 的封面或声明位置无法识别。')
  }
  fillZjuCoverNodes(nodes, fields)
  for (const node of nodes.slice(end + 1)) body.removeChild(node)
  for (const frontSection of Array.from(body.getElementsByTagNameNS(word, 'sectPr'))) {
    // Writer expands Word's East Asian character grid, pushing the original cover onto two pages.
    // The isolated front matter uses its original margins, artwork and text runs with automatic flow.
    for (const name of ['docGrid', 'headerReference', 'footerReference']) {
      for (const setting of Array.from(frontSection.getElementsByTagNameNS(word, name))) {
        setting.parentNode?.removeChild(setting)
      }
    }
  }
  if (includeDeclarations) {
    for (const paragraph of nodes.slice(15, 28)) {
      const properties = paragraph.getElementsByTagNameNS(word, 'pPr').item(0)
      if (!properties) continue
      let spacing = properties.getElementsByTagNameNS(word, 'spacing').item(0)
      if (!spacing) {
        spacing = doc.createElementNS(word, 'w:spacing')
        properties.insertBefore(spacing, properties.getElementsByTagNameNS(word, 'rPr').item(0))
      }
      spacing.setAttributeNS(word, 'w:line', '240')
      spacing.setAttributeNS(word, 'w:lineRule', 'auto')
    }
    const date = nodes[25].getElementsByTagNameNS(word, 't').item(0)
    if (date?.textContent) date.textContent = date.textContent.replace(/ {5}$/, ' ')
  }
  section.parentNode?.removeChild(section)
  body.appendChild(section)
  zip.file(main, new XMLSerializer().serializeToString(doc))
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'cover.docx')
}

export function fillZjuCoverNodes(nodes: readonly Element[], fields: readonly string[], compact = false) {
  const labels = ['题目', '姓名与学号', '指导教师', '年级与专业', '所在学院', '提交日期']
  for (const [position, paragraph] of [6, 9, 10, 11, 12, 14].entries()) {
    const text = Array.from(nodes[paragraph].getElementsByTagNameNS(word, 't'))
    const label = labels[position]
    let prefix = ''
    let value = 0
    while (value < text.length && prefix.length < label.length) prefix += text[value++].textContent
    if (prefix !== label || !text[value]) throw new Error(`官方 Word 封面无法定位“${label}”。`)
    // Retain the original title run's font and the other fields' underline formatting.
    if (position === 0) value = 3
    for (let i = label === '题目' ? 1 : value; i < text.length; i++) {
      if (i === value) {
        text[i].setAttribute('xml:space', 'preserve')
        text[i].textContent = position === 0 ? '   ' + fields[position] : compact ? ' ' + fields[position] + ' ' : '     ' + fields[position] + '     '
      } else text[i].textContent = ''
    }
  }
}
