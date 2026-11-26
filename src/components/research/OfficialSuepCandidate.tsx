'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { previewTemplateSwitchRelease } from '@/lib/project/template-export-client'
import { readCandidateOrigin, type OfficialTemplateRelease, type TemplateOrigin } from '@/lib/project/template-release'

export function OfficialSuepCandidate({ parent, officialFile, sourceUrl, publish, close }: {
  parent: TemplateOrigin; officialFile?: File; sourceUrl: string; publish: (release: OfficialTemplateRelease) => Promise<void>; close: () => void
}) {
  const [file, setFile] = useState(officialFile)
  const [version, setVersion] = useState('')
  const [output, setOutput] = useState<{ release: OfficialTemplateRelease; url: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const previewUrl = output?.url
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function compile(event: FormEvent) {
    event.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setError('')
    setOutput(undefined)
    try {
      const origin = await readCandidateOrigin(parent, version, file)
      const { release, pdf } = await previewTemplateSwitchRelease({
        ...origin, kind: 'word-import', archive: file, sourceName: file.name, sourceUrl,
        publishedAt: new Date().toISOString(), previewSha256: '',
      }, AbortSignal.timeout(120_000))
      setOutput({ release: { ...release, previewSha256: release.switchAcceptance!.pdfSha256 }, url: URL.createObjectURL(pdf) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法验收候选附件。')
    } finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle>验收上电官方附件候选</DialogTitle>
      <DialogDescription>核对发布说明，用独立稿编译候选。请对照学校规范检查封面、声明和正文版式。</DialogDescription>
      <form onSubmit={compile} className="space-y-3">
        <label className="block text-sm">候选版本<Input required maxLength={48} disabled={busy} value={version}
          onChange={event => { setVersion(event.target.value); setOutput(undefined) }} /></label>
        <label className="block text-sm">候选官方 RAR
          <Input type="file" accept=".rar" required={!file} disabled={busy}
            onChange={event => { setFile(event.target.files?.[0]); setOutput(undefined) }} />
        </label>
        {file && <p className="text-sm">{file.name}</p>}
        {output && <>
          <p role="status" className="break-all text-sm">候选通过独立稿编译和双向定位。原件 SHA-256 {output.release.sha256}</p>
          <iframe title="上电候选 PDF" src={output.url} className="h-80 w-full rounded border" />
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="submit" variant="outline" disabled={!file || busy}>{busy ? '正在编译候选…' : '编译候选预览'}</Button>
          <Button type="button" disabled={!output || busy} onClick={() => { if (output) void publish(output.release) }}>发布此版本</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
