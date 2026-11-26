import JSZip from 'jszip'
import { z } from 'zod'
import { exportSourceArchive, importSourceArchive } from './source-archive'
import { projectCompileUrl, wordLayoutCompile } from './compile-profile'
import { templateDigest } from './paper-templates'
import type { LocalPaperTemplate } from './template-catalog'
import type { ProjectFileSystem } from './types'
import { hasLayoutConflict, layoutKeys, layoutValues, wordLayoutAssets, wordLayoutSchema, type WordLayout, type WordLayoutBundle } from './word-layout'
import { wordImportLimit } from './word-import'
import { templateOriginSchema } from './submission-layout'
import type { TemplateOrigin } from './template-release'
import { assessLayout, type LayoutFinding } from './layout-preflight'
import type { CompileReport } from './compile-diagnostics'
import type { SyncRegion } from './source-sync'

const { mainFile: wordMain, compileProfile: wordCompileProfile } = wordLayoutCompile

export async function wordRequest(data: FormData, signal?: AbortSignal) {
  const response = await fetch('/api/word/import', { method: 'POST', body: data, signal })
  if (!response.ok) {
    const details = await response.json().catch(() => undefined)
    throw new Error(typeof details?.error === 'string' ? details.error : 'Word conversion failed.')
  }
  return response
}

export function applyWordBundle(data: FormData, bundle: WordLayoutBundle) {
  data.set('profile', 'custom')
  data.set('layout', JSON.stringify(bundle.layout))
  for (const key of wordLayoutAssets) {
    const file = bundle.assets[key]
    if (file) data.set(key, file)
  }
}

export async function importWordAsProject(data: FormData, name: string, signal?: AbortSignal) {
  const response = await wordRequest(data, signal)
  const project = await importSourceArchive(new File([await response.blob()], name + '.zip'))
  return { ...project, metadata: { ...project.metadata, compileProfile: wordCompileProfile } }
}

async function compileWordPreview(project: ProjectFileSystem, signal?: AbortSignal, synchronize = false) {
  const archive = await exportSourceArchive(project)
  const url = projectCompileUrl(project.metadata.mainFile ?? wordMain, project.metadata.compileProfile ?? wordCompileProfile)
  const request = synchronize ? url : url.replace('&sync=1', '')
  const response = await fetch(request, { method: 'POST', body: archive, signal })
  if (!response.ok) {
    const problem = await response.json().catch(() => undefined)
    const detail = problem?.diagnostics?.[0]?.message
    throw new Error([problem?.error ?? 'PDF 编译失败。', detail].filter(Boolean).join(' '))
  }
  return response
}

export async function previewWordProject(project: ProjectFileSystem, signal?: AbortSignal) {
  return (await compileWordPreview(project, signal)).blob()
}

export async function compileWordProjectWithSync(project: ProjectFileSystem, signal: AbortSignal) {
  const response = await compileWordPreview(project, signal, true)
  const result = await response.formData()
  const pdf = result.get('pdf')
  if (!(pdf instanceof Blob)) throw new Error('编译器未返回 PDF。')
  const report = result.get('report')
  const map = result.get('sourceMap')
  const regions: SyncRegion[] = typeof map === 'string' ? JSON.parse(map) : []
  const diagnostics: CompileReport | undefined = typeof report === 'string' ? JSON.parse(report) : undefined
  return { pdf, regions, diagnostics }
}

export async function previewWordLayout(project: ProjectFileSystem, layout: WordLayout, signal: AbortSignal): Promise<{ pdf: Blob; findings: LayoutFinding[] }> {
  const { pdf, regions, diagnostics } = await compileWordProjectWithSync(project, signal)
  const inspectionSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  const { readPdfLayout } = await import('./pdf-layout-client')
  const pages = await readPdfLayout(pdf, inspectionSignal, Number(layout.rules.footerOffset.chosen.value), Number(layout.rules.top.chosen.value))
    .catch(() => [])
  signal.throwIfAborted()
  const findings = assessLayout(project.files, project.metadata.mainFile ?? 'main.tex', pages, regions, diagnostics)
  return { pdf, findings: findings.filter(item => item.comparisons?.length) }
}

const portableTemplate = z.object({
  format: z.literal('word-layout'),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/),
  origin: templateOriginSchema.optional(),
})

export async function packWordTemplate(name: string, bundle: WordLayoutBundle, version = '1.0.0', origin?: TemplateOrigin): Promise<LocalPaperTemplate> {
  const zip = new JSZip()
  const metadata = portableTemplate.parse({ format: 'word-layout', name, version, origin })
  validateSavedLayout(bundle.layout)
  zip.file('template.json', JSON.stringify(metadata, null, 2))
  zip.file('layout.json', JSON.stringify(bundle.layout, null, 2))
  for (const role of wordLayoutAssets) {
    const file = bundle.assets[role]
    if (!file) continue
    const extension = file.name.split('.').at(-1)?.toLowerCase()
    if (!extension || !(role === 'cover' ? /^(docx?)$/ : /^(png|jpe?g)$/).test(extension)) {
      throw new Error('所选素材格式无效。')
    }
    zip.file('assets/' + role + '.' + extension, await file.arrayBuffer())
  }
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  return templateRecord(metadata, bundle, bytes)
}

function validateSavedLayout(value: unknown) {
  const layout = wordLayoutSchema.parse(value)
  layoutValues(layout)
  if (layoutKeys.some(key => hasLayoutConflict(layout.rules[key]))) throw new Error('版式包包含未处理的冲突。')
  return layout
}

async function templateRecord(metadata: Pick<z.infer<typeof portableTemplate>, 'name' | 'version' | 'origin'>,
  bundle: WordLayoutBundle, bytes: ArrayBuffer): Promise<LocalPaperTemplate> {
  return { id: 'local-' + crypto.randomUUID(), name: metadata.name, version: metadata.version, mainFile: wordMain,
    origin: metadata.origin,
    compileProfile: wordCompileProfile, kind: 'word-layout', reference: !bundle.layout.standardName,
    archive: new Blob([bytes], { type: 'application/zip' }), sha256: await templateDigest(bytes) }
}

async function unpackWordBundle(zip: JSZip): Promise<WordLayoutBundle> {
  const config = zip.file('layout.json')
  if (!config) throw new Error('版式包中没有配置。')
  const raw = await config.async('string')
  if (raw.length > 128 * 1024) throw new Error('版式配置超过大小限制。')
  const layout = validateSavedLayout(JSON.parse(raw))
  const assets: WordLayoutBundle['assets'] = {}
  const entries = Object.values(zip.files).filter(file => !file.dir)
  const allowed = new Set(['layout.json', 'template.json'])
  let total = 0
  for (const role of wordLayoutAssets) {
    const matches = entries.filter(file =>
      new RegExp('^assets/' + role + (role === 'cover' ? '\\.docx?$' : '\\.(png|jpe?g)$')).test(file.name))
    if (matches.length > 1) throw new Error('版式包含有重复的素材。')
    const [entry] = matches
    if (!entry) continue
    allowed.add(entry.name)
    const bytes = await entry.async('arraybuffer')
    total += bytes.byteLength
    if (total > wordImportLimit) throw new Error('版式包素材超过 16 MB。')
    assets[role] = new File([bytes], entry.name.split('/').at(-1)!)
  }
  if (entries.some(entry => !allowed.has(entry.name) || (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name))) {
    throw new Error('版式包包含不受支持的文件。')
  }
  return { layout, assets }
}

export async function readWordTemplate(template: LocalPaperTemplate): Promise<WordLayoutBundle> {
  const bytes = await template.archive.arrayBuffer()
  if (await templateDigest(bytes) !== template.sha256) throw new Error('保存的版式包校验失败。')
  return unpackWordBundle(await JSZip.loadAsync(bytes))
}

export async function importWordTemplateArchive(file: File): Promise<LocalPaperTemplate | undefined> {
  if (file.size > wordImportLimit + 128 * 1024) return undefined
  const bytes = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(bytes)
  if (!zip.file('layout.json') || Object.keys(zip.files).some(path => /\.tex$/i.test(path))) return undefined
  const bundle = await unpackWordBundle(zip)
  const manifest = zip.file('template.json')
  if (!manifest) return templateRecord({ name: file.name.replace(/\.zip$/i, '').slice(0, 120) || 'Word 版式', version: '1.0.0' }, bundle, bytes)
  const raw = await manifest.async('string')
  if (raw.length > 4096) throw new Error('版式包说明超过大小限制。')
  return templateRecord(portableTemplate.parse(JSON.parse(raw)), bundle, bytes)
}
