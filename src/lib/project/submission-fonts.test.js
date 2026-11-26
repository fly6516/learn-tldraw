import { expect, test } from 'bun:test'
import { njuptDepositFontFinding, parsePdfFonts } from './submission-fonts'

const header = 'name                     type        encoding    emb sub uni object ID\n-----------------  ------------   -----------  --- --- --- ---------\n'
const pdfFonts = (heiti = 'yes') => parsePdfFonts(header + [
  'ABCDEF+SimSun            CID TrueType Identity-H  yes yes yes 95 0',
  'BCDEFG+SimHei            CID TrueType Identity-H  ' + heiti + ' yes yes 96 0',
  'CDEFGH+TimesNewRomanPSMT  CID TrueType Identity-H  yes yes yes 97 0',
].join('\n'))

test('requires embedded designated PDF fonts and a body-page inventory', () => {
  expect(njuptDepositFontFinding()).toMatchObject({ status: 'issue' })
  expect(njuptDepositFontFinding({ firstPage: 8, fonts: pdfFonts('no') })).toMatchObject({ status: 'issue', page: 8 })
  const actual = njuptDepositFontFinding({ firstPage: 8, fonts: pdfFonts() })
  expect(actual).toMatchObject({ status: 'pass', page: 8 })
  expect(actual.observed).toContain('SimSun（已嵌入）')
})
