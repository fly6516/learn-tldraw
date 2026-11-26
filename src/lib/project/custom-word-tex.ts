import type { LayoutValues } from './word-layout'

type Node = { t: string; c?: unknown }
type Document = { blocks: Node[] }
const items = (node: Node) => node.c as unknown[]
const raw = (value: string): Node => ({ t: 'RawBlock', c: ['latex', value] })
const paragraph = (node?: Node) => !!node && /^(Plain|Para)$/.test(node.t)

function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('')
  if (!value || typeof value !== 'object') return ''
  const node = value as Node
  return node.t === 'Str' ? String(node.c ?? '') : /^(Space|SoftBreak|LineBreak)$/.test(node.t) ? ' '
    : node.t === 'Image' ? '' : text(node.c)
}
function images(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(images)
  if (!value || typeof value !== 'object') return []
  const node = value as Node
  return node.t === 'Image' ? [node] : images(node.c)
}
const label = (value: unknown) => text(value).replace(/\s+/g, ' ').trim()
const words = (value: string): Node[] => value.split(/\s+/).flatMap((str, index) =>
  index ? [{ t: 'Space' }, { t: 'Str', c: str }] : [{ t: 'Str', c: str }])
const heading = (level: number, value: string, attr?: unknown): Node => ({ t: 'Header', c: [level, attr ?? ['', [], []], words(value)] })
const makeCaption = (value: string) => [null, [{ t: 'Plain', c: words(value) }]]
const captionOf = (value: string) => /^(图|表|Fig(?:ure)?\.?|Table)\s*([A-Z]?\d+(?:[-.－–]\d+)?)\s*[:：.、]?\s*(\S.*)$/i.exec(value)
const bibliographyTitle = /^(?:参\s*考\s*文\s*献|References|Bibliography)$/i

export function formatCustomWord(document: Document, settings: LayoutValues) {
  let chapter = 0
  let figureIndex = 0
  let tableIndex = 0
  let body = false
  let toc = false
  let front = false
  let bibliography = false
  let referenceIndex = 0
  let references = 0
  let unmatchedCaptions = 0
  const printedCitations = new Set<string>()
  const referenceNumbers = new Set<string>()
  const scanCitations = (nodes: Node[]): boolean => nodes.every(node => {
    if (node.t === 'Div') return scanCitations(items(node)[1] as Node[])
    if (bibliographyTitle.test(label(node))) return false
    if (paragraph(node)) {
      for (const match of label(node).matchAll(/[\[［]\s*(\d+)\s*[\]］]/g)) printedCitations.add(match[1])
    }
    return true
  })
  scanCitations(document.blocks)
  const captionNumbers = new Map<string, string | null>()
  const number = (kind: 'figures' | 'tables', original: string) => {
    const scheme = settings[kind]
    if (scheme === 'keep') return original
    const index = kind === 'figures' ? ++figureIndex : ++tableIndex
    const separator = settings.captionSeparator === 'dot' ? '.' : '-'
    const updated = scheme === 'chapter' && chapter > 0 ? `${chapter}${separator}${index}` : String(index)
    const key = kind + ':' + original.replace(/[.－–]/g, '-')
    captionNumbers.set(key, captionNumbers.has(key) ? null : updated)
    return updated
  }
  const startFront = (out: Node[]) => {
    if (front || body || settings.frontPages === 'none') return
    out.push(raw('\\CustomWordFront'))
    front = true
  }
  const markTitle = (value: string) => {
    const title = escapeTex(value)
    return raw('\\markboth{' + title + '}{' + title + '}')
  }

  const format = (nodes: Node[]): Node[] => {
    const out: Node[] = []
    for (const [i, node] of nodes.entries()) {
      if (node.t === 'Div') {
        const [attr, children] = items(node)
        if (/^(?:Table of Contents|TOC)/i.test((attr as string[])[0])) continue
        out.push({ ...node, c: [attr, format(children as Node[])] })
        continue
      }
      if (node.t === 'OrderedList') {
        const [attributes, children] = items(node) as [[number, Node, Node], Node[][]]
        if (children.length && children.every(item => item[0]?.t === 'Header')) {
          const expanded = children.flatMap(([first, ...rest], offset) => {
            const [level, attr] = items(first)
            const title = label(first)
            const numbered = /^\d+(?:\.\d+)*\s|^第.+章|^[一二三四五六七八九十]+、/.test(title)
            const value = level === 1 && !numbered ? `${attributes[0] + offset} ${title}` : title
            return [heading(Number(level), value, attr), ...rest]
          })
          out.push(...format(expanded))
          continue
        }
      }
      const value = label(node)
      const nativeHeading = node.t === 'Header'
      const hasTitle = nativeHeading || paragraph(node)
      const numeric = /^(\d{1,2}(?:\s*\.\s*\d{1,2}){0,2})[、．.]?\s+([^\d].{0,74})$/.exec(value)
      const chapterTitle = /^第[一二三四五六七八九十\d]+章\s*\S/.test(value)
      if (hasTitle && /^(?:目\s*录|Table of Contents)$/i.test(value)) {
        if (settings.tocDepth && !toc) { startFront(out); out.push(raw('\\CustomWordToc')); toc = true }
        continue
      }
      if (hasTitle && /^(?:中\s*文\s*)?摘\s*要$|^(?:English\s+)?Abstract$/i.test(value)) {
        startFront(out)
        if (settings.abstract === 'separate') {
          out.push(raw(/^.*摘/.test(value) ? '\\CustomWordAbstract{摘要}' : '\\clearpage\\CustomWordAbstract{Abstract}'))
          continue
        }
      }
      if (hasTitle && !body && /^(?:专用术语注释表|主要符号表|缩略词表|图目录|表目录)$/.test(value)) {
        startFront(out)
        out.push(raw(`\\clearpage\\CustomWordAbstract{${escapeTex(value)}}`))
        continue
      }
      if (hasTitle && bibliographyTitle.test(value)) {
        out.push(raw('\\clearpage'))
        if (settings.runningHead === 'chapter-all') out.push(markTitle(value))
        out.push(heading(1, value))
        bibliography = true
        continue
      }
      if (bibliography && paragraph(node) && value && !numeric && !/^附录|Appendix/i.test(value)) {
        references++
        const previous = /^[\[［]\s*(\d+)\s*[\]］]\s*(.*)$/.exec(value)
        if (previous) {
          referenceNumbers.add(previous[1])
          referenceIndex = Math.max(referenceIndex, Number(previous[1]))
        }
        const index = settings.references === 'numbered' && !previous ? ++referenceIndex : ''
        if (index) referenceNumbers.add(String(index))
        const inlines = settings.references === 'author-year' && previous && !printedCitations.size ? words(previous[2]) : items(node)
        out.push({ t: 'Para', c: [{ t: 'RawInline', c: ['latex', `\\CustomWordReference{${index}}`] }, ...inlines] })
        continue
      }
      const level = nativeHeading ? Math.min(Number(items(node)[0]), 3)
        : settings.headings === 'numbered' && hasTitle ? numeric?.[1].split('.').length ?? (chapterTitle ? 1 : 0) : 0
      if (level) {
        if (level === 1) {
          if (!body) {
            if (settings.tocDepth && !toc) { startFront(out); out.push(raw('\\CustomWordToc')); toc = true }
            out.push(raw('\\CustomWordBody'))
            body = true
          } else if (settings.chapterBreak === 'new-page') out.push(raw('\\clearpage'))
          if (settings.runningHead !== 'same') out.push(markTitle(value))
          chapter = numeric ? Number(numeric[1]) : chapter + 1
          if (settings.figures === 'chapter') figureIndex = 0
          if (settings.tables === 'chapter') tableIndex = 0
          bibliography = false
        }
        out.push(heading(level, value, nativeHeading ? items(node)[1] : undefined))
        continue
      }
      const next = nodes[i + 1]
      const previous = nodes[i - 1]
      const match = paragraph(node) && captionOf(value)
      if (paragraph(node) && !value && images(node).length && paragraph(next)
          && /^(图|Fig)/i.test(captionOf(label(next))?.[1] ?? '')) continue
      if (match && /^(图|Fig)/i.test(match[1])) {
        const content = !label(previous) ? images(previous) : []
        const title = match[1] + ' ' + number('figures', match[2]) + ' ' + match[3]
        if (content.length) {
          out.push({ t: 'Figure', c: [['', [], []], makeCaption(title), [{ t: 'Plain', c: content.map(image => ({
            ...image, c: [['', [], []], ...items(image).slice(1)],
          })) }]] })
        } else { unmatchedCaptions++; out.push(node) }
        continue
      }
      if (match && /^(表|Table)/i.test(match[1]) && next?.t === 'Table') continue
      if (node.t === 'Table') {
        const tableCaption = paragraph(previous) && captionOf(label(previous))
        const fields = items(node).slice()
        const match = tableCaption || captionOf(label(fields[1]))
        if (match && /^(表|Table)/i.test(match[1])) {
          fields[1] = makeCaption(match[1] + ' ' + number('tables', match[2]) + ' ' + match[3])
          out.push({ ...node, c: fields })
        } else out.push(node)
        continue
      }
      if (node.t === 'Figure') {
        const fields = items(node).slice()
        const match = captionOf(label(fields[1]))
        if (match && /^(图|Fig)/i.test(match[1])) {
          fields[1] = makeCaption(match[1] + ' ' + number('figures', match[2]) + ' ' + match[3])
          out.push({ ...node, c: fields })
          continue
        }
      }
      out.push(node)
    }
    return out
  }
  document.blocks = format(document.blocks)
  if (!body) document.blocks.unshift(raw('\\CustomWordBody'))
  let unresolvedReferences = 0
  const plainInlines = (nodes: Node[]): Node[] => nodes.flatMap(node => {
    if (node.t !== 'Span') return [node]
    const [[id, classes, attributes], children] = items(node) as [[string, string[], unknown[]], Node[]]
    return id || classes.length || attributes.length ? [node] : plainInlines(children)
  })
  const replaceReferences = (nodes: Node[]) => {
    for (const node of nodes) {
      if (node.t === 'Div') { replaceReferences(items(node)[1] as Node[]); continue }
      if (!paragraph(node)) continue
      const input = items(node) as Node[]
      // Paired captions are already inside their Figure or Table. A remaining
      // paragraph may begin with a figure or table reference in running text.
      if (input[0]?.t === 'RawInline') continue
      const output: Node[] = []
      let run: Node[] = []
      function flush() {
        const original = text(run)
        const updated = original.replace(/(图|表|\bFig(?:ure)?\.?|\bTable)(\s*)([A-Z]?\d+(?:[-.－–]\d+)?)(?!\d|[-.－–]\d)/gi, (match, prefix: string, space: string, id: string) => {
          const kind = /^(图|fig)/i.test(prefix) ? 'figures' : 'tables'
          if (settings[kind] === 'keep') return match
          const replacement = captionNumbers.get(kind + ':' + id.replace(/[.－–]/g, '-'))
          if (!replacement) { unresolvedReferences++; return match }
          return prefix + space + replacement
        })
        output.push(...(updated === original ? run : updated.split(/(\s+)/).filter(Boolean)
          .map(value => /^\s+$/.test(value) ? { t: 'Space' } : { t: 'Str', c: value })))
        run = []
      }
      for (const inline of plainInlines(input)) {
        if (/^(Str|Space|SoftBreak)$/.test(inline.t)) run.push(inline)
        else { flush(); output.push(inline) }
      }
      flush()
      node.c = output
    }
  }
  replaceReferences(document.blocks)
  const unmatchedCitations = [...printedCitations].filter(value => !referenceNumbers.has(value)).length
  return { references, unmatchedCaptions, unresolvedReferences, unmatchedCitations,
    keptNumericCitations: settings.references === 'author-year' && !!printedCitations.size }
}

const headerHeightPoints = (fontSize: number) => fontSize * 1.3

export function wordHeaderOffsetForGap(top: number, fontSize: number, gap: number) {
  return Math.max(0, Number((top - headerHeightPoints(fontSize) * 25.4 / 72.27 - gap).toFixed(2)))
}

export function customWordGeometry(settings: LayoutValues) {
  const headerHeight = headerHeightPoints(settings.headerSize)
  const headerGap = Math.max(0, settings.top - settings.headerOffset - headerHeight * 25.4 / 72.27)
  const footerGap = Math.max(settings.footerSize * 1.25 * 25.4 / 72.27, settings.bottom - settings.footerOffset)
  return ['top', 'bottom', 'left', 'right'].map(key => `${key}=${settings[key as 'top']}mm`)
    .concat([`bindingoffset=${settings.gutter}mm`, `headheight=${headerHeight.toFixed(2)}pt`, `headsep=${headerGap.toFixed(2)}mm`,
      `footskip=${footerGap.toFixed(2)}mm`])
}

function escapeTex(value: string) {
  return value.replace(/[\\{}%#&_$^~]/g, char =>
    char === '\\' ? '\\textbackslash{}' : char === '^' ? '\\textasciicircum{}' : char === '~' ? '\\textasciitilde{}' : '\\' + char)
}

export function customWordTex(settings: LayoutValues, title: string) {
  const bodyFont = { song: '\\songti', hei: '\\heiti', kai: '\\kaishu', fangsong: '\\fangsong' }[settings.cjkFont]
  const warning = (message: string) => `\\typeout{word-layout.tex:\\the\\inputlineno: warning: ${message}}`
  const western = {
    times: `\\IfFontExistsTF{Times New Roman}{\\setmainfont[Scale=1]{Times New Roman}}{${warning('Times New Roman unavailable; substituting.')}\\IfFontExistsTF{TeX Gyre Termes}{\\setmainfont[Scale=1]{TeX Gyre Termes}}{}}`,
    sans: `\\IfFontExistsTF{Arial}{\\setmainfont[Scale=1]{Arial}}{${warning('Arial unavailable; substituting.')}\\setsansfont{Latin Modern Sans}\\renewcommand{\\familydefault}{\\sfdefault}}`,
    modern: '',
  }[settings.latinFont]
  const alignment = { none: '', left: 'L', center: 'C', right: 'R' } as const
  const head = (content: string, position: string = alignment[settings.header]) => settings.header === 'none' ? ''
    : `\\fancyhead[${position}]{\\fontsize{${settings.headerSize}bp}{${settings.headerSize * 1.2}bp}\\selectfont ${content}}`
  const staticTitle = escapeTex(settings.fixedHeader || title)
  const side = alignment[settings.header]
  const pageHead = settings.runningHead === 'odd-title' ? head('\\songti ' + escapeTex(title), 'RO') + head('\\songti ' + staticTitle, 'LE')
    : settings.runningHead === 'odd-chapter' ? head('\\leftmark', side + 'O') + head(staticTitle, side + 'E')
    : settings.runningHead === 'even-chapter' ? head(staticTitle, side + 'O') + head('\\leftmark', side + 'E')
      : settings.runningHead === 'split' ? head(staticTitle, 'L') + head('\\leftmark', 'R')
        : head(settings.runningHead === 'chapter-all' ? '\\leftmark' : staticTitle)
  const pageFoot = settings.footer === 'none' ? '' : `\\fancyfoot[${alignment[settings.footer]}]{\\fontsize{${settings.footerSize}bp}{${settings.footerSize * 1.2}bp}\\selectfont${settings.runningHead === 'odd-title' ? '\\songti ' : ''}\\thepage}`
  // After clearing floats the shipout counter tracks physical pages, independent of Roman numbering.
  const chapterFront = settings.runningHead === 'chapter-all'
  const bodyOpening = settings.bodyOpening === 'odd'
    ? '\\ifodd\\ReadonlyShipoutCounter\\relax\\null\\thispagestyle{customfront}\\newpage\\fi' : ''
  const frontStyle = chapterFront ? 'customword' : 'customfront'
  const abstractMark = chapterFront ? '\\markboth{#1}{#1}' : ''
  const tocMark = chapterFront ? '\\markboth{\\contentsname}{\\contentsname}' : ''
  const line = settings.lineMode === 'exact' ? settings.spacing : Math.round(settings.bodySize * 1.2 * settings.spacing * 100) / 100
  const headings = [settings.heading1, settings.heading2, settings.heading3].map((size, i) => {
    const section = ['section', 'subsection', 'subsubsection'][i]
    return `${section}={format=\\heiti\\fontsize{${size}bp}{${size * 1.25}bp}\\selectfont}`
  })
  return [
    '\\usepackage{fancyhdr,caption}',
    '\\ifdefined\\ul\\IfFileExists{xeCJKfntef.sty}{\\usepackage{xeCJKfntef}\\let\\ul\\CJKunderline}{\\let\\ul\\underline}\\fi',
    `\\IfFontExistsTF{SimSun}{\\setCJKmainfont[Scale=1]{SimSun}\\setCJKfamilyfont{zhsong}[Scale=1]{SimSun}}{${settings.cjkFont === 'song' ? warning('SimSun unavailable; substituting.') : ''}\\IfFontExistsTF{Songti SC}{\\setCJKmainfont[Scale=1]{Songti SC}\\setCJKfamilyfont{zhsong}[Scale=1]{Songti SC}}{}}`,
    '\\IfFontExistsTF{SimHei}{\\setCJKfamilyfont{zhhei}[Scale=1]{SimHei}}{\\IfFontExistsTF{Heiti SC}{\\setCJKfamilyfont{zhhei}[Scale=1]{Heiti SC}}{}}',
    western, `\\ctexset{${headings.join(',')}}`,
    `\\setcounter{tocdepth}{${settings.tocDepth}}`,
    '\\captionsetup{labelformat=empty,justification=centering,position=auto}',
    '\\newcommand{\\CustomWordToc}{\\clearpage' + tocMark + '\\tableofcontents\\clearpage}',
    '\\newcommand{\\CustomWordAbstract}[1]{' + abstractMark + '\\section*{#1}}',
    '\\newcommand{\\CustomWordReference}[1]{\\par\\hangindent=2em\\hangafter=1\\noindent\\if\\relax\\detokenize{#1}\\relax\\else [#1]\\enspace\\fi}',
    `\\fancypagestyle{customword}{\\fancyhf{}${pageHead}${pageFoot}\\renewcommand{\\headrulewidth}{${pageHead ? '0.4pt' : '0pt'}}\\renewcommand{\\footrulewidth}{0pt}}`,
    `\\fancypagestyle{customfront}{\\fancyhf{}${pageFoot}\\renewcommand{\\headrulewidth}{0pt}\\renewcommand{\\footrulewidth}{0pt}}`,
    '\\newcommand{\\CustomWordFront}{\\clearpage\\pagenumbering{' + (settings.frontPages === 'none' ? 'Roman' : settings.frontPages)
      + '}\\pagestyle{' + frontStyle + '}}',
    `\\newcommand{\\CustomWordBody}{\\clearpage${bodyOpening}\\pagenumbering{arabic}\\pagestyle{customword}}`,
    `\\newcommand{\\CustomWordSetup}{\\pagestyle{empty}\\fontsize{${settings.bodySize}bp}{${line}bp}\\selectfont${bodyFont}\\setlength{\\parindent}{2em}\\setlength{\\parskip}{0pt}}`,
  ].join('\n')
}
