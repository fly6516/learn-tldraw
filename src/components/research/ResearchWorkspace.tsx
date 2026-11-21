'use client'

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronDown, FileCode2, LayoutGrid, Network, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { OutlineCanvasActions } from '@/components/project/OutlinePanel'
import { SourceProjectWorkspace, type SourceWorkspaceHandle } from '@/components/project/SourceProjectWorkspace'
import type { ProjectFileSystem, ResearchNodeData } from '@/lib/project/types'
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
import { CanvasSearchDialog } from './CanvasSearchDialog'
import type { CanvasLocation } from '@/lib/project/canvas-search'
import { emptyCanvasHistory, recordCanvasEdit, stepCanvasHistory, type CanvasHistory, type CanvasSnapshot } from '@/lib/project/canvas-history'
import type { OutlineHeading } from '@/lib/project/outline'
import { anchorHeading, headingKey, indexOutline, resolveSectionAnchor } from '@/lib/project/section-links'

function Workspace({ sample }: { sample?: ResearchCanvas }) {
  const { fileSystem, initializeProject, setFileSystem } = useProjectFileSystem()
  const view = useSearchParams().get('view') === 'write' ? 'write' : 'canvas'
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [nodeJump, setNodeJump] = useState<CanvasLocation>()
  const [histories, setHistories] = useState<Record<string, CanvasHistory>>({})
  const [canvasVersion, setCanvasVersion] = useState(0)
  const [sourceVersion, setSourceVersion] = useState(0)
  const [canvasActions, setCanvasActions] = useState<HTMLDivElement | null>(null)
  const [writingActions, setWritingActions] = useState<HTMLDivElement | null>(null)
  const [archiveOutline, setArchiveOutline] = useState<{ project: string; index: ReturnType<typeof indexOutline> }>()
  const writing = useRef<SourceWorkspaceHandle>(null)
  const initialCanvas = sample ?? emptyCanvas
  const canvas = fileSystem?.canvas ?? initialCanvas
  const page = activeResearchPage(canvas)
  const livePage = useRef(page)
  const history = histories[page.id] ?? emptyCanvasHistory
  useLayoutEffect(() => { livePage.current = page }, [page])
  const clearNodeJump = useCallback(() => setNodeJump(undefined), [])
  const generateSource = useCallback((project: ProjectFileSystem, onNode?: Parameters<typeof generateProjectSource>[2]) =>
    generateProjectSource(page, project, onNode), [page])
  const generated = useMemo(() => {
    const nodes = new Map<ResearchNodeData, number>()
    const source = fileSystem && fileSystem.metadata.sourceMode !== 'archive'
      ? generateSource(fileSystem, (node, line) => nodes.set(node, line)) : undefined
    return { source, nodes }
  }, [fileSystem, generateSource])
  const archiveProject = fileSystem?.metadata.sourceMode === 'archive' ? fileSystem.metadata.createdAt : undefined
  const archiveIndex = archiveOutline?.project === archiveProject ? archiveOutline?.index : undefined
  const sectionLinks = useMemo(() => {
    const byNode = new Map<ResearchNodeData, OutlineHeading>()
    const byHeading = new Map<string, CanvasLocation>()
    if (archiveProject && archiveIndex) {
      for (const page of canvas.pages) {
        for (const node of page.nodes) {
          const heading = resolveSectionAnchor(archiveIndex, archiveProject, node.data.sourceAnchor)
          if (!heading) continue
          byNode.set(node.data, heading)
          if (!byHeading.has(headingKey(heading))) byHeading.set(headingKey(heading), { pageId: page.id, nodeId: node.id })
        }
      }
    }
    return { byNode, byHeading }
  }, [archiveIndex, archiveProject, canvas.pages])
  const generatedLinks = useMemo(() => {
    const byLine = new Map<number, CanvasLocation>()
    for (const node of page.nodes) {
      const line = generated.nodes.get(node.data)
      if (line !== undefined) byLine.set(line, { pageId: page.id, nodeId: node.id })
    }
    return byLine
  }, [generated.nodes, page])

  useEffect(() => {
    if (!fileSystem) initializeProject(undefined, sample ? 'Sample paper' : 'My Research Project')
  }, [fileSystem, initializeProject, sample])

  useEffect(() => {
    if (!fileSystem || generated.source === undefined) return
    const main = fileSystem.files.get('main.tex')
    if (!main || !('content' in main)) return
    const source = generated.source
    if (main.content === source) return
    setFileSystem(current => current === fileSystem ? updateFileContent(fileSystem, 'main.tex', source) : current)
  }, [fileSystem, generated.source, setFileSystem])

  function switchView(next: 'canvas' | 'write') {
    const url = new URL(window.location.href)
    if ((url.searchParams.get('view') === 'write' ? 'write' : 'canvas') === next) return
    if (next === 'write') url.searchParams.set('view', 'write')
    else url.searchParams.delete('view')
    window.history.pushState(null, '', url)
  }

  function openWriting(path?: string) {
    switchView('write')
    if (path) writing.current?.openFile(path)
  }

  function updateCanvas(update: (current: ResearchCanvas) => ResearchCanvas) {
    setFileSystem(project => {
      if (!project) return project
      const previous = project.canvas ?? initialCanvas
      const next = update(previous)
      return next === previous ? project : { ...project, canvas: next }
    })
  }

  function updatePage(update: (current: ResearchPage) => ResearchPage, pageId = page.id) {
    updateCanvas(current => {
      const previous = current.pages.find(item => item.id === pageId)
      if (!previous) return current
      const next = update(previous)
      return next === previous ? current : {
        ...current, pages: current.pages.map(item => item.id === pageId ? next : item),
      }
    })
  }

  function snapshot(current: ResearchPage): CanvasSnapshot {
    return { nodes: current.nodes, edges: current.edges }
  }

  function applySnapshot(next: CanvasSnapshot, pageId = page.id) {
    if (livePage.current.id === pageId) livePage.current = { ...livePage.current, ...next }
    updatePage(current => ({ ...current, ...next }), pageId)
  }

  function editPage(update: (current: ResearchPage) => ResearchPage, group?: string, pageId = page.id) {
    const target = livePage.current.id === pageId ? livePage.current : canvas.pages.find(item => item.id === pageId)
    if (!target) return
    const previous = snapshot(target)
    const next = snapshot(update(target))
    if (previous.nodes === next.nodes && previous.edges === next.edges) return
    setHistories(current => ({ ...current, [pageId]: recordCanvasEdit(current[pageId] ?? emptyCanvasHistory, previous, next, group) }))
    applySnapshot(next, pageId)
  }

  function finishEditGroup() {
    setHistories(current => {
      const present = current[page.id]
      return present?.group ? { ...current, [page.id]: { ...present, group: undefined } } : current
    })
  }

  function stepHistory(direction: 'undo' | 'redo') {
    const step = stepCanvasHistory(history, snapshot(livePage.current), direction)
    if (!step) return
    setHistories(current => ({ ...current, [page.id]: step.history }))
    applySnapshot(step.snapshot)
  }

  function addPage() {
    const id = crypto.randomUUID()
    updateCanvas(current => ({
      activePageId: id, pages: [...current.pages, emptyPage(`Page ${current.pages.length + 1}`, id)],
    }))
  }

  function locateNode(location: CanvasLocation) {
    updateCanvas(current => current.activePageId === location.pageId ? current : { ...current, activePageId: location.pageId })
    setNodeJump(location)
    setSearchOpen(false)
  }

  const outlineCanvas: OutlineCanvasActions = {
    canvas,
    linked: heading => sectionLinks.byHeading.get(headingKey(heading))
      ?? (heading.path === 'main.tex' ? generatedLinks.get(heading.line) : undefined),
    canLink: heading => Boolean(archiveProject && archiveIndex && anchorHeading(archiveIndex, archiveProject, heading)),
    canBindNode: (pageId, nodeId) => {
      const node = canvas.pages.find(item => item.id === pageId)?.nodes.find(item => item.id === nodeId)
      return Boolean(node && !sectionLinks.byNode.has(node.data))
    },
    onLocate: location => {
      switchView('canvas')
      locateNode(location)
    },
    onLink: (heading, pageId, nodeId) => {
      if (!archiveProject || !archiveIndex || sectionLinks.byHeading.has(headingKey(heading))) return
      const anchor = anchorHeading(archiveIndex, archiveProject, heading)
      if (!anchor || (nodeId && !outlineCanvas.canBindNode(pageId, nodeId))) return
      const id = nodeId ?? crypto.randomUUID()
      editPage(current => {
        if (nodeId) return { ...current, nodes: current.nodes.map(node => node.id === nodeId
          ? { ...node, data: { ...node.data, sourceAnchor: anchor } } : node) }
        const y = current.nodes.reduce((bottom, node) => Math.max(bottom, node.position.y + 340), 50)
        const order = current.nodes.reduce((max, node) => Math.max(max, node.data.order + 1), 0)
        const data = { section: 'custom' as const, content: '', customLabel: heading.title, order, level: 1, sourceAnchor: anchor }
        return { ...current, nodes: [...current.nodes, { id, position: { x: 50, y }, data }] }
      }, undefined, pageId)
    },
  }

  function importNodes(nodes: ResearchNode[]) {
    editPage(current => {
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
    <main className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header aria-label="Project" className="z-30 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-2 md:flex md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" aria-label="Research Canvas home" className="rounded-md bg-indigo-100 p-2 text-indigo-700 hover:bg-indigo-200"
            onNavigate={event => { if (writing.current?.confirmLeave() === false) event.preventDefault() }}>
            <Network className="size-4" aria-hidden />
          </Link>
          <h1 className="min-w-0 max-w-56 truncate text-sm font-semibold md:max-w-36 xl:max-w-56" title={fileSystem.metadata.projectName}>{fileSystem.metadata.projectName}</h1>
        </div>
        <nav aria-label="Project views" className={(view === 'write' ? 'col-span-2 ' : '') + 'order-3 flex w-fit shrink-0 rounded-lg bg-muted p-0.5 md:order-none'}>
          <Button size="sm" variant={view === 'canvas' ? 'outline' : 'ghost'} aria-current={view === 'canvas' ? 'page' : undefined}
            onClick={() => switchView('canvas')}><LayoutGrid className="size-4" /> Canvas</Button>
          <Button size="sm" variant={view === 'write' ? 'outline' : 'ghost'} aria-current={view === 'write' ? 'page' : undefined}
            onClick={() => switchView('write')}><FileCode2 className="size-4" /> Writing</Button>
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="order-2 justify-self-end md:order-none">Project menu <ChevronDown /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>Import LaTeX</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void exportResearchToLatexWithFileSystem(page, fileSystem)}>Export LaTeX ZIP</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportResearchToMarkdown(page)}>Export Canvas as Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportResearchToPdf(page)}>Print Canvas as PDF</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setBackupOpen(true)}>Project Backup</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div ref={setCanvasActions} className={view === 'canvas' ? 'order-4 ml-auto' : 'hidden'} />
        <div ref={setWritingActions} className={view === 'write' ? 'order-4 col-span-2 flex min-w-0 flex-1 items-center justify-end gap-2' : 'hidden'} />
      </header>
      <div className={view === 'canvas' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
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
        <Button variant="outline" size="sm" onClick={() => setSearchOpen(true)}><Search /> Search canvas</Button>
        <Input aria-label="Page name" className="w-36" key={`${canvasVersion}:${page.id}`} defaultValue={page.name}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
          onBlur={event => {
            const name = event.target.value.trim() || page.name
            event.target.value = name
            if (name !== page.name) updatePage(current => ({ ...current, name }))
          }} />
        <Button variant="outline" size="sm" aria-pressed={showFiles} onClick={() => setShowFiles(open => !open)}>Project Files</Button>
        <Button variant="outline" size="sm" aria-pressed={showPreview} onClick={() => setShowPreview(open => !open)}>LaTeX Preview</Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto lg:flex-row">
          {showFiles && view === 'canvas' && <div className="h-64 w-full shrink-0 overflow-auto border-r lg:h-full lg:w-80">
            <ProjectPanel onOpenWriting={openWriting} />
          </div>}
          <ResearchGraphEditor key={`${canvasVersion}:${page.id}`} page={page} updatePage={updatePage} actions={canvasActions}
            editPage={editPage} onFinishEdit={finishEditGroup} onHistory={stepHistory} canUndo={history.undo.length > 0} canRedo={history.redo.length > 0}
            jumpTo={nodeJump?.pageId === page.id ? nodeJump.nodeId : undefined} onJumpHandled={clearNodeJump}
            sourceStatus={node => {
              if (generated.nodes.has(node) || sectionLinks.byNode.has(node)) return 'available'
              if (node.sourceAnchor && archiveIndex) return 'unavailable'
            }} onOpenSource={node => {
              const heading = sectionLinks.byNode.get(node)
              if (heading) writing.current?.locate(heading)
              else if (generated.nodes.has(node)) writing.current?.openGeneratedNode(node)
              else return
              switchView('write')
            }} onUnlinkSource={nodeId => editPage(current => ({
              ...current, nodes: current.nodes.map(node => node.id === nodeId
                ? { ...node, data: { ...node.data, sourceAnchor: undefined } } : node),
            }))} sample={view === 'canvas' && Boolean(sample) && fileSystem.canvas === undefined} />
          {showPreview && <div className="h-64 w-full shrink-0 border-l lg:h-full lg:w-96">
            <LatexPreviewPanel page={page} onClose={() => setShowPreview(false)} />
          </div>}
        </div>
      </div>
      <div className={view === 'write' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
        <SourceProjectWorkspace key={sourceVersion} ref={writing} project={fileSystem} actions={writingActions}
          active={view === 'write'} generateSource={fileSystem.metadata.sourceMode === 'archive' ? undefined : generateSource}
          onOpenCanvas={() => switchView('canvas')} outlineCanvas={outlineCanvas} onArchiveOutline={setArchiveOutline} />
      </div>
      {searchOpen && <CanvasSearchDialog pages={canvas.pages} onOpenChange={setSearchOpen} onLocate={locateNode} />}
      <LatexImportDialog open={importOpen} onOpenChange={setImportOpen} onImportNodes={importNodes}
        onProjectImport={async project => {
          if (await writing.current?.prepareReplacement() === false) return false
          setSourceVersion(version => version + 1)
          setFileSystem(current => ({ ...project, canvas: current?.canvas }))
          switchView('write')
          return true
        }} />
      {backupOpen && <ProjectBackupDialog canvas={canvas} project={fileSystem} onRestore={async project => {
        if (await writing.current?.prepareReplacement() === false) return false
        setCanvasVersion(version => version + 1)
        setHistories({})
        setSourceVersion(version => version + 1)
        setShowFiles(false)
        setFileSystem(project)
        return true
      }} onClose={() => setBackupOpen(false)} />}
    </main>
  )
}

export function ResearchWorkspace({ sample }: { sample?: ResearchCanvas }) {
  return (
    <ProjectFileSystemProvider storageKey={sample ? 'research-flow-example-v1' : 'research-flow-v2'}>
      <Suspense fallback={<p role="status">Opening research project…</p>}>
        <Workspace sample={sample} />
      </Suspense>
    </ProjectFileSystemProvider>
  )
}
