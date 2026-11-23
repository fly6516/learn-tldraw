'use client'

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, FileCode2, LayoutGrid, Network, PanelLeft, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
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
  activeResearchPage, emptyCanvas, emptyPage, removeResearchPage, validResearchConnection, type ResearchCanvas, type ResearchNode, type ResearchPage,
} from '@/lib/project/research-graph'
import { LatexImportDialog } from './LatexImportDialog'
import { LatexPreviewPanel } from './LatexPreviewPanel'
import { ProjectBackupDialog } from './ProjectBackupDialog'
import { ProjectSnapshotsDialog } from './ProjectSnapshotsDialog'
import { ResearchGraphEditor } from './ResearchGraphEditor'
import { ProjectSearchDialog } from './ProjectSearchDialog'
import { researchNodeTitle, type CanvasLocation } from '@/lib/project/canvas-search'
import { recordHistory, stepCanvasHistory, type CanvasHistory } from '@/lib/project/canvas-history'
import type { OutlineHeading } from '@/lib/project/outline'
import { anchorHeading, headingKey, resolveSectionAnchor } from '@/lib/project/section-links'
import { arrangeCanvas, documentPage, dropOverviewNodes, normalizeCanvas, pageCapacity, projectOverview, repageCanvas } from '@/lib/project/canvas-overview'
import { latexBlockTitle, imageAttachment, inspectLatexBlock, type LatexBlock } from '@/lib/project/latex-blocks'
import { CanvasBibliographyContext, CanvasBlockContext } from './CanvasResource'
import { materialKind } from '@/lib/project/canvas-card-kinds'
import type { BibliographyEntry, ReferenceLocation } from '@/lib/project/references'
import { anchorLatexBlock, findSourceLinkIssues, repairSourceLink, type CanvasSourceCatalog } from '@/lib/project/canvas-source-links'
import { SourceLinksDialog } from './SourceLinksDialog'
import { readBackupHistory, restoreProjectBackup } from '@/lib/project/storage'
import type { PortableProjectHistory } from '@/lib/project/backup-history'
import type { LibraryView } from '@/lib/project/project-library'
import type { PortableWritingState } from '@/lib/project/writing-drafts'
import type { WritingReviewActions } from '@/components/project/WritingReviewPanel'
import { bindReviewTarget, resolveReviewTarget, reviewItems, reviewResource } from '@/lib/project/review-links'
import { sourceOffsetAtPosition, type SourceLocation } from '@/lib/project/latex-source'
import type { SearchSourceLink } from '@/lib/project/project-search'

type WorkspaceProps = {
  sample?: ResearchCanvas; initialProject?: () => Promise<ProjectFileSystem>; storageNamespace?: string; notice?: React.ReactNode
  projectListHref?: string; onViewChange?: (view: LibraryView) => void
  onImportCopy?: (project: ProjectFileSystem, view: LibraryView, writing?: PortableWritingState, history?: PortableProjectHistory) => Promise<void>
}
type GraphSnapshot = Pick<ResearchCanvas, 'pages' | 'crossPageEdges' | 'activePageId'>
const emptyHistory: CanvasHistory<GraphSnapshot> = { undo: [], redo: [] }
const noBlocks: LatexBlock[] = []

function Workspace({ sample, initialProject, notice, projectListHref, onViewChange, onImportCopy }: WorkspaceProps) {
  const router = useRouter()
  const { fileSystem, initializeProject, setFileSystem, storage, storageKey, acceptStoredProject } = useProjectFileSystem()
  const view = useSearchParams()?.get('view') === 'write' ? 'write' : 'canvas'
  useEffect(() => { onViewChange?.(view) }, [onViewChange, view])
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState<{ writing?: PortableWritingState }>()
  const [snapshotsOpen, setSnapshotsOpen] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [showFiles, setShowFiles] = useState(true)
  const [mobileExplorer, setMobileExplorer] = useState(false)
  const [filesTab, setFilesTab] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sourceLinksDialog, setSourceLinksDialog] = useState<{ nodeId?: string }>()
  const [nodeJump, setNodeJump] = useState<CanvasLocation>()
  const [history, setHistory] = useState(emptyHistory)
  const [pendingEdit, setPendingEdit] = useState<{ canvas: ResearchCanvas; detached: ResearchNode[]; arrangement?: ReturnType<typeof arrangeCanvas> }>()
  const [deletePageId, setDeletePageId] = useState<string>()
  const [pendingCard, setPendingCard] = useState<ResearchNode['data']>()
  const [cardPage, setCardPage] = useState('')
  const [canvasVersion, setCanvasVersion] = useState(0)
  const [sourceVersion, setSourceVersion] = useState(0)
  const [canvasActions, setCanvasActions] = useState<HTMLDivElement | null>(null)
  const [writingActions, setWritingActions] = useState<HTMLDivElement | null>(null)
  const [archiveOutline, setArchiveOutline] = useState<CanvasSourceCatalog>()
  const writing = useRef<SourceWorkspaceHandle>(null)
  const initialCanvas = useMemo(() => normalizeCanvas(sample ?? emptyCanvas), [sample])
  const rawCanvas = fileSystem?.canvas ?? initialCanvas
  const canvas = useMemo(() => normalizeCanvas(rawCanvas), [rawCanvas])
  const page = activeResearchPage(canvas)
  const pageToDelete = canvas.pages.find(item => item.id === deletePageId)
  const liveCanvas = useRef(canvas)
  useLayoutEffect(() => { liveCanvas.current = canvas }, [canvas])
  const overview = canvas.display === 'overview'
  const whole = useMemo(() => projectOverview(canvas), [canvas])
  const editorPage = overview ? whole.page : page
  const paper = useMemo(() => documentPage(canvas), [canvas])
  const locations = useMemo(() => new Map(canvas.pages.flatMap(page => page.nodes.map(node => [node.id, { pageId: page.id, nodeId: node.id }] as const))), [canvas.pages])
  const allNodes = useMemo(() => new Map(canvas.pages.flatMap(page => page.nodes.map(node => [node.id, node] as const))), [canvas.pages])
  const clearNodeJump = useCallback(() => setNodeJump(undefined), [])
  const generateSource = useCallback((project: ProjectFileSystem, onNode?: Parameters<typeof generateProjectSource>[2]) =>
    generateProjectSource(paper, project, onNode, true), [paper])
  const generated = useMemo(() => {
    const nodes = new Map<ResearchNodeData, number>()
    const source = fileSystem && fileSystem.metadata.sourceMode !== 'archive'
      ? generateSource(fileSystem, (node, line) => nodes.set(node, line)) : undefined
    return { source, nodes }
  }, [fileSystem, generateSource])
  const archiveProject = fileSystem?.metadata.sourceMode === 'archive' ? fileSystem.metadata.createdAt : undefined
  const archiveIndex = archiveOutline?.project === archiveProject ? archiveOutline?.index : undefined
  const projectId = fileSystem?.metadata.createdAt
  const sourceCatalog = archiveOutline?.project === projectId ? archiveOutline : undefined
  const references = sourceCatalog?.references
  const reviews = useMemo(() => reviewItems(canvas.pages, sourceCatalog), [canvas.pages, sourceCatalog])
  const reviewSources = useMemo(() => new Map(reviews.flatMap(item => item.source ? [[item.data, item.source] as const] : [])), [reviews])
  const sourceIssues = useMemo(() => sourceCatalog ? findSourceLinkIssues(canvas.pages, sourceCatalog) : [], [canvas.pages, sourceCatalog])
  const firstSourceIssue = useMemo(() => {
    const issues = new Map<string, typeof sourceIssues[number]>()
    for (const issue of sourceIssues) if (!issues.has(issue.nodeId)) issues.set(issue.nodeId, issue)
    return issues
  }, [sourceIssues])
  const bibliographyLinks = useMemo(() => {
    const byNode = new Map<ResearchNode['data'], BibliographyEntry>()
    const byKey = new Map<string, CanvasLocation>()
    for (const page of canvas.pages) for (const { id, data } of page.nodes) {
      const resource = data.resource
      if (resource?.kind !== 'bibliography' || resource.project !== projectId) continue
      if (!byKey.has(resource.key)) byKey.set(resource.key, { pageId: page.id, nodeId: id })
      const reference = references?.definitions.get(resource.key)
      if (reference) byNode.set(data, reference)
    }
    return { byNode, byKey }
  }, [canvas.pages, projectId, references])
  const blocks = sourceCatalog?.blocks ?? noBlocks
  const blockLinks = useMemo(() => {
    const byNode = new Map<ResearchNode['data'], LatexBlock>()
    const byBlock = new Map<LatexBlock, CanvasLocation>()
    for (const page of canvas.pages) for (const node of page.nodes) {
      if (!projectId || !node.data.figureAnchor) continue
      const resolution = inspectLatexBlock(blocks, projectId, node.data.figureAnchor, sourceCatalog?.index.labelLocations)
      if (resolution.status !== 'linked') continue
      const block = resolution.location
      byNode.set(node.data, block)
      if (!byBlock.has(block) && !reviewResource(node.data)) byBlock.set(block, { pageId: page.id, nodeId: node.id })
    }
    return { byNode, byBlock }
  }, [canvas.pages, blocks, projectId, sourceCatalog])
  const sectionLinks = useMemo(() => {
    const byNode = new Map<ResearchNodeData, OutlineHeading>()
    const byHeading = new Map<string, CanvasLocation>()
    if (archiveProject && archiveIndex) {
      for (const page of canvas.pages) {
        for (const node of page.nodes) {
          const heading = resolveSectionAnchor(archiveIndex, archiveProject, node.data.sourceAnchor)
          if (!heading) continue
          byNode.set(node.data, heading)
          if (!byHeading.has(headingKey(heading)) && !reviewResource(node.data)) byHeading.set(headingKey(heading), { pageId: page.id, nodeId: node.id })
        }
      }
    }
    return { byNode, byHeading }
  }, [archiveIndex, archiveProject, canvas.pages])
  const generatedLinks = useMemo(() => {
    const byLine = new Map<number, CanvasLocation>()
    for (const item of canvas.pages) for (const node of item.nodes) {
      const line = generated.nodes.get(node.data)
      if (line !== undefined) byLine.set(line, { pageId: item.id, nodeId: node.id })
    }
    return byLine
  }, [generated.nodes, canvas.pages])

  const projectSearchLinks = useMemo(() => {
    if (!searchOpen) return []
    const links: SearchSourceLink[] = []
    for (const page of canvas.pages) for (const node of page.nodes) {
      let source: SourceLocation | undefined = sectionLinks.byNode.get(node.data) ?? blockLinks.byNode.get(node.data)
        ?? bibliographyLinks.byNode.get(node.data) ?? reviewSources.get(node.data)
      const line = generated.nodes.get(node.data)
      if (!source && generated.source && line !== undefined) {
        const start = sourceOffsetAtPosition(generated.source, { lineNumber: line, column: 1 })
        const end = start + (generated.source.slice(start).match(/^[^\r\n]*/)?.[0].length ?? 0)
        source = { path: 'main.tex', start, end, line }
      }
      if (source) links.push({ pageId: page.id, nodeId: node.id, pageName: page.name, title: researchNodeTitle(node.data), source })
    }
    return links
  }, [searchOpen, canvas.pages, sectionLinks, blockLinks, bibliographyLinks, reviewSources, generated])

  useEffect(() => {
    if (fileSystem) return
    if (!initialProject) {
      initializeProject(undefined, sample ? 'Sample paper' : 'My Research Project')
      return
    }
    let active = true
    void initialProject().then(project => {
      if (active) setFileSystem(current => current ?? project)
    }).catch(() => {
      if (active) setLoadError(true)
    })
    return () => { active = false }
  }, [fileSystem, initialProject, initializeProject, sample, setFileSystem])

  useEffect(() => {
    if (!fileSystem || generated.source === undefined) return
    const main = fileSystem.files.get('main.tex')
    if (!main || !('content' in main)) return
    const source = generated.source
    if (main.content === source) return
    setFileSystem(current => current === fileSystem ? updateFileContent(fileSystem, 'main.tex', source) : current)
  }, [fileSystem, generated.source, setFileSystem])

  async function leaveForList(href: string) {
    if (await writing.current?.prepareProjectSwitch() === false) return
    router.push(href)
  }

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
      const previous = project.canvas ? normalizeCanvas(project.canvas) : initialCanvas
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

  function applyGraph(next: GraphSnapshot, fromHistory = false) {
    const apply = (current: ResearchCanvas) => {
      const viewports = new Map(current.pages.map(page => [page.id, page.viewport]))
      const activePageId = fromHistory && next.pages.some(page => page.id === current.activePageId) ? current.activePageId : next.activePageId
      return { ...current, activePageId, crossPageEdges: next.crossPageEdges,
        pages: next.pages.map(page => ({ ...page, viewport: viewports.get(page.id) ?? page.viewport })) }
    }
    liveCanvas.current = apply(liveCanvas.current)
    updateCanvas(apply)
  }

  function editGraph(update: (current: ResearchCanvas) => ResearchCanvas, group?: string) {
    const current = liveCanvas.current
    let next = update(current)
    if (next === current) return
    const previous = new Set(current.pages.flatMap(page => page.nodes.map(node => node.id)))
    let order = current.pages.flatMap(page => page.nodes).reduce((last, node) => Math.max(last, node.data.order + 1), 0)
    next = { ...next, pages: next.pages.map(page => ({ ...page, nodes: page.nodes.map(node => previous.has(node.id)
      ? node : { ...node, data: { ...node.data, order: order++ } }) })) }
    setHistory(value => recordHistory(value, current, group))
    applyGraph(next)
  }

  function editPage(update: (current: ResearchPage) => ResearchPage, group?: string, pageId = page.id) {
    editGraph(current => {
      const before = current.pages.find(page => page.id === pageId)
      if (!before) return current
      const next = update(before)
      if (next === before) return current
      const remaining = new Set(next.nodes.map(node => node.id))
      const removed = new Set(before.nodes.filter(node => !remaining.has(node.id)).map(node => node.id))
      return { ...current, pages: current.pages.map(page => page.id === pageId ? next : page),
        crossPageEdges: current.crossPageEdges?.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)),
      }
    }, group)
  }

  function editOverview(update: (current: ResearchPage) => ResearchPage, group?: string) {
    editGraph(current => {
      const { page: projected } = projectOverview(current)
      const edited = update(projected)
      if (edited === projected) return current
      const actual = new Map(current.pages.flatMap(page => page.nodes.map(node => [node.id, node.position] as const)))
      const nodes = edited.nodes.map(node => ({ ...node, position: actual.get(node.id) ?? node.position }))
      return repageCanvas(current, nodes, edited.edges, new Map()).canvas
    }, group)
  }

  function finishEditGroup() {
    setHistory(current => current.group ? { ...current, group: undefined } : current)
  }

  function stepHistory(direction: 'undo' | 'redo') {
    const step = stepCanvasHistory(history, liveCanvas.current, direction)
    if (!step) return
    setHistory(step.history)
    applyGraph(step.snapshot, true)
  }

  function addPage() {
    const id = crypto.randomUUID()
    editGraph(current => {
      const names = new Set(current.pages.map(item => item.name))
      let number = 1
      while (names.has(`Page ${number}`)) number++
      return { ...current, activePageId: id, pages: [...current.pages, emptyPage(`Page ${number}`, id)] }
    })
  }

  function deletePage(id: string) {
    editGraph(current => removeResearchPage(current, id))
    if (nodeJump?.pageId === id) clearNodeJump()
    setDeletePageId(undefined)
  }

  function enterPage(pageId: string) {
    updateCanvas(current => ({ ...current, activePageId: pageId, display: 'page' }))
    setMobileExplorer(false)
  }

  function locateNode(location: CanvasLocation) {
    updateCanvas(current => current.activePageId === location.pageId ? current : { ...current, activePageId: location.pageId })
    setNodeJump(location)
    setMobileExplorer(false)
    setSearchOpen(false)
  }

  function addCard(data: ResearchNode['data'], pageId: string, reveal = true) {
    const id = crypto.randomUUID()
    editPage(current => {
      const y = current.nodes.reduce((bottom, node) => Math.max(bottom, node.position.y + 360), 50)
      return { ...current, nodes: [...current.nodes, { id, position: { x: 50, y }, data }] }
    }, undefined, pageId)
    if (reveal) locateNode({ pageId, nodeId: id })
  }

  function requestCard(data: ResearchNode['data']) {
    if (!overview) { addCard(data, page.id); return }
    setCardPage(page.id)
    setPendingCard(data)
  }

  function addMaterialCard(path: string) {
    const file = fileSystem?.files.get(path)
    const kind = materialKind(path)
    if (!kind || !file || file.type === 'directory' || (kind === 'image' && !imageAttachment(file))) return
    requestCard({ section: 'custom', customLabel: file.name, content: '', level: 1, order: 0, resource: { kind, path } })
  }

  function referenceCanvasAction(entry: BibliographyEntry) {
    if (!projectId || references?.definitions.get(entry.key) !== entry) return
    const linked = bibliographyLinks.byKey.get(entry.key)
    if (linked) return { label: 'Locate on Canvas', run: () => {
      switchView('canvas')
      locateNode(linked)
    } }
    return { label: 'Add to Canvas', run: () => {
      setCardPage(page.id)
      setPendingCard({ section: 'custom', customLabel: entry.title || entry.key, content: '', level: 1, order: 0,
        resource: { kind: 'bibliography', key: entry.key, project: projectId } })
    } }
  }

  function openReferenceLocation(location: ReferenceLocation) {
    writing.current?.locate(location)
    switchView('write')
  }

  function anchorBlock(block: LatexBlock) {
    return sourceCatalog && anchorLatexBlock(sourceCatalog, block)
  }

  function addBlockCard(block: LatexBlock, pageId: string) {
    const anchor = anchorBlock(block)
    if (!anchor || blockLinks.byBlock.has(block)) return
    const parent = canvas.pages.find(page => page.id === pageId)?.nodes
      .map(node => ({ id: node.id, heading: sectionLinks.byNode.get(node.data) }))
      .filter(item => item.heading?.path === block.path && item.heading.start < block.start)
      .sort((a, b) => b.heading!.start - a.heading!.start)[0]
    addCard({ section: 'custom', customLabel: latexBlockTitle(block), content: '', level: 1, order: 0, parentId: parent?.id,
      resource: block.kind === 'figure' ? { kind: 'image', path: block.imagePath }
        : block.kind === 'table' ? { kind: 'table' } : { kind: block.kind, environment: block.environment },
      figureAnchor: anchor,
    }, pageId, false)
  }

  function dropNodes(leaderId: string, positions: ReadonlyMap<string, ResearchNode['position']>) {
    const result = dropOverviewNodes(liveCanvas.current, whole.regions, leaderId, positions)
    if (!result) return
    if (result.detached.length) setPendingEdit(result)
    else editGraph(() => result.canvas)
  }

  function remoteLinks(nodeId: string) {
    if (overview) return []
    return (canvas.crossPageEdges ?? []).flatMap(edge => {
      const target = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : undefined
      const location = target ? locations.get(target) : undefined
      if (!location) return []
      const other = allNodes.get(location.nodeId)!
      const otherPage = canvas.pages.find(page => page.id === location.pageId)!
      return [{ id: edge.id, title: `${edge.source === nodeId ? 'To' : 'From'} ${researchNodeTitle(other.data)} · ${otherPage.name}`,
        onLocate: () => locateNode(location),
        onRemove: () => editGraph(current => ({ ...current, crossPageEdges: current.crossPageEdges?.filter(item => item.id !== edge.id) })),
      }]
    })
  }

  const outlineCanvas: OutlineCanvasActions = {
    canvas,
    linkedBlock: block => blockLinks.byBlock.get(block),
    canLinkBlock: block => Boolean(anchorBlock(block)),
    onLinkBlock: addBlockCard,
    linked: heading => sectionLinks.byHeading.get(headingKey(heading))
      ?? (heading.path === 'main.tex' ? generatedLinks.get(heading.line) : undefined),
    canLink: heading => Boolean(archiveProject && archiveIndex && anchorHeading(archiveIndex, archiveProject, heading)),
    canBindNode: (pageId, nodeId) => {
      const node = canvas.pages.find(item => item.id === pageId)?.nodes.find(item => item.id === nodeId)
      return Boolean(node && !node.data.resource && !sectionLinks.byNode.has(node.data))
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
        const data = { section: heading.appendix ? 'appendix' as const : 'custom' as const,
          content: '', customLabel: heading.title, order, level: 1, sourceAnchor: anchor }
        return { ...current, nodes: [...current.nodes, { id, position: { x: 50, y }, data }] }
      }, undefined, pageId)
    },
  }

  const review: WritingReviewActions = {
    items: reviews,
    bind: (location, pageId, role, content, target) => {
      if (!sourceCatalog || !resolveReviewTarget(sourceCatalog, target)) return false
      if (location) {
        const current = liveCanvas.current.pages.find(page => page.id === location.pageId)?.nodes.find(node => node.id === location.nodeId)
        if (!current || !reviewResource(current.data)) return false
        editPage(page => ({ ...page, nodes: page.nodes.map(node => node.id === location.nodeId
          ? { ...node, data: bindReviewTarget(node.data, target) } : node) }), undefined, location.pageId)
      } else {
        if (!liveCanvas.current.pages.some(page => page.id === pageId)) return false
        addCard(bindReviewTarget({ section: 'custom', content, level: 1, order: 0,
          resource: { kind: 'research', role, status: 'open' } }, target), pageId, false)
      }
      return true
    },
    status: (location, status) => editPage(page => {
      const node = page.nodes.find(node => node.id === location.nodeId)
      const resource = node && reviewResource(node.data)
      if (!node || !resource || (resource.status ?? 'open') === status) return page
      return { ...page, nodes: page.nodes.map(item => item !== node ? item
        : { ...item, data: { ...item.data, resource: { ...resource, status } } }) }
    }, undefined, location.pageId),
    locateCanvas: location => {
      switchView('canvas')
      locateNode(location)
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

  function resetProjectViews() {
    setCanvasVersion(version => version + 1)
    setHistory(emptyHistory)
    setSourceVersion(version => version + 1)
    setMobileExplorer(false)
    setNodeJump(undefined)
    setArchiveOutline(undefined)
    setSourceLinksDialog(undefined)
  }

  if (!fileSystem) return loadError ? <p role="alert">Could not load the initial project.</p>
    : <p role="status">Opening research project…</p>

  return (
    <main className="flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <header aria-label="Project" className="z-30 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-2 md:flex md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={projectListHref ?? "/"} aria-label={projectListHref ? "Back to projects" : "Research Canvas home"} className="rounded-md bg-indigo-100 p-2 text-indigo-700 hover:bg-indigo-200"
            onNavigate={event => {
              if (projectListHref) {
                event.preventDefault()
                void leaveForList(projectListHref)
              } else if (writing.current?.confirmLeave() === false) event.preventDefault()
            }}>
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
            <DropdownMenuItem onSelect={() => setSearchOpen(true)}>Project search</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>Import LaTeX</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void exportResearchToLatexWithFileSystem(paper, fileSystem, true)}>Export LaTeX ZIP</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportResearchToMarkdown(paper)}>Export Outline as Markdown</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportResearchToPdf(paper)}>Print Outline as PDF</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSourceLinksDialog({})}>
              Source link check{sourceIssues.length > 0 && ` (${sourceIssues.length})`}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBackupOpen({ writing: writing.current?.getDraftBackup() })}>Project Backup</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSnapshotsOpen(true)} disabled={!storage || !storageKey}>Project Snapshots</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div ref={setCanvasActions} className={view === 'canvas' ? 'order-4 ml-auto' : 'hidden'} />
        <div ref={setWritingActions} className={view === 'write' ? 'order-4 col-span-2 flex min-w-0 flex-1 items-center justify-end gap-2' : 'hidden'} />
      </header>
      {notice}
      <div className={view === 'canvas' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-muted/35 px-2 py-1.5 sm:px-3">
          <Button size="icon-sm" variant="ghost" className="hidden lg:inline-flex" aria-label="Toggle Canvas explorer"
            aria-expanded={showFiles} onClick={() => setShowFiles(open => !open)}><PanelLeft /></Button>
          <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Open Canvas explorer"
            aria-expanded={mobileExplorer} onClick={() => setMobileExplorer(open => !open)}><PanelLeft /></Button>
          <div role="group" aria-label="Canvas display" className="flex rounded-md border bg-background">
            <Button size="sm" variant={overview ? 'secondary' : 'ghost'} aria-pressed={overview} onClick={() => updateCanvas(current => ({ ...current, display: 'overview' }))}>Whole paper</Button>
            <Button size="sm" variant={overview ? 'ghost' : 'secondary'} aria-pressed={!overview} onClick={() => enterPage(page.id)}>Single page</Button>
          </div>
          <span className="hidden max-w-56 truncate px-1 text-xs text-muted-foreground sm:block">{overview ? `${canvas.pages.length} pages` : page.name}</span>
          <Button variant="ghost" size="sm" aria-label="Search project" onClick={() => setSearchOpen(true)}><Search /><span className="hidden sm:inline">Search project</span></Button>
          <Button variant="outline" size="sm" onClick={() => {
            const arrangement = arrangeCanvas(liveCanvas.current, () => crypto.randomUUID())
            setPendingEdit({ ...arrangement, arrangement })
          }} disabled={!allNodes.size}>Auto arrange</Button>
          <Button variant="ghost" size="sm" aria-pressed={showPreview} onClick={() => setShowPreview(open => !open)}>LaTeX Preview</Button>
        </div>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {view === 'canvas' && (showFiles || mobileExplorer) && <aside aria-label="Canvas explorer"
            className={`min-h-0 w-60 max-w-[90vw] shrink-0 flex-col border-r bg-background ${showFiles ? 'lg:flex' : 'lg:hidden'} ${mobileExplorer ? 'absolute inset-y-0 left-0 z-20 flex shadow-lg lg:relative lg:shadow-none' : 'hidden'}`}>
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Explorer</h2>
              <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Close Canvas explorer" onClick={() => setMobileExplorer(false)}><X /></Button>
            </div>
            <div role="group" aria-label="Explorer content" className="flex gap-1 border-b p-1">
              <Button size="sm" variant={filesTab ? 'ghost' : 'secondary'} aria-pressed={!filesTab} onClick={() => setFilesTab(false)}>Pages</Button>
              <Button size="sm" variant={filesTab ? 'secondary' : 'ghost'} aria-pressed={filesTab} onClick={() => setFilesTab(true)}>Project Files</Button>
            </div>
            {filesTab ? <div className="min-h-0 flex-1"><ProjectPanel onOpenWriting={openWriting} onAddMaterial={addMaterialCard} /></div>
              : <nav aria-label="Canvas pages" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {canvas.pages.map(item => <div key={item.id} className={`flex items-center rounded ${item.id === page.id ? 'bg-accent' : ''}`}>
                  <button type="button" aria-current={!overview && item.id === page.id ? 'page' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => enterPage(item.id)}><LayoutGrid className="size-3.5 shrink-0" /><span className="flex-1 break-words">{item.name}</span><span className="text-xs text-muted-foreground">{item.nodes.length}</span></button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete page ${item.name}`}
                    title={canvas.pages.length === 1 ? 'Canvas must keep at least one page' : `Delete ${item.name}`}
                    disabled={canvas.pages.length === 1} onClick={() => setDeletePageId(item.id)}><Trash2 /></Button>
                </div>)}
                <Button variant="ghost" size="sm" onClick={addPage}>Add Page</Button>
                {!overview && <Input aria-label="Page name" key={`${canvasVersion}:${page.id}`} defaultValue={page.name}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  onBlur={event => {
                    const name = event.target.value.trim() || page.name
                    event.target.value = name
                    if (name !== page.name) editPage(current => ({ ...current, name }))
                  }} />}
              </nav>}
          </aside>}
          <CanvasBlockContext.Provider value={blockLinks.byNode}>
          <CanvasBibliographyContext.Provider value={bibliographyLinks.byNode}>
            <ResearchGraphEditor key={`${canvasVersion}:${editorPage.id}`} page={editorPage}
              updatePage={overview ? update => updateCanvas(current => {
                const viewport = update(projectOverview(current).page).viewport
                return current.overviewViewport === viewport ? current : { ...current, overviewViewport: viewport }
              }) : updatePage} actions={canvasActions}
              overview={overview ? { regions: whole.regions, enterPage, drop: dropNodes, fitOnOpen: !canvas.overviewViewport,
                addNode: requestCard,
              } : undefined}
              editPage={overview ? editOverview : editPage} onFinishEdit={finishEditGroup} onHistory={stepHistory}
              canUndo={history.undo.length > 0} canRedo={history.redo.length > 0}
              jumpTo={(overview || nodeJump?.pageId === page.id) ? nodeJump?.nodeId : undefined} onJumpHandled={clearNodeJump}
              validateConnection={(source, target) => validResearchConnection(whole.page, source, target)}
              canParent={(nodeId, parentId) => locations.get(nodeId)?.pageId === locations.get(parentId)?.pageId}
              remoteLinks={remoteLinks}
              referenceLocations={data => data.resource?.kind === 'bibliography' && bibliographyLinks.byNode.has(data)
                ? references?.uses.get(data.resource.key) ?? [] : []}
              onOpenReference={openReferenceLocation}
              onRepairSource={nodeId => firstSourceIssue.has(nodeId) ? () => setSourceLinksDialog({ nodeId }) : undefined}
              sourceStatus={node => {
                if (generated.nodes.has(node) || sectionLinks.byNode.has(node) || blockLinks.byNode.has(node)
                  || bibliographyLinks.byNode.has(node) || reviewSources.has(node)) return 'available'
                if (archiveOutline && (node.sourceAnchor || node.figureAnchor || node.selectionAnchor || node.resource?.kind === 'bibliography')) return 'unavailable'
              }} onOpenSource={node => {
                const location = sectionLinks.byNode.get(node) ?? blockLinks.byNode.get(node) ?? bibliographyLinks.byNode.get(node) ?? reviewSources.get(node)
                if (location) writing.current?.locate(location)
                else if (generated.nodes.has(node)) writing.current?.openGeneratedNode(node)
                else return
                switchView('write')
              }} onUnlinkSource={nodeId => (overview ? editOverview : editPage)(current => ({
                ...current, nodes: current.nodes.map(node => node.id === nodeId
                  ? { ...node, data: { ...node.data, sourceAnchor: undefined, figureAnchor: undefined, selectionAnchor: undefined,
                    resource: node.data.resource?.kind === 'image' ? { kind: 'image', path: blockLinks.byNode.get(node.data)?.imagePath ?? node.data.resource.path } : node.data.resource,
                  } } : node),
              }))} sample={view === 'canvas' && !overview && Boolean(sample) && fileSystem.canvas === undefined} />
          </CanvasBibliographyContext.Provider>
          </CanvasBlockContext.Provider>
          {showPreview && <div className="absolute inset-y-0 right-0 z-20 w-full shrink-0 border-l bg-background sm:w-96 xl:relative">
            <LatexPreviewPanel page={paper} onClose={() => setShowPreview(false)} />
          </div>}
        </div>
      </div>
      <div className={view === 'write' ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
        <SourceProjectWorkspace key={sourceVersion} ref={writing} project={fileSystem} actions={writingActions}
          active={view === 'write'} generateSource={fileSystem.metadata.sourceMode === 'archive' ? undefined : generateSource}
          onOpenCanvas={() => switchView('canvas')} outlineCanvas={outlineCanvas} onArchiveOutline={setArchiveOutline}
          referenceCanvasAction={referenceCanvasAction} review={review} />
      </div>
      {searchOpen && <ProjectSearchDialog pages={canvas.pages} catalog={sourceCatalog} blocks={blockLinks.byNode}
        bibliography={bibliographyLinks.byNode} headings={sectionLinks.byNode} links={projectSearchLinks}
        onClose={() => setSearchOpen(false)}
        onCanvas={location => { switchView('canvas'); locateNode(location) }}
        onSource={location => { setSearchOpen(false); openReferenceLocation(location) }} />}
      {sourceLinksDialog && <SourceLinksDialog canvas={canvas} catalog={sourceCatalog} issues={sourceIssues}
        initialNode={sourceLinksDialog.nodeId} onClose={() => setSourceLinksDialog(undefined)}
        onLocate={issue => {
          setSourceLinksDialog(undefined)
          switchView('canvas')
          locateNode(issue)
        }}
        onRepair={(issue, target) => {
          if (!sourceCatalog) return false
          const current = liveCanvas.current
          const repaired = repairSourceLink(current, sourceCatalog, issue, target)
          if (repaired === current) return false
          editGraph(() => repaired)
          return true
        }}
        onUndo={() => stepHistory('undo')} />}
      {pendingCard && <Dialog open onOpenChange={open => { if (!open) setPendingCard(undefined) }}>
        <DialogContent>
          <DialogTitle>Add to Canvas</DialogTitle>
          <DialogDescription>Choose a page for the new card.</DialogDescription>
          <form className="space-y-4" onSubmit={event => {
            event.preventDefault()
            if (pendingCard.resource?.kind === 'bibliography') switchView('canvas')
            addCard(pendingCard, cardPage)
            setPendingCard(undefined)
          }}>
            <label className="grid gap-1 text-sm">Canvas page
              <select className="min-w-0 rounded border bg-background p-2" value={cardPage} onChange={event => setCardPage(event.target.value)}>
                {canvas.pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
              </select>
            </label>
            <DialogFooter><Button type="submit">Add card</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>}
      {pageToDelete && <Dialog open onOpenChange={open => { if (!open) setDeletePageId(undefined) }}>
        <DialogContent>
          <DialogTitle className="break-words">Delete {pageToDelete.name}?</DialogTitle>
          <DialogDescription>
            {pageToDelete.nodes.length ? `This removes ${pageToDelete.nodes.length} ${pageToDelete.nodes.length === 1 ? 'card' : 'cards'} and their connections, including links to other pages. ` : 'This page is empty. '}
            {fileSystem?.metadata.sourceMode === 'archive' ? 'Writing source files and attachments stay in the project. '
              : 'Removed chapter cards will disappear from the generated manuscript. Project files and attachments stay in the project. '}
            Use Canvas Undo to restore the page.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePageId(undefined)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deletePage(pageToDelete.id)}>Delete page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {pendingEdit && <Dialog open onOpenChange={open => { if (!open) setPendingEdit(undefined) }}>
        <DialogContent className="max-h-[90dvh] overflow-auto">
          <DialogTitle>{pendingEdit.arrangement ? 'Auto arrange preview' : 'Move nodes between pages'}</DialogTitle>
          <DialogDescription>{pendingEdit.arrangement ? `Align cards and limit each page to ${pageCapacity} cards.` : 'Some parent section relationships span different pages after this move.'}</DialogDescription>
          {pendingEdit.arrangement && <div className="space-y-1 text-sm">
            <p>{pendingEdit.arrangement.newPages.length ? 'New pages' : 'No new pages needed.'}</p>
            {pendingEdit.arrangement.newPages.length > 0 && <ul className="max-h-32 list-disc overflow-auto pl-5">
              {pendingEdit.arrangement.newPages.map(page => <li key={page.id}>{page.name}</li>)}
            </ul>}
            {pendingEdit.arrangement.moved.length > 0 && <div><p>Cards moving to a new page</p>
              <ul className="max-h-44 list-disc overflow-auto pl-5">
                {pendingEdit.arrangement.moved.map(({ node, from, to }) => <li key={node.id}>{researchNodeTitle(node.data)} · {from} → {to}</li>)}
              </ul></div>}
          </div>}
          {pendingEdit.detached.length > 0 && <div className="rounded bg-amber-50 p-2 text-sm text-amber-900">
            <p>Parent section links that will be removed</p>
            <ul className="max-h-32 list-disc overflow-auto pl-5">{pendingEdit.detached.map(node => <li key={node.id}>{researchNodeTitle(node.data)}</li>)}</ul>
          </div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingEdit(undefined)}>Cancel</Button>
            <Button onClick={() => { editGraph(() => pendingEdit.canvas); setPendingEdit(undefined) }}>
              {pendingEdit.arrangement ? 'Apply arrangement' : 'Move nodes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      <LatexImportDialog open={importOpen} onOpenChange={setImportOpen} onImportNodes={importNodes}
        onProjectImport={async project => {
          if (onImportCopy) {
            if (await writing.current?.prepareProjectSwitch() === false) return false
            await onImportCopy(project, 'write')
            return true
          }
          if (await writing.current?.prepareReplacement() === false) return false
          setSourceVersion(version => version + 1)
          setFileSystem(current => ({ ...project, canvas: current?.canvas }))
          switchView('write')
          return true
        }} />
      {backupOpen && <ProjectBackupDialog canvas={canvas} project={fileSystem} writing={backupOpen.writing}
        readHistory={storage && storageKey ? selection => readBackupHistory(storage, [storageKey, fileSystem.metadata.createdAt], selection) : undefined}
        onImportCopy={onImportCopy ? async (project, incoming, history) => {
          if (await writing.current?.prepareProjectSwitch() === false) return false
          await onImportCopy(project, incoming?.view ? 'write' : 'canvas', incoming, history)
          return true
        } : undefined}
        onRestore={async (project, incoming, history) => {
        if (!storage || !storageKey) {
          if (incoming || history) throw new Error('Local storage is required to restore drafts or project history.')
          if (await writing.current?.prepareReplacement() === false) return false
          resetProjectViews()
          setFileSystem(project)
          return true
        }
        if (!await writing.current?.confirmBackupReplacement()) return false
        await restoreProjectBackup(storage, [storageKey, fileSystem.metadata.createdAt], project, incoming, history)
        resetProjectViews()
        acceptStoredProject(project)
        return true
      }} onClose={() => setBackupOpen(undefined)} />}
      {snapshotsOpen && storage && storageKey && <ProjectSnapshotsDialog database={storage} storageKey={storageKey}
        project={{ ...fileSystem, canvas }} verifyRestore={paths => writing.current
          ? writing.current.snapshotRestoreBlock(paths) : 'Wait for Writing to finish opening before restoring a snapshot.'}
        onRestore={(project, selectedFiles) => {
          if (!selectedFiles) resetProjectViews()
          acceptStoredProject(project, selectedFiles ? fileSystem : undefined)
        }} onClose={() => setSnapshotsOpen(false)} />}
    </main>
  )
}

export function ResearchWorkspace({ storageNamespace, ...workspace }: WorkspaceProps) {
  return (
    <ProjectFileSystemProvider storageKey={storageNamespace ?? (workspace.sample ? 'research-flow-example-v1' : 'research-flow-v2')}>
      <Suspense fallback={<p role="status">Opening research project…</p>}>
        <Workspace {...workspace} />
      </Suspense>
    </ProjectFileSystemProvider>
  )
}
