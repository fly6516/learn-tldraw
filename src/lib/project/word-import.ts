import { groupEnd, maskLatexCode } from './latex-source'

export const wordProfiles = ['article', 'suep-undergraduate'] as const
export type WordProfile = (typeof wordProfiles)[number]
export const wordRoles = ['body', 'cover', 'declaration'] as const
export type WordRole = (typeof wordRoles)[number]
export const wordImportLimit = 16 * 1024 * 1024

export function normalizeWordUnderlines(source: string) {
  const code = maskLatexCode(source)
  let current = 0
  const parts: string[] = []
  for (const match of code.matchAll(/\\(?:\\|(ul)\s*\{)/g)) {
    if (!match[1]) continue
    const open = match.index + match[0].length - 1
    const end = groupEnd(code, open, '{', '}')
    if (end < 0) continue
    const text = code.slice(open + 1, end)
    if (!/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(text) || !/\\[A-Za-z]+/.test(text)) continue
    // Pandoc's soul underline cannot scan nested formatting around CJK
    // punctuation under XeLaTeX. Preserve that run as a single underline.
    parts.push(source.slice(current, match.index), '\\underline')
    current = match.index + '\\ul'.length
  }
  return parts.length ? parts.join('') + source.slice(current) : source
}
