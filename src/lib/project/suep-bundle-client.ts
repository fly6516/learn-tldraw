import type { SuepBundleReceipt, SuepBundlePin } from './suep-undergraduate-source'

export async function prepareSuepBundle(pin: SuepBundlePin, signal: AbortSignal, upload?: Blob): Promise<SuepBundleReceipt> {
  const query = new URLSearchParams({ version: pin.version, sha256: pin.sha256 })
  const response = await fetch('/api/templates/suep?' + query, { method: 'POST', signal, body: upload }).catch(() => {
    signal.throwIfAborted()
    throw new Error('无法连接本机工作台获取上电官方附件。')
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '无法读取上电官方附件。')
  if (result.manifest?.id !== pin.id || result.manifest.version !== pin.version || result.manifest.sha256 !== pin.sha256) {
    throw new Error('上电官方附件的来源与所选版本不一致。')
  }
  return result
}

export function bindSuepBundle(data: FormData, pin: SuepBundlePin) {
  data.set('suep-version', pin.version)
  data.set('suep-sha256', pin.sha256)
}

export async function restoreSuepBundle(pin: SuepBundlePin, signal: AbortSignal, stored?: Blob) {
  try { return await prepareSuepBundle(pin, signal) }
  catch (cause) {
    signal.throwIfAborted()
    if (!stored) throw cause
    return prepareSuepBundle(pin, signal, stored)
  }
}
