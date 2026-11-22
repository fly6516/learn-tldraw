import { groupEnd, indexLatexLabels, lineNumber, maskLatexCode, type SourceLocation } from './latex-source'

export type CrossReferenceUse = SourceLocation & { key: string; command: string }
export type CrossReferenceIssue = SourceLocation & { key: string; kind: 'missing' | 'duplicate' }

export function indexCrossReferences(sources: ReadonlyMap<string, string>, labels = indexLatexLabels(sources)) {
  const uses = new Map<string, CrossReferenceUse[]>()
  const issues: CrossReferenceIssue[] = []
  for (const [path, source] of sources) {
    const text = maskLatexCode(source)
    const commands = /\\(?:\\|(ref|pageref|eqref|autoref|nameref|vref|vpageref|cref|Cref|cpageref|Cpageref|crefrange|Crefrange|cpagerefrange|Cpagerefrange|hyperref)\*?(?![a-zA-Z@]))/g
    for (const match of text.matchAll(commands)) {
      const command = match[1]
      if (!command) continue
      const open = command === 'hyperref' ? '[' : '{'
      let start = match.index + match[0].length
      const count = command.endsWith('range') ? 2 : 1
      for (let argument = 0; argument < count; argument++) {
        while (/\s/.test(text[start] ?? '')) start++
        if (text[start] !== open) break
        const end = groupEnd(text, start, open, open === '[' ? ']' : '}')
        if (end < 0) break
        const body = text.slice(start + 1, end)
        const list = /^(?:[cC]ref|[cC]pageref)$/.test(command)
        const keyPattern = list ? /^\s*[^\s,{}\\#]+(?:\s*,\s*[^\s,{}\\#]+)*\s*$/ : /^\s*[^\s,{}\\#]+\s*$/
        if (keyPattern.test(body)) {
          for (const item of body.matchAll(/[^\s,]+/g)) {
            const key = item[0]
            const offset = start + 1 + item.index
            const use = { path, line: lineNumber(source, offset), start: offset, end: offset + key.length, key, command }
            if (!uses.has(key)) uses.set(key, [])
            uses.get(key)!.push(use)
            if (!labels.has(key)) issues.push({ ...use, kind: 'missing' })
          }
        }
        start = end + 1
      }
    }
  }
  for (const [key, definitions] of labels) {
    if (definitions.length < 2) continue
    for (const definition of definitions) issues.push({ ...definition, key, kind: 'duplicate' })
  }
  return { labels, uses, issues }
}

export type CrossReferenceIndex = ReturnType<typeof indexCrossReferences>
