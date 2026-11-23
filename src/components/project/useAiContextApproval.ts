'use client'

import { useEffect, useRef, useState } from 'react'
import type { AiContextReceipt } from '@/lib/project/ai-read-scope'

type Request = {
  receipt: AiContextReceipt
  purpose: string
  fingerprint: string
  valid: () => boolean
  send: (recipient: string, confirmation: NonNullable<AiContextReceipt['confirmation']>) => void
  cancel?: () => void
}

export function useAiContextApproval(active: boolean, onError: (message: string) => void) {
  const [preview, setPreview] = useState<{ request: Request; recipient: string }>()
  const [checking, setChecking] = useState(false)
  const [wasActive, setWasActive] = useState(active)
  const waiting = useRef<{ request: Request; controller: AbortController } | null>(null)
  const reviewing = useRef<Request | null>(null)
  const approved = useRef<{ recipient: string; fingerprint: string } | null>(null)
  if (wasActive !== active) {
    setWasActive(active)
    setPreview(undefined)
    setChecking(false)
  }

  useEffect(() => () => {
    approved.current = null
    waiting.current?.controller.abort()
    waiting.current = null
    reviewing.current = null
  }, [active])

  function send(request: Request, recipient: string, confirmation: NonNullable<AiContextReceipt['confirmation']>) {
    if (!request.valid()) {
      request.cancel?.()
      onError('The project or diagnostics changed. Review the current model context and try again.')
      return false
    }
    request.send(recipient, confirmation)
    return true
  }

  function start(request: Request, { force = false, example = false } = {}) {
    if (!active || waiting.current || reviewing.current) return false
    if (example) return send(request, 'Built-in example', 'local')
    const controller = new AbortController()
    waiting.current = { request, controller }
    setChecking(true)
    void fetch('/api/latex/status?check=model', { method: 'POST', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Could not check the local model configuration.')
      const { recipient, localOnly } = await response.json() as { recipient: string | null; localOnly?: boolean }
      if (controller.signal.aborted) return
      if (!recipient) throw new Error('Configure a model on the local server before sending, or use the built-in writing sample.')
      if (!force && (localOnly || approved.current?.recipient === recipient && approved.current.fingerprint === request.fingerprint)) {
        send(request, recipient, localOnly ? 'local' : 'reused')
      } else {
        reviewing.current = request
        setPreview({ request, recipient })
      }
    }).catch(cause => {
      if (controller.signal.aborted) return
      request.cancel?.()
      onError(cause instanceof Error ? cause.message : 'Could not check the local model configuration.')
    }).finally(() => {
      if (waiting.current?.controller !== controller) return
      waiting.current = null
      setChecking(false)
    })
    return true
  }

  function cancel() {
    waiting.current?.request.cancel?.()
    waiting.current?.controller.abort()
    waiting.current = null
    reviewing.current?.cancel?.()
    reviewing.current = null
    setChecking(false)
    setPreview(undefined)
  }

  function confirm() {
    if (!preview || reviewing.current !== preview.request) return
    const { request, recipient } = preview
    reviewing.current = null
    setPreview(undefined)
    if (send(request, recipient, 'approved')) approved.current = { recipient, fingerprint: request.fingerprint }
  }

  return { start, confirm, cancel, preview: active ? preview : undefined, busy: active && (checking || Boolean(preview)),
    pending: () => Boolean(waiting.current || reviewing.current), revoke: () => { approved.current = null } }
}
