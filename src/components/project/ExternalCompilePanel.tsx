'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { externalCompileCommand, missingCompilerFile, type CompileCompatibility, type ExternalEngine } from '@/lib/project/compile-compatibility'

export function ExternalCompilePanel({ main, compatibility, error, checksum, downloadUrl, busy, ready, onPrepare, onAttach }: {
  main: string; compatibility: CompileCompatibility; error: string; checksum?: string; downloadUrl?: string; busy: boolean; ready: boolean
  onPrepare: () => Promise<void>; onAttach: (pdf: File, engine: ExternalEngine) => void
}) {
  const [choice, setChoice] = useState<ExternalEngine>()
  const [input, setInput] = useState<{ checksum: string; file: File }>()
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [preparing, setPreparing] = useState(false)
  const selected = input?.checksum === checksum ? input?.file : undefined
  const engine = choice ?? compatibility.engine ?? 'xelatex'
  const directory = main.includes('/') ? main.slice(0, main.lastIndexOf('/')) : 'the extracted ZIP root'
  const missingFile = missingCompilerFile(error)

  return <details className="space-y-2 rounded border p-2 text-sm">
    <summary className="cursor-pointer font-medium">External compilation</summary>
    {compatibility.engine && <p>Template engine hint <strong>{compatibility.engine}</strong></p>}
    {compatibility.bibliography && <p>Bibliography hint <strong>{compatibility.bibliography === 'biber' ? 'Biber' : 'BibTeX'}</strong></p>}
    {missingFile && <p className="break-words text-amber-800">The built-in compiler could not find <code>{missingFile}</code>. Check the selected files and the TeX installation used for compilation.</p>}
    <label className="flex flex-wrap items-center gap-2">External engine <select value={engine} className="rounded border px-2 py-1"
      onChange={event => { setChoice(event.target.value as ExternalEngine); setConfirmed(false) }}>
      <option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option>
    </select></label>
    <p className="break-all">Extract the final ZIP and build from <strong>{directory}</strong>. Replace <code>MAIN.tex</code> with <code>{main.split('/').at(-1)}</code>.</p>
    <p><code className="break-words">{externalCompileCommand(engine)}</code></p>
    {compatibility.bibliography === 'biber' && <p>Install Biber alongside biblatex in your TeX distribution. Latexmk runs the bibliography step when the template requests it.</p>}
    {compatibility.nestedStyles && <div className="space-y-1">
      <p>Bibliography styles are in subfolders. Set the recursive BibTeX search path before building.</p>
      <p>PowerShell <code className="break-all">{'$env:BSTINPUTS = "$($PWD.Path)//;"'}</code></p>
      <p>POSIX shell <code className="break-all">{'export BSTINPUTS="$PWD//:"'}</code></p>
    </div>}
    {compatibility.eps && engine === 'pdflatex' && <div className="space-y-1">
      <p>For each EPS figure used by the template, prepare its PDF conversion next to the original before building. Replace <code>FIGURE</code> with the file stem.</p>
      <code className="break-all">epstopdf --outfile=FIGURE-eps-converted-to.pdf FIGURE.eps</code>
    </div>}
    {checksum && downloadUrl ? <>
      <Button asChild size="sm" variant="outline"><a href={downloadUrl} download={`${main.split('/').at(-1)?.replace(/\.tex$/i, '') || 'project'}-external-source.zip`}>Download external build ZIP</a></Button>
      <p className="break-all text-xs">ZIP SHA-256 <code>{checksum}</code></p>
      <label className="block space-y-1">Compiled PDF <Input key={checksum} type="file" accept="application/pdf,.pdf" onChange={event => {
        const file = event.target.files?.[0]
        setInput(file ? { checksum, file } : undefined)
        setConfirmed(false)
        setMessage('')
      }} /></label>
      <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={Boolean(selected && confirmed)}
        disabled={!selected} onChange={event => setConfirmed(event.target.checked)} /> I compiled this PDF from the downloaded ZIP shown above.</label>
      <Button type="button" size="sm" disabled={busy || !selected || !confirmed} onClick={async () => {
        if (!selected || !confirmed) return
        try {
          if (selected.size > 64 * 1024 * 1024 || await selected.slice(0, 5).text() !== '%PDF-') throw new Error()
          onAttach(selected, engine)
        } catch { setMessage('Select a PDF file of at most 64 MB.') }
      }}>Attach external PDF</Button>
    </> : <Button type="button" size="sm" variant="outline" disabled={!ready || busy || preparing} onClick={async () => {
      setPreparing(true)
      setMessage('')
      try { await onPrepare() } catch { setMessage('Could not prepare the external build ZIP.') } finally { setPreparing(false) }
    }}>{preparing ? 'Preparing external ZIP…' : 'Prepare external build ZIP'}</Button>}
    {message && <p role="alert" className="text-red-800">{message}</p>}
  </details>
}
