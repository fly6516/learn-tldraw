'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { compileProfileSchema, defaultCompileProfile, type CompileProfile } from '@/lib/project/compile-profile'

export function CompileSettingsDialog({ main, paths, profile, onClose, onSave }: {
  main: string; paths: string[]; profile?: CompileProfile
  onClose: () => void; onSave: (main: string, profile: CompileProfile) => void
}) {
  const [entry, setEntry] = useState(main)
  const [engine, setEngine] = useState<CompileProfile['engine']>(profile?.engine ?? defaultCompileProfile.engine)
  const [bibliography, setBibliography] = useState<CompileProfile['bibliography']>(profile?.bibliography ?? 'auto')
  const usesLocalTeX = engine === 'pdflatex' || engine === 'xelatex'
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent>
      <DialogTitle>Compile settings</DialogTitle>
      <DialogDescription>This project uses the same compile settings for previews, Writing AI verification, and submission ZIPs.</DialogDescription>
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault()
        const parsed = compileProfileSchema.safeParse({ engine, bibliography: usesLocalTeX ? bibliography : 'auto' })
        if (parsed.success && paths.includes(entry)) onSave(entry, parsed.data)
      }}>
        <label className="grid gap-1 text-sm">Main file
          <select className="min-w-0 rounded border bg-background p-2" value={entry} onChange={event => setEntry(event.target.value)}>
            {paths.map(path => <option key={path}>{path}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Engine
          <select className="min-w-0 rounded border bg-background p-2" value={engine}
            onChange={event => setEngine(event.target.value as CompileProfile['engine'])}>
            <option value="tectonic">Tectonic (built in)</option>
            <option value="pdflatex">pdfLaTeX (local TeX Live)</option>
            <option value="xelatex">XeLaTeX (local TeX Live)</option>
            <option value="lualatex">LuaLaTeX (external build ZIP)</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">Bibliography backend
          <select className="min-w-0 rounded border bg-background p-2" value={usesLocalTeX ? bibliography : 'auto'}
            disabled={!usesLocalTeX} onChange={event => setBibliography(event.target.value as CompileProfile['bibliography'])}>
            <option value="auto">Detect automatically</option><option value="bibtex">BibTeX</option>
            <option value="biber">Biber</option><option value="none">Skip bibliography tool</option>
          </select>
        </label>
        {engine === 'lualatex' ? <p className="text-sm text-muted-foreground">Compile the exported ZIP in your TeX installation and attach the resulting PDF.</p>
          : engine !== 'tectonic' && <p className="text-sm text-muted-foreground">
            Use a trusted project with a local TeX Live installation. Set LATEX_SYSTEM_TEX_ENABLED=1 and restart the local server.
            On Windows you can also select a WSL distribution with LATEX_SYSTEM_TEX_WSL.
          </p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!entry}>Save compile settings</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
