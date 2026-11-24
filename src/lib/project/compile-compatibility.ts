import { maskLatexCode } from './latex-source'

export type ExternalEngine = 'pdflatex' | 'xelatex' | 'lualatex'
export type CompileCompatibility = { engine?: ExternalEngine; configuredEngine?: ExternalEngine; bibliography?: 'bibtex' | 'biber'; eps: boolean; nestedStyles: boolean }

export function needsExternalCompile(compatibility: CompileCompatibility) {
  if (compatibility.configuredEngine) return compatibility.configuredEngine === 'lualatex'
  return compatibility.bibliography === 'biber' || compatibility.engine === 'lualatex' || compatibility.engine === 'pdflatex'
}

export function detectCompileCompatibility(sources: ReadonlyMap<string, string>, main: string, paths: Iterable<string>): CompileCompatibility {
  const entry = sources.get(main) ?? ''
  const all = [...sources.values()].map(source => maskLatexCode(source)).join('\n')
  const directive = /^\s*%\s*!TeX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\b/im.exec(entry)?.[1].toLowerCase()
  const classOptions = /\\documentclass\s*\[([^\]]*)\]/.exec(maskLatexCode(entry))?.[1].split(',').map(value => value.trim()) ?? []
  const engines: ExternalEngine[] = ['pdflatex', 'xelatex', 'lualatex']
  const engine = engines.find(candidate => candidate === directive) ?? engines.find(candidate => classOptions.includes(candidate))
  const biblatex = [...all.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^{}]+)\}/g)]
    .find(match => match[2].split(',').some(name => name.trim() === 'biblatex'))
  const bibliography = biblatex ? (/\bbackend\s*=\s*bibtex8?\b/.test(biblatex[1] ?? '') ? 'bibtex' : 'biber')
    : /\\bibliography\s*\{/.test(all) ? 'bibtex' : undefined
  const root = main.slice(0, main.lastIndexOf('/') + 1)
  const included = [...paths]
  return { engine, bibliography, eps: included.some(path => /\.eps$/i.test(path)),
    nestedStyles: included.some(path => /\.bst$/i.test(path) && path.slice(root.length).includes('/')) }
}

export function externalCompileCommand(engine: ExternalEngine) {
  const option = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' }[engine]
  return `latexmk -norc ${option} -latexoption=-no-shell-escape ./MAIN.tex`
}

export function missingCompilerFile(log: string) {
  return /(?:File\s+[`'‘]([^`'’\r\n]+)['’]\s+not found|couldn't open (?:style|database) file\s+([^\s:]+))/i.exec(log)?.slice(1).find(Boolean)
}
