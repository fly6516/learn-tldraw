import { lineNumber, maskLatexCode } from './latex-source'
import { bibliographyRecords, findCitations } from './references'
import { findPdfRegion, type SyncRegion } from './source-sync'
import type { LayoutFinding, PdfLayoutPage } from './layout-preflight'
import type { ProjectFileSystem } from './types'

export function assessBibliography(files: ProjectFileSystem['files'], main: string, sources: ReadonlyMap<string, string>,
  pages: PdfLayoutPage[], regions: SyncRegion[], imported: boolean): LayoutFinding[] {
  const located = (path: string, line: number) => {
    const region = findPdfRegion(regions, path, line)
    return { path, line, page: region && Math.abs(region.line - line) <= 3 ? region.page : undefined }
  }
  const findings: LayoutFinding[] = []
  const keys = new Set<string>()
  const requested = new Set<string>()
  const citations = [...sources].flatMap(([path, source]) => findCitations(path, source))
  const encoded = new Set<string>()
  for (const [path, source] of sources) {
    const text = maskLatexCode(source)
    for (const [, key] of text.matchAll(/\\bibitem\s*(?:\[[^\]]*\]\s*)?\{([^\s{}]+)\}/g)) keys.add(key)
    for (const [, values] of text.matchAll(/\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/g)) {
      for (const name of values.split(',').map(value => value.trim()).filter(Boolean)) {
        requested.add((name.endsWith('.bib') ? name : name + '.bib').replace(/^\.\//, ''))
      }
    }
    if (imported && path === 'manuscript.tex') {
      const bibliography = /\\(?:section|chapter)\*?\s*\{\s*(?:参考文献|References|Bibliography)\s*\}/i.exec(text)
      const firstEntry = /\\(?:CustomWordReference|SuepReference)\s*\{/.exec(text)
      const end = bibliography?.index ?? firstEntry?.index ?? text.length
      const body = text.slice(0, end)
      for (const [, number] of text.slice(end).matchAll(/\\(?:CustomWordReference|SuepReference)\s*\{\s*(\d+)\s*\}/g)) encoded.add(number)
      // Pandoc escapes square brackets. Limit this check to single reference numbers.
      for (const match of body.matchAll(/(?:\{\[\}|\[)\s*([1-9]\d{0,3})\s*(?:\{\]\}|\])/g)) {
        const line = lineNumber(source, match.index)
        if (!citations.some(item => item.path === path && item.line === line && item.key === match[1])) {
          citations.push({ path, line, start: match.index, end: match.index + match[0].length, key: match[1] })
        }
      }
      // In as-written layouts the original number is the first text after CustomWordReference{}.
      for (const [, number] of text.slice(end).matchAll(/\\CustomWordReference\s*\{\}\s*\{?\{\[\}\s*(\d+)\s*\{\]\}/g)) encoded.add(number)
    }
  }

  const cited = new Set(citations.map(item => item.key))
  const root = main.slice(0, main.lastIndexOf('/') + 1)
  let unresolvedResource = false
  for (const name of requested) {
    const nested = [...files.keys()].filter(path => path.startsWith(root) && path.endsWith('/' + name))
    const path = files.has(root + name) ? root + name : nested.length === 1 ? nested[0] : undefined
    const file = path ? files.get(path) : undefined
    if (!path || !file || !('content' in file) || !file.content) {
      unresolvedResource = true
      continue
    }
    for (const { entry, fields, type } of bibliographyRecords(path, file.content)) {
      keys.add(entry.key)
      if (!cited.has(entry.key) || !/^(?:article|book|inproceedings)$/i.test(type) || /\b(?:crossref|xref|xdata)\s*=/i.test(fields)) continue
      const missing = [!entry.author && !/\beditor\s*=\s*[^\s,{]+|\beditor\s*=\s*\{\s*[^}]/i.test(fields) ? '作者或编者' : '',
        !entry.title ? '题名' : '', !entry.year ? '年份' : ''].filter(Boolean)
      if (missing.length) findings.push({ label: '参考文献缺项', status: 'issue', detail: `条目 ${entry.key} 缺少${missing.join('、')}。`,
        evidence: '本次编译入口引用的 BibTeX 数据库', expected: '作者或编者、题名、年份', observed: '缺少' + missing.join('、'), ...located(path, entry.line) })
    }
  }

  const wordNumbers = imported && (encoded.size > 0 || requested.size === 0 && keys.size === 0)
  for (const { path, line, key } of citations) {
    if (keys.has(key) || (wordNumbers && encoded.has(key))) continue
    const numeric = wordNumbers && /^\d+$/.test(key)
    const review = numeric && !encoded.size || unresolvedResource && !numeric
    findings.push({ label: '参考文献缺项', status: review ? 'manual' : 'issue',
      detail: review ? `请确认引文 ${key} 对应的文献条目。` : `引文 ${key} 没有对应的参考文献条目。`,
      evidence: numeric ? '本次 TeX 中的数字引文和导入后的编号条目' : '本次编译入口的引文、BibTeX 数据库或手写条目',
      expected: '每处引文对应一条文献', observed: '未匹配 ' + key, ...located(path, line) })
  }

  if (!findings.length) {
    const pageIndex = pages.findIndex(page => !page.toc && /(?:参\s*考\s*文\s*献|\b(?:References|Bibliography)\b)/i.test(page.text))
    const matched = citations.length > 0
    findings.push({ label: '参考文献缺项', status: matched ? 'pass' : 'manual',
      detail: matched ? `已匹配 ${citations.length} 处可识别的引文。` : '请核对作者—年份引文、文献类型或其他未识别的引文格式。',
      evidence: '本次编译的 TeX 与参考文献数据', observed: matched ? `${citations.length} 处引文已匹配` : undefined,
      page: pageIndex >= 0 ? pageIndex + 1 : undefined })
  }
  return findings.slice(0, 25)
}
