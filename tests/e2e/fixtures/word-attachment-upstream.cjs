const { appendFileSync, readFileSync } = require('node:fs')

const state = process.env.RESEARCH_ATTACHMENT_UPSTREAM_STATE
const originals = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES
if (state && originals) {
  const upstream = globalThis.fetch
  const host = 'https://bms.zju.edu.cn'
  const listing = host + '/2026/0901/c85146a3197941/page.htm'
  const location = '/_upload/article/files/8b/05/6f97db8e4843a9fdf8f2913002f6/'
  const word = location + '07794228-a1b3-4356-bc98-950306b07c2c.docx'
  const guide = location + '587de67d-7c81-4475-8e8d-db0a82130801.pdf'
  const njupt = 'https://pg.njupt.edu.cn'
  const njuptListing = njupt + '/2025/0530/c978a284783/page.htm'
  const njuptLocation = '/_upload/article/files/ee/24/7d0bd75140f1ab28894791372b6c/'
  const njuptWord = njuptLocation + 'f4ad7a70-88bd-4654-9384-6ed9f42bd5d2.doc'
  const declaration = njuptLocation + '44f4a937-34f0-44e6-9642-092b23320dec.doc'
  const blind = '/_upload/article/files/bd/78/f4b43f084e7689f6d504a5fd8ce8/64394426-6fd3-4655-9b5b-16b8008d4177.doc'
  globalThis.fetch = async function (input, init) {
    const url = new URL(input instanceof Request ? input.url : input)
    if (![listing, host + word, host + guide, njuptListing, njupt + njuptWord, njupt + declaration, njupt + blind].includes(url.href)) return upstream(input, init)
    const mode = readFileSync(state, 'utf8').trim()
    appendFileSync(state + '.requests', mode + ' ' + url.href + '\n')
    if (mode === 'offline') return new Response('Simulated publisher outage', { status: 503 })
    if (url.href === njuptListing) return new Response('<a href="' + njuptWord + '">南京邮电大学专业学位硕士研究生学位论文模板-自然科学类</a>' +
      '<a href="' + declaration + '">南京邮电大学学位论文原创性声明和使用授权声明</a>')
    if (url.pathname === njuptWord) return new Response(readFileSync(originals + '/njupt-professional-masters.doc'))
    if (url.pathname === blind) return new Response(readFileSync(originals + '/njupt-blind-cover.doc'))
    if (url.pathname === declaration) return new Response(readFileSync(mode === 'candidate'
      ? state + '.declaration.doc' : originals + '/njupt-declaration.doc'))
    if (url.href === listing) return new Response('<a href="' + word + '">附件6：基础医学院本科生毕业论文-毕业论文模板</a>' +
      '<a href="' + guide + '">附件7：浙江大学本科生毕业论文（设计）编写规则.pdf</a>')
    if (url.pathname === word) return new Response(readFileSync(originals + '/zju-basic-medicine-undergraduate.docx'))
    return new Response(readFileSync(mode === 'candidate' ? state + '.guideline.pdf' : originals + '/zju-basic-medicine-undergraduate-guidelines.pdf'))
  }
}
