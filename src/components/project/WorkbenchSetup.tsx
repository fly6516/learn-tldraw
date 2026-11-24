'use client'

import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { ResourcePreparation, StorageStatus, WorkbenchStatus } from '@/lib/project/workbench-status'

const compilerMessages: Record<WorkbenchStatus['compiler'], [string, string]> = {
  ready: ['Sample resources ready', 'Tectonic compiled a small built-in document using cached resources. Individual templates may need additional packages.'],
  disabled: ['Compilation disabled', 'Set LATEX_COMPILE_ENABLED=1 in .env.local, restart the local server, then retry.'],
  missing: ['Tectonic executable missing', 'Install Tectonic and put it on PATH, or set TECTONIC_BIN to its absolute executable path. Restart the server.'],
  resources: ['TeX resources not ready', 'Prepare TeX resources with the built-in sample before compiling a manuscript.'],
  unavailable: ['Tectonic check failed', 'Run tectonic --version locally and check the executable, temporary directory, and font configuration before retrying.'],
}

export function WorkbenchSetup({ storage }: { storage: StorageStatus }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<WorkbenchStatus>()
  const [preparation, setPreparation] = useState<ResourcePreparation>()
  const [starting, setStarting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')

  async function check() {
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/latex/status', { method: 'POST', signal: AbortSignal.timeout(25_000) })
      if (!response.ok) throw new Error('Open the local workbench on http://127.0.0.1 and retry the check.')
      const status: WorkbenchStatus = await response.json()
      setResult(status)
      setPreparation(status.preparation)
    } catch (cause) {
      setResult(undefined)
      setError(cause instanceof Error ? cause.message : 'Could not check this workbench.')
    } finally { setPending(false) }
  }

  async function prepare() {
    setError('')
    setStarting(true)
    try {
      const response = await fetch('/api/latex/status?check=prepare', { method: 'POST', signal: AbortSignal.timeout(10_000) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Could not start TeX resource preparation.')
      setPreparation(data)
      setElapsed(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start TeX resource preparation.')
    } finally { setStarting(false) }
  }

  const startedAt = preparation?.state === 'running' ? preparation.startedAt : undefined
  useEffect(() => {
    if (!open || startedAt === undefined) return
    const controller = new AbortController()
    let checking = false
    const interval = window.setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
      if (checking) return
      checking = true
      try {
        const response = await fetch('/api/latex/status?check=preparation', { method: 'POST',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
        if (!response.ok) throw new Error()
        const status: ResourcePreparation = await response.json()
        if (!controller.signal.aborted) {
          setError('')
          setPreparation(status)
        }
      } catch {
        if (!controller.signal.aborted) setError('Could not check preparation. Keep the launcher open, or retry the status check.')
      } finally { checking = false }
    }, 2000)
    return () => { window.clearInterval(interval); controller.abort() }
  }, [open, startedAt])

  return <Dialog open={open} onOpenChange={setOpen}>
    <Button type="button" size="sm" variant="outline" aria-label="Workbench setup" title="Workbench setup" onClick={() => {
      setOpen(true)
      if (!pending) void check()
    }}><Settings2 /><span className="hidden sm:inline">Setup</span></Button>
    <DialogContent className="max-h-[90dvh] overflow-auto">
      <DialogTitle>Workbench setup</DialogTitle>
      <DialogDescription>Check this browser and the local server before writing, compiling, or using a model.</DialogDescription>
      <dl className="space-y-3 text-sm" aria-label="Workbench capabilities">
        <div><dt className="font-medium">Browser storage</dt><dd>{storage === 'ready' ? 'Local project storage ready'
          : storage === 'checking' ? 'Opening local project storage…' : 'Local storage unavailable. Allow site storage for this address, then reload.'}</dd></div>
        <div><dt className="font-medium">LaTeX compiler</dt><dd>{result ? <>
          <p className={result.compiler === 'ready' ? undefined : 'text-amber-900'}>
            {preparation?.state === 'ready' ? 'Built-in sample compiled successfully' : compilerMessages[result.compiler][0]}
          </p>
          {result.compiler === 'resources' && result.cachedOnly && <p>Remove TECTONIC_ONLY_CACHED=1 and restart the server before warming the cache.</p>}
          <p className="text-muted-foreground">{preparation?.state === 'ready'
            ? 'You can compile the sample now. Other templates may download additional packages.' : compilerMessages[result.compiler][1]}</p>
        </> : pending ? 'Checking the local compiler…' : 'Compiler status unavailable'}</dd></div>
        <div><dt className="font-medium">Writing AI</dt><dd>{result?.model
          ? <>{result.model.provider} · {result.model.model} configured. The check does not contact the model.</>
          : result ? <>No model configured. Use example edits in the writing sample, or set DEEPSEEK_API_KEY in .env.local and restart to use DeepSeek.</>
            : pending ? 'Checking model configuration…' : 'Model status unavailable'}</dd></div>
      </dl>
      {startedAt !== undefined && <div className="rounded border p-3 text-sm">
        <p role="status">Preparing the built-in sample. Tectonic downloads missing resources and then checks that it can produce a PDF.</p>
        <p className="text-muted-foreground">Elapsed {elapsed} s. The first run can take several minutes. You can close Setup while it runs.</p>
      </div>}
      {preparation?.state === 'failed' && <p role="alert" className="text-sm text-red-800">{preparation.message}</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {result && !result.cachedOnly && !['disabled', 'missing'].includes(result.compiler)
          && preparation?.state !== 'ready' && <Button type="button" disabled={pending || starting || startedAt !== undefined}
            onClick={() => void prepare()}>{preparation?.state === 'failed' ? 'Retry TeX preparation' : 'Prepare TeX resources'}</Button>}
        <Button type="button" variant="outline" disabled={pending || starting} onClick={() => void check()}>{pending ? 'Checking…' : 'Retry checks'}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
