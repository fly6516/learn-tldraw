import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import JSZip from 'jszip'
import type { WordLayout } from './word-layout'

const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export function sjtuLayout(layout: WordLayout): WordLayout {
  const source = '2024-07-01 工学硕士 Word 原件 · 正文页眉和页眉段落样式。'
  return { ...layout, presentation: 'sjtu-engineering', rules: { ...layout.rules,
    header: { ...layout.rules.header, chosen: { value: 'left', origin: 'file', source } },
    headerSize: { ...layout.rules.headerSize, chosen: { value: 9, origin: 'file', source } },
    runningHead: { ...layout.rules.runningHead, chosen: { value: 'split', origin: 'file', source } },
    fixedHeader: { ...layout.rules.fixedHeader, chosen: { value: '上海交通大学硕士学位论文', origin: 'file', source } },
    chapterBreak: { ...layout.rules.chapterBreak, chosen: { value: 'new-page', origin: 'sample',
      source: '2024-07-01 工学硕士 Word 原件 · 正文各章前设置分节换页。' } },
  } }
}

export const sjtuWordPreamble = [
  '\\ctexset{section={name={第\\space,\\space 章},format+=\\bfseries\\centering},subsection={format+=\\bfseries},subsubsection={format+=\\bfseries}}',
  '\\renewcommand{\\headrule}{\\ifdim\\headrulewidth>0pt\\vbox{\\hrule width\\headwidth height.35bp\\kern.35bp\\hrule width\\headwidth height.9bp\\vskip-1.6bp}\\fi}',
]

type FrontFields = {
  title: string; name: string; chineseTitle: string; advisor: string; englishAdvisor: string
  affiliation: string; englishAffiliation: string; program: string; studentNumber: string; date: string; declarations: boolean
}

/** Fill both compatibility branches in the registered engineering master's Word example. */
export async function sjtuExportFront(original: File, fields: FrontFields) {
  const zip = await JSZip.loadAsync(await original.arrayBuffer())
  const path = 'word/document.xml'
  const xml = await zip.file(path)?.async('string')
  if (!xml) throw new Error('上交大 Word 原件缺少正文。')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const body = doc.getElementsByTagNameNS(ns, 'body').item(0)
  const nodes = body && Array.from(body.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && node.namespaceURI === ns)
  const text = (node: Element) => Array.from(node.getElementsByTagNameNS(ns, 't')).map(run => run.textContent).join('')
  const end = fields.declarations ? 25 : 8
  const section = nodes?.[end]?.getElementsByTagNameNS(ns, 'sectPr').item(0)
  if (!body || !nodes || !section || !text(nodes[0]).includes('上海交通大学硕士学位论文') || !text(nodes[9]).includes('原创性声明')) {
    throw new Error('模板的硕士题名页或声明位置与已登记的版本不同。')
  }
  const date = /^(\d{4})(?:-|年)(\d{1,2})(?:-|月)(\d{1,2})日?$/.exec(fields.date.trim())
  if (!date) throw new Error('上交大提交日期请用 YYYY-MM-DD 或年月日格式。')
  const [year, month, day] = date.slice(1).map(Number)
  const instant = new Date(Date.UTC(year, month - 1, day))
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) {
    throw new Error('上交大提交日期无效。')
  }
  const englishDate = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(instant)
  const replacements: [number, string, string][] = [
    [1, '上海交通大学学位论文格式模板', fields.chineseTitle],
    [2, '张三', fields.name], [2, '520XXXXXXXX', fields.studentNumber], [2, '李四', fields.advisor],
    [2, '某某学院', fields.affiliation], [2, '某某专业', fields.program], [2, '2023年11月2日', `${year}年${month}月${day}日`],
    [5, 'Dissertation Template for Master Degree of Engineering in Shanghai Jiao Tong University', fields.title],
    [6, 'Zhang San', fields.name], [6, 'Li Si', fields.englishAdvisor],
    [7, 'School of XXXXXXX', fields.englishAffiliation], [7, 'November 2nd, 2023', englishDate],
  ]
  for (const [index, placeholder, replacement] of replacements) {
    const runs = Array.from(nodes[index].getElementsByTagNameNS(ns, 't'))
    const combined = runs.map(run => run.textContent ?? '').join('')
    const positions: number[] = []
    for (let at = combined.indexOf(placeholder); at >= 0; at = combined.indexOf(placeholder, at + placeholder.length)) positions.push(at)
    if (!positions.length) throw new Error('无法定位上交大 Word 题名页中的原始占位符。')
    // Edit from the end so offsets in earlier compatibility branches remain valid.
    for (const start of positions.reverse()) {
      const finish = start + placeholder.length
      let cursor = 0
      for (const run of runs) {
        if (cursor >= finish) break
        const value = run.textContent ?? ''
        const next = cursor + value.length
        if (next > start) {
          run.textContent = value.slice(0, Math.max(0, start - cursor))
            + (cursor <= start ? replacement : '') + value.slice(Math.min(value.length, finish - cursor))
        }
        cursor = next
      }
    }
  }
  for (const node of nodes.slice(end + 1)) body.removeChild(node)
  section.parentNode?.removeChild(section)
  body.appendChild(section)
  zip.file(path, new XMLSerializer().serializeToString(doc))
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'cover.docx')
}
