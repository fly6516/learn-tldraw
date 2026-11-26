'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { prepareSuepBundle, restoreSuepBundle } from '@/lib/project/suep-bundle-client'
import type { SuepBundlePin, SuepBundleReceipt } from '@/lib/project/suep-undergraduate-source'

export function useSuepAttachments(pin?: SuepBundlePin, published?: Blob, manual = false) {
  const [manualUpload, setManualUpload] = useState<{ key: string; file: File }>()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; upload?: File; attempt: number;
    receipt?: SuepBundleReceipt; error?: string }>()
  const version = pin?.version
  const sha256 = pin?.sha256
  const id = pin?.id
  const key = version + '/' + sha256
  const upload = manualUpload?.key === key ? manualUpload?.file : undefined
  const current = result?.key === key && result.upload === upload && result.attempt === attempt ? result : undefined

  useEffect(() => {
    if (!version || !sha256 || !id || manual && !upload && !attempt) return
    const controller = new AbortController()
    const request = { key, upload, attempt }
    const pin = { id, version, sha256 }
    const load = upload ? prepareSuepBundle(pin, controller.signal, upload) : restoreSuepBundle(pin, controller.signal, published)
    void load
      .then(receipt => { if (!controller.signal.aborted) setResult({ ...request, receipt }) })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setResult({ ...request, error: cause instanceof Error ? cause.message : '无法读取上电官方附件。' })
      })
    return () => controller.abort()
  }, [attempt, id, key, manual, published, sha256, upload, version])

  return { ...current, version, upload, setUpload: (file?: File) => setManualUpload(file && { key, file }), retry: () => setAttempt(value => value + 1),
    waiting: !!pin && !current && (!manual || !!upload || !!attempt), manual }
}

export function SuepOfficialAttachments({ state, disabled }: { state: ReturnType<typeof useSuepAttachments>; disabled?: boolean }) {
  const receipt = state.receipt
  const status = receipt?.status === 'cache' ? '已使用校验通过的本地缓存'
    : receipt?.status === 'download' ? '已从学校获取并缓存'
      : '已校验并载入上传的官方附件包'
  return <section aria-label="上电官方附件" className="space-y-2 rounded-md border p-2 text-sm">
    <p role="status">官方附件 · {state.version} · {receipt ? status : state.waiting ? '正在加载' : '待加载'}</p>
    {receipt && <p className="text-xs">封面、声明、正文示范和撰写规范均已校验。</p>}
    {state.error && <p role="alert" className="text-destructive">{state.error} 可重试或手动上传所选版本的官方 RAR。</p>}
    <details open={state.error || state.manual ? true : undefined}>
      <summary className="cursor-pointer text-xs">手动上传官方原件</summary>
      <label className="block text-xs">官方附件包 RAR
        <Input key={state.version} type="file" accept=".rar" disabled={disabled} onChange={event => state.setUpload(event.target.files?.[0])} />
      </label>
      <Button variant="outline" type="button" size="sm" disabled={disabled || state.waiting} onClick={() => {
        state.setUpload(undefined)
        state.retry()
      }}>重新自动获取</Button>
    </details>
  </section>
}
