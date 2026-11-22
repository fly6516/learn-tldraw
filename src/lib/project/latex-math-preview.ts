import katex from 'katex'

export interface LatexMathPart {
  source: string
  environment: string
}

export function renderLatexMath({ source, environment }: LatexMathPart, displayMode = true) {
  const base = environment.replace(/\*$/, '')
  let expression = source
  if (['align', 'alignat', 'flalign', 'eqnarray'].includes(base)) {
    const body = base === 'alignat' ? source.replace(/^\s*\{\d+\}/, '') : source
    expression = '\\begin{aligned}' + body + '\\end{aligned}'
  } else if (base === 'gather' || base === 'multline') {
    expression = '\\begin{gathered}' + source + '\\end{gathered}'
  }
  try {
    return katex.renderToString(expression, { displayMode, trust: false, strict: 'ignore', macros: { '\\mbox': '\\text{#1}' } })
  } catch (error) {
    if (!(error instanceof katex.ParseError)) throw error
  }
}
