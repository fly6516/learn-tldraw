import JSZip from 'jszip'
import { z } from 'zod'
import { templateDigest } from './paper-templates'
import { parseSyncTex } from './parse-synctex'
import { findSourceRegion } from './source-sync'
import { manuscriptRegions, type LineSources, type TemplatePreview } from './template-source-map'
import type { ProjectFileSystem } from './types'

const checksum = z.string().regex(/^[0-9a-f]{64}$/)
const resultSchema = z.object({
  version: z.literal(1), buildId: z.string().uuid(), inputSha256: checksum, pdfSha256: checksum, syncSha256: checksum,
})

const buildScript = `import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const cwd = realpathSync(fileURLToPath(new URL('.', import.meta.url)))
const recipe = JSON.parse(readFileSync(join(cwd, 'workbench-input.json'), 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')
const checkInputs = () => {
  for (const [path, expected] of recipe.files) {
    if (hash(readFileSync(join(cwd, path))) !== expected) throw new Error('Exported file changed: ' + path)
  }
}
checkInputs()
const out = mkdtempSync(join(tmpdir(), 'workbench-mit-'))
try {
  const run = spawnSync('latexmk', ['-norc', '-lualatex', '-synctex=1', '-latexoption=-no-shell-escape',
    '-interaction=nonstopmode', '-halt-on-error', '-outdir=' + out, 'main.tex'], { cwd, stdio: 'inherit' })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error('LuaLaTeX/Biber did not complete successfully.')
  checkInputs()
  const pdf = readFileSync(join(out, 'main.pdf'))
  const sync = gzipSync(gunzipSync(readFileSync(join(out, 'main.synctex.gz'))).toString('utf8')
    .split('\\n').map(line => {
      if (!line.startsWith('Input:')) return line
      const prefix = /^Input:\\d+:/.exec(line)?.[0]
      const input = prefix && line.slice(prefix.length)
      if (!input) return line
      return prefix + (resolve(cwd, input) === join(cwd, 'main.tex') ? './main.tex' : 'external-input')
    }).join('\\n'))
  writeFileSync(join(cwd, 'workbench-preview.pdf'), pdf)
  writeFileSync(join(cwd, 'workbench-preview.synctex.gz'), sync)
  writeFileSync(join(cwd, 'workbench-result.json'), JSON.stringify({ version: 1, buildId: recipe.buildId,
    inputSha256: recipe.inputSha256, pdfSha256: hash(pdf), syncSha256: hash(sync) }, null, 2))
} finally {
  rmSync(out, { recursive: true, force: true })
}
`

export type ExternalTemplatePreview = TemplatePreview & { sourceSha256: string }

export async function projectSourceDigest(files: ProjectFileSystem['files'], main: string, information?: ProjectFileSystem['metadata']['information']) {
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const data = await Promise.all(entries.flatMap(([path, file]) => {
    if (file.type === 'directory') return []
    return [hash(file.content ?? file.blob ?? '').then(digest => [path, digest])]
  }))
  return hash(JSON.stringify({ main, data, information }))
}

function hash(value: string | Blob) {
  return typeof value === 'string' ? templateDigest(new TextEncoder().encode(value).buffer) : value.arrayBuffer().then(templateDigest)
}

export async function packageExternalTemplate(files: ReadonlyMap<string, string | Blob>, lines: LineSources,
  body: LineSources, sourceSha256: string) {
  const zip = new JSZip()
  const entries: [string, string][] = []
  for (const [path, data] of files) {
    zip.file(path, data instanceof Blob ? await data.arrayBuffer() : data)
    entries.push([path, await hash(data)])
  }
  for (const path of ['compile-mit.mjs', 'workbench-input.json', 'workbench-preview.pdf', 'workbench-preview.synctex.gz', 'workbench-result.json']) {
    if (files.has(path)) throw new Error('素材路径 ' + path + ' 与外部编译文件冲突。')
  }
  const inputSha256 = await hash(JSON.stringify({ sourceSha256, files: entries }))
  const buildId = crypto.randomUUID()
  zip.file('workbench-input.json', JSON.stringify({ buildId, inputSha256, files: entries }, null, 2))
  zip.file('compile-mit.mjs', buildScript)
  const archive = new File([await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })],
    'mit-thesis-external.zip', { type: 'application/zip' })
  const bodyAnchors = new Set([...body.values()].map(({ path, line }) => path + '\0' + line))
  return { archive, buildId, inputSha256, sourceSha256, lines, bodyAnchors }
}

export type ExternalTemplateBuild = Awaited<ReturnType<typeof packageExternalTemplate>>

async function syncText(file: File) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 32 * 1024 * 1024) throw new Error('SyncTeX 超出可读取大小。')
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return chunks.join('') + decoder.decode()
}

export async function attachExternalTemplate(build: ExternalTemplateBuild, pdf: File, sync: File, receipt: File, signal: AbortSignal): Promise<ExternalTemplatePreview> {
  if (pdf.size > 64 * 1024 * 1024 || sync.size > 16 * 1024 * 1024 || receipt.size > 4096) {
    throw new Error('外部编译回传文件超出大小限制。')
  }
  const result = await receipt.text().then(value => resultSchema.parse(JSON.parse(value))).catch(() => undefined)
  if (result?.buildId !== build.buildId || result.inputSha256 !== build.inputSha256) {
    throw new Error('编译记录与本次源包不匹配，请使用本次下载的源包重新编译。')
  }
  const [pdfSha256, syncSha256] = await Promise.all([hash(pdf), hash(sync)])
  if (result.pdfSha256 !== pdfSha256 || result.syncSha256 !== syncSha256) {
    throw new Error('PDF 或 SyncTeX 与编译记录不匹配，请上传同一次编译生成的三个文件。')
  }
  signal.throwIfAborted()
  const text = await syncText(sync).catch(() => { throw new Error('无法读取外部 SyncTeX。') })
  const output = /^Output:([^\r\n]+)$/m.exec(text)?.[1]
  if (output !== 'pdf') throw new Error('SyncTeX 未记录 PDF 输出。')
  const regions = manuscriptRegions(parseSyncTex(text, path => path === './main.tex' ? 'main.tex' : undefined), 'main.tex', build.lines)
  const { readPdfLayout } = await import('./pdf-layout-client')
  const attached = pdf.slice(0, pdf.size, 'application/pdf')
  const pages = await readPdfLayout(attached, signal)
  if (!pages.length || regions.some(region => region.page > pages.length)) throw new Error('PDF 和 SyncTeX 的页码不匹配。')
  if (!regions.some(region => {
    if (!build.bodyAnchors.has(region.path + '\0' + region.line)) return false
    const back = findSourceRegion(regions, region.page, region.x + region.width / 2, region.y + region.height / 2)
    return back?.path === region.path && back.line === region.line
  })) throw new Error('外部编译未生成可用的正文双向定位。')
  return { pdf: attached, regions, sourceSha256: build.sourceSha256 }
}
