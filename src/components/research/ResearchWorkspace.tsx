'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { ProjectFileSystemProvider, useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import {
  exportResearchToLatexWithFileSystem, exportResearchToMarkdown, exportResearchToPdf, generateProjectSource,
} from '@/lib/export/export-actions'
import { updateFileContent } from '@/lib/project/file-system'
import {
  activeResearchPage, emptyCanvas, emptyPage, type ResearchCanvas, type ResearchNode, type ResearchPage,
} from '@/lib/project/research-graph'
import { LatexImportDialog } from './LatexImportDialog'
import { LatexPreviewPanel } from './LatexPreviewPanel'
import { ProjectBackupDialog } from './ProjectBackupDialog'
import { ResearchGraphEditor } from './ResearchGraphEditor'

function Workspace({ sample }: { sample?: ResearchCanvas }) {
  const { fileSystem, initializeProject, setFileSystem } = useProjectFileSystem()
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [canvasVersion, setCanvasVersion] = useState(0)
  const initialCanvas = sample ?? emptyCanvas
  const canvas = fileSystem?.canvas ?? initialCanvas
  const page = activeResearchPage(canvas)

  useEffect(() => {
    if (!fileSystem) initializeProject(undefined, sample ? 'Sample paper' : 'My Research Project')
  }, [fileSystem, initializeProject, sample])

  useEffect(() => {
    if (!fileSystem || fileSystem.metadata.sourceMode === 'archive') return
    const main = fileSystem.files.get('main.tex')
    if (!main || !('content' in main)) return
    const source = generateProjectSource(page, fileSystem)
    if (main.content === source) return
    setFileSystem(current => current === fileSystem ? updateFileContent(fileSystem, 'main.tex', source) : current)
  }, [fileSystem, page, setFileSystem])

  function updateCanvas(update: (current: ResearchCanvas) => ResearchCanvas) {
    setFileSystem(project => {
      if (!project) return project
      const previous = project.canvas ?? initialCanvas
      const next = update(previous)
      return next === previous ? project : { ...project, canvas: next }
    })
  }

  function updatePage(update: (current: ResearchPage) => ResearchPage) {
    updateCanvas(current => {
      const previous = current.pages.find(item => item.id === page.id)
      if (!previous) return current
      const next = update(previous)
      return next === previous ? current : {
        ...current, pages: current.pages.map(item => item.id === page.id ? next : item),
      }
    })
  }

  function addPage() {
    const id = crypto.randomUUID()
    updateCanvas(current => ({
      activePageId: id, pages: [...current.pages, emptyPage(`Page ${current.pages.length + 1}`, id)],
    }))
  }

  function importNodes(nodes: ResearchNode[]) {
    updatePage(current => {
      const top = current.nodes.reduce((max, node) => Math.max(max, node.position.y + 340), 0)
      const order = current.nodes.reduce((max, node) => Math.max(max, node.data.order + 1), 0)
      return { ...current, nodes: [...current.nodes, ...nodes.map((node, index) => ({
        ...node, position: { ...node.position, y: node.position.y + top },
        data: { ...node.data, order: order + index },
      }))] }
    })
  }

  if (!fileSystem) return <p role="status">Opening research project…</p>

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <Link href="/" className="mr-2 font-semibold">Research Canvas</Link>
        <label className="flex items-center gap-2 text-sm">Canvas page
          <select className="max-w-48 rounded border bg-background p-2" value={page.id}
            onChange={event => {
              const activePageId = event.target.value
              updateCanvas(current => ({ ...current, activePageId }))
            }}>
            {canvas.pages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={addPage}>Add Page</Button>
        <Input aria-label="Page name" className="w-36" key={`${canvasVersion}:${page.id}`} defaultValue={page.name}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
          onBlur={event => {
            const name = event.target.value.trim() || page.name
            event.target.value = name
            if (name !== page.name) updatePage(current => ({ ...current, name }))
          }} />
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>Import LaTeX</Button>
        <Button variant="outline" size="sm" aria-pressed={showFiles} onClick={() => setShowFiles(open => !open)}>Project Files</Button>
        <Button variant="outline" size="sm" aria-pressed={showPreview} onClick={() => setShowPreview(open => !open)}>LaTeX Preview</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Export</Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => void exportResearchToLatexWithFileSystem(page, fileSystem)}>LaTeX ZIP</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportResearchToMarkdown(page)}>Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportResearchToPdf(page)}>Print PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={() => setBackupOpen(true)}>Project Backup</Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row">
        {showFiles && <div className="h-64 w-full shrink-0 overflow-auto border-r lg:h-full lg:w-80"><ProjectPanel /></div>}
        <ResearchGraphEditor key={`${canvasVersion}:${page.id}`} page={page} updatePage={updatePage}
          sample={Boolean(sample) && fileSystem.canvas === undefined} />
        {showPreview && <div className="h-64 w-full shrink-0 border-l lg:h-full lg:w-96">
          <LatexPreviewPanel page={page} onClose={() => setShowPreview(false)} />
        </div>}
      </div>
      <LatexImportDialog open={importOpen} onOpenChange={setImportOpen} onImportNodes={importNodes}
        onProjectImport={() => setShowFiles(true)} />
      {backupOpen && <ProjectBackupDialog canvas={canvas} project={fileSystem} onRestore={project => {
        setCanvasVersion(version => version + 1)
        setShowFiles(false)
        setFileSystem(project)
      }} onClose={() => setBackupOpen(false)} />}
    </main>
  )
}

export function ResearchWorkspace({ sample }: { sample?: ResearchCanvas }) {
  return (
    <ProjectFileSystemProvider storageKey={sample ? undefined : 'research-flow-v2'}>
      <Workspace sample={sample} />
    </ProjectFileSystemProvider>
  )
}
