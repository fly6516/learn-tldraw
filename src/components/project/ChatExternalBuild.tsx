'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { exportExternalBuild } from '@/lib/project/submission'
import type { CompileCompatibility, ExternalEngine } from '@/lib/project/compile-compatibility'
import type { ProjectFileSystem } from '@/lib/project/types'
import { ExternalCompilePanel } from './ExternalCompilePanel'

export function ChatExternalBuild({ target, main, compatibility, ready, busy, onAttach }: {
  target?: ProjectFileSystem; main: string; compatibility: CompileCompatibility; ready: boolean; busy: boolean
  onAttach: (pdf: File, engine: ExternalEngine, zip: Blob, checksum: string) => Promise<void>
}) {
  const [prepared, setPrepared] = useState<{ target: ProjectFileSystem; zip: Blob; checksum: string; url: string }>()
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(target)
  useLayoutEffect(() => { latest.current = target }, [target])
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.url) }, [prepared])
  const build = prepared?.target === target ? prepared : undefined
  return <div className="space-y-1">
    <ExternalCompilePanel main={main} compatibility={compatibility} error="" busy={busy || attaching} stale={Boolean(prepared && !build)}
      ready={ready && Boolean(target)} checksum={build?.checksum} downloadUrl={build?.url}
      onPrepare={async () => {
        if (!target || !ready) return
        const { zip, checksum } = await exportExternalBuild(target)
        if (latest.current === target) setPrepared({ target, zip, checksum, url: URL.createObjectURL(zip) })
      }}
      onAttach={(pdf, engine) => {
        if (!build || busy || attaching || latest.current !== build.target) return
        setAttaching(true)
        setError('')
        void onAttach(pdf, engine, build.zip, build.checksum)
          .catch(cause => setError(cause instanceof Error ? cause.message : 'Could not attach the external build.'))
          .finally(() => setAttaching(false))
      }} />
    {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
  </div>
}
