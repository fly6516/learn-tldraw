import { suepDocxMembers } from './suep-undergraduate-source'
type Node = { t: string; c?: unknown }
type PandocDocument = { blocks: Node[] }

export const suepExampleHash = suepDocxMembers.body.sha256
export const suepMargins = { top: 25.4, bottom: 25.4, left: 31.7, right: 25, binding: 0 }
export const suepGeometry = [...Object.entries(suepMargins).filter(([key]) => key !== 'binding').map(([key, value]) => `${key}=${value}mm`),
  'headheight=13pt', 'headsep=6mm', 'footskip=7.9mm']

const raw = (text: string): Node => ({ t: 'RawBlock', c: ['latex', text] })
const blocks = (value: unknown) => value as Node[]
const args = (node: Node) => node.c as unknown[]
const paragraph = (node?: Node) => node && ['Plain', 'Para'].includes(node.t)
const attribute = (value: unknown) => (value as [string, string[], [string, string][]])[0]

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('')
  if (!value || typeof value !== 'object') return ''
  const node = value as Node
  if (node.t === 'Str') return String(node.c ?? '')
  if (['Space', 'SoftBreak', 'LineBreak'].includes(node.t)) return ' '
  if (node.t === 'Image') return ''
  return text(node.c)
}

function plain(value: string): Node[] {
  // Render each word using the Pandoc writer's normal TeX escaping.
  return value.split(/\s+/).flatMap((word, index) =>
    index ? [{ t: 'Space' }, { t: 'Str', c: word }] : [{ t: 'Str', c: word }])
}

function heading(level: number, title: string, id = ''): Node {
  return { t: 'Header', c: [level, [id, [], []], plain(title)] }
}

function numberedHeading(level: number, number: string, title: string, id: string): Node {
  const node = heading(level, title, id)
  if (number) args(node)[2] = [
    ...plain(number),
    { t: 'RawInline', c: ['latex', '\\texorpdfstring{\\quad}{ }'] },
    ...plain(title),
  ]
  return node
}

function getImages(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(getImages)
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return node.t === 'Image' ? [node] : getImages(node.c)
}

function caption(value: string) {
  return [null, [{ t: 'Plain', c: plain(value) }]]
}

function numberedCaption(value: string) {
  return /^(续\s*表|表|图)\s*([A-Z\d]+\s*[-–－]\s*\d+)\s*(.*)$/.exec(value.trim())
}

function figure(images: Node[], label: string): Node {
  return {
    t: 'Figure',
    c: [['', [], []], caption(label), [{ t: 'Plain', c: images.map(image => {
      const [attributes, alt, target] = args(image)
      const [id, classes] = attributes as [string, string[], [string, string][]]
      return { t: 'Image', c: [[id, classes, []], alt, target] }
    }) }]],
  }
}

type TableRow = [unknown, unknown[]]
type TableBody = [unknown, number, TableRow[], TableRow[]]

function takeHeader(table: Node, force = false) {
  const [attributes, label, columns, head, bodies, foot] = args(table)
  const [headAttributes, rows] = head as [unknown, TableRow[]]
  const [first, ...remaining] = bodies as TableBody[]
  const row = first?.[3][0]
  const cells = row?.[1] as [unknown, unknown, unknown, unknown, Node[]][] | undefined
  // Writer can export a bold first row using ordinary td elements.
  if (rows.length || !row || (!force && !cells?.every(cell => cell[4].some(block => getStrong(block.c))))) return table
  return { ...table, c: [attributes, label, columns, [headAttributes, [row]],
    [[first[0], first[1], first[2], first[3].slice(1)], ...remaining], foot] }
}

function getStrong(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(getStrong)
  if (!value || typeof value !== 'object') return false
  const item = value as Node
  return item.t === 'Strong' || getStrong(item.c)
}

function escapeTex(value: string) {
  const escapes: Record<string, string> = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&',
    '_': '\\_', '$': '\\$', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
  }
  return value.replace(/[\\{}%#&_$^~]/g, character => escapes[character])
}

export function suepRunningTitle(html: string, fallback = '') {
  const source = /<div title="header"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? ''
  const title = source.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
  return (title || fallback || '本科毕业设计（论文）').slice(0, 120)
}

export function normalizeSuepExampleHtml(html: string) {
  // These are the original example's red formatting callouts. Images embedded in the
  // manuscript, the unaligned transformer drawing and equation objects are retained.
  const graphs = html.replace(/<img\b(?=[^>]*\bname="DrawObject\d+")(?=[^>]*\balign="left")[^>]*>/gi, '')
  // Writer exports these anchored formatting notes as nested spans, including literal labels.
  const spans: (number | undefined)[] = []
  const ranges: [number, number][] = []
  for (const tag of graphs.matchAll(/<\/?span\b[^>]*>/gi)) {
    if (!tag[0].startsWith('</')) {
      spans.push(/\bid="Frame\d+"/i.test(tag[0]) ? tag.index : undefined)
      continue
    }
    const start = spans.pop()
    if (start !== undefined) ranges.push([start, tag.index + tag[0].length])
  }
  let result = graphs
  let next = graphs.length
  for (const [start, end] of ranges.sort((a, b) => b[1] - a[1])) {
    if (end > next) continue
    result = result.slice(0, start) + result.slice(end)
    next = start
  }
  return result
}

const referenceHeading = /^参\s*考\s*文\s*献$/
const referenceEntry = /^[\[［]\s*(\d+)\s*[\]］]\s*(\S.*)$/
const citationNumber = /^[\[［]\s*(\d+)\s*[\]］]$/
const normalizedText = (value: unknown) => text(value).replace(/\s+/g, ' ').trim()

function formatSuepReferences(document: PandocDocument, example: boolean) {
  const entries: { number: number; body: string }[] = []
  const citations: Node[] = []
  let section: { list: Node[]; start: number; end: number } | undefined
  function scan(value: unknown) {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { scan(item); continue }
        const node = item as Node
        if (!section && (node.t === 'Header' || paragraph(node)) && referenceHeading.test(normalizedText(node))) {
          let end = index + 1
          while (end < value.length && paragraph(value[end])) {
            const candidate = normalizedText(value[end])
            const entry = referenceEntry.exec(candidate)
            if (entry) entries.push({ number: Number(entry[1]), body: entry[2] })
            else if (candidate) break
            end++
          }
          section = { list: value, start: index, end }
          return
        }
        scan(node)
      }
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Node
    if (node.t === 'Div' && /^Table of Contents\d*$/i.test(attribute(args(node)[0]))) return
    if (!section && node.t === 'Superscript' && citationNumber.test(normalizedText(node))) citations.push(node)
    else scan(node.c)
  }
  scan(document.blocks)
  const distinct = new Set(entries.map(entry => entry.body))
  const journalCount = [...distinct].filter(entry => /[\[［]J[\]］]/i.test(entry)).length
  if (!section || !entries.length) return { count: 0, journalCount, duplicates: 0, citations: 0 }

  const sourceByNumber = new Map(entries.map(entry => [entry.number, entry]))
  const citedEntries = citations.flatMap(node => {
    const entry = sourceByNumber.get(Number(citationNumber.exec(normalizedText(node))?.[1]))
    return entry ? [entry] : []
  })
  const duplicates = entries.length - distinct.size
  // Only the pinned university example has been checked for uncaptured citation formats.
  // Preserve other manuscripts' citation IDs even when conversion sees only one citation.
  const ordered = example
    ? [...new Map([...citedEntries, ...entries].map(entry => [entry.body, entry])).values()]
    : entries
  const numbers = new Map(ordered.map((entry, index) => [entry.body, example ? index + 1 : entry.number]))
  for (const node of citations) {
    const original = sourceByNumber.get(Number(citationNumber.exec(normalizedText(node))?.[1]))
    if (original) node.c = plain(`[${numbers.get(original.body)}]`)
  }
  section.list.splice(section.start, section.end - section.start, raw('\\clearpage'), heading(1, '参考文献'),
    raw('\\begin{SuepReferences}'), ...ordered.flatMap(entry => [
      raw(`\\SuepReference{${example ? numbers.get(entry.body) : entry.number}}`),
      { t: 'Para', c: plain(entry.body) },
    ]), raw('\\end{SuepReferences}'))
  return { count: distinct.size, journalCount, duplicates, citations: citedEntries.length }
}

export function applySuepWordLayout(document: PandocDocument, example: boolean) {
  const references = formatSuepReferences(document, example)
  let started = false
  let abstract: 'chinese' | 'english' | undefined
  let chineseCharacters = 0
  let chineseKeywords = 0
  let englishKeywords = 0
  let chineseAbstract = false
  let englishAbstract = false
  let englishTitle = false
  let hasToc = false
  let appendices = 0
  let unnamedTables = 0
  let unmatchedFigures = 0
  let appendixTables = 0
  let appendix = false
  const tableColumns = new Map<string, unknown[]>()

  function closeAbstract(result: Node[]) {
    if (!abstract) return
    result.push(raw(abstract === 'chinese' ? '\\end{SuepChineseAbstract}' : '\\end{SuepEnglishAbstract}\\clearpage'))
    abstract = undefined
  }

  function convert(input: Node[]): Node[] {
    const result: Node[] = []
    for (const [index, node] of input.entries()) {
      if (node.t === 'Div') {
        const [attrs, children] = args(node)
        const id = attribute(attrs)
        if (example && /^Frame\d+$/.test(id)) continue
        if (/^Table of Contents\d*$/i.test(id)) {
          closeAbstract(result)
          hasToc = true
          result.push(raw('\\tableofcontents\\clearpage'))
          continue
        }
        result.push({ ...node, c: [attrs, convert(blocks(children))] })
        continue
      }
      const selected = normalizedText(node)
      const asHeading = paragraph(node) || node.t === 'Header'
      const id = node.t === 'Header' ? attribute(args(node)[1]) : ''
      if (example && paragraph(node) && !selected && !getImages(node).length) continue
      const isToc = asHeading && /^目\s*录$/.test(selected)
      if (isToc) {
        if (!example && !input.some(entry => entry.t === 'Div' && /^Table of Contents\d*$/i.test(attribute(args(entry)[0])))) {
          closeAbstract(result)
          hasToc = true
          result.push(raw('\\tableofcontents\\clearpage'))
        }
        continue
      }
      if (example && !started && /^(?:第\s*一章|<附录\s*\d+[^>]+>\s*\d+)$/.test(selected)) continue

      const following = asHeading ? input.slice(index + 1).find(entry => normalizedText(entry)) : undefined
      if (!started && asHeading && !englishTitle && !englishAbstract
          && /^[A-Z][\x20-\x7e]{4,150}$/.test(selected) && /^A\s*bstract$/i.test(normalizedText(following))) {
        closeAbstract(result)
        englishTitle = true
        result.push(raw(`\\SuepEnglishTitle{${escapeTex(selected)}}`))
        continue
      }
      if (!started && asHeading && /^(?:摘\s*要|A\s*bstract)$/i.test(selected)) {
        closeAbstract(result)
        const isChinese = /^摘/.test(selected)
        abstract = isChinese ? 'chinese' : 'english'
        if (isChinese) chineseAbstract = true
        else englishAbstract = true
        result.push(raw(isChinese ? '\\begin{SuepChineseAbstract}'
          : `${englishTitle ? '' : '\\clearpage\n'}\\begin{SuepEnglishAbstract}`))
        continue
      }
      const keywords = /^(关键词|key\s*words)\s*[:：]\s*(.*)$/i.exec(selected)
      if (abstract && keywords) {
        const count = keywords[2].split(abstract === 'chinese' ? /[；;]/ : /[;；]/).filter(word => word.trim()).length
        if (abstract === 'chinese') chineseKeywords = count
        else englishKeywords = count
        const label = abstract === 'chinese' ? '关键词：' : 'Key Words: '
        result.push(raw(`\\SuepKeywords{${label}}{${escapeTex(keywords[2])}}`))
        closeAbstract(result)
        continue
      }
      if (abstract === 'chinese' && paragraph(node)) chineseCharacters += selected.match(/\p{Script=Han}/gu)?.length ?? 0

      const chapter = /^(第\s*[一二三四五六七八九十百\d]+\s*章)\s*(\S.*)$/.exec(selected)
      const introduction = /^(?:(?:第)?一章\s*)?(?:引言|绪论)$/.test(selected)
      if (!started && (introduction || chapter || (node.t === 'Header' && args(node)[0] === 1 && !abstract))) {
        closeAbstract(result)
        started = true
        result.push(raw('\\SuepStartBody'))
      }
      if (asHeading && started && selected.length <= 75 && (chapter || introduction)) {
        result.push(raw('\\clearpage'),
          numberedHeading(1, chapter ? chapter[1].replace(/\s/g, '') : '', chapter ? chapter[2] : selected, id))
        continue
      }
      const section = /^(\d+\s*\.\s*\d+(?:\s*\.\s*\d+)?)\.?\s+(\S.*)$/.exec(selected)
      if (asHeading && started && section && selected.length < 60 && !/[，。；]$/.test(selected)) {
        const number = section[1].replace(/\s/g, '')
        result.push(numberedHeading(number.split('.').length, number, section[2], id))
        continue
      }
      const appendixTitle = /^附\s*录\s*([A-Z\d一二三四五六七八九十]+)\s*[:：]?\s*(\S.*)$/i.exec(selected)
      if (asHeading && appendixTitle && selected.length < 80) {
        appendix = true
        appendices++
        result.push(raw('\\clearpage'), numberedHeading(1, `附录 ${appendixTitle[1]}`, appendixTitle[2], id))
        continue
      }
      if (asHeading && /^附\s*录$/.test(selected)) {
        appendix = true
        if (/^附\s*录\s*[A-Z\d一二三四五六七八九十]/i.test(normalizedText(following))) continue
        appendices++
        result.push(raw('\\clearpage'), heading(1, '附录', id))
        continue
      }
      if (asHeading && /^(致谢|谢辞)$/.test(selected)) {
        result.push(raw('\\clearpage'), heading(1, selected, id))
        continue
      }
      const next = input[index + 1]
      if (paragraph(node) && !selected && getImages(node).length && paragraph(next)
          && numberedCaption(text(next).trim())?.[1] === '图') continue
      const label = paragraph(node) && numberedCaption(selected)
      if (label && label[1] === '图') {
        const previous = input[index - 1]
        const originals = paragraph(previous) && !text(previous).trim() ? getImages(previous) : []
        const formatted = `图 ${label[2].replace(/\s+/g, '').replace(/[–－]/g, '-')} ${label[3]}`.trimEnd()
        if (originals.length) result.push(figure(originals, formatted))
        else {
          unmatchedFigures++
          result.push(raw(`\\SuepDetachedCaption{${escapeTex(formatted)}}`))
        }
        continue
      }
      if (label && label[1] !== '图' && next?.t === 'Table') continue
      if (node.t === 'Table') {
        const previous = input[index - 1]
        const match = paragraph(previous) && numberedCaption(text(previous).trim())
        let tableNumber = match && match[1] !== '图' ? match[2].replace(/\s+/g, '').replace(/[–－]/g, '-') : ''
        const continuation = Boolean(match && /^续/.test(match[1]))
        let title = match && match[1] !== '图' ? match[3] : ''
        const sampleAppendixTable = !tableNumber && example && appendix && /气体色谱分析/.test(text(previous))
        if (sampleAppendixTable) {
          tableNumber = `A-${++appendixTables}`
          title = '气体色谱分析'
        }
        const table = takeHeader(node, sampleAppendixTable)
        const fields = args(table).slice()
        if (tableNumber) {
          const columns = fields[2] as unknown[]
          const originalColumns = tableColumns.get(tableNumber)
          if (continuation && originalColumns?.length === columns.length) fields[2] = originalColumns
          if (!continuation) tableColumns.set(tableNumber, columns)
        }
        if (tableNumber) fields[1] = caption(`${continuation ? '续表' : '表'} ${tableNumber}${title ? ' ' + title : ''}`)
        else if (!text(fields[1]).trim()) unnamedTables++
        result.push(raw(`\\begingroup\\zihao{5}\\SuepTableSetup{${tableNumber}}{${continuation ? 'raggedleft' : 'centering'}}`),
          { ...table, c: fields }, raw('\\endgroup'))
        continue
      }
      result.push(node)
    }
    return result
  }

  document.blocks = convert(document.blocks)
  closeAbstract(document.blocks)
  if (!started) document.blocks.unshift(raw('\\SuepStartBody'))
  return { unnamedTables, unmatchedFigures, foundIntroduction: started, references, chineseCharacters,
    chineseKeywords, englishKeywords, chineseAbstract, englishAbstract, hasToc, appendices }
}

export function suepTableContinuations(tex: string) {
  return tex.replace(/(\\SuepTableSetup\{([A-Z\d]+-\d+)\}\{(?:centering|raggedleft)\}\s*\\begin\{longtable\}[\s\S]*?)(?=\\end\{longtable\})/g,
    (table, _opening: string, number: string) => {
      if (!table.includes('\\endfirsthead')) return table
      return table.replace('\\endfirsthead', () => `\\endfirsthead\n\\caption*{\\hfill 续表 ${number}}\\tabularnewline`)
    })
}

export function suepTexLayout(title: string) {
  return String.raw`% 上海电力大学本科生毕业设计（论文）格式示范
\usepackage{fancyhdr,setspace,caption}
\IfFontExistsTF{SimSun}{\setCJKmainfont{SimSun}\setCJKfamilyfont{zhsong}{SimSun}}{%
  \IfFontExistsTF{Songti SC}{\setCJKmainfont{Songti SC}\setCJKfamilyfont{zhsong}{Songti SC}}{}}
\IfFontExistsTF{SimHei}{\setCJKfamilyfont{zhhei}[Scale=1]{SimHei}}{%
  \IfFontExistsTF{Heiti SC Medium}{\setCJKfamilyfont{zhhei}[Scale=1]{Heiti SC Medium}}{%
    \IfFontExistsTF{Heiti SC}{\setCJKfamilyfont{zhhei}[Scale=1]{Heiti SC}}{}}}
\IfFontExistsTF{Times New Roman}{\setmainfont{Times New Roman}}{%
  \IfFontExistsTF{TeX Gyre Termes}{\setmainfont{TeX Gyre Termes}}{}}
\newcommand{\SuepRunningTitle}{` + escapeTex(title) + String.raw`}
\newcommand{\SuepPageHeader}{\zihao{-5}\songti\SuepRunningTitle}
\newcommand{\SuepPageFooter}{\zihao{-5}\rmfamily- \thepage\ -}
\fancypagestyle{suep-front}{%
  \fancyhf{}\fancyhead[C]{\SuepPageHeader}%
  \renewcommand{\headrulewidth}{0.4pt}\renewcommand{\footrulewidth}{0pt}}
\fancypagestyle{suep-body}{%
  \fancyhf{}\fancyhead[C]{\SuepPageHeader}\fancyfoot[C]{\SuepPageFooter}%
  \renewcommand{\headrulewidth}{0.4pt}\renewcommand{\footrulewidth}{0pt}}
\newcommand{\SuepStartBody}{\clearpage\pagenumbering{arabic}\hypersetup{pageanchor=true}\pagestyle{suep-body}}
\newcommand{\SuepSetup}{\pagestyle{suep-front}\pagenumbering{gobble}%
  \hypersetup{pageanchor=false}\setstretch{1.25}\setlength{\parindent}{2em}\setlength{\parskip}{0pt}\songti}
\ctexset{section={format=\centering\heiti\setstretch{1.5}\zihao{-3},beforeskip=0pt,afterskip=0.5\baselineskip},%
  subsection={format=\heiti\setstretch{1.5}\zihao{4},beforeskip=0.5\baselineskip,afterskip=0pt},%
  subsubsection={format=\heiti\setstretch{1.5}\zihao{-4},indent=2em,beforeskip=0.5\baselineskip,afterskip=0pt}}
\setcounter{tocdepth}{3}
\renewcommand{\contentsname}{${'目'}\quad ${'录'}}
\newcommand{\SuepEnglishTitle}[1]{\clearpage\begin{center}\rmfamily\bfseries\zihao{-2}#1\end{center}}
\newenvironment{SuepChineseAbstract}{%
  \section*{${'摘'}\quad ${'要'}}\songti\setstretch{1.5}\zihao{-4}}{\par}
\newenvironment{SuepEnglishAbstract}{%
  \begin{center}\rmfamily\bfseries\zihao{-3}Abstract\end{center}%
  \rmfamily\setstretch{1}\fontsize{12bp}{25bp}\selectfont}{\par}
\newcommand{\SuepKeywords}[2]{\par\medskip\noindent{\bfseries #1}#2\par}
\newenvironment{SuepReferences}{%
  \begin{list}{}{\setlength{\leftmargin}{2em}\setlength{\labelwidth}{1.6em}%
    \setlength{\labelsep}{0.4em}\setlength{\itemsep}{0pt}\setlength{\parsep}{0pt}}}{\end{list}}
\newcommand{\SuepReference}[1]{%
  \item[{\zihao{5}\rmfamily [#1]}]\songti\setstretch{1.25}\zihao{5}}
\DeclareCaptionFont{suep}{\zihao{5}\songti}
\captionsetup[figure]{labelformat=empty,font=suep,justification=centering,singlelinecheck=false,position=bottom}
\newcommand{\SuepDetachedCaption}[1]{\par\begin{center}\zihao{5}#1\end{center}}
\newcommand{\SuepTableSetup}[2]{%
  \captionsetup{labelformat=empty,font=suep,justification=#2,singlelinecheck=false,position=top}}
`
}
