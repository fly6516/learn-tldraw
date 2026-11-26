import type { LayoutFinding } from './layout-preflight'

export type PdfFontInventory = { firstPage: number; fonts: { name: string; embedded: boolean }[] }

export function parsePdfFonts(output: string) {
  const lines = output.split(/\r?\n/)
  if (!/^name\s+type\s+encoding\s+emb\s+sub\s+uni\s+object ID\s*$/.test(lines[0] ?? '')) return
  return lines.slice(2).flatMap(line => {
    const font = /^(\S+)\s+.+?\s+(yes|no)\s+(?:yes|no)\s+(?:yes|no)\s+\d+\s+\d+\s*$/.exec(line)
    return font ? [{ name: font[1].replace(/^[A-Z]{6}\+/, ''), embedded: font[2] === 'yes' }] : []
  })
}

export function njuptDepositFontFinding(inventory?: PdfFontInventory): LayoutFinding {
  const required = [
    ['SimSun', /^simsun(?:regular|psmt)?$/i],
    ['SimHei', /^simhei(?:regular|psmt)?$/i],
    ['Times New Roman', /^timesnewroman(?:ps)?(?:regular|bold|italic|bolditalic)?(?:mt)?$/i],
  ] as const
  const missing = required.filter(([, pattern]) => {
    const matches = inventory?.fonts.filter(font => pattern.test(font.name.replace(/[\s-]/g, ''))) ?? []
    return !matches.length || matches.some(font => !font.embedded)
  })
  return {
    ruleId: 'deposit-embedded-fonts', label: '正式归档正文嵌入字体', status: missing.length ? 'issue' : 'pass',
    detail: !inventory?.fonts.length ? '当前 PDF 未获得正文嵌入字体证据。请在可读取 PDF 字体的本机环境中重新编译。'
      : missing.length ? '待确认 ' + missing.map(([name]) => name).join('、') + '。安装获授权的指定字体后重新编译。'
        : '在生成的正文 PDF 中核验了三类指定字体的嵌入状态。',
    expected: required.map(([name]) => name).join('、'),
    observed: inventory?.fonts.map(font => font.name + (font.embedded ? '（已嵌入）' : '（未嵌入）')).join('、').slice(0, 2500),
    page: inventory?.firstPage,
    evidence: '生成的 PDF 字体表 · 从正文起始页读取',
    sourceUrl: 'https://pg.njupt.edu.cn/2009/1119/c14020a14690/page.htm',
  }
}
