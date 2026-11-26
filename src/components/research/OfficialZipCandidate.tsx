'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { catalogReleaseSource, importCatalogTemplate, type CatalogTemplate } from '@/lib/project/template-catalog'
import { templateDigest } from '@/lib/project/paper-templates'
import { readCandidateOrigin, type OfficialTemplateRelease, type TemplateOrigin } from '@/lib/project/template-release'
import { previewWordProject } from '@/lib/project/word-conversion-client'
import { assessLayout } from '@/lib/project/layout-preflight'
import { ExternalCompilePanel } from '@/components/project/ExternalCompilePanel'
import { detectCompileCompatibility, type CompileCompatibility } from '@/lib/project/compile-compatibility'
import { exportExternalBuild } from '@/lib/project/submission'

type ZipRelease = Extract<OfficialTemplateRelease, { kind: 'zip' }>

export function OfficialZipCandidate({ entry, parent, officialFile, publish, close }: {
  entry: Extract<CatalogTemplate, { delivery: 'archive' }>
  parent: TemplateOrigin
  officialFile?: File
  publish: (release: OfficialTemplateRelease) => Promise<void>
  close: () => void
}) {
  const [version, setVersion] = useState('')
  const [upload, setFile] = useState<File>()
  const file = officialFile ?? upload
  const [candidate, setCandidate] = useState<{ release: ZipRelease; preview: string }>()
  const [external, setExternal] = useState<{ release: Omit<ZipRelease, 'previewSha256'>; main: string;
    compatibility: CompileCompatibility; checksum: string; downloadUrl: string; generation: number }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const url = candidate?.preview
  const externalUrl = external?.downloadUrl
  const previewGeneration = useRef(0)
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  useEffect(() => () => { if (externalUrl) URL.revokeObjectURL(externalUrl) }, [externalUrl])

  function resetPreview() {
    previewGeneration.current++
    setCandidate(undefined)
    setExternal(undefined)
  }

  async function preview(release: Omit<ZipRelease, 'previewSha256'>, pdf: Blob, generation: number) {
    const previewSha256 = await pdf.arrayBuffer().then(templateDigest)
    if (generation !== previewGeneration.current) throw new Error('候选文件或版本已变更，请重新验收。')
    setCandidate({ release: { ...release, previewSha256 }, preview: URL.createObjectURL(pdf) })
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (!file || !version.trim() || busy) return
    resetPreview()
    const generation = previewGeneration.current
    setError('')
    setBusy(true)
    try {
      if (file.size > 128 * 1024 * 1024) throw new Error('候选源包超过大小限制。')
      const origin = await readCandidateOrigin(parent, version, file)
      const source = catalogReleaseSource(entry)
      if (source?.kind === 'zip' && source.pinnedUrl && (origin.sha256 === source.baseline.sha256
        || parent.sha256 === source.baseline.sha256 && origin.sha256 === source.equivalentBranchSha256)) {
        throw new Error('这是目录初始版本的源包。请选择新版源包。')
      }
      const project = await importCatalogTemplate(entry, file, entry.name, origin)
      const main = project.metadata.mainFile ?? entry.template.mainFile
      const layout = assessLayout(project.files, main, [], [], undefined, entry.id)
      const issue = layout.find(item => item.status === 'issue')
      if (issue) throw new Error(issue.detail)
      const release = { ...origin, kind: 'zip' as const, archive: file, sourceName: file.name,
        sourceUrl: entry.sourceUrl ?? '', publishedAt: new Date().toISOString() }
      if (entry.workflow.preview === 'external') {
        const { zip, checksum } = await exportExternalBuild(project)
        const sources = new Map([...project.files].flatMap(([path, entry]) =>
          'content' in entry && typeof entry.content === 'string' && /\.(tex|cls|sty)$/i.test(path) ? [[path, entry.content] as const] : []))
        const engine = entry.workflow.compile.compileProfile.engine
        const compatibility = detectCompileCompatibility(sources, main, project.files.keys())
        setExternal({ release, main, compatibility: { ...compatibility, configuredEngine: engine === 'tectonic' ? undefined : engine },
          checksum, downloadUrl: URL.createObjectURL(zip), generation })
      } else {
        await preview(release, await previewWordProject(project), generation)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '候选校验失败。') }
    finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent showCloseButton={!busy}>
      <DialogTitle>验收模板候选</DialogTitle>
      <DialogDescription>核对发布方源包的校验值和编译结果，再发布到当前浏览器。</DialogDescription>
      <form onSubmit={event => void verify(event)} className="space-y-3 text-sm">
        <label className="block">候选版本号
          <Input value={version} disabled={busy} required maxLength={48} onChange={event => { setVersion(event.target.value); resetPreview() }} />
        </label>
        {officialFile ? <p>已校验官方 ZIP · {officialFile.name}</p> : <label className="block">候选官方 ZIP
          <Input type="file" accept=".zip" disabled={busy} required onChange={event => { setFile(event.target.files?.[0]); resetPreview() }} />
        </label>}
        <Button disabled={busy}>{entry.workflow.preview === 'external' ? '准备候选外部编译' : '编译候选'}</Button>
      </form>
      {external && !candidate && <ExternalCompilePanel key={external.checksum} main={external.main}
        compatibility={external.compatibility} ready busy={busy} error=""
        checksum={external.checksum} downloadUrl={external.downloadUrl}
        onPrepare={async () => {}} onAttach={pdf => preview(external.release, pdf.slice(0, pdf.size, 'application/pdf'), external.generation)} />}
      {candidate && <div className="space-y-2 text-sm">
        <p className="break-all">候选 SHA-256 {candidate.release.sha256}</p>
        <a href={candidate.preview} target="_blank" rel="noreferrer" className="block underline">查看候选 PDF</a>
        <Button disabled={busy} onClick={() => {
          setBusy(true)
          void publish(candidate.release).catch(cause => setError(cause instanceof Error ? cause.message : '发布失败。')).finally(() => setBusy(false))
        }}>发布新版本</Button>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent>
  </Dialog>
}
