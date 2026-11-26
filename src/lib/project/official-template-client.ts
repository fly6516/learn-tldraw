import { templateDigest } from './paper-templates'

export async function requestOfficialSource(id: string, sha256?: string, asset?: 'guideline' | 'declaration' | 'blind-cover' | 'docx-bundle', signal?: AbortSignal) {
  const params = new URLSearchParams({ id })
  if (sha256) params.set('sha256', sha256)
  if (asset) params.set('asset', asset)
  const response = await fetch('/api/templates/source?' + params, { method: 'POST', signal }).catch(() => {
    signal?.throwIfAborted()
    throw new Error('无法连接本机工作台以获取官方原件。请重试或手动上传。')
  })
  if (!response.ok) {
    const result = await response.json().catch(() => undefined)
    throw new Error(result?.error ?? '无法获取官方原件，请重试或手动上传。')
  }
  return response
}

export async function fetchOfficialFile(id: string, sha256: string, asset?: 'guideline' | 'declaration' | 'blind-cover' | 'docx-bundle', signal?: AbortSignal) {
  const response = await requestOfficialSource(id, sha256, asset, signal)
  const name = /filename="([a-z\d-]+\.(?:docx?|zip|rar|pdf))"/i.exec(response.headers.get('Content-Disposition') ?? '')?.[1]
  const bytes = await response.arrayBuffer()
  if (!name || await templateDigest(bytes) !== sha256) {
    throw new Error('获取的官方原件校验失败。请重试或手动上传所选版本的原件。')
  }
  return new File([bytes], name)
}
