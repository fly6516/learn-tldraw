export type ReviewLetterComment = { reviewer: string; text: string }

export const maxReviewLetterComments = 100
export const maxReviewCommentLength = 12_000

function reviewHeading(source: string) {
  const line = source.trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+?)\*\*/, '$1')
  const colon = line.search(/[:：]/)
  const heading = (colon < 0 ? line : line.slice(0, colon)).trim()
  const text = colon < 0 ? '' : line.slice(colon + 1).trim()
  const label = heading.replace(/^comments?\s+(?:from|by)\s+(?:the\s+)?/i, '')
  if (/^(?:(?:handling|associate|academic)\s+)?(?:editor|editorial office)(?:['’]s)?(?:\s+(?:comments?|decision|feedback|report))?$/i.test(label)) {
    return { reviewer: 'Editor', text }
  }
  const reviewer = /^(?:reviewer|referee)(?:\s*(?:#\s*|no\.\s*|\s+)([a-z]|\d{1,3}))?(?:['’]s)?(?:\s+(?:comments?|report|feedback))?$/i.exec(label)
  if (reviewer) return { reviewer: reviewer[1] ? `Reviewer ${reviewer[1].toUpperCase()}` : 'Reviewer', text }
  const chinese = /^(责任编辑|主编|编辑部|编辑|审稿人|审稿专家|评审专家|评审人)\s*(?:第\s*)?([\d０-９一二三四五六七八九十甲乙丙丁]*)(?:\s*号)?\s*(?:意见|决定|评语|建议)?$/.exec(label)
  if (chinese) return { reviewer: chinese[1] + (chinese[2] ? ` ${chinese[2]}` : ''), text }
}

const listItem = /^([ \t]*)(?:(?:\d{1,3}[.):]|[-*•])\s+|(?:\d{1,3}、|[（(]\d{1,3}[）)])\s*)(\S.*)$/u

export function splitReviewLetter(input: string): ReviewLetterComment[] {
  if (input.length > 120_000) throw new Error('Paste up to 120,000 characters at a time.')
  const comments: ReviewLetterComment[] = []
  let reviewer = ''
  let lines: string[] = []
  let itemIndent: number | undefined
  function finish() {
    const text = lines.join('\n').trim()
    if (text) comments.push({ reviewer, text })
    lines = []
  }
  for (const line of input.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = reviewHeading(line)
    if (heading) {
      finish()
      reviewer = heading.reviewer
      itemIndent = undefined
      if (heading.text) lines.push(heading.text)
      continue
    }
    const item = listItem.exec(line)
    const indent = item?.[1].replace(/\t/g, '    ').length
    if (item && indent !== undefined && (itemIndent === undefined || indent <= itemIndent)) {
      finish()
      itemIndent = indent
      lines.push(item[2])
    } else lines.push(line)
  }
  finish()
  if (comments.length > maxReviewLetterComments) throw new Error(`Preview up to ${maxReviewLetterComments} comments at a time.`)
  return comments
}
