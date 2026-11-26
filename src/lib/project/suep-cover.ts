import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { z } from 'zod'

const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\r\n\t]+$/)

export const suepCoverFields = z.object({
  title: line(36), affiliation: line(40), program: line(40), author: line(20),
  studentNumber: line(20), advisor: line(40), date: line(30),
})

export async function fillSuepCover(bytes: Uint8Array, fields: z.infer<typeof suepCoverFields>) {
  const zip = await JSZip.loadAsync(bytes)
  const path = 'word/document.xml'
  const xml = await zip.file(path)?.async('string')
  if (!xml) throw new Error('上电封面缺少 Word 正文。')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const body = doc.getElementsByTagNameNS(ns, 'body').item(0)
  const paragraphs = body && Array.from(body.childNodes)
    .filter((node): node is Element => node.nodeType === 1 && node.namespaceURI === ns && node.localName === 'p')
  const rows: [number, string, number, string][] = [
    [7, '题　　目：', 1, fields.title], [9, '院　　系：', 1, fields.affiliation],
    [10, '专业年级：', 1, fields.program], [11, '学生姓名：', 1, fields.author],
    [11, '学号：', 3, fields.studentNumber], [12, '指导教师：', 1, fields.advisor],
    [14, '年　　月　　日', 0, fields.date],
  ]
  for (const [paragraph, label, index, text] of rows) {
    const runs = paragraphs?.[paragraph]?.getElementsByTagNameNS(ns, 't')
    const marker = runs?.item(Math.max(0, index - 1))
    const value = runs?.item(index)
    if (marker?.textContent !== label || !value) throw new Error('官方上电封面字段位置与登记的版本不同。')
    const old = value.textContent ?? ''
    value.textContent = index ? text + '　'.repeat(Math.max(0, old.length - text.length)) : text
  }
  zip.file(path, new XMLSerializer().serializeToString(doc))
  return zip.generateAsync({ type: 'uint8array' })
}
