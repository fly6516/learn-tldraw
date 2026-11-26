import { groupEnd, lineNumber, maskLatexCode } from './latex-source'
import { findCitations, parseBibliography } from './references'
import type { LineSources, ManuscriptLine, MappedTex } from './template-source-map'
import type { ProjectFile, ProjectDirectory } from './types'

type Location = ManuscriptLine
type Range = { start: number; end: number }
type Located<T> = Readonly<T & Location>
type Asset = Readonly<{ path: string; blob: Blob }>
type Section = Located<{ level: number; title: string }>
type Reference = Located<{ kind: string; key: string }>

export type ManuscriptSnapshot = Readonly<{
  title: string
  authors: readonly string[]
  abstract: string
  keywords: string
  body: string
  lineSources: Readonly<Record<'abstract' | 'keywords' | 'body', LineSources>>
  sections: readonly Section[]
  floats: readonly Located<{ kind: 'figure' | 'table' }>[]
  references: readonly Reference[]
  assets: readonly Asset[]
  bibliography: readonly Readonly<{ path: string; content: string }>[]
  unicodeLocation?: Readonly<Location>
}>

type Chunk = { path: string; source: string; offset: number; start: number; end: number }

const supportedPackages = new Set('amsmath amssymb graphicx booktabs array url hyperref natbib geometry inputenc fontenc ctex'.split(' '))
const supportedEnvironments = new Set('abstract keywords figure figure* table table* tabular tabular* center flushleft flushright itemize enumerate description quote quotation equation equation* align align* gather gather* aligned split cases matrix pmatrix bmatrix vmatrix smallmatrix verbatim verbatim*'.split(' '))
const headings = ['section', 'subsection', 'subsubsection']
const unsupportedJmlrText = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u
const commands = new Set((
  'section subsection subsubsection appendix paragraph label ref eqref pageref autoref includegraphics caption ' +
  'textbf textit texttt textsf textsc textrm textnormal emph underline textsuperscript textsubscript textbackslash ' +
  'textasciitilde textasciicircum textsuperscript LaTeX TeX ldots dots cdots url href nolinkurl ' +
  'cite citep citet citealp citealt citeauthor citeyear nocite ' +
  'centering raggedright raggedleft noindent par newline linebreak smallskip medskip bigskip hfill ' +
  'small footnotesize normalsize large Large bfseries itshape rmfamily footnote footnotemark footnotetext ' +
  'item rule toprule midrule bottomrule cmidrule hline cline multicolumn ' +
  'linewidth textwidth columnwidth frac dfrac tfrac sqrt sum prod int lim max min log ln exp sin cos tan ' +
  'alpha beta gamma delta epsilon varepsilon theta lambda mu nu pi rho sigma tau phi varphi chi psi omega ' +
  'Gamma Delta Theta Lambda Pi Sigma Phi Psi Omega mathrm mathbf mathit mathsf mathcal mathbb mathfrak ' +
  'text left right middle big Big bigg Bigg bigl bigr Bigl Bigr overline underline bar hat widehat vec dot ' +
  'cdot times pm mp le leq ge geq ne neq approx sim simeq equiv in notin subset subseteq cup cap mid ' +
  'infty partial nabla ell forall exists emptyset vert Vert langle rangle to mapsto rightarrow leftarrow ' +
  'Rightarrow Leftarrow leftrightarrow iff land lor neg quad qquad operatorname nonumber notag tag ' +
  'limits nolimits phantom vphantom hphantom'
).split(/\s+/))

function problem(location: Location, message: string): never {
  throw new Error(`${location.path}:${location.line} · ${message}`)
}

function safeResource(name: string) {
  return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name) && !name.split('/').some(part => part === '.' || part === '..')
}

function readArgument(masked: string, index: number, open: string, close: string) {
  while (/\s/.test(masked[index] ?? '')) index++
  if (masked[index] !== open) return
  const end = groupEnd(masked, index, open, close)
  if (end !== undefined && end >= index) return { start: index + 1, end, next: end + 1 }
}

// Track the first original token on each emitted TeX line. Includes can put
// fragments from different files on one line, while SyncTeX only reports a line.
function mappedExcerpt(source: string, chunks: Chunk[], ranges: Range[]): MappedTex {
  const pieces: string[] = []
  const positions: { offset: number; source: ManuscriptLine }[] = []
  let length = 0
  let firstChunk = 0
  for (const { start, end } of ranges) {
    if (start >= end) continue
    pieces.push(source.slice(start, end))
    while (firstChunk < chunks.length && chunks[firstChunk].end <= start) firstChunk++
    for (let i = firstChunk; i < chunks.length && chunks[i].start < end; i++) {
      const chunk = chunks[i]
      const from = Math.max(start, chunk.start)
      const to = Math.min(end, chunk.end)
      let line = lineNumber(chunk.source, chunk.offset + from - chunk.start)
      const fragment = source.slice(from, to)
      for (const match of fragment.matchAll(/\r\n|\r|\n|[^\r\n]+/g)) {
        if (/^[\r\n]/.test(match[0])) line++
        else {
          const token = match[0].search(/\S/)
          if (token >= 0) positions.push({ offset: length + from - start + match.index + token, source: { path: chunk.path, line } })
        }
      }
    }
    length += end - start
  }
  const raw = pieces.join('')
  const text = raw.trim()
  const discarded = raw.length - raw.trimStart().length
  const lines = new Map<number, ManuscriptLine>()
  const breaks = text.matchAll(/\r\n|\r|\n/g)
  let next = breaks.next()
  let line = 1
  for (const position of positions) {
    const offset = position.offset - discarded
    while (!next.done && next.value.index < offset) { line++; next = breaks.next() }
    if (!lines.has(line)) lines.set(line, position.source)
  }
  return { text, lines }
}

/** Captures the supported LaTeX interchange subset from the current working files. */
export function captureManuscript(files: ReadonlyMap<string, ProjectFile | ProjectDirectory>, main: string): ManuscriptSnapshot {
  const root = main.slice(0, main.lastIndexOf('/') + 1)
  const chunks: Chunk[] = []
  let source = ''
  const append = (path: string, text: string, offset: number, end: number) => {
    if (offset === end) return
    chunks.push({ path, source: text, offset, start: source.length, end: source.length + end - offset })
    source += text.slice(offset, end)
  }
  const expand = (path: string, parent: Location, stack: readonly string[]) => {
    if (stack.includes(path)) problem(parent, `循环引用源文件 ${path}。`)
    if (stack.length > 32 || source.length > 2_000_000) problem(parent, '稿件嵌套或展开后的长度超出导出范围。')
    const entry = files.get(path)
    if (!entry || entry.type === 'directory' || typeof entry.content !== 'string') problem(parent, `找不到源文件 ${path}。`)
    const text = entry.content
    const code = maskLatexCode(text)
    let offset = 0
    for (const match of code.matchAll(/\\(?:\\|(?:input|include)(?![A-Za-z@]))/g)) {
      if (match[0] === '\\\\') continue
      const at = { path, line: lineNumber(text, match.index) }
      const argument = readArgument(code, match.index + match[0].length, '{', '}')
      const name = argument && text.slice(argument.start, argument.end).trim()
      if (!argument || !name || !safeResource(name)) problem(at, '源文件引用必须使用项目内的静态路径。')
      append(path, text, offset, match.index)
      expand(root + (name.endsWith('.tex') ? name : name + '.tex'), at, [...stack, path])
      append(path, '\n', 0, 1)
      offset = argument.next
    }
    append(path, text, offset, text.length)
  }
  expand(main, { path: main, line: 1 }, [])
  const location = (index: number): Location => {
    const chunk = chunks.find(item => item.start <= index && item.end > index)
    return chunk ? { path: chunk.path, line: lineNumber(chunk.source, chunk.offset + index - chunk.start) } : { path: main, line: 1 }
  }
  const masked = maskLatexCode(source, true)
  let title = ''
  let authors: string[] = []
  let abstract = ''
  let keywords = ''
  let document = false
  let ended = false
  let abstractStart: number | undefined
  let keywordStart: number | undefined
  let abstractRange: Range | undefined
  let keywordRange: Range | undefined
  const removed: Range[] = []
  const sections: Section[] = []
  const floats: ManuscriptSnapshot['floats'][number][] = []
  const assets = new Map<string, Blob>()
  const bibliography = new Map<string, string>()
  const labels = new Set<string>()
  const references: Reference[] = []
  const body: Range[] = []
  const environments: Located<{ name: string }>[] = []
  let bodyStart = -1
  let bodyEnd = -1
  let until = 0
  const stop = (index: number, message: string) => problem(location(index), message)
  const requireWhitespace = (start: number, end: number) => {
    const char = /\S/.exec(masked.slice(start, end))
    if (char) stop(start + char.index, '文档主体外存在无法识别的内容。')
  }
  for (const match of masked.matchAll(/\\([A-Za-z@]+|[^\r\n])/g)) {
    const index = match.index
    if (index < until) continue
    const name = match[1]
    const at = location(index)
    if (!document) requireWhitespace(until, index)
    if (ended) problem(at, '文档结束后还有 LaTeX 内容。')
    let cursor = index + match[0].length
    const optional = () => {
      const arg = readArgument(masked, cursor, '[', ']')
      if (arg) cursor = arg.next
      return arg && source.slice(arg.start, arg.end).trim()
    }
    const required = () => {
      const arg = readArgument(masked, cursor, '{', '}')
      if (!arg) return problem(at, `\\${name} 缺少可读取的参数。`)
      cursor = arg.next
      return source.slice(arg.start, arg.end).trim()
    }
    const omit = () => { removed.push({ start: index, end: cursor }) }
    if (name === 'begin' || name === 'end') {
      const environment = required()
      if (environment === 'document') {
        if (name === 'begin' && !document) { document = true; bodyStart = cursor }
        else if (name === 'end' && document && !environments.length) { ended = true; bodyEnd = index }
        else problem(at, '文档结构不完整。')
      } else if (!document || !supportedEnvironments.has(environment)) {
        problem(at, `环境 ${environment} 暂无法转换。`)
      } else if (name === 'begin') {
        environments.push({ ...at, name: environment })
        if (environment === 'abstract') {
          if (abstractStart !== undefined || abstract) problem(at, '导出仅支持一个正文摘要。')
          abstractStart = cursor
          removed.push({ start: index, end: index })
        }
        if (environment === 'keywords') {
          if (keywordStart !== undefined || keywords) problem(at, '导出仅支持一组正文关键词。')
          keywordStart = cursor
          removed.push({ start: index, end: index })
        }
        const float = environment.replace(/\*$/, '')
        if (float === 'figure' || float === 'table') floats.push({ ...at, kind: float })
      } else {
        if (environments.pop()?.name !== environment) problem(at, `环境 ${environment} 没有配对。`)
        if (environment === 'abstract' || environment === 'keywords') {
          const start = (environment === 'abstract' ? abstractStart : keywordStart)!
          if (environment === 'abstract') {
            abstractRange = { start, end: index }
            abstract = source.slice(start, index).trim()
            abstractStart = undefined
          } else {
            keywordRange = { start, end: index }
            keywords = source.slice(start, index).trim()
            keywordStart = undefined
          }
          const opening = removed.findLast(range => range.start === range.end)!
          opening.end = cursor
        }
      }
    } else if (name === 'documentclass' && !document) {
      optional()
      required()
    } else if (name === 'usepackage' && !document) {
      const options = optional()
      const packages = required().split(',').map(value => value.trim())
      for (const item of packages) {
        if (!supportedPackages.has(item)) problem(at, `源项目依赖宏包 ${item}，当前目标无法保证等价转换。`)
        if (options && !['geometry', 'natbib', 'hyperref', 'inputenc', 'fontenc', 'ctex'].includes(item)) {
          problem(at, `宏包 ${item} 的选项暂无法转换。`)
        }
      }
    } else if (name === 'title' || name === 'author' || name === 'date') {
      const value = required()
      if (name !== 'date' && (/\\(?!and\b|[&%#$ _])|[{}$]/.test(value) || !value)) {
        problem(at, `\\${name} 请使用普通文字，多个作者可用 \\and 分隔。`)
      }
      if (name === 'title') {
        if (title) problem(at, '发现多个标题。')
        title = value
      }
      if (name === 'author') {
        if (authors.length) problem(at, '发现多组作者。')
        authors = value.split(/\s*\\and\b\s*/).map(author => author.trim()).filter(Boolean)
      }
      if (document) omit()
    } else if ((document && ['maketitle', 'tableofcontents'].includes(name)) || name === 'bibliographystyle') {
      if (name === 'bibliographystyle') required()
      omit()
    } else if (document && name === 'bibliography') {
      for (const resource of required().split(',').map(value => value.trim())) {
        if (!safeResource(resource)) problem(at, '参考文献必须使用项目内的 .bib 文件。')
        const path = resource.endsWith('.bib') ? resource : resource + '.bib'
        const file = files.get(root + path)
        if (!file || file.type === 'directory' || !file.content?.trim()) problem(at, `找不到参考文献文件 ${root + path}。`)
        bibliography.set(path, file.content)
      }
      omit()
    } else if (document && name === 'includegraphics') {
      const options = optional()
      if (options && [...options.matchAll(/\\([A-Za-z@]+)/g)].some(match => !commands.has(match[1]))) {
        problem(at, '图像尺寸选项中包含无法转换的命令。')
      }
      const resource = required()
      if (!safeResource(resource)) problem(at, '图片必须使用项目内的静态路径。')
      const candidates = /\.[A-Za-z]+$/.test(resource) ? [resource] : ['pdf', 'png', 'jpg', 'jpeg'].map(ext => resource + '.' + ext)
      const path = candidates.find(key => files.has(root + key))
      const file = path && files.get(root + path)
      if (!path || !file || file.type === 'directory' || !file.blob?.size) problem(at, `找不到图片 ${root + resource}。`)
      if (!/\.(?:pdf|png|jpe?g)$/i.test(path)) problem(at, `图片 ${path} 的格式暂不支持，请转换为 PNG、JPEG 或 PDF。`)
      assets.set(path, file.blob)
    } else if (document && ['label', 'ref', 'eqref', 'pageref', 'autoref'].includes(name)) {
      const key = required()
      if (name === 'label') {
        if (labels.has(key)) problem(at, `标签 ${key} 重复。`)
        labels.add(key)
      } else references.push({ ...at, kind: name, key })
    } else if (document && headings.includes(name)) {
      if (masked[cursor] === '*') cursor++
      optional()
      sections.push({ ...at, level: headings.indexOf(name) + 1, title: required() })
      // Scan the title too for unsupported commands or references.
      cursor = index + match[0].length
    } else if (!document || (/^[A-Za-z@]+$/.test(name) && !commands.has(name))) {
      problem(at, `命令 \\${name} 暂无法转换。`)
    }
    until = cursor
  }

  if (ended) requireWhitespace(until, masked.length)
  if (!ended || !title || !authors.length || !abstract) {
    stop(Math.max(bodyStart, 0), '导出需要完整的 document、title、author 和 abstract。')
  }
  for (const reference of references) {
    if (!labels.has(reference.key)) problem(reference, `找不到交叉引用 ${reference.key} 的标签。`)
  }
  const bibKeys = new Set<string>()
  for (const [path, content] of bibliography) {
    for (const record of parseBibliography(root + path, content)) {
      if (bibKeys.has(record.key)) problem({ path: root + path, line: record.line }, `参考文献键 ${record.key} 重复。`)
      bibKeys.add(record.key)
    }
  }
  for (const citation of findCitations(main, source)) {
    const at = location(citation.start)
    if (citation.key !== '*' && !bibKeys.has(citation.key)) problem(at, `找不到参考文献键 ${citation.key}。`)
    references.push({ ...at, kind: 'citation', key: citation.key })
  }
  const ranges = removed.filter(range => range.start >= bodyStart && range.end <= bodyEnd).sort((a, b) => a.start - b.start)
  let offset = bodyStart
  for (const range of ranges) {
    if (range.start < offset) continue
    body.push({ start: offset, end: range.start })
    offset = range.end
  }
  body.push({ start: offset, end: bodyEnd })
  const mappedBody = mappedExcerpt(source, chunks, body)
  const lineSources = {
    body: mappedBody.lines,
    abstract: abstractRange ? mappedExcerpt(source, chunks, [abstractRange]).lines : new Map(),
    keywords: keywordRange ? mappedExcerpt(source, chunks, [keywordRange]).lines : new Map(),
  }
  const unicode = unsupportedJmlrText.exec(masked)
  let unicodeLocation = unicode ? location(unicode.index) : undefined
  if (!unicodeLocation) {
    for (const [path, content] of bibliography) {
      const character = unsupportedJmlrText.exec(maskLatexCode(content))
      if (character) {
        unicodeLocation = { path: root + path, line: lineNumber(content, character.index) }
        break
      }
    }
  }
  return {
    title, authors, abstract, keywords, body: mappedBody.text, lineSources, sections, floats, references,
    assets: Array.from(assets, ([path, blob]) => ({ path, blob })),
    bibliography: Array.from(bibliography, ([path, content]) => ({ path, content })),
    unicodeLocation,
  }
}
