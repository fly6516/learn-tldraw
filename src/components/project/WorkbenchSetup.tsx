'use client'

import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { StorageStatus, WorkbenchStatus } from '@/lib/project/workbench-status'

const compilerMessages: Record<WorkbenchStatus['compiler'], [string, string]> = {
  ready: ['Sample resources ready', 'Tectonic compiled a small built-in document using cached resources. Individual templates may need additional packages.'],
  disabled: ['Compilation disabled', 'Set LATEX_COMPILE_ENABLED=1 in .env.local, restart the local server, then retry.'],
  missing: ['Tectonic executable missing', 'Install Tectonic and put it on PATH, or set TECTONIC_BIN to its absolute executable path. Restart the server.'],
  resources: ['TeX resources not ready', 'Open the writing sample and compile its PDF to populate the Tectonic cache.'],
  unavailable: ['Tectonic check failed', 'Run tectonic --version locally and check the executable, temporary directory, and font configuration before retrying.'],
}

export function WorkbenchSetup({ storage }: { storage: StorageStatus }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<WorkbenchStatus>()
  const [error, setError] = useState('')

  async function check() {
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/latex/status', { method: 'POST', signal: AbortSignal.timeout(25_000) })
      if (!response.ok) throw new Error('Open the local workbench on http://127.0.0.1 and retry the check.')
      setResult(await response.json())
    } catch (cause) {
      setResult(undefined)
      setError(cause instanceof Error ? cause.message : 'Could not check this workbench.')
    } finally { setPending(false) }
  }

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
          <p className={result.compiler === 'ready' ? undefined : 'text-amber-900'}>{compilerMessages[result.compiler][0]}</p>
          {result.compiler === 'resources' && result.cachedOnly && <p>Remove TECTONIC_ONLY_CACHED=1 and restart the server before warming the cache.</p>}
          <p className="text-muted-foreground">{compilerMessages[result.compiler][1]}</p>
        </> : pending ? 'Checking the local compiler…' : 'Compiler status unavailable'}</dd></div>
        <div><dt className="font-medium">Writing AI</dt><dd>{result?.model
          ? <>{result.model.provider} · {result.model.model} configured. The check does not contact the model.</>
          : result ? <>No model configured. Use example edits in the writing sample, or set DEEPSEEK_API_KEY in .env.local and restart to use DeepSeek.</>
            : pending ? 'Checking model configuration…' : 'Model status unavailable'}</dd></div>
      </dl>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <Button type="button" variant="outline" disabled={pending} onClick={() => void check()}>{pending ? 'Checking…' : 'Retry checks'}</Button>
    </DialogContent>
  </Dialog>
}
