import { loadEnvConfig } from '@next/env'
import JSZip from 'jszip'
import { POST as chat } from '../src/app/api/latex/chat/route'
import { POST as compile } from '../src/app/api/latex/compile/route'
import { applyProjectEdits, buildChapterContext } from '../src/lib/project/ai-edit'
import { aiProviderStatus } from '../src/lib/project/ai-provider'
import { updateFileContent } from '../src/lib/project/file-system'
import { exportSourceArchive, importSourceArchive } from '../src/lib/project/source-archive'
import { chatEditSchema } from '../src/lib/project/writing-chat'
import { buildAttachmentContext } from '../src/lib/project/ai-attachments'
import { locateSourceRanges, mergeSourceRanges, sourceExcerpt } from '../src/lib/project/ai-source-ranges'

const origin = 'http://127.0.0.1:3000'
const host = '127.0.0.1:3000'
const main = 'main.tex'
const section = 'sections/results.tex'
const headers = { origin, host }
const interests = {
  cn: {
    id: 'public-chinese-adaptation', provenance: 'McDonald et al., 2021, DOI 10.1371/journal.pone.0249715. Public domain; methods paraphrased in Chinese.',
    documentClass: String.raw`\documentclass[fontset=fandol]{ctexart}`,
    source: ['\\section{研究方法}', '\\label{sec:study}', '研究在各城市化地区内按人口普查街区的收入百分位分组。', ''].join('\n'),
    prompt: '润色 sections/results.tex 的研究方法句子，使分组依据更明确。只替换原句，保留「人口普查街区」术语，不修改标签。Use propose_edits.',
    protected: [String.raw`\label{sec:study}`],
    expected: /人口普查街区.*(?:收入.*百分位|百分位.*收入)/,
  },
  journal: {
    id: 'public-journal-adaptation', provenance: 'Bae, Jang and Kim, 2026, DOI 10.1371/journal.pclm.0000841, CC BY 4.0. Results paraphrased and CSV transcribed from section 4.2.',
    documentClass: String.raw`\documentclass[twocolumn]{article}`,
    source: String.raw`\section{Results}
\label{sec:study}
The modeled threshold differed across land-use categories.
`,
    prompt: 'Read row 2 of data/thresholds.csv. In sections/results.tex, retain the existing sentence and add a separate sentence reporting the modeled commercial threshold of approximately 30 degrees Celsius. Link the named commercial_c column and physical line 2 in the claim references. Keep the qualifier and label. Use propose_edits.',
    protected: [String.raw`\label{sec:study}`, 'The modeled threshold differed across land-use categories.'],
    expected: /(?=[^.]*\bcommercial\b)(?=[^.]*\bmodeled\b)[^.]*\b(?:approximately|about|around)\s+30\s+degrees Celsius\b/i,
    csv: 'commercial_c,residential_c,park_c\n30,31,29\n',
    evidence: true,
  },
  complex: {
    id: 'synthetic-complex-section', provenance: 'Synthetic QA fixture; no published text.',
    documentClass: String.raw`\documentclass{article}`,
    source: String.raw`\section{Calibration}
\label{sec:calibration}
\begin{equation}
\label{eq:mean}
x = y
\end{equation}
` + '% Long chapter filler for navigation and scope.\n'.repeat(1400) + String.raw`\subsection{Limitations}
\label{sec:study}
The sample frame excluded night shifts, limiting generalization.
`,
    prompt: 'Clarify the sampling bias in sections/results.tex: explain what the absence of night shifts limits. Preserve the equation and labels. Use propose_edits.',
    protected: [String.raw`\label{sec:study}`, String.raw`\begin{equation}
\label{eq:mean}
x = y
\end{equation}`],
    expected: /night shifts?/i,
    long: true,
  },
}

async function run(item: typeof interests[keyof typeof interests], recipient: string) {
  const started = Date.now()
  const zip = new JSZip()
  const family = item === interests.cn ? process.env.RESEARCH_AI_EVAL_CJK_FONT?.trim() : undefined
  if (family && !/^[A-Za-z0-9 -]{1,80}$/.test(family)) throw new Error('Use a plain system font family name.')
  const preamble = family ? String.raw`\documentclass{article}
\font\RcEvalHan="${family}" at 11pt
\makeatletter
\renewcommand\section{\@startsection{section}{1}{0pt}{2ex}{1ex}{\RcEvalHan}}
\makeatother
\AtBeginDocument{\RcEvalHan}` : item.documentClass
  zip.file(main, preamble + '\n\\begin{document}\n\\input{sections/results}\n\\end{document}\n')
  zip.file(section, item.source)
  if ('csv' in item) zip.file('data/thresholds.csv', item.csv)
  const bytes = await zip.generateAsync({ type: 'arraybuffer' })
  const project = await importSourceArchive(new File([bytes], item.id + '.zip'))
  const ranges = 'long' in item ? locateSourceRanges(project, [section], item.prompt, section).matches.map(match => match.range)
    : item === interests.cn ? [{ path: section, start: 3, end: 3 }] : []
  const excerpts = mergeSourceRanges(ranges).flatMap(range => {
    const excerpt = sourceExcerpt(item.source, range)
    return excerpt ? [excerpt] : []
  })
  const request = {
    run: crypto.randomUUID(), expectedRecipient: recipient, workflow: 'auto', scope: [section], excerpts,
    ...(item === interests.cn ? { selection: { path: section, start: 3, end: 3 } } : {}),
    source: { path: section, main, source: excerpts[0]?.source ?? item.source, instruction: '', mode: 'rewrite',
      compiler: { state: 'unavailable', log: '', diagnostics: [] }, context: buildChapterContext(project, section, main) },
    attachments: buildAttachmentContext(project, item.prompt),
    messages: [{ role: 'user', text: item.prompt }],
  }
  const response = await chat(new Request(origin + '/api/latex/chat', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request),
  }))
  const payload = await response.text()
  const parts = payload.split('\n').filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)))
  const completed = parts.some(part => part.type === 'finish' && part.messageMetadata?.complete)
  const proposal = parts.flatMap(part => {
    if (part.type !== 'tool-output-available') return []
    const parsed = chatEditSchema.safeParse(part.output)
    return parsed.success ? [parsed.data] : []
  })[0]
  const summary = {
    id: item.id, provenance: item.provenance, model: recipient, cjkFont: family ?? null, durationMs: 0,
    proposal: Boolean(proposal && completed), compile: false, evidenceCorrect: null as boolean | null,
    rubricPassed: false, humanAcceptance: 'not reviewed',
    failures: parts.filter(part => part.type === 'error').map(part => part.errorText as string),
    rejectedProposals: parts.filter(part => part.type === 'tool-output-available' && typeof part.output?.error === 'string')
      .map(part => part.output.error as string),
    sharedRanges: excerpts.map(({ path, start }) => ({ path, start })),
    toolActivity: parts.filter(part => part.type === 'tool-input-available' || part.type === 'tool-output-error')
      .map(part => part.toolName ?? part.errorText ?? 'Unrecognized tool output'),
  }
  if (!response.ok) summary.failures.push('HTTP ' + response.status, JSON.parse(payload).error)
  if (proposal && completed) {
    const updated = applyProjectEdits(new Map([[section, item.source]]), proposal.edits).get(section)!
    summary.rubricPassed = proposal.edits.some(edit => item.expected.test(edit.after)) && item.protected.every(value => updated.includes(value))
    if ('evidence' in item) summary.evidenceCorrect = Boolean(proposal.claims?.some(claim => /commercial/i.test(claim.quote)
      && claim.references.some(ref => ref.path === 'data/thresholds.csv' && ref.line === 2 && ref.column === 'commercial_c')
      && !claim.needsConfirmation))
    const archive = await exportSourceArchive(updateFileContent(project, section, updated))
    const result = await compile(new Request(origin + '/api/latex/compile?main=main.tex', {
      method: 'POST', headers: { ...headers, 'content-length': String(archive.size) }, body: archive,
    }))
    summary.compile = result.ok
    if (!result.ok) summary.failures.push((await result.json()).error ?? 'Compilation failed.')
  }
  summary.durationMs = Date.now() - started
  return { ...summary, request: item.prompt, proposedEdits: proposal?.edits ?? [], proposedClaims: proposal?.claims ?? [] }
}

loadEnvConfig(process.cwd(), false)
if (process.env.RESEARCH_AI_EVAL !== '1') throw new Error('Set RESEARCH_AI_EVAL=1 to submit the included public and synthetic fixtures.')
const configured = aiProviderStatus()
if (configured?.provider !== 'DeepSeek' || process.env.RESEARCH_TEST_MODE === '1') {
  throw new Error('Configure DeepSeek and disable the simulated model to measure live quality.')
}
const cases = process.env.RESEARCH_AI_EVAL_CASE
const selected = Object.values(interests).filter(item => !cases || item.id === cases)
if (!selected.length && cases !== 'synthetic-media') throw new Error('The requested evaluation case is unknown.')
for (const item of selected) {
  console.log(JSON.stringify(await run(item, configured.provider + ' · ' + configured.model)))
}
if (!cases || cases === 'synthetic-media') {
  const recipient = configured.provider + ' · ' + configured.model
  const media = [
    { kind: 'pdf_page', path: 'sample.pdf', page: 2, text: 'The archived sample code is QZ-418.' },
    { kind: 'image', path: 'panel.png', mediaType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=' },
  ]
  for (const input of media) {
    const started = Date.now()
    const prompt = input.kind === 'image' ? 'Identify the one visible color and cite the attached filename.'
      : 'State the sample code and cite the attached filename and exact page.'
    const response = await chat(new Request(origin + '/api/latex/chat', {
      method: 'POST', headers, body: JSON.stringify({
        run: crypto.randomUUID(), expectedRecipient: recipient, workflow: 'auto', scope: [],
        source: { path: main, main, source: 'Attachment check.', instruction: '', mode: 'rewrite',
          compiler: { state: 'unavailable', log: '', diagnostics: [] }, context: [] },
        media: input, messages: [{ role: 'user', text: prompt }],
      }),
    }))
    const parts = (await response.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)))
    const answer = parts.filter(part => part.type === 'text-delta').map(part => part.delta).join('')
    const expected = input.kind === 'image' ? /\bred\b/i : /QZ-418/
    const correctPage = input.kind === 'pdf_page' ? /\bpage\s*\*{0,2}2\b/i.test(answer)
      : !/\b(?:page|p\.|fig(?:ure)?\.?)\s*\*{0,2}\d/i.test(answer)
    const completed = parts.some(part => part.type === 'finish' && part.messageMetadata?.complete)
    console.log(JSON.stringify({ id: 'synthetic-' + input.kind, model: recipient, durationMs: Date.now() - started,
      evidenceCorrect: response.ok && completed && answer.includes(input.path) && expected.test(answer) && correctPage,
      failures: parts.filter(part => part.type === 'error').map(part => part.errorText), answer }))
  }
}
