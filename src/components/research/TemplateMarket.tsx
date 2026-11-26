'use client'

import { acceptTemplateSwitchRelease, catalogSwitchStatus, supportsSwitchRelease, switchTargetForRelease } from '@/lib/project/template-export-client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, BookOpen, FilePlus2, FileUp, Folder, GraduationCap, LayoutGrid, LibraryBig, Search, Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { fetchOfficialFile, requestOfficialSource } from '@/lib/project/official-template-client'
import { stagesForTemplate, submissionStageInfo } from '@/lib/project/submission-stages'
import { createTemplateProject, openTemplateArchive } from '@/lib/project/paper-templates'
import { compilerLabels } from '@/lib/project/compile-profile'
import { catalogReleaseSource, importCatalogTemplate, templateCatalog, type CatalogTemplate, type LocalPaperTemplate } from '@/lib/project/template-catalog'
import { importSourceArchive } from '@/lib/project/source-archive'
import { addLocalTemplate, listLocalTemplates, listOfficialTemplateReleases, publishOfficialTemplateRelease, saveOfficialSwitchAcceptance, updateLocalTemplate } from '@/lib/project/storage'
import { downloadFile } from '@/lib/export/export-actions'
import type { ProjectFileSystem } from '@/lib/project/types'
import { SaveTemplateDialog } from './SaveTemplateDialog'
import { WordImportDialog } from './WordImportDialog'
import { WordTemplateBuilder } from './WordTemplateBuilder'
import { importWordTemplateArchive, packWordTemplate, readWordTemplate } from '@/lib/project/word-conversion-client'
import { WordLayoutReview } from './WordLayoutReview'
import type { WordLayoutBundle } from '@/lib/project/word-layout'
import type { WordProfile } from '@/lib/project/word-import'
import { OfficialSuepCandidate } from './OfficialSuepCandidate'
import { OfficialZipCandidate } from './OfficialZipCandidate'
import { validateReleaseCandidate, type OfficialTemplateRelease, type TemplateOrigin } from '@/lib/project/template-release'
import { attachmentManifestDigest, type AttachmentRole, type OfficialAttachment } from '@/lib/project/official-attachments'
import { prepareSuepBundle } from '@/lib/project/suep-bundle-client'
import { suepUndergraduateId } from '@/lib/project/suep-undergraduate-source'
import { catalogWordAttachments, usesWordAttachmentRelease } from '@/lib/project/word-release-attachments'
import { wordReleaseFile } from '@/lib/project/word-release-client'
import { exportRelease, importRelease } from '@/lib/project/release-transfer'

const categories = [
  ['all', 'All templates', LayoutGrid], ['general', 'General', BookOpen],
  ['school', 'Universities', GraduationCap], ['journal', 'Journals', LibraryBig],
  ['mine', 'My templates', Folder],
] as const

type Category = (typeof categories)[number][0]
type MarketItem = CatalogTemplate | (LocalPaperTemplate & { delivery: 'local'; category: 'mine' })
const officialReleaseEntries = templateCatalog.filter(catalogReleaseSource)

function templateUsage(item: MarketItem) {
  if (item.delivery === 'local') return item.kind === 'word-layout' ? '用版式导入 Word' : '本地 LaTeX 模板'
  switch (item.workflow.kind) {
    case 'starter': return '内置 LaTeX · 创建项目'
    case 'word': return '官方 Word · 版式对照'
    case 'word-import': return '官方 Word · 专用导入'
    case 'zip': return (item.community ? '社区 LaTeX' : '官方 LaTeX') + (item.workflow.preview === 'external' ? ' · 外部编译' : ' · 创建项目')
    case 'reference': return '参考资料 · 查看来源'
  }
}

export const templateMarketHref = '/research?section=templates'

function TemplatePreview({ item }: { item: MarketItem }) {
  if ('previewUrl' in item && item.previewUrl?.startsWith('/')) {
    return <Image src={item.previewUrl} alt="" width={120} height={170} className="h-full w-full object-contain" unoptimized />
  }
  const layout = 'layout' in item ? item.layout : 'article'
  return <div aria-hidden="true" className="ml-auto mr-auto h-full w-24 overflow-hidden rounded-sm border border-workbench-line bg-white px-2.5 py-3 shadow-sm">
    <div className={'font-serif text-[7px] leading-tight text-workbench-ink ' + (layout === 'thesis' ? 'mt-3 text-center' : '')}>{item.name}</div>
    <div className={'mt-2 h-0.5 bg-workbench-selection-strong ' + (layout === 'thesis' ? 'mx-auto w-1/2' : 'w-full')} />
    {layout === 'thesis' ? <div className="mx-auto mt-5 w-3/5 space-y-1"><div className="h-0.5 bg-workbench-line" /><div className="h-0.5 bg-workbench-line" /></div>
      : <div className={'mt-3 grid gap-x-1.5 gap-y-1 ' + (layout === 'columns' ? 'grid-cols-2' : '')}>
        {Array.from({ length: layout === 'columns' ? 14 : 7 }, (_, index) => <div key={index} className={'h-0.5 bg-workbench-line ' + (index % 5 === 4 ? 'w-4/5' : '')} />)}
      </div>}
  </div>
}

export function TemplateMarket({ database, storageUnavailable, openProject }: {
  database?: IDBDatabase
  storageUnavailable: boolean
  openProject: (project: ProjectFileSystem) => Promise<void>
}) {
  const params = useSearchParams()
  const initialCategory = params.get('category')
  const openManagement = params.get('manage') === '1'
  const [category, setCategory] = useState<Category>(() => categories.find(([id]) => id === initialCategory)?.[0] ?? 'all')
  const [selection, setSelection] = useState(params.get('template') ?? '')
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState('')
  const [local, setLocal] = useState<LocalPaperTemplate[]>([])
  const [detailsOpen, setDetailsOpen] = useState(openManagement)
  const [nameDialog, setNameDialog] = useState<{ item: MarketItem; name: string; rename?: boolean; release?: OfficialTemplateRelease; officialFile?: File }>()
  const [remove, setRemove] = useState<LocalPaperTemplate>()
  const [sourceProject, setSourceProject] = useState<ProjectFileSystem>()
  const [publisherFile, setPublisherFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [wordImport, setWordImport] = useState<{ profile: WordProfile; origin: TemplateOrigin; archive?: Blob; manual?: boolean }>()
  const [layoutBuilder, setLayoutBuilder] = useState(false)
  const [layoutEditor, setLayoutEditor] = useState<{ name: string; version: string; bundle: WordLayoutBundle; origin?: TemplateOrigin }>()
  const [layoutReview, setLayoutReview] = useState<{ name: string; version: string; bundle: WordLayoutBundle }>()
  const [savedLayout, setSavedLayout] = useState<{ name: string; bundle: WordLayoutBundle; origin?: TemplateOrigin; declaration?: File }>()
  const [releases, setReleases] = useState<Record<string, OfficialTemplateRelease[]>>({})
  const [releaseChoice, setReleaseChoice] = useState<Record<string, string>>({})
  const [releaseCandidate, setReleaseCandidate] = useState<{ entry: CatalogTemplate; parent: TemplateOrigin; file?: File; standard?: File; extraFiles?: Partial<Record<AttachmentRole, File>>; parentAttachments?: OfficialAttachment[]; candidateSources?: OfficialAttachment[] }>()
  const [pendingPublication, setPendingPublication] = useState<OfficialTemplateRelease>()
  const [restore, setRestore] = useState<{ release: OfficialTemplateRelease; parent: TemplateOrigin }>()
  const [sourceCheck, setSourceCheck] = useState<Record<string, {
    sha256: string; url: string; scope: 'listing' | 'file'; matchesBaseline?: boolean; attachments?: OfficialAttachment[]
  }>>({})
  const [officialWord, setOfficialWord] = useState<{ origin: TemplateOrigin; file?: File; standard?: File }>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const zipInput = useRef<HTMLInputElement>(null)
  const releaseInput = useRef<HTMLInputElement>(null)
  const details = useRef<HTMLElement>(null)
  const cards = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    if (openManagement && window.matchMedia('(width < 64rem)').matches) details.current?.focus()
  }, [openManagement])

  useEffect(() => {
    if (!database) return
    let active = true
    void listLocalTemplates(database).then(templates => { if (active) setLocal(templates) }).catch(() => {
      if (active) setError('Could not load templates stored in this browser.')
    })
    void Promise.all(officialReleaseEntries.map(async entry => [entry.id, await listOfficialTemplateReleases(database, entry.id)] as const))
      .then(entries => { if (active) setReleases(Object.fromEntries(entries)) })
      .catch(() => { if (active) setError('无法读取官方模板版本。') })
    return () => { active = false }
  }, [database])

  const items: MarketItem[] = [...templateCatalog, ...local.map(item => ({ ...item, delivery: 'local', category: 'mine' } as const))]
  const term = query.trim().normalize().toLowerCase()
  const visible = items.filter(item => (category === 'all' || item.category === category)
    && (!language || ('language' in item && item.language === language))
    && [item.name, 'summary' in item ? item.summary : '',
      ...('sections' in item ? item.sections : []), ...('keywords' in item ? item.keywords ?? [] : [])]
      .join(' ').normalize().toLowerCase().includes(term))
  const selected = visible.find(item => item.id === selection) ?? visible[0]
  const history = selected ? releases[selected.id] ?? [] : []
  const selectedRelease = selected && (releaseChoice[selected.id]
    ? history.find(item => item.version === releaseChoice[selected.id]) : history[0])
  const releaseSource = selected && selected.delivery !== 'local' ? catalogReleaseSource(selected) : undefined
  const baseline = releaseSource?.baseline
  const switchStatus = selected && selected.delivery !== 'local' ? catalogSwitchStatus(selected) : undefined
  const workflow = selected?.delivery !== 'local' ? selected?.workflow : undefined
  const workflowMain = workflow?.kind === 'zip' && selectedRelease?.kind === 'zip'
    ? workflow.upstream?.mainFile ?? workflow.compile.mainFile
    : workflow && 'compile' in workflow ? workflow.compile.mainFile : undefined
  const candidateSource = releaseCandidate && catalogReleaseSource(releaseCandidate.entry)
  const parentRelease = history[0] ?? baseline
  const releaseReady = !baseline || Object.hasOwn(releases, baseline.id)
  const checkedSource = baseline && sourceCheck[baseline.id]
  const currentAttachments = history[0]?.attachments ?? (baseline && catalogWordAttachments(baseline.id))
  const matchesPublished = checkedSource?.attachments
    ? checkedSource.attachments.every(item => currentAttachments?.some(old => old.role === item.role && old.sha256 === item.sha256))
    : checkedSource?.sha256 === parentRelease?.sha256 || (!history.length && checkedSource?.matchesBaseline)
  const activeName = categories.find(([id]) => id === category)?.[1]
  const dialogItem = nameDialog?.item

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the template action.') }
    finally { setBusy(false) }
  }

  function choose(item: MarketItem) {
    setSelection(item.id)
    setDetailsOpen(true)
    if (window.matchMedia('(width < 64rem)').matches) requestAnimationFrame(() => details.current?.focus())
  }

  function addToCatalog(template: LocalPaperTemplate) {
    setLocal(current => [...current, template])
    setCategory('mine')
    setLanguage('')
    setQuery('')
    choose({ ...template, delivery: 'local', category: 'mine' })
  }

  function submitName() {
    if (!database || !nameDialog || !nameDialog.name.trim()) return
    const { item, name, rename, release, officialFile } = nameDialog
    const archiveFile = officialFile ?? publisherFile
    void run(async () => {
      if (rename) {
        await updateLocalTemplate(database, item.id, name.trim())
        setLocal(await listLocalTemplates(database))
      } else if (item.delivery === 'built-in') {
        await openProject(await createTemplateProject(item.template.id, name.trim()))
      } else if (item.delivery === 'archive' && release?.kind === 'zip') {
        await openProject(await importCatalogTemplate(item, new File([release.archive], release.sourceName), name.trim(), release))
      } else if (item.delivery === 'archive' && archiveFile) {
        await openProject(await importCatalogTemplate(item, archiveFile, name.trim()))
      } else if (item.delivery === 'local') {
        const file = new File([item.archive], item.name + '.zip', { type: 'application/zip' })
        await openProject(await openTemplateArchive(file, item, name.trim(), item.sha256))
      } else {
        return
      }
      setNameDialog(undefined)
      setPublisherFile(undefined)
    })
  }

  async function activateRelease(release: OfficialTemplateRelease, parent: TemplateOrigin) {
    if (!database) throw new Error('无法打开本机模板存储。')
    validateReleaseCandidate(parent, release.version, release.sha256, release.manifestSha256)
    const signal = AbortSignal.timeout(120_000)
    release = await acceptTemplateSwitchRelease(release, signal)
    if (!release.attachments && release.kind === 'word-import' && release.id === suepUndergraduateId) {
      const { manifest } = await prepareSuepBundle({ ...release, id: suepUndergraduateId }, signal, release.archive)
      const attachments: OfficialAttachment[] = [
        { role: 'original', sha256: release.sha256, url: manifest.sourceUrl },
        ...Object.entries(manifest.members).map(([role, item]) => ({
          role: (role === 'guide' ? 'guideline' : role) as OfficialAttachment['role'],
          sha256: item.sha256, url: manifest.sourceUrl, member: item.path,
        })),
      ]
      release = { ...release, attachments, manifestSha256: await attachmentManifestDigest(attachments) }
    } else if (!release.attachments && release.kind === 'zip') {
      const entry = templateCatalog.find(item => item.id === release.id)
      const source = entry && catalogReleaseSource(entry)
      if (source) {
        const attachments: OfficialAttachment[] = [{ role: 'original', sha256: release.sha256, url: source.url }]
        release = { ...release, attachments, manifestSha256: await attachmentManifestDigest(attachments) }
      }
    }
    await publishOfficialTemplateRelease(database, release, parent)
    setReleases(current => ({ ...current, [release.id]: [release, ...current[release.id] ?? []] }))
    setReleaseChoice(current => ({ ...current, [release.id]: release.version }))
    setMessage('新版本已发布到当前浏览器。')
  }

  async function publish(release: OfficialTemplateRelease) {
    if (!releaseCandidate) return
    setPendingPublication(release)
  }

  async function acceptStoredSwitch(release: OfficialTemplateRelease) {
    if (!database || !switchTargetForRelease(release)) return
    const verified = await acceptTemplateSwitchRelease(release, AbortSignal.timeout(120_000))
    await saveOfficialSwitchAcceptance(database, verified)
    setReleases(current => ({ ...current, [release.id]: (current[release.id] ?? []).map(item =>
      item.version === release.version && item.sha256 === release.sha256 ? verified : item) }))
    setMessage('该版本已通过项目内切换验收。')
  }

  async function checkSource(id: string) {
    setSourceCheck(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    const [result, ...supplemental] = await Promise.all([
      requestOfficialSource(id).then(response => response.json()),
      ...(catalogWordAttachments(id) ?? []).filter(item => item.role === 'guideline' || item.role === 'declaration' || item.role === 'blind-cover')
        .map(async item => {
          const role = item.role as 'guideline' | 'declaration' | 'blind-cover'
          const found = await (await requestOfficialSource(id, undefined, role)).json()
          return { role, sha256: found.sha256, url: found.url } as OfficialAttachment
        }),
    ])
    if (supplemental.length) result.attachments = [{ role: 'original', sha256: result.sha256, url: result.url }, ...supplemental]
    setSourceCheck(current => ({ ...current, [id]: result }))
  }

  async function openReleaseCandidate(entry: CatalogTemplate, parent: TemplateOrigin, current?: OfficialTemplateRelease,
    file?: File, candidateSources?: OfficialAttachment[]) {
    if (!usesWordAttachmentRelease(entry.id)) { setReleaseCandidate({ entry, parent, file }); return }
    const fallback = () => undefined
    const [original, ...files] = await Promise.all([
      file ?? wordReleaseFile(entry.id, 'original', undefined, current).catch(fallback),
      ...(catalogWordAttachments(entry.id) ?? []).filter(item => item.role !== 'original').map(async item => {
        const update = candidateSources?.find(change => change.role === item.role && change.sha256 !==
          (current?.attachments?.find(prior => prior.role === item.role)?.sha256 ?? item.sha256))
        const role = item.role as 'guideline' | 'declaration' | 'blind-cover'
        const asset = update ? await fetchOfficialFile(entry.id, update.sha256, role)
          : await wordReleaseFile(entry.id, role, undefined, current).catch(fallback)
        return [role, asset] as const
      }),
    ])
    const extraFiles = Object.fromEntries(files)
    setReleaseCandidate({ entry, parent, file: original, standard: extraFiles.guideline,
      extraFiles, parentAttachments: current?.attachments, candidateSources })
  }

  async function openConfiguredTemplate(item: MarketItem, release?: OfficialTemplateRelease, manual = false) {
    if (release?.kind === 'word') {
      const declaration = release.attachments?.some(item => item.role === 'declaration')
        ? await wordReleaseFile(item.id, 'declaration', undefined, release) : undefined
      setSavedLayout({ name: item.name, bundle: await readWordTemplate(release.layout), origin: release.layout.origin, declaration })
      return
    }
    if (item.delivery === 'local' && item.kind === 'word-layout') {
      setSavedLayout({ name: item.name, bundle: await readWordTemplate(item), origin: item.origin })
      return
    }
    if (item.delivery === 'local' || item.workflow.kind === 'starter' || release?.kind === 'zip') {
      setNameDialog({ item, name: '', release })
      return
    }
    const { workflow } = item
    if (workflow.kind === 'reference') return
    const origin = { id: item.id, version: workflow.version, sha256: workflow.original.sha256 }
    if (workflow.kind === 'word-import') {
      setWordImport({ profile: workflow.profile, origin: release?.kind === 'word-import' ? { id: release.id, version: release.version, sha256: release.sha256 } : origin,
        archive: release?.kind === 'word-import' ? release.archive : undefined, manual })
      return
    }
    if (workflow.kind === 'zip') {
      const officialFile = manual ? undefined : await fetchOfficialFile(item.id, origin.sha256)
      setPublisherFile(undefined)
      setNameDialog({ item, name: '', officialFile })
      return
    }
    const [file, standard] = manual ? [] : await Promise.all([
      fetchOfficialFile(item.id, origin.sha256),
      workflow.guideline && fetchOfficialFile(item.id, workflow.guideline.sha256, 'guideline').catch((cause: unknown) => {
        throw new Error('读取官方规范 PDF 失败。' + (cause instanceof Error ? cause.message : '请重试或手动上传。'))
      }),
    ])
    setOfficialWord({ origin, file, standard })
    setLayoutBuilder(true)
  }

  return <main className="research-theme flex min-h-dvh flex-col bg-workbench-canvas text-workbench-ink">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-workbench-line bg-workbench-toolbar px-4 py-2.5 sm:px-5">
      <Link href="/research" className="flex items-center gap-2 rounded-md px-1 text-sm font-semibold text-workbench-accent focus-visible:outline-2">
        <ArrowLeft className="size-4" /> Research projects
      </Link>
      <div className="flex flex-wrap gap-2">
        {category === 'mine' && <Button size="sm" disabled={!database || busy}
          onClick={() => setLayoutBuilder(true)}><FilePlus2 /> 从 Word 生成模板</Button>}
        <Button size="sm" variant={category === 'mine' ? 'outline' : 'default'} disabled={!database || busy}
          onClick={() => zipInput.current?.click()}><FileUp /> Import as template</Button>
      </div>
      <input ref={zipInput} type="file" accept=".zip" aria-label="Choose template ZIP" hidden onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file && database) void run(async () => {
          const template = await importWordTemplateArchive(file)
          if (!template) { setSourceProject(await importSourceArchive(file)); return }
          await addLocalTemplate(database, template)
          addToCatalog(template)
          setMessage('Word 版式已导入。')
        })
      }} />
    </header>
    <div className="grid min-w-0 flex-1 lg:grid-cols-[11rem_minmax(0,1fr)_19rem] xl:grid-cols-[13rem_minmax(0,1fr)_22rem]">
      <aside className="border-b border-workbench-line bg-workbench-explorer p-3 lg:border-r lg:border-b-0 lg:py-5">
        <h2 className="mb-2 px-2 font-mono text-[11px] font-semibold tracking-widest text-workbench-muted uppercase">Template library</h2>
        <nav className="flex flex-wrap gap-1 lg:flex-col" aria-label="Template categories">
          {categories.map(([id, label, Icon]) => <button key={id} type="button" aria-pressed={category === id}
            onClick={() => { setCategory(id); setDetailsOpen(false); setSelection(''); setLanguage('') }}
            className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium hover:bg-workbench-selection focus-visible:outline-2 focus-visible:outline-workbench-accent aria-pressed:bg-workbench-selection-strong aria-pressed:text-workbench-accent">
            <Icon className="size-4 shrink-0" />{label}</button>)}
        </nav>
      </aside>
      <section aria-label="Template catalog" className="min-w-0 bg-white">
        <div className="space-y-4 border-b border-workbench-line px-4 py-5 sm:px-6">
          <h1 className="text-2xl font-semibold tracking-tight">Paper templates</h1>
          <div className="grid gap-2 min-[450px]:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative flex items-center">
              <span className="sr-only">Search templates</span><Search className="pointer-events-none absolute left-3 size-4 text-workbench-muted" />
              <Input type="search" className="bg-workbench-panel pl-9" placeholder="Search schools, journals or templates" value={query}
                onChange={event => setQuery(event.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm">Language
              <select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value)} className="h-9 min-w-0 flex-1 rounded-md border bg-white px-2">
                <option value="">All languages</option><option>简体中文</option><option>English</option>
              </select>
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between border-b border-workbench-line bg-workbench-panel px-4 py-2 text-sm sm:px-6">
          <h2 className="font-semibold">{activeName}</h2><span className="font-mono text-xs text-workbench-muted">{visible.length} templates</span>
        </div>
        {message && <p role="status" className="border-b px-4 py-3 text-sm">{message}</p>}
        {storageUnavailable && <p role="alert" className="border-b bg-red-50 px-4 py-3 text-sm text-red-900">Local project storage could not be opened. Reload the page to try again.</p>}
        {error && !nameDialog && !remove && !restore && <p role="alert" className="border-b bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p>}
        {visible.length ? <ul aria-label="Template results" className="grid grid-cols-1 gap-3 p-4 min-[390px]:grid-cols-2 sm:grid-cols-3 sm:p-6 lg:grid-cols-2 xl:grid-cols-3">
          {visible.map((item, index) => <li key={item.id} className="min-w-0">
            <button ref={node => { if (node) cards.current.set(item.id, node); else cards.current.delete(item.id) }}
              type="button" aria-label={item.name} aria-pressed={item.id === selected?.id}
              className="flex size-full flex-col overflow-hidden rounded-lg border bg-white text-left hover:border-workbench-accent/60 focus-visible:outline-2 focus-visible:outline-workbench-accent aria-pressed:border-workbench-accent aria-pressed:ring-1 aria-pressed:ring-workbench-accent"
              onClick={() => choose(item)} onKeyDown={event => {
                const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? visible[index + 1]
                  : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? visible[index - 1] : undefined
                if (next) { event.preventDefault(); setSelection(next.id); cards.current.get(next.id)?.focus() }
              }}>
              <div className="h-32 w-full overflow-hidden border-b bg-workbench-explorer p-3"><TemplatePreview item={item} /></div>
              <div className="w-full space-y-1 p-3">
                <span className="block break-words text-sm leading-tight font-semibold">{item.name}</span>
                <span className="block text-xs text-workbench-muted">{templateUsage(item)}</span>
              </div>
            </button>
          </li>)}
        </ul> : <p className="p-6 text-sm text-workbench-muted">{category === 'mine' && !local.length
          ? 'Import a LaTeX ZIP or save a project as a template to get started.' : 'No templates match the current filters.'}</p>}
      </section>
      <aside ref={details} tabIndex={-1} aria-label="Template details"
        className={`min-w-0 border-t border-workbench-line bg-workbench-panel focus:outline-none lg:block lg:border-t-0 lg:border-l ${detailsOpen && selected ? 'block' : 'hidden'}`}>
        <div className="flex h-11 items-center justify-between border-b px-4 text-sm font-semibold">
          Template details
          <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => {
            setDetailsOpen(false)
            if (selected) cards.current.get(selected.id)?.focus()
          }}>Hide details</Button>
        </div>
        {selected && <div className="space-y-4 p-4">
          <div>
            <h2 className="break-words text-xl font-semibold">{selected.name}</h2>
            {'summary' in selected && <p className="mt-2 text-sm text-workbench-muted">{selected.summary}</p>}
          </div>
          <div className="h-36 rounded-md border border-workbench-line bg-workbench-explorer p-3"><TemplatePreview item={selected} /></div>
          <p className="-mt-2 text-xs text-workbench-muted">{'previewLabel' in selected && selected.previewLabel
            ? selected.previewLabel : 'previewUrl' in selected && selected.previewUrl?.startsWith('/') ? 'Sample first page' : 'Structure preview'}</p>
          {'sections' in selected && <p className="border-y py-3 text-sm text-workbench-muted">{selected.sections.join(' · ')}</p>}
          {selected.delivery !== 'local' && <dl className="space-y-2 text-sm">
            <div><dt className="font-medium">使用方式</dt><dd className="text-workbench-muted">{templateUsage(selected)}</dd></div>
            <div><dt className="font-medium">来源版本</dt><dd className="text-workbench-muted">
              {selectedRelease?.version ?? selected.sourceVersion ?? ('template' in selected ? selected.template.version : '以发布页为准')}
            </dd></div>
            <div><dt className="font-medium">验收范围</dt><dd className="text-workbench-muted">
              {selectedRelease ? '版本记录包含原件校验值和验收 PDF 摘要。' : selected.verification ?? (selected.delivery === 'built-in' ? '可在工作台创建项目。' : '提供来源和使用方式，尚无逐项排版验收记录。')}
            </dd></div>
            <div><dt className="font-medium">提交准备</dt><dd className="text-workbench-muted">
              {selected.workflow.kind === 'reference' ? '参考条目 · 查看发布方要求'
                : stagesForTemplate(selected.id).map(stage => submissionStageInfo(stage, selected.id).label).join(' · ')}
            </dd></div>
            {switchStatus && <div><dt className="font-medium">项目内切换</dt><dd>
              {switchStatus === 'reference' ? '此条目提供官方参考资料。'
                : switchStatus === 'external-switch' ? '支持项目内更换为目录登记版。通过外部 LuaLaTeX 编译文件回传 PDF 和原稿定位。'
                  : switchStatus === 'external' ? '使用外部编译。当前 PDF 回传不含原稿行号映射。'
                  : switchStatus === 'pinned' ? '支持目录登记版。'
                    : selectedRelease ? selectedRelease.switchAcceptance?.protocol === 1
                      ? '已通过独立稿编译和双向定位验收。' : '此版本尚未验收项目内切换。'
                      : '支持目录登记版。发布候选需通过切换验收。'}
            </dd></div>}
            {selected.manualReview && <div><dt className="font-medium">待人工核对</dt><dd className="text-workbench-muted">{selected.manualReview}</dd></div>}
          </dl>}
          <div className="flex flex-wrap gap-2">
            {workflow?.kind === 'reference' ? (selected.delivery !== 'local' && selected.sourceUrl && <Button asChild size="sm">
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">查看模板来源 <ArrowUpRight /></a>
            </Button>) : <Button size="sm" disabled={!database || busy || !releaseReady}
              onClick={() => void run(() => openConfiguredTemplate(selected, selectedRelease || undefined))}><FilePlus2 /> 使用模板</Button>}
            {baseline && !selectedRelease && <Button size="sm" variant="outline" disabled={!database || busy || !releaseReady}
              onClick={() => void run(() => openConfiguredTemplate(selected, undefined, true))}>手动上传原件</Button>}
          </div>
          {baseline && releaseSource && parentRelease && selected.delivery !== 'local' && <details open={openManagement || undefined} className="rounded border p-2.5 text-sm">
            <summary className="cursor-pointer">管理官方版本</summary>
            <p className="mt-2">当前发布版 {parentRelease.version}</p>
            <p className="break-all font-mono text-xs">原件 SHA-256 {parentRelease.sha256}</p>
            {selectedRelease?.manifestSha256 && <p className="break-all font-mono text-xs">附件清单 SHA-256 {selectedRelease.manifestSha256}</p>}
            {history.length > 0 && <label className="mt-2 block">项目使用版本
              <select className="mt-1 block max-w-full rounded border p-1" value={selectedRelease?.version ?? baseline.version}
                onChange={event => setReleaseChoice(current => ({ ...current, [selected.id]: event.target.value }))}>
                {history.map(item => <option key={item.version}>{item.version}</option>)}
                <option>{baseline.version}</option>
              </select>
            </label>}
            {history.length > 0 && <ul className="mt-2 space-y-1">
              {history.map(item => <li key={item.version} className="break-all text-xs">
                {item.version} · {item.sourceName} · {new Date(item.publishedAt).toLocaleDateString()} · 已编译 · {item.sha256}
                {item.previewSha256 && <p>验收 PDF SHA-256 {item.previewSha256}</p>}
                {item.switchAcceptance && <p>切换验收 PDF SHA-256 {item.switchAcceptance.pdfSha256}</p>}
                {item.wordAcceptance && <p>Microsoft Word {item.wordAcceptance.version} 实机验收通过 · 定稿 SHA-256 {item.wordAcceptance.finalSha256}</p>}
              </li>)}
            </ul>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => checkSource(baseline.id))}>检查官方原件更新</Button>
              <Button size="sm" variant="outline" disabled={!database || busy || !releaseReady}
                onClick={() => void run(() => openReleaseCandidate(selected, parentRelease, history[0]))}>验收候选文件</Button>
              <Button size="sm" variant="outline" disabled={!database || busy || !releaseReady}
                onClick={() => releaseInput.current?.click()}>导入版本包</Button>
              {selectedRelease && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
                downloadFile(await exportRelease(selectedRelease), selectedRelease.id + '-' + selectedRelease.version + '.release.zip')
              })}>导出所选版本</Button>}
              {selectedRelease && !selectedRelease.switchAcceptance && switchTargetForRelease(selectedRelease) &&
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void run(() => acceptStoredSwitch(selectedRelease))}>验收项目内切换</Button>}
            </div>
            <input hidden ref={releaseInput} type="file" accept=".zip" aria-label="官方模板版本包" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void run(async () => {
                const release = await importRelease(file, releaseSource)
                if (history.some(item => item.version === release.version)) throw new Error('此浏览器已有这个版本号。')
                validateReleaseCandidate(parentRelease, release.version, release.sha256, release.manifestSha256)
                setRestore({ release, parent: parentRelease })
              })
            }} />
            {checkedSource && <div role="status" className="mt-2 space-y-1">
              <p>{matchesPublished ? '所检查的官方原件与当前发布版一致。' : '发现不同的官方原件，请核对发布说明并验收候选。'}</p>
              <a href={checkedSource.url} target="_blank" rel="noreferrer" className="underline">打开本次检查的原件</a>
              <p className="break-all font-mono text-xs">{checkedSource.sha256}</p>
              {checkedSource.attachments?.filter(item => item.role !== 'original').map(item =>
                <p key={item.role} className="break-all font-mono text-xs">{item.role} · {item.sha256}</p>)}
              {checkedSource.scope === 'file' && <p className="text-workbench-muted">本次检查目录登记的文件地址。新附件另行发布时，请查看发布页。</p>}
              {!matchesPublished && <Button size="sm" variant="outline"
                disabled={!database || busy || !releaseReady} onClick={() => void run(async () => {
                  const sameMain = checkedSource.sha256 === parentRelease.sha256 && usesWordAttachmentRelease(selected.id)
                  const file = sameMain ? undefined : await fetchOfficialFile(selected.id, checkedSource.sha256)
                  await openReleaseCandidate(selected, parentRelease, history[0], file, checkedSource.attachments)
                })}>载入官方原件验收</Button>}
            </div>}
          </details>}
          {workflow?.kind === 'zip' && workflow.preview === 'external' && <p className="text-sm text-workbench-muted">
            用项目的 Prepare submission 导出外部编译 ZIP。此模板可检查源包更新，候选验收需要外部编译。
          </p>}
          {selected.delivery === 'official' && <section aria-label={selected.language === '简体中文' ? '官方文件' : 'Official files'} className="space-y-2">
            <h3 className="text-sm font-semibold">{selected.language === '简体中文' ? '官方文件' : 'Official files'}</h3>
            {selected.officialFiles.map(({ label, url }, index) => <Button key={url} asChild size="sm"
              variant={index === 0 ? 'default' : 'outline'} className="h-auto min-h-8 w-full justify-between whitespace-normal text-left">
              <a href={url} target="_blank" rel="noreferrer">{label}<ArrowUpRight /></a>
            </Button>)}
          </section>}
          {workflow && 'compile' in workflow ? <dl className="space-y-2 text-sm">
            <div><dt className="font-medium">编译器</dt><dd className="text-workbench-muted">{compilerLabels[workflow.compile.compileProfile.engine]}</dd></div>
            <div><dt className="font-medium">编译入口</dt><dd className="break-all font-mono text-xs text-workbench-muted">{workflowMain}</dd></div>
          </dl> : selected.delivery === 'local' &&
            <dl className="space-y-2 text-sm">
              <div><dt className="font-medium">Version</dt><dd className="text-workbench-muted">{selected.version}</dd></div>
              <div><dt className="font-medium">Compiler</dt><dd className="text-workbench-muted">{compilerLabels[selected.compileProfile.engine]}</dd></div>
              <div><dt className="font-medium">Main file</dt><dd className="break-all font-mono text-xs text-workbench-muted">{selected.mainFile}</dd></div>
            </dl>}
          {selected.delivery === 'local' && selected.kind === 'word-layout' && <p className="text-sm text-workbench-muted">
            {selected.reference ? '参考版式 · 尚未按官方规范核对' : 'Word 版式 · 规则及核对状态见版式包'}
          </p>}
          <div className="flex flex-wrap gap-2">
            {'downloadUrl' in selected && selected.downloadUrl && <Button asChild size="sm" variant="outline">
              <a href={selected.downloadUrl}
                target="_blank" rel="noreferrer">Get source ZIP <ArrowUpRight /></a></Button>}
            {workflow?.kind !== 'reference' && 'sourceUrl' in selected && selected.sourceUrl && <Button asChild size="sm" variant="outline">
              <a href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.delivery === 'official' && selected.language === '简体中文'
                ? '学校发布页' : selected.requirementsUrl ? 'Template source' : 'Source and requirements'} <ArrowUpRight /></a></Button>}
            {'requirementsUrl' in selected && selected.requirementsUrl && <Button asChild size="sm" variant="outline">
              <a href={selected.requirementsUrl} target="_blank" rel="noreferrer">{selected.requirementsLabel ?? 'Author requirements'} <ArrowUpRight /></a></Button>}
            {'previewUrl' in selected && selected.previewUrl && !selected.previewLabel && <Button asChild size="sm" variant="outline">
              <a href={selected.previewUrl} target="_blank" rel="noreferrer">{selected.previewUrl.startsWith('/') ? 'Open sample page'
                : selected.delivery === 'official' && selected.language === '简体中文' ? '查看学校 PDF 原件' : 'View source preview'} <ArrowUpRight /></a></Button>}
            {selected.delivery === 'local' && <>
              {selected.kind === 'word-layout' && <>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
                  setLayoutReview({ name: selected.name, version: selected.version, bundle: await readWordTemplate(selected) })
                })}>查看版式规则</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
                  setLayoutEditor({ name: selected.name, version: selected.version, bundle: await readWordTemplate(selected), origin: selected.origin })
                })}>编辑版式</Button>
              </>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
                const file = selected.kind === 'word-layout'
                  ? (await packWordTemplate(selected.name, await readWordTemplate(selected), selected.version, selected.origin)).archive : selected.archive
                downloadFile(file, selected.name.replace(/[<>:"/\\|?*]/g, '_') + '.zip')
              })}>Download ZIP</Button>
              <Button size="sm" variant="outline" onClick={() => { setError(''); setNameDialog({ item: selected, name: selected.name, rename: true }) }}>Rename</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setError(''); setRemove(selected) }}><Trash2 /> Delete</Button>
            </>}
          </div>
        </div>}
      </aside>
    </div>
    <footer className="border-t bg-workbench-explorer px-4 py-2 font-mono text-[11px] text-workbench-muted">My templates are stored in this browser</footer>
    {database && sourceProject && <SaveTemplateDialog database={database} project={sourceProject} onClose={() => setSourceProject(undefined)}
      onSave={template => {
        setSourceProject(undefined)
        addToCatalog(template)
      }} />}
    {database && (layoutBuilder || layoutEditor || candidateSource?.kind === 'word') && <WordTemplateBuilder database={database} previous={layoutEditor}
      official={releaseCandidate && candidateSource?.kind === 'word' ? { origin: releaseCandidate.parent, file: releaseCandidate.file, standard: releaseCandidate.standard, extraFiles: releaseCandidate.extraFiles, parentAttachments: releaseCandidate.parentAttachments, candidateSources: releaseCandidate.candidateSources,
        publish: (layout, original, previewSha256, assets) => {
        if (!layout.origin) throw new Error('缺少候选官方原件。')
        return publish({ ...layout.origin, kind: 'word', layout, sourceName: original.name,
          ...(assets && { attachments: assets.attachments, attachmentFiles: assets.files }),
          ...(supportsSwitchRelease(layout.origin.id) && /\.docx?$/i.test(original.name) && { original }),
          sourceUrl: releaseCandidate.entry.sourceUrl ?? '', publishedAt: new Date().toISOString(), previewSha256 })
      } } : officialWord}
      close={() => { setLayoutBuilder(false); setLayoutEditor(undefined); setReleaseCandidate(undefined); setOfficialWord(undefined) }}
      onSave={template => { setLayoutBuilder(false); setLayoutEditor(undefined); setOfficialWord(undefined); addToCatalog(template); setMessage('Word 版式已保存。') }} />}
    {restore && <Dialog open onOpenChange={open => { if (!open && !busy) setRestore(undefined) }}>
      <DialogContent>
        <DialogTitle>导入官方模板版本包</DialogTitle>
        <DialogDescription>包内容校验通过。请确认版本包来自你信任的浏览器。启用后，新项目将默认使用此版本。</DialogDescription>
        <p className="text-sm">版本 {restore.release.version} · 原浏览器验收记录</p>
        <p className="break-all font-mono text-xs">验收 PDF SHA-256 {restore.release.previewSha256}</p>
        <DialogFooter><Button disabled={busy} onClick={() => void run(async () => {
          await activateRelease(restore.release, restore.parent)
          setRestore(undefined)
        })}>导入并启用</Button></DialogFooter>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>}
    {releaseCandidate && candidateSource?.kind === 'word-import' && <OfficialSuepCandidate
      parent={releaseCandidate.parent} officialFile={releaseCandidate.file} sourceUrl={candidateSource.sourceUrl}
      publish={publish} close={() => setReleaseCandidate(undefined)} />}
    {releaseCandidate?.entry.delivery === 'archive' && <OfficialZipCandidate entry={releaseCandidate.entry}
      parent={releaseCandidate.parent} officialFile={releaseCandidate.file} publish={publish} close={() => setReleaseCandidate(undefined)} />}
    {pendingPublication && releaseCandidate && <AlertDialog open onOpenChange={open => { if (!open && !busy) setPendingPublication(undefined) }}>
      <AlertDialogContent>
        <AlertDialogTitle>确认发布模板版本</AlertDialogTitle>
        <AlertDialogDescription>{releaseCandidate.entry.name} · {pendingPublication.version}。新项目将默认使用此版本。</AlertDialogDescription>
        <p className="break-all font-mono text-xs">原件 SHA-256 {pendingPublication.sha256}</p>
        {switchTargetForRelease(pendingPublication) && <p role={busy ? 'status' : undefined} className="text-sm">
          {busy ? '正在用独立稿编译并验收双向定位…' : '确认后将编译独立稿并核对双向定位，通过后开放项目内切换。'}
        </p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>返回候选预览</AlertDialogCancel>
          <Button disabled={busy} onClick={() => void run(async () => {
            await activateRelease(pendingPublication, releaseCandidate.parent)
            setPendingPublication(undefined)
            setReleaseCandidate(undefined)
          })}>确认发布</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
    {layoutReview && <Dialog open onOpenChange={open => { if (!open) setLayoutReview(undefined) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>版式规则</DialogTitle>
        <DialogDescription>{layoutReview.name} · {layoutReview.version}</DialogDescription>
        <WordLayoutReview layout={layoutReview.bundle.layout} />
      </DialogContent>
    </Dialog>}
    {nameDialog && <Dialog open onOpenChange={open => { if (!open && !busy) setNameDialog(undefined) }}>
      <DialogContent showCloseButton={!busy}>
        <DialogTitle>{nameDialog.rename ? 'Rename template' : 'Create project from template'}</DialogTitle>
        <DialogDescription>{dialogItem?.name}</DialogDescription>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); submitName() }}>
          <label className="block space-y-1 text-sm">{nameDialog.rename ? 'Template name' : 'Project name'}
            <Input autoFocus maxLength={120} value={nameDialog.name} onChange={event => {
              const name = event.target.value
              setNameDialog(current => current && { ...current, name })
            }} /></label>
          {nameDialog.officialFile && dialogItem?.delivery === 'archive' && <p className="text-sm">
            已校验官方 ZIP · {dialogItem.template.version} · {nameDialog.officialFile.name}
          </p>}
          {dialogItem?.delivery === 'archive' && !nameDialog.release && !nameDialog.officialFile && <label className="block space-y-1 text-sm">Publisher template ZIP
            <Input type="file" accept=".zip" onChange={event => setPublisherFile(event.target.files?.[0])} /></label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button disabled={busy || !nameDialog.name.trim() || (dialogItem?.delivery === 'archive' && !publisherFile && !nameDialog.release && !nameDialog.officialFile)}>{nameDialog.rename ? 'Save name' : 'Create project'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>}
    <AlertDialog open={Boolean(remove)} onOpenChange={open => { if (!open && !busy) setRemove(undefined) }}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete local template?</AlertDialogTitle>
        <AlertDialogDescription>Delete “{remove?.name}” from this browser’s template library. Existing projects keep their own files.</AlertDialogDescription>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => {
            if (database && remove) void run(async () => {
              await updateLocalTemplate(database, remove.id)
              setLocal(current => current.filter(item => item.id !== remove.id))
              setRemove(undefined)
              setMessage('Template deleted.')
            })
          }}>Delete template</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {wordImport && <WordImportDialog initialProfile={wordImport.profile} templateOrigin={wordImport.origin} officialArchive={wordImport.archive} manual={wordImport.manual} close={() => setWordImport(undefined)}
      openProject={openProject} />}
    {savedLayout && <WordImportDialog initialProfile="article" savedLayout={savedLayout}
      close={() => setSavedLayout(undefined)} openProject={openProject} />}
  </main>
}
