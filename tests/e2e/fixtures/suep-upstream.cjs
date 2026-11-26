// Loaded only by the isolated Playwright acceptance server.
const { appendFileSync, readFileSync } = require('node:fs')

const state = process.env.RESEARCH_SUEP_UPSTREAM_STATE
const originals = process.env.RESEARCH_TEMPLATE_PINNED_FIXTURES
if (state && originals) {
  const fetch = globalThis.fetch
  const listing = 'https://xxgk.shiep.edu.cn/615/list.htm'
  const original = 'https://xxgk.shiep.edu.cn/_upload/article/files/37/c7/30eed380428bbbd7f390389bc4ec/76ac2adc-7920-4056-921c-b038658a282e.rar'
  const next = 'https://xxgk.shiep.edu.cn/_upload/article/files/suep-acceptance/candidate.rar'
  globalThis.fetch = async function (input, init) {
    const url = new URL(input instanceof Request ? input.url : input)
    if (![listing, original, next].includes(url.href)) return fetch(input, init)
    const mode = readFileSync(state, 'utf8').trim()
    appendFileSync(state + '.requests', mode + ' ' + url.href + '\n')
    if (mode === 'live') return fetch(input, init)
    if (mode === 'offline') return new Response('Simulated official outage', { status: 503 })
    if (url.href === listing) return new Response("<a href='" + (mode === 'candidate' ? next : original) +
      "'>上海电力大学本科生毕业设计（论文）相关文件</a>")
    return new Response(readFileSync(url.href === next ? state + '.candidate.rar' : originals + '/suep-undergraduate.rar'))
  }
}
