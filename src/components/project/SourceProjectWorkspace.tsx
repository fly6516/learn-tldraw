'use client'

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import type { editor, IPosition } from 'monaco-editor'
import { BookOpen, ChevronRight, CircleAlert, Download, Ellipsis, FileCode2, FileText, Folder, Link2, ListChecks, LocateFixed, PanelLeft, Play, Save, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WordLayoutReview } from '@/components/research/WordLayoutReview'
import { LayoutPreflight } from './LayoutPreflight'
import { assessLayout, layoutPreflightProfile, type LayoutFinding } from '@/lib/project/layout-preflight'
import { assessSubmissionStage, stagesForTemplate, submissionHasFigures, type BlindEvidence, type SubmissionStage } from '@/lib/project/submission-stages'
import { njuptDepositFontFinding } from '@/lib/project/submission-fonts'
import { buildSubmissionLayout } from '@/lib/project/submission-layout'
import { wordLayoutIssuesSchema, wordLayoutSchema } from '@/lib/project/word-layout'
import { WorkbenchSetup } from './WorkbenchSetup'
import { RightToolPanel, useRightToolPanelWide } from '@/components/ui/right-tool-panel'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { ImperativePanelGroupHandle, ImperativePanelHandle } from 'react-resizable-panels'
import { useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import { getFileTree, updateFileContent, type FileTreeNode } from '@/lib/project/file-system'
import { exportSourceArchive, sourceArchiveEntry } from '@/lib/project/source-archive'
import { projectSourceDigest, type ExternalTemplatePreview } from '@/lib/project/external-template-build'
import { activeTemplateEngine, type ActiveTemplate } from '@/lib/project/active-template'
import { projectInformationKey, sourcesWithProjectInformation, type ProjectInformation } from '@/lib/project/project-information'
import { ProjectInformationDialog } from './ProjectInformationDialog'
import type { ProjectFile, ProjectFileSystem, ResearchNodeData } from '@/lib/project/types'
import { WritingAiWorkbench } from './WritingAiWorkbench'
import type { ChatAction } from '@/lib/project/writing-chat-actions'
import type { ChatCompileFeedback } from '@/lib/project/writing-chat'
import type { ChapterEditRequest } from '@/lib/project/ai-edit'
import { ReferencesPanel } from './ReferencesPanel'
import { CrossReferencesPanel } from './CrossReferencesPanel'
import { indexCrossReferences } from '@/lib/project/cross-references'
import { OutlinePanel, type OutlineCanvasActions } from './OutlinePanel'
import { buildProjectOutline } from '@/lib/project/outline'
import { indexOutline } from '@/lib/project/section-links'
import { readProjectLatexBlocks } from '@/lib/project/latex-blocks'
import type { CanvasSourceCatalog } from '@/lib/project/canvas-source-links'
import { checkCitations, collectBibliography, indexCanvasReferences, type BibliographyEntry } from '@/lib/project/references'
import { indexLatexLabels, sourceOffsetAtPosition, sourcePosition, type SourceLocation } from '@/lib/project/latex-source'
import type { SourceProblem } from './MonacoSourceEditor'
import type { CompileDiagnostic, CompileReport } from '@/lib/project/compile-diagnostics'
import { manuscriptRegions, type TemplatePreview, type LineSources } from '@/lib/project/template-source-map'
import { findPdfRegion, type SyncRegion } from '@/lib/project/source-sync'
import { applyWritingDrafts, draftConflicts, editableSource, sameDraft, type PortableWritingState, type WritingDrafts } from '@/lib/project/writing-drafts'
import { readExternalTemplatePreview, writeProject, commitFileOperation, commitWritingDrafts, commitChatAction, commitManuscriptSave, readSourceMoves, undoChatBatches } from '@/lib/project/storage'
import type { ChatVerification } from '@/lib/project/writing-chat-validation'
import type { SourceMove } from '@/lib/project/writing-ai-evidence'
import type { FileOperation } from '@/lib/project/file-refactor'
import { FileOperationDialog, type FileOperationPlan } from './FileOperationDialog'
import { ReferenceOperationDialog, type ReferenceRequest } from './ReferenceOperationDialog'
import { SubmissionDialog } from './SubmissionDialog'
import { RevisionRoundsDialog } from './RevisionRoundsDialog'
import { exportExternalBuild, prepareSubmission, type SubmissionIssue, type SubmissionBuild, type SubmissionSelection } from '@/lib/project/submission'
import type { ExternalEngine } from '@/lib/project/compile-compatibility'
import { compilerLabels, compileProfileKey, projectCompileUrl, type CompileProfile } from '@/lib/project/compile-profile'
import { CompileSettingsDialog } from './CompileSettingsDialog'
import { useWritingDrafts } from './useWritingDrafts'
import { SourceSearchPanel } from './SourceSearchPanel'
import { WritingReviewPanel, type WritingReviewActions } from './WritingReviewPanel'
import { makeSelectionAnchor, type ReviewTarget } from '@/lib/project/review-links'

const MonacoSourceEditor = dynamic(() => import('./MonacoSourceEditor').then(module => module.MonacoSourceEditor), {
  ssr: false,
  loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Loading source editor…</p>,
})
const TemplateExportDialog = dynamic(() => import('./TemplateExportDialog').then(module => module.TemplateExportDialog), { ssr: false })
const SyncedPdfPreview = dynamic(() => import('./SyncedPdfPreview').then(module => module.SyncedPdfPreview), {
  ssr: false,
  loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Loading PDF preview…</p>,
})
const WritingDraftComparison = dynamic(() => import('./MonacoSourceEditor').then(module => module.WritingDraftComparison), { ssr: false })

function Files({ nodes, selected, main, onSelect, dirty, sourcePaths, onSetMain, onMove }: {
  nodes: FileTreeNode[]
  selected: string
  main: string
  dirty: WritingDrafts
  onSelect: (path: string) => void
  sourcePaths: ReadonlySet<string>
  onSetMain: (path: string) => void
  onMove?: (path: string) => void
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map(node => (
        <li key={node.path}>
          {node.type === 'directory' ? (
            <details open className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-slate-600 hover:bg-white">
                <ChevronRight className="size-3 group-open:rotate-90" /><Folder className="size-3.5 text-indigo-500" />
                <span className="truncate">{node.name}</span>
              </summary>
              <div className="ml-3 border-l border-slate-200 pl-2">
                <Files nodes={node.children ?? []} selected={selected} main={main} dirty={dirty} onSelect={onSelect}
                  sourcePaths={sourcePaths} onSetMain={onSetMain} onMove={onMove} />
              </div>
            </details>
          ) : (
            <div className="flex min-w-0 items-center gap-0.5">
            <button type="button" title={node.path} disabled={!sourcePaths.has(node.path)} aria-current={selected === node.path ? 'true' : undefined}
              onClick={() => onSelect(node.path)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-45 ${
                selected === node.path ? 'bg-indigo-100 font-semibold text-workbench-ink' : 'text-slate-700 hover:bg-white'
              }`}>
              <FileText className="size-3.5 shrink-0" /><span className="truncate">{node.name}</span>
              {node.path === main && <span className="ml-auto rounded border border-indigo-200 bg-white px-1 text-[10px] text-workbench-accent">Main</span>}
              {Object.hasOwn(dirty, node.path) && <span aria-label="Unsaved" className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
            </button>
            {(onMove || (/\.tex$/i.test(node.path) && sourcePaths.has(node.path))) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-7 shrink-0"
                  aria-label={`Actions for ${node.name}`}><Ellipsis /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {/\.tex$/i.test(node.path) && sourcePaths.has(node.path) &&
                    <DropdownMenuItem disabled={node.path === main} onSelect={() => onSetMain(node.path)}>Set as main file</DropdownMenuItem>}
                  {onMove && <DropdownMenuItem onSelect={() => onMove(node.path)}>Rename or move…</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

type GenerateSource = (project: ProjectFileSystem, onNode?: (node: ResearchNodeData, line: number) => void) => string
type CompileSnapshot = { main: string; profile: string; files: ProjectFileSystem['files'] }
type SubmissionSnapshot = CompileSnapshot & { stage?: SubmissionStage; working?: ProjectFileSystem['files']; blindCover?: File }
type ExternalSubmission = Omit<SubmissionBuild, 'pdf' | 'warnings' | 'diagnostics'> & { checksum: string; downloadUrl: string; snapshot: SubmissionSnapshot; rendered: ProjectFileSystem }

function sameSubmissionInputs(previous: SubmissionSnapshot, current?: SubmissionSnapshot) {
  if (!current || previous.main !== current.main || previous.profile !== current.profile ||
    previous.stage !== current.stage || previous.blindCover !== current.blindCover) return false
  if (previous.stage) return Boolean(previous.working && current.working && sameSources(previous.working, current.working)
    && sameSources(previous.files, current.files))
  return previous.files.size === current.files.size
    && [...previous.files].every(([path, before]) => {
      const after = current.files.get(path)
      return after && sourceArchiveEntry(before) === sourceArchiveEntry(after)
    })
}

function submissionFilePaths(files: ProjectFileSystem['files']) {
  return [...files.values()].filter(file => file.type !== 'directory').map(file => file.path).sort()
}

function submissionDiagnostics(diagnostics: CompileDiagnostic[], files: ProjectFileSystem['files']): SubmissionIssue[] {
  return diagnostics.map(({ path, line, severity, message }) => {
    const file = files.get(path)
    const source = file && 'content' in file ? file.content : undefined
    const lines = source?.split(/\r\n|\n|\r/)
    if (!source || !lines || line > lines.length) return { severity, message }
    const start = sourceOffsetAtPosition(source, { lineNumber: line, column: 1 })
    return { severity, message, location: { path, line, start, end: start + lines[line - 1].length } }
  })
}

export interface SourceWorkspaceHandle {
  openFile: (path: string, line?: number) => void
  locate: (location: SourceLocation) => void
  openGeneratedNode: (node: ResearchNodeData) => void
  openRevisionCard: (nodeId: string) => void
  confirmLeave: () => boolean
  prepareProjectSwitch: () => Promise<boolean>
  snapshotRestoreBlock: (paths?: readonly string[]) => string | undefined
  getDraftBackup: () => PortableWritingState | undefined
  confirmBackupReplacement: () => Promise<WritingDrafts | false>
  prepareReplacement: () => Promise<boolean>
}

function sameSources(previous: ProjectFileSystem['files'], current: ProjectFileSystem['files']) {
  if (previous === current) return true
  return previous.size === current.size && [...previous].every(([path, before]) => {
    const after = current.get(path)
    if (before === after) return true
    if (!after || before.type !== after.type) return false
    if (before.type === 'directory' || after.type === 'directory') return true
    return before.content !== undefined ? before.content === after.content : before.blob === after.blob && after.content === undefined
  })
}

function editorSourcePath(model: editor.ITextModel | null) {
  const path = model?.uri.path ?? ''
  // The first segment scopes the Monaco model to this workspace.
  return path.slice(path.indexOf('/', 1) + 1)
}

export function SourceProjectWorkspace({ project, ref, active, actions, generateSource, onOpenCanvas, onRecoveryBackup, outlineCanvas, onArchiveOutline, referenceCanvasAction, review }: {
  project: ProjectFileSystem
  ref: Ref<SourceWorkspaceHandle>
  active: boolean
  actions: HTMLElement | null
  generateSource?: GenerateSource
  onOpenCanvas: () => void
  onRecoveryBackup: () => void
  outlineCanvas: OutlineCanvasActions
  onArchiveOutline: (outline: CanvasSourceCatalog | undefined) => void
  referenceCanvasAction: (entry: BibliographyEntry) => { label: string; run: () => void } | undefined
  review: WritingReviewActions
}) {
  const { setFileSystem, storage, storageKey, acceptStoredProject, flushProject } = useProjectFileSystem()
  const journal = useWritingDrafts(storage, storageKey, project.metadata.createdAt)
  const { drafts, restoredView, recordView } = journal
  const textFiles = useMemo(() => [...project.files.values()].filter(
    (file): file is ProjectFile & { content: string } => file.type !== 'directory' && typeof file.content === 'string',
  ).sort((a, b) => a.path.localeCompare(b.path)), [project.files])
  const sourcePaths = useMemo(() => new Set(textFiles.map(file => file.path)), [textFiles])
  const activeTemplate = project.metadata.activeTemplate
  const wordLayoutReview = useMemo(() => {
    if (activeTemplate?.kind === 'zju-undergraduate' || activeTemplate?.kind === 'sjtu-graduate-word') return { rules: activeTemplate.layout, issues: [] }
    if (activeTemplate) return
    const layout = textFiles.find(file => file.path === 'layout.json')
    if (!layout || !sourcePaths.has('word-layout.tex')) return
    try {
      const rules = wordLayoutSchema.parse(JSON.parse(layout.content))
      const file = textFiles.find(file => file.path === 'word-layout-issues.json')
      const issues = file ? wordLayoutIssuesSchema.safeParse(JSON.parse(file.content)).data : undefined
      return { rules, issues: issues ?? [] }
    } catch { return undefined }
  }, [activeTemplate, sourcePaths, textFiles])
  const texFiles = textFiles.filter(file => /\.tex$/i.test(file.path))
  const main = texFiles.find(file => file.path === project.metadata.mainFile)?.path
    ?? (generateSource && sourcePaths.has('main.tex') ? 'main.tex' : texFiles[0]?.path ?? '')
  const profile = project.metadata.compileProfile
  const information = project.metadata.information
  const compileKey = (template?: ActiveTemplate) =>
    JSON.stringify([compileProfileKey(profile), template?.selectionId ?? '', projectInformationKey(information)])
  const profileKey = compileKey(activeTemplate)
  const originalTemplateName = project.metadata.templateOrigin
    ? project.metadata.templateOrigin.id + ' · ' + project.metadata.templateOrigin.version : '原项目版式'
  const [informationOpen, setInformationOpen] = useState(false)
  const [compileSettingsOpen, setCompileSettingsOpen] = useState(false)
  const [wordReviewOpen, setWordReviewOpen] = useState(false)
  const [selection, setSelected] = useState<string>()
  const wanted = selection ?? restoredView?.path ?? main
  const selected = sourcePaths.has(wanted) ? wanted : main
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const [templateExport, setTemplateExport] = useState<{ files: ProjectFileSystem['files']; main: string }>()
  const [revision, setRevision] = useState<{ submissionId?: string; cardId?: string }>()
  const [revisionRoundId, setRevisionRoundId] = useState<string>()
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [selectedStage, setSelectedStage] = useState<SubmissionStage>()
  const [uploadedBlindCover, setUploadedBlindCover] = useState<File>()
  const [submissionResult, setSubmissionResult] = useState<{ build: SubmissionBuild; snapshot: SubmissionSnapshot; layout?: LayoutFinding[] }>()
  const [externalSubmission, setExternalSubmission] = useState<ExternalSubmission>()
  const externalPreparation = useRef(0)
  const [submissionExcluded, setSubmissionExcluded] = useState<ReadonlySet<string>>(new Set())
  const [submissionError, setSubmissionError] = useState('')
  const [submissionLog, setSubmissionLog] = useState('')
  const [submissionCompilerIssues, setSubmissionCompilerIssues] = useState<SubmissionIssue[]>([])
  const [saveError, setSaveError] = useState('')
  const [fileOperation, setFileOperation] = useState<{ request: FileOperation; view?: PortableWritingState['view'] }>()
  const [referenceOperation, setReferenceOperation] = useState<{ request: ReferenceRequest; view?: PortableWritingState['view'] }>()
  const [fileUndo, setFileUndo] = useState<{ before: ProjectFileSystem; writing: PortableWritingState;
    after: { project: ProjectFileSystem; writing: PortableWritingState }; move?: SourceMove; references?: boolean }>()
  const [comparison, setComparison] = useState<string>()
  const [error, setError] = useState('')
  const [log, setLog] = useState('')
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([])
  const [diagnosticSnapshot, setDiagnosticSnapshot] = useState<CompileSnapshot>()
  const [hasWarnings, setHasWarnings] = useState(false)
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfFilename, setPdfFilename] = useState('')
  const [lastCompile, setLastCompile] = useState<CompileSnapshot>()
  const [sourceMap, setSourceMap] = useState<SyncRegion[]>([])
  const [pdfPage, setPdfPage] = useState(1)
  const [pdfTarget, setPdfTarget] = useState<SyncRegion | null>(null)
  const [layoutFindings, setLayoutFindings] = useState<LayoutFinding[]>()
  const [layoutCheckOpen, setLayoutCheckOpen] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [panel, setPanel] = useState<'problems' | 'references' | 'cross-references' | 'review' | null>(null)
  const [aiOpen, setAiOpen] = useState(Boolean(project.metadata.writingSample))
  const [returnToAi, setReturnToAi] = useState(false)
  const [resumeManuscriptReview, setResumeManuscriptReview] = useState<(() => void)>()
  const evidenceTrigger = useRef<HTMLElement | null>(null)
  const [sourceMoves, setSourceMoves] = useState<SourceMove[]>()
  const writingKey = journal.key
  useEffect(() => {
    if (!storage || !writingKey) return
    let active = true
    void readSourceMoves(storage, writingKey).then(moves => {
      if (active) setSourceMoves(current => current ?? moves)
    }).catch(() => {})
    return () => { active = false }
  }, [storage, writingKey])
  const wideTools = useRightToolPanelWide()
  const [aiPreference, setAiPreference] = useState<{ key?: string; placement?: 'docked' | 'floating' }>({})
  const aiPreferenceKey = writingKey && `research-canvas:ai-layout:${JSON.stringify(writingKey)}`
  const aiPlacement = aiPreference.key === aiPreferenceKey ? aiPreference.placement : undefined
  useEffect(() => {
    if (!aiPreferenceKey) return
    try {
      const value = localStorage.getItem(aiPreferenceKey)
      if (value === 'docked' || value === 'floating') setAiPreference({ key: aiPreferenceKey, placement: value })
    } catch { /* The workspace can still use its responsive default. */ }
  }, [aiPreferenceKey])
  function setAiPlacement(placement: 'docked' | 'floating' | undefined) {
    setAiPreference({ key: aiPreferenceKey, placement })
    if (!aiPreferenceKey) return
    try {
      if (placement) localStorage.setItem(aiPreferenceKey, placement)
      else localStorage.removeItem(aiPreferenceKey)
    } catch { /* Keep the setting for this session. */ }
  }
  const aiLayout = aiPlacement ?? (wideTools ? 'docked' : 'floating')
  const aiDocked = aiOpen && aiLayout === 'docked'
  const writingSplit = useRef<ImperativePanelGroupHandle>(null)
  const aiWidth = useRef(30)
  const aiTrigger = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const split = writingSplit.current
    if (split?.getLayout().length !== 2) return
    const width = aiDocked ? aiWidth.current : 0
    split.setLayout([100 - width, width])
  }, [aiDocked])
  const [reviewCursor, setReviewCursor] = useState<{ path: string; line: number }>()
  const [navigation, setNavigation] = useState<'files' | 'outline' | 'search'>('files')
  const [searchQuery, setSearchQuery] = useState('')
  const [narrowView, setNarrowView] = useState<'source' | 'pdf'>('source')
  const [mobileFiles, setMobileFiles] = useState(false)
  const [desktopFiles, setDesktopFiles] = useState(true)
  const navPanel = useRef<ImperativePanelHandle>(null)
  const fileToggle = useRef<HTMLButtonElement>(null)
  const firstFileTab = useRef<HTMLButtonElement>(null)
  const compileRequest = useRef<AbortController | null>(null)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const restoredCursor = useRef(false)
  const writeInProgress = useRef(false)
  const pendingJump = useRef<{ path: string; previousFocus: Element | null; range?: { start: IPosition; end: IPosition } } | null>(null)
  const isTex = /\.tex$/i.test(selected)
  const draftPaths = Object.keys(drafts)
  const revisionDraftPaths = useMemo(() => new Set(Object.keys(drafts)), [drafts])
  const dirty = draftPaths.length > 0
  const conflicts = useMemo(() => draftConflicts(project, drafts), [project, drafts])
  const unprotected = journal.pending > 0 || (dirty && (journal.loadError || journal.failed.size > 0))
  const locked = busy || writing || !journal.ready
  const currentFile = textFiles.find(file => file.path === selected)
  const readOnly = currentFile?.type !== 'editable' || !currentFile.metadata?.editable || conflicts.includes(selected)
  const withGeneratedSource = useCallback((next: ProjectFileSystem) => {
    const generated = next.files.get('main.tex')
    if (!generateSource || generated?.type !== 'generated') return next
    const source = generateSource(next)
    return source === generated.content ? next : updateFileContent(next, 'main.tex', source)
  }, [generateSource])
  const workingProject = useMemo(() => withGeneratedSource(applyWritingDrafts(project, drafts)), [drafts, project, withGeneratedSource])
  const savedProject = useMemo(() => withGeneratedSource(project), [project, withGeneratedSource])
  const workingFiles = workingProject.files
  const latestTemplateSource = useRef({ main, files: workingFiles })
  useLayoutEffect(() => { latestTemplateSource.current = { main, files: workingFiles } }, [main, workingFiles])
  const { headings, blocks, index, crossReferences, labelTitles } = useMemo(() => {
    const source = { files: workingFiles }
    const documents = new Map<string, string>()
    const preamble = new Map<string, string>()
    const headings = buildProjectOutline(source, main, undefined, (path, text) => documents.set(path, text),
      (path, text) => preamble.set(path, text))
    const sources = new Map([...preamble, ...documents])
    const labels = indexLatexLabels(sources)
    const blocks = readProjectLatexBlocks(source, main, documents, preamble, labels)
    const index = indexOutline(headings, labels)
    const labelTitles = new Map<string, string>()
    const pending = [...headings]
    while (pending.length) {
      const heading = pending.pop()!
      pending.push(...heading.children)
      if (heading.label) labelTitles.set(heading.label, heading.title)
    }
    for (const block of blocks) {
      for (const label of block.labels) labelTitles.set(label, block.caption || block.kind)
    }
    return { headings, blocks, index, crossReferences: indexCrossReferences(sources, labels), labelTitles }
  }, [workingFiles, main])
  const source = currentFile?.content ?? ''
  const workingFile = workingProject.files.get(selected)
  const draft = workingFile && 'content' in workingFile ? workingFile.content ?? '' : ''
  const pdfStale = Boolean(lastCompile && (lastCompile.main !== main || lastCompile.profile !== profileKey || !sameSources(lastCompile.files, workingProject.files)))
  const diagnosticsStale = Boolean(diagnosticSnapshot && (diagnosticSnapshot.main !== main || diagnosticSnapshot.profile !== profileKey
    || !sameSources(diagnosticSnapshot.files, workingFiles)))
  const currentWarnings = hasWarnings && !diagnosticsStale
  const tree = useMemo(() => getFileTree(project), [project])
  const bibliography = useMemo(() => collectBibliography(workingProject), [workingProject])
  const references = useMemo(() => indexCanvasReferences(workingProject, bibliography), [workingProject, bibliography])
  const citationIssues = useMemo(() => checkCitations(workingProject, bibliography), [workingProject, bibliography])
  const submission = useMemo(() => {
    if (!submissionOpen) return
    const source = includeDrafts ? workingProject : withGeneratedSource(project)
    const paths = submissionFilePaths(source.files)
    const excluded = new Set(paths.filter(path => path !== main && submissionExcluded.has(path)))
    return { ...prepareSubmission(source, main, excluded), paths, excluded }
  }, [submissionOpen, includeDrafts, workingProject, withGeneratedSource, project, main, submissionExcluded])
  const submissionStageOptions = stagesForTemplate(activeTemplate?.origin.id ?? project.metadata.templateOrigin?.id)
  const stage = selectedStage && submissionStageOptions.includes(selectedStage) ? selectedStage : undefined
  const blindCover = stage === 'njupt-blind' ? uploadedBlindCover : undefined
  const submissionSnapshot = useMemo(() => submission && { main, profile: profileKey, files: submission.target.files,
    stage, blindCover, working: stage ? workingFiles : undefined }, [main, profileKey, submission, stage, blindCover, workingFiles])
  const latestSubmission = useRef(submissionSnapshot)
  useLayoutEffect(() => { latestSubmission.current = submissionSnapshot }, [submissionSnapshot])
  const freshExternal = externalSubmission && sameSubmissionInputs(externalSubmission.snapshot, submissionSnapshot) ? externalSubmission : undefined
  const freshResult = submissionResult && sameSubmissionInputs(submissionResult.snapshot, submissionSnapshot) ? submissionResult.build : undefined
  const templateId = project.metadata.templateOrigin?.id
  const activeEngine = activeTemplate && activeTemplateEngine(activeTemplate)
  const preflightAvailable = Boolean(activeTemplate || layoutPreflightProfile(workingFiles, templateId))
  const catalog = useMemo(() => ({ project: project.metadata.createdAt, index, blocks, references, files: workingFiles }),
    [index, blocks, references, workingFiles, project.metadata.createdAt])
  useLayoutEffect(() => {
    onArchiveOutline(journal.ready ? catalog : undefined)
  }, [catalog, journal.ready, onArchiveOutline])
  const currentDiagnostics = useMemo(() => diagnosticsStale ? [] : diagnostics.filter(issue => {
    const file = workingFiles.get(issue.path)
    return file && 'content' in file && typeof file.content === 'string'
      && issue.line <= file.content.split(/\r\n|\n|\r/).length
  }), [diagnostics, diagnosticsStale, workingFiles])
  const aiCompiler: ChapterEditRequest['compiler'] = {
    state: !diagnosticSnapshot ? 'unavailable' : diagnosticsStale ? 'stale' : 'current', main: diagnosticSnapshot?.main,
    diagnostics: currentDiagnostics.slice(0, 40).map(item => ({ ...item, message: item.message.slice(0, 500) })),
    log: diagnosticsStale ? '' : log.slice(-4000),
  }
  const problems = useMemo<SourceProblem[]>(() => [
    ...currentDiagnostics,
    ...citationIssues.map(issue => ({
      path: issue.path, line: issue.line, severity: 'warning' as const, location: issue,
      message: issue.kind === 'missing' ? `Unknown citation key: ${issue.key}` : `Duplicate bibliography key: ${issue.key}`,
    })),
    ...crossReferences.issues.map(issue => ({
      path: issue.path, line: issue.line, severity: 'warning' as const, location: issue,
      message: issue.kind === 'missing' ? `Undefined LaTeX reference: ${issue.key}` : `Duplicate LaTeX label: ${issue.key}`,
    })),
  ], [citationIssues, crossReferences, currentDiagnostics])

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  const externalUrl = externalSubmission?.downloadUrl
  useEffect(() => () => { if (externalUrl) URL.revokeObjectURL(externalUrl) }, [externalUrl])
  useEffect(() => () => compileRequest.current?.abort(), [])

  useEffect(() => {
    if (mobileFiles && active) firstFileTab.current?.focus()
  }, [mobileFiles, active])

  useEffect(() => {
    if (!unprotected || !journal.ready) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unprotected, journal.ready])

  const captureCursor = useCallback((path: string, position: IPosition) => {
    recordView({ path, ...position })
    if (panel === 'review') setReviewCursor(current => current?.path === path && current.line === position.lineNumber
      ? current : { path, line: position.lineNumber })
  }, [recordView, panel])

  function readReviewSelection(): ReviewTarget | undefined {
    const model = editorRef.current?.getModel()
    const selection = editorRef.current?.getSelection()
    if (!isTex || currentFile?.type === 'generated' || !model || !selection || selection.isEmpty()
      || editorSourcePath(model) !== selected) return
    const anchor = makeSelectionAnchor(project.metadata.createdAt, selected, draft,
      sourceOffsetAtPosition(draft, selection.getStartPosition()), sourceOffsetAtPosition(draft, selection.getEndPosition()))
    if (anchor) return { type: 'selection', anchor }
  }

  const applyPendingJump = useCallback((instance: editor.IStandaloneCodeEditor | null) => {
    editorRef.current = instance
    if (!instance) return
    requestAnimationFrame(() => {
      const container = instance.getDomNode()
      if (!container?.clientWidth || !container.clientHeight) return
      const pending = pendingJump.current
      const model = instance.getModel()
      if (!model) return
      if (!pending) {
        if (!restoredCursor.current && restoredView && editorSourcePath(model) === restoredView.path) {
          restoredCursor.current = true
          instance.layout()
          const position = model.validatePosition(restoredView)
          instance.setPosition(position)
          instance.revealLineInCenter(position.lineNumber)
        }
        return
      }
      if (editorSourcePath(model) !== pending.path) return
      restoredCursor.current = true
      pendingJump.current = null
      if (pending.range) {
        instance.layout()
        const start = model.validatePosition(pending.range.start)
        const end = model.validatePosition(pending.range.end)
        instance.setSelection({
          startLineNumber: start.lineNumber, startColumn: start.column,
          endLineNumber: end.lineNumber, endColumn: end.column,
        })
        instance.revealLineInCenter(start.lineNumber)
      }
      const position = instance.getPosition()
      if (position) captureCursor(pending.path, position)
      if (document.activeElement === pending.previousFocus || document.activeElement === document.body) instance.focus()
    })
  }, [captureCursor, restoredView])

  useEffect(() => {
    if (active) applyPendingJump(editorRef.current)
  }, [active, narrowView, applyPendingJump])

  function openFile(path: string, line?: number, location?: SourceLocation, selectLine = false) {
    if (!sourcePaths.has(path)) return
    const file = workingProject.files.get(path)
    setSelected(path)
    setMobileFiles(false)
    setNarrowView('source')
    const text = file && 'content' in file ? file.content ?? '' : ''
    const start = location ? sourcePosition(text, location.start) : line === undefined ? undefined : { lineNumber: line, column: 1 }
    const end = location ? sourcePosition(text, location.end)
      : start && (selectLine ? { ...start, column: Number.MAX_SAFE_INTEGER } : start)
    pendingJump.current = { path, previousFocus: document.activeElement, range: start && end ? { start, end } : undefined }
    applyPendingJump(editorRef.current)
  }

  function confirmDiscard() {
    return !dirty || window.confirm('Discard unsaved edits to project files?')
  }

  useImperativeHandle(ref, () => ({
    openFile,
    locate,
    openRevisionCard: nodeId => setRevision({ cardId: nodeId }),
    snapshotRestoreBlock: paths => {
      if (locked || journal.pending) return 'Wait for Writing to finish its current operation before restoring a snapshot.'
      if (journal.loadError) return 'Local drafts could not be checked. Reopen the project before restoring a snapshot.'
      if (paths?.some(path => Object.hasOwn(drafts, path))) return 'Save or discard the local drafts for the selected files in Writing first.'
      if (!paths && dirty) return 'Save or discard the local drafts in Writing before restoring a snapshot.'
    },
    confirmLeave: () => !unprotected || window.confirm('Some drafts have not been saved locally. Leave this page?'),
    async prepareProjectSwitch() {
      if (writeInProgress.current || !journal.ready) {
        setSaveError('Wait for local drafts to finish loading or saving before switching projects.')
        return false
      }
      const persisted = await journal.storedDrafts()
      if (dirty && (journal.loadError || Object.entries(drafts).some(([path, draft]) => !sameDraft(draft, persisted[path])))) {
        setSaveError('Some drafts could not be saved on this device. Resolve them before switching projects.')
        return false
      }
      return true
    },
    getDraftBackup: captureWritingState,
    async confirmBackupReplacement() {
      if (writeInProgress.current || !journal.ready || journal.loadError) {
        setSaveError('Wait for local drafts to finish loading or saving before replacing the project.')
        return false
      }
      if (!confirmDiscard()) return false
      return journal.storedDrafts()
    },
    async prepareReplacement() {
      return !writeInProgress.current && journal.ready && confirmDiscard()
    },
    openGeneratedNode(node) {
      let line: number | undefined
      generateSource?.(workingProject, (candidate, position) => {
        if (candidate === node) line = position
      })
      if (line !== undefined) openFile('main.tex', line)
    },
  }))

  function locate(location: SourceLocation) {
    openFile(location.path, location.line, location)
  }

  function toggleChapterAi() {
    if (!aiOpen && returnToAi) {
      resumeAi()
      return
    }
    setAiOpen(!aiOpen)
    setMobileFiles(false)
    if (!aiOpen && aiLayout === 'floating' && !wideTools) setPanel(null)
  }

  function locateAiEvidence(path: string, line: number) {
    if (aiLayout === 'floating') {
      evidenceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setReturnToAi(true)
      setAiOpen(false)
    }
    openFile(path, line, undefined, true)
  }

  function locateReviewSource(path: string, line: number, onReturn: () => void) {
    setReturnToAi(false)
    setResumeManuscriptReview(() => onReturn)
    if (aiLayout === 'floating') setAiOpen(false)
    openFile(path, line, undefined, true)
  }

  function resumeAi() {
    setReturnToAi(false)
    setMobileFiles(false)
    setAiOpen(true)
    requestAnimationFrame(() => {
      const trigger = evidenceTrigger.current
      if (trigger?.isConnected && trigger.closest('#writing-ai')) trigger.focus()
      else document.querySelector<HTMLElement>('#writing-ai textarea')?.focus()
      evidenceTrigger.current = null
    })
  }

  function aiSelection() {
    const instance = editorRef.current
    const range = instance?.getSelection()
    if (!range || range.isEmpty() || editorSourcePath(instance?.getModel() ?? null) !== selected) return
    return { path: selected, start: range.startLineNumber, end: range.endLineNumber }
  }

  async function applyChatAction(run: string, action: ChatAction) {
    if (!storage || !journal.key || journal.loadError || locked || writeInProgress.current) throw new Error('Local draft storage is unavailable.')
    writeInProgress.current = true
    setWriting(true)
    try {
      const persisted = await journal.storedDrafts()
      if (journal.failed.size || Object.keys(drafts).some(path => !sameDraft(persisted[path], drafts[path]))) {
        throw new Error('Local drafts are out of sync. Resolve them before applying.')
      }
      const result = await commitChatAction(storage, journal.key, run, action, await flushProject(project))
      if (result.changed && action.kind !== 'reject') {
        const entries = Object.fromEntries(Object.entries(result.checkpoint.after).map(([path, source]) =>
          [path, source.draft ?? { base: source.saved, text: source.saved }]))
        acceptStoredProject(result.project, project)
        journal.acceptDraftBatch(entries)
        markSourceChanged()
      }
      return result.checkpoint.state
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function undoManuscriptBatches(runs: readonly string[]) {
    if (!storage || !journal.key || journal.loadError || locked || writeInProgress.current) throw new Error('Local draft storage is unavailable.')
    writeInProgress.current = true
    setWriting(true)
    try {
      const persisted = await journal.storedDrafts()
      if (journal.failed.size || Object.keys(drafts).some(path => !sameDraft(persisted[path], drafts[path]))) {
        throw new Error('Local drafts are out of sync. Resolve them before undoing the batches.')
      }
      const result = await undoChatBatches(storage, journal.key, runs, await flushProject(project))
      acceptStoredProject(result.project, project)
      journal.acceptDraftBatch(Object.fromEntries(Object.entries(result.sources).map(([path, source]) =>
        [path, source.draft ?? { base: source.saved, text: source.saved }])))
      markSourceChanged()
      return result.undone
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function saveManuscript(taskId: string, runs: readonly string[], report: ChatVerification) {
    if (!storage || !journal.key || journal.loadError || locked || writeInProgress.current) throw new Error('Local draft storage is unavailable.')
    writeInProgress.current = true
    setWriting(true)
    try {
      const persisted = await journal.storedDrafts()
      if (journal.failed.size || Object.keys(drafts).some(path => !sameDraft(persisted[path], drafts[path]))) {
        throw new Error('Local drafts are out of sync. Resolve them before saving the task.')
      }
      const { candidate, checkpoint } = await commitManuscriptSave(storage, journal.key, taskId, runs, report, await flushProject(project))
      acceptStoredProject(candidate, project)
      journal.acceptDraftBatch(Object.fromEntries(Object.entries(checkpoint.after).map(([path, source]) =>
        [path, { base: source.saved, text: source.saved }])))
      markSourceChanged()
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  function captureWritingState(): PortableWritingState | undefined {
    if (!journal.ready || (journal.loadError && !dirty)) return
    const instance = editorRef.current
    const position = instance?.getPosition()
    const view = position && editorSourcePath(instance?.getModel() ?? null) === selected ? { path: selected, ...position } : restoredView
    return { drafts, view }
  }

  function openFileOperation(request: FileOperation) {
    setFileOperation({ request, view: captureWritingState()?.view })
  }

  function openReferenceOperation(request: ReferenceRequest) {
    setReferenceOperation({ request, view: captureWritingState()?.view })
  }

  async function writeFileOperation(before: ProjectFileSystem, after: ProjectFileSystem, writingState: PortableWritingState, move?: SourceMove) {
    if (locked || writeInProgress.current || !storage || !journal.key || journal.loadError) throw new Error('Writing storage is not ready.')
    writeInProgress.current = true
    setWriting(true)
    try {
      const stored = await journal.storedDrafts()
      if (JSON.stringify(Object.entries(stored).sort()) !== JSON.stringify(Object.entries(drafts).sort())) {
        throw new Error('Some drafts are not synchronized with local storage.')
      }
      const committed = await commitFileOperation(storage, journal.key, await flushProject(before), stored, after, writingState, move)
      if (committed.moves) setSourceMoves(committed.moves)
      acceptStoredProject(committed.project)
      journal.acceptWritingState(writingState)
      setSelected(writingState.view?.path)
      restoredCursor.current = false
      pendingJump.current = null
      setComparison(undefined)
      markSourceChanged()
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function applyFileOperation(plan: FileOperationPlan, before: ProjectFileSystem, prior: PortableWritingState, destination: string) {
    if (before !== project || prior.drafts !== drafts) throw new Error('Project data changed. Go back and preview the latest changes.')
    const movedCurrent = prior.view && plan.writing.view?.path !== prior.view.path
    const writingState = plan.project.files.get(destination)?.type === 'editable'
      ? { ...plan.writing, view: movedCurrent ? plan.writing.view : { path: destination, lineNumber: 1, column: 1 } }
      : plan.writing
    const move = fileOperation?.request.kind === 'move' ? { from: fileOperation.request.from, to: destination } : undefined
    await writeFileOperation(before, plan.project, writingState, move)
    setFileUndo({ before, writing: prior, after: plan, move })
  }

  async function undoFileOperation() {
    if (!fileUndo || locked) return
    setSaveError('')
    const graph = (value?: ProjectFileSystem['canvas']) => JSON.stringify([
      value?.pages.map(({ id, name, nodes, edges }) => ({ id, name, nodes, edges })), value?.crossPageEdges,
    ])
    if (project.files !== fileUndo.after.project.files || project.metadata !== fileUndo.after.project.metadata
      || graph(project.canvas) !== graph(fileUndo.after.project.canvas)
      || JSON.stringify(Object.entries(drafts).sort()) !== JSON.stringify(Object.entries(fileUndo.after.writing.drafts).sort())) {
      setSaveError('Undo is unavailable after editing files, drafts or cards again.')
      return
    }
    try {
      const before = fileUndo.before
      const current = project.canvas
      const canvas = before.canvas && current ? { ...before.canvas, activePageId: current.activePageId,
        display: current.display, overviewViewport: current.overviewViewport,
        pages: before.canvas.pages.map(page => ({ ...page, viewport: current.pages.find(item => item.id === page.id)?.viewport ?? page.viewport })),
      } : before.canvas
      await writeFileOperation(project, { ...before, canvas }, fileUndo.writing, fileUndo.move && { from: fileUndo.move.to, to: fileUndo.move.from })
      setFileUndo(undefined)
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not undo the file changes.')
    }
  }

  const canSync = !locked && !pdfStale && sourceMap.length > 0
  const canRefactorReferences = project.metadata.sourceMode === 'archive' && !!storage && journal.ready && !journal.loadError && !locked

  function showInPdf() {
    const line = editorRef.current?.getPosition()?.lineNumber
    if (!line || !canSync) return
    const target = findPdfRegion(sourceMap, selected, line)
    if (target) {
      setPdfPage(target.page)
      setPdfTarget({ ...target })
      setSyncMessage(target.line === line ? `Source line ${line} · PDF page ${target.page}`
        : `Nearest typeset line ${target.line} · PDF page ${target.page}`)
    } else {
      setSyncMessage('The selected file has no mapped content in this PDF.')
    }
    setNarrowView('pdf')
  }

  function showInSource(location: SyncRegion | undefined) {
    if (!location) {
      setSyncMessage('No source location here. Click closer to the typeset content.')
      return
    }
    setPdfTarget(null)
    setSyncMessage(`${location.path}:${location.line}`)
    openFile(location.path, location.line)
  }

  const changePdfPage = useCallback((page: number) => {
    setPdfPage(page)
    setPdfTarget(null)
    setSyncMessage('')
  }, [])

  async function commitDrafts(entries: WritingDrafts) {
    if (!Object.keys(entries).length) return workingProject
    if (writeInProgress.current || !journal.ready) return
    writeInProgress.current = true
    setWriting(true)
    setSaveError('')
    try {
      if (!storage || !journal.key) throw new Error('Project storage is unavailable. Keep this tab open to retain your edits.')
      const stored = await journal.storedDrafts()
      const result = await commitWritingDrafts(storage, journal.key, await flushProject(project), entries, stored)
      acceptStoredProject(result.project, project)
      if (result.conflicts.length) {
        setComparison(result.conflicts[0])
        return
      }
      journal.forget(Object.keys(entries))
      return result.project
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the project.')
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function save() {
    if (locked || !dirty) return
    if (conflicts.length) setComparison(conflicts[0])
    else await commitDrafts(drafts)
  }

  function markSourceChanged() {
    setPdfTarget(null)
    setSyncMessage('')
    setError('')
  }

  function changeDraft(value: string) {
    if (locked || readOnly || value === draft) return
    const base = Object.hasOwn(drafts, selected) ? drafts[selected].base : source
    journal.change(selected, value === source ? undefined : { base, text: value })
    markSourceChanged()
  }

  function insertReference(key: string, command = 'cite') {
    const instance = editorRef.current
    const range = instance?.getSelection()
    if (!instance || !range || !isTex || readOnly || locked || editorSourcePath(instance.getModel()) !== selected) return
    setNarrowView('source')
    instance.pushUndoStop()
    instance.executeEdits('reference', [{ range, text: `\\${command}{${key}}`, forceMoveMarkers: true }])
    instance.pushUndoStop()
    requestAnimationFrame(() => instance.focus())
  }

  function setMain(path: string) {
    if (locked) return
    setFileSystem(current => current ? { ...current, metadata: { ...current.metadata, mainFile: path } } : current)
    markSourceChanged()
  }

  function saveCompileSettings(path: string, compileProfile: CompileProfile) {
    if (locked) return
    setFileSystem(current => current ? { ...current, metadata: { ...current.metadata, mainFile: path, compileProfile } } : current)
    setCompileSettingsOpen(false)
    markSourceChanged()
  }

  async function saveProjectInformation(information: ProjectInformation) {
    if (!storage || !storageKey || locked || writeInProgress.current) throw new Error('本机项目暂时无法保存，请稍后重试。')
    writeInProgress.current = true
    setWriting(true)
    try {
      const stored = await flushProject(project)
      const metadata = { ...stored.metadata, updatedAt: new Date().toISOString() }
      if (Object.keys(information).length) metadata.information = information
      else delete metadata.information
      const saved = await writeProject(storage, storageKey, { ...stored, metadata }, stored)
      acceptStoredProject(saved, stored)
      markSourceChanged()
      setLayoutFindings(undefined)
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function setCurrentTemplate(template?: ActiveTemplate, preview?: TemplatePreview | ExternalTemplatePreview) {
    if (!storage || !storageKey || locked || writeInProgress.current) throw new Error('本机项目暂时无法保存，请稍后重试。')
    if (template && conflicts.length) throw new Error('请先处理稿件的本地草稿冲突。')
    if (template && (!templateExport || templateExport.main !== latestTemplateSource.current.main
      || !sameSources(templateExport.files, latestTemplateSource.current.files))) {
      throw new Error('稿件在预览后发生了变化，请重新打开面板并编译预览。')
    }
    writeInProgress.current = true
    setWriting(true)
    try {
      const stored = await flushProject(project)
      const metadata = { ...stored.metadata }
      if (template) metadata.activeTemplate = template
      else delete metadata.activeTemplate
      const external = preview && 'sourceSha256' in preview ? preview : undefined
      if (template?.kind === 'mit-thesis') {
        const current = latestTemplateSource.current
        if (!external || external.sourceSha256 !== await projectSourceDigest(current.files, current.main, information)
          || current !== latestTemplateSource.current) throw new Error('稿件在外部编译后发生了变化，请重新准备源包。')
      }
      const saved = await writeProject(storage, storageKey, { ...stored, metadata }, stored, external)
      acceptStoredProject(saved, stored)
      markSourceChanged()
      setLayoutFindings(undefined)
      if (template && preview && templateExport) {
        setPdfUrl(URL.createObjectURL(preview.pdf))
        setPdfFilename(template.main.replace(/\.tex$/i, '.pdf'))
        setLastCompile({ ...templateExport, profile: compileKey(template) })
        setSourceMap(preview.regions)
        setPdfPage(1)
        setNarrowView('pdf')
      }
    } finally {
      writeInProgress.current = false
      setWriting(false)
    }
  }

  async function compileSource(source: ProjectFileSystem, signal: AbortSignal, stage?: SubmissionStage, cover?: File):
    Promise<{ project: ProjectFileSystem; lines?: LineSources; blind?: BlindEvidence }> {
    if (!source.metadata.activeTemplate) {
      if (stage === 'njupt-blind') throw new Error('请先在「更换模板」中启用已配置题名与专业字段的南邮专硕版式。')
      return { project: sourcesWithProjectInformation(source, main) }
    }
    const { projectWithActiveTemplate } = await import('@/lib/project/template-export-client')
    return projectWithActiveTemplate(source, main, signal, stage, cover)
  }

  async function discard(paths: string[]) {
    if (locked) return
    setWriting(true)
    await journal.discard(paths)
    setWriting(false)
    markSourceChanged()
  }

  async function compile(submissionSelection?: SubmissionSelection, chatSignal?: AbortSignal): Promise<{
    feedback: ChatCompileFeedback; submission?: SubmissionBuild
  } | undefined> {
    if (!main || locked || compileRequest.current) return
    if (!submissionSelection && conflicts.length) {
      if (!chatSignal) setComparison(conflicts[0])
      return
    }
    const controller = new AbortController()
    const signal = chatSignal ? AbortSignal.any([chatSignal, controller.signal]) : controller.signal
    compileRequest.current = controller
    setBusy(true)
    const source = submissionSelection?.target ?? workingProject
    const stage = submissionSelection?.stage
    const cover = submissionSelection?.blindCover
    const submitted: SubmissionSnapshot = { main, profile: profileKey, files: source.files, stage, blindCover: cover, working: stage ? workingFiles : undefined }
    // A saved-only submission may differ from the sources in Monaco.
    const updatePreview = !submissionSelection || (!chatSignal && stage !== 'njupt-blind'
      && sameSources(source.files, new Map([...workingFiles].filter(([, file]) => file.type !== 'directory'))))
    const feedback = (status: ChatCompileFeedback['status'], message: string, issues: CompileDiagnostic[] = [], log?: string) => ({
      status, message: message.slice(0, 1000), diagnostics: issues.slice(0, 40).map(issue => ({ ...issue, message: issue.message.slice(0, 500) })),
      log: log?.slice(-4000),
    })
    if (updatePreview) {
      setLayoutFindings(undefined)
      setSyncMessage('')
      setError('')
      setLog('')
      setDiagnostics([])
      setDiagnosticSnapshot(undefined)
      setHasWarnings(false)
    }
    try {
      const snapshot = { main, profile: profileKey, files: updatePreview ? workingFiles : source.files }
      if (source.metadata.activeTemplate?.kind === 'mit-thesis') {
        if (submissionSelection) throw new Error('当前 MIT 版式需要外部 LuaLaTeX。在此面板准备外部编译 ZIP 后上传 PDF。')
        if (chatSignal) return { feedback: feedback('failed', 'Use the workbench to verify the current MIT external build.') }
        const preview = storage && storageKey ? await readExternalTemplatePreview(storage, storageKey, source) : undefined
        const digest = preview ? await projectSourceDigest(source.files, main, source.metadata.information) : undefined
        if (signal.aborted) return
        if (preview && digest === preview.sourceSha256 && sameSources(source.files, latestTemplateSource.current.files)
          && main === latestTemplateSource.current.main) {
          setPdfUrl(URL.createObjectURL(preview.pdf))
          setPdfFilename('mit-thesis.pdf')
          setLastCompile(snapshot)
          setSourceMap(preview.regions)
          setPdfTarget(null)
          setPdfPage(1)
          setNarrowView('pdf')
          return { feedback: feedback('passed', 'Verified MIT external PDF restored.') }
        }
        setTemplateExport(latestTemplateSource.current)
        return
      }
      const { project: target, lines, blind } = await compileSource(source, signal, stage, cover)
      const switched = Boolean(lines)
      const entry = switched ? target.metadata.mainFile! : main
      const editorDiagnostics = (issues: CompileDiagnostic[]) => switched
        ? issues.map(issue => ({ ...issue, path: '', message: `${issue.path}:${issue.line} · ${issue.message}` }))
        : issues
      const packaged = submissionSelection ? await exportExternalBuild(target) : undefined
      const archive = packaged?.zip ?? await exportSourceArchive(target)
      let compileUrl = projectCompileUrl(entry, target.metadata.compileProfile)
      if (stage === 'njupt-deposit') {
        const source = target.files.get(entry)
        const bodyLine = source && 'content' in source ? source.content?.split(/\r?\n/).findIndex(line => /^\s*\\CustomWordBody\b/.test(line)) : undefined
        if (bodyLine !== undefined && bodyLine >= 0) compileUrl += '&fontLine=' + (bodyLine + 2)
      }
      const response = await fetch(compileUrl, {
        method: 'POST', body: archive, signal,
      })
      if (!response.ok) {
        const failure = await response.json()
        if (signal.aborted) return
        if (submissionSelection && !chatSignal) {
          setSubmissionError([failure.error, failure.log].filter(Boolean).join('\n'))
          setSubmissionCompilerIssues(submissionDiagnostics(editorDiagnostics(failure.diagnostics ?? []), source.files))
        }
        if (updatePreview) {
          const generatedError = switched && failure.diagnostics?.[0]
          setError(generatedError ? `${failure.error} ${generatedError.path}:${generatedError.line} · ${generatedError.message}` : failure.error)
          setLog(failure.log ?? '')
          setDiagnostics(editorDiagnostics(failure.diagnostics ?? []))
          setDiagnosticSnapshot(snapshot)
          if (!chatSignal && !aiDocked && !wideTools) setAiOpen(false)
          setPanel('problems')
        }
        return { feedback: feedback('failed', failure.error ?? 'Compilation failed.', failure.diagnostics, failure.log) }
      }
      const result = await response.formData()
      if (signal.aborted) return
      const pdf = result.get('pdf')
      if (!(pdf instanceof Blob)) throw new Error('The compiler did not return a PDF.')
      const map = result.get('sourceMap')
      const report = result.get('report')
      const info = typeof report === 'string' ? JSON.parse(report) as CompileReport : undefined
      const regions: SyncRegion[] = typeof map === 'string' ? JSON.parse(map) : []
      let findings: LayoutFinding[] | undefined
      let figureAttachmentsRequired: boolean | undefined
      const targetTemplate = target.metadata.templateOrigin?.id
      const layoutProfile = layoutPreflightProfile(target.files, targetTemplate)
      if (layoutProfile || stage) {
        const inspectionSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        const footerOffset = Number(layoutProfile?.layout?.rules.footerOffset.chosen.value ?? 0)
        const topMargin = layoutProfile?.layout && Number(layoutProfile.layout.rules.top.chosen.value)
        const pages = await import('@/lib/project/pdf-layout-client').then(({ readPdfLayout }) => readPdfLayout(pdf, inspectionSignal, footerOffset, topMargin,
          blind && (values => { blind.pdfMetadata = values })))
          .catch(() => [])
        if (signal.aborted) return
        findings = layoutProfile && stage !== 'njupt-blind' ? assessLayout(target.files, entry, pages, regions, info, targetTemplate) : []
        if (stage) {
          if (stage === 'agu-revision') figureAttachmentsRequired = submissionHasFigures(target, entry, pages)
          const stageFindings = assessSubmissionStage(target, entry, stage, pages, switched, blind)
          if (stage === 'njupt-deposit') stageFindings.push(njuptDepositFontFinding(info?.pdfFonts))
          const replaced = new Set(stageFindings.map(finding => finding.label))
          findings = [...stageFindings, ...findings.filter(finding => !replaced.has(finding.label) &&
            (stage !== 'njupt-deposit' || finding.ruleId !== 'njupt-declaration-signatures'))]
        }
      }
      let submission: SubmissionBuild | undefined
      if (submissionSelection) {
        const { paths, excluded, drafts, issues } = submissionSelection
        const diagnostics = submissionDiagnostics(editorDiagnostics(info?.diagnostics ?? []), source.files)
        if (info?.hasWarnings && !diagnostics.length) diagnostics.push({ severity: 'warning', message: 'The compiler reported warnings without a source location. See the compiler output.' })
        const delivery = stage ? { stage, buildId: crypto.randomUUID(), entry,
          engine: target.metadata.compileProfile?.engine ?? 'tectonic' as const,
          snapshotSha256: await projectSourceDigest(source.files, main, source.metadata.information), figureAttachmentsRequired, attachmentSha256: blind?.attachmentSha256 } : undefined
        submission = { main: entry, paths: switched ? submissionFilePaths(target.files) : paths, excluded, drafts, issues, pdf, zip: archive, warnings: Boolean(info?.hasWarnings), diagnostics,
          sourceChecksum: packaged?.checksum, compileProfile: target.metadata.compileProfile,
          layoutReport: findings ? await buildSubmissionLayout(findings, { pdf, zip: archive, sourceChecksum: packaged?.checksum }, target.metadata.templateOrigin, delivery) : undefined }
        if (signal.aborted) return
        if (!chatSignal) {
          setSubmissionCompilerIssues(diagnostics)
          setSubmissionResult({ build: submission, snapshot: submitted, layout: findings })
          if (info?.hasWarnings) setSubmissionLog(info.log)
        }
      }
      if (updatePreview) {
        if (info) {
          setDiagnostics(editorDiagnostics(info.diagnostics))
          setHasWarnings(info.hasWarnings)
          setLog(info.log)
          setDiagnosticSnapshot(snapshot)
        }
        setSourceMap(lines ? manuscriptRegions(regions, entry, lines) : regions)
        setLayoutFindings(findings)
        setPdfTarget(null)
        setPdfPage(1)
        setPdfUrl(URL.createObjectURL(pdf))
        setPdfFilename(entry.split('/').at(-1)?.replace(/\.tex$/i, '.pdf') ?? 'project.pdf')
        setLastCompile(snapshot)
        setNarrowView('pdf')
      }
      return { submission, feedback: feedback('passed', info?.hasWarnings ? 'Compiled with warnings.' : 'Compiled successfully.', info && editorDiagnostics(info.diagnostics), info?.log) }
    } catch (cause) {
      if (signal.aborted) return
      const message = cause instanceof Error ? cause.message : 'Could not compile the project.'
      if (submissionSelection && !chatSignal) setSubmissionError(message)
      if (updatePreview) {
        setError(message)
        setPanel('problems')
      }
      return { feedback: feedback('failed', message) }
    } finally {
      compileRequest.current = null
      setBusy(false)
    }
  }

  function resetSubmissionBuild(keepExternal = false) {
    externalPreparation.current++
    if (!keepExternal) setExternalSubmission(undefined)
    setSubmissionResult(undefined)
    setSubmissionError('')
    setSubmissionLog('')
    setSubmissionCompilerIssues([])
  }

  function getSubmissionSelection(): SubmissionSelection | undefined {
    if (!submission) return
    return { target: submission.target, stage, blindCover, paths: submissionFilePaths(submission.target.files), excluded: [...submission.excluded],
      issues: submission.issues, drafts: includeDrafts ? draftPaths.filter(path => submission.target.files.has(path)) : [] }
  }

  async function prepareExternalSubmission() {
    const selection = getSubmissionSelection()
    if (!selection || selection.stage && selection.stage !== 'catalog-delivery' || locked) return
    const { target, ...info } = selection
    const snapshot: SubmissionSnapshot = { main, profile: profileKey, files: target.files,
      stage: selection.stage, working: selection.stage ? workingFiles : undefined }
    const token = ++externalPreparation.current
    try {
      const { project: rendered } = await compileSource(target, AbortSignal.timeout(120_000))
      const { zip, checksum } = await exportExternalBuild(rendered)
      if (token !== externalPreparation.current || !sameSubmissionInputs(snapshot, latestSubmission.current)) return
      setExternalSubmission({ ...info, main: rendered === target ? main : rendered.metadata.mainFile!, snapshot, rendered, zip, checksum,
        paths: rendered === target ? info.paths : submissionFilePaths(rendered.files), downloadUrl: URL.createObjectURL(zip) })
    } catch (cause) {
      if (token === externalPreparation.current) throw new Error(cause instanceof Error ? cause.message : 'Could not prepare the external build ZIP.')
    }
  }

  function attachExternalPdf(pdf: File, engine: ExternalEngine, checksum: string) {
    if (!externalSubmission || externalSubmission.checksum !== checksum || !sameSubmissionInputs(externalSubmission.snapshot, latestSubmission.current)) {
      throw new Error('The submission source changed. Prepare and compile the current ZIP before attaching a PDF.')
    }
    const { main, paths, excluded, drafts, issues, zip, snapshot, rendered } = externalSubmission
    const origin = rendered.metadata.templateOrigin
    const attached = pdf.slice(0, pdf.size, 'application/pdf')
    setSubmissionResult({ snapshot, build: { main, paths, excluded, drafts, issues, zip, pdf: attached,
      warnings: false, diagnostics: [], externalEngine: engine, sourceChecksum: checksum } })
    const layoutProfile = layoutPreflightProfile(rendered.files, origin?.id)
    if (layoutProfile || snapshot.stage) void import('@/lib/project/pdf-layout-client')
      .then(({ readPdfLayout }) => readPdfLayout(attached, AbortSignal.timeout(30_000), Number(layoutProfile?.layout?.rules.footerOffset.chosen.value ?? 0),
        layoutProfile?.layout && Number(layoutProfile.layout.rules.top.chosen.value)))
      .catch(() => [])
      .then(async pages => {
        const layout = layoutProfile ? assessLayout(rendered.files, main, pages, [], undefined, origin?.id) : []
        const stage = snapshot.stage
        if (stage) layout.unshift(...assessSubmissionStage(rendered, main, stage, pages, Boolean(rendered !== workingProject)))
        const delivery = stage ? { stage, buildId: crypto.randomUUID(), entry: main, engine,
          snapshotSha256: await projectSourceDigest(snapshot.files, snapshot.main), sourceMatch: 'author-confirmed' as const } : undefined
        const layoutReport = await buildSubmissionLayout(layout, { pdf: attached, zip, sourceChecksum: checksum }, origin, delivery)
        setSubmissionResult(current => current?.build.pdf === attached
          ? { ...current, layout, build: { ...current.build, layoutReport } } : current)
      }).catch(() => {
        setSubmissionResult(current => current?.build.pdf === attached ? undefined : current)
        if (sameSubmissionInputs(snapshot, latestSubmission.current)) setSubmissionError('无法保存外部 PDF 的版式检查报告。请重新附加 PDF。')
      })
    setSubmissionError('')
    setSubmissionLog('')
    setSubmissionCompilerIssues([])
  }

  function closeMobileFiles(restoreFocus = false) {
    setMobileFiles(false)
    if (restoreFocus) fileToggle.current?.focus()
  }

  const comparedDraft = comparison && Object.hasOwn(drafts, comparison) ? drafts[comparison] : undefined
  const comparedSource = comparison ? editableSource(project, comparison) : undefined
  const draftStatus = !journal.ready ? 'Restoring local drafts…'
    : journal.pending ? 'Saving drafts on this device…'
      : journal.failed.size || (dirty && journal.loadError) ? 'Some local drafts could not be saved'
        : dirty ? `${draftPaths.length} local draft${draftPaths.length === 1 ? '' : 's'} · Not saved to project`
          : 'All changes saved to project'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-workbench-canvas text-workbench-ink">
      {actions && createPortal(<>
        <div className="mr-auto min-w-0 text-xs md:mr-0 md:text-right" title={main}>
          <span className="block text-workbench-muted">Main file</span>
          <span className="block truncate font-mono font-medium min-[385px]:hidden">{main.split('/').at(-1) || 'None'}</span>
          <span className="hidden max-w-56 truncate font-mono font-medium min-[385px]:block">{main || 'None'}</span>
        </div>
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || locked}><Save /> {writing ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" className="bg-workbench-accent text-white hover:bg-workbench-accent-hover" onClick={() => void compile()} disabled={!main || locked}>
          <Play /> {busy ? 'Compiling…' : 'Compile PDF'}
        </Button>
        <Button size="sm" variant="ghost" aria-label="Compile settings" title={activeTemplate ? '原模板编译设置' : 'Compile settings'} disabled={!main || locked}
          onClick={() => setCompileSettingsOpen(true)} className="shrink-0 px-1.5 sm:px-2">
          <SlidersHorizontal /><span className="hidden text-xs xl:inline">{compilerLabels[activeEngine ?? profile?.engine ?? 'tectonic']}</span>
        </Button>
        <Button size="sm" variant="outline" disabled={!storage || !storageKey || locked}
          onClick={() => setInformationOpen(true)}>项目信息</Button>
        <WorkbenchSetup storage={journal.loadError || journal.failed.size ? 'unavailable' : journal.ready && storage ? 'ready' : 'checking'} />
        <Button ref={aiTrigger} size="sm" variant={aiOpen ? 'secondary' : 'outline'} aria-expanded={aiOpen} aria-controls="writing-ai"
          aria-label="Writing AI" title="Writing AI" className="shrink-0 px-2 sm:px-3" onClick={toggleChapterAi}>
          <Sparkles /><span className="hidden sm:inline">Writing AI</span>
        </Button>
      </>, actions)}
      {conflicts.length > 0 && <div className="max-h-24 shrink-0 overflow-auto border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-950">
        <p role="status" className="font-medium">Project source changed since these drafts were created. Compare before saving or compiling.</p>
        <ul className="flex flex-wrap gap-x-4">
          {conflicts.map(path => <li key={path}><button className="break-all text-left underline" onClick={() => setComparison(path)}>
            Compare {path}
          </button></li>)}
        </ul>
      </div>}
      {saveError && <p role="alert" className="shrink-0 border-b bg-red-50 px-3 py-1.5 text-sm text-red-900">{saveError}</p>}
      {(journal.failed.size > 0 || (dirty && journal.loadError)) && <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-1.5 text-sm text-amber-950">
        <span>Drafts could not be written to this browser. The editor still holds your changes.</span>
        <Button size="sm" variant="outline" onClick={onRecoveryBackup}>Back up working drafts</Button>
        {journal.failed.size > 0 && <Button size="sm" variant="ghost" disabled={!!journal.pending} onClick={() => void journal.retryFailed()}>Retry draft save</Button>}
      </div>}
      {returnToAi && !aiOpen && <div className="flex shrink-0 items-center border-b bg-workbench-panel px-2 py-1">
        <Button type="button" size="sm" variant="outline" onClick={resumeAi}>Back to Writing AI</Button>
      </div>}
      {resumeManuscriptReview && <div className="flex shrink-0 items-center border-b bg-workbench-panel px-2 py-1">
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setResumeManuscriptReview(undefined)
          setAiOpen(true)
          resumeManuscriptReview()
        }}>Back to manuscript review</Button>
      </div>}
      <div className="flex shrink-0 items-center gap-2 border-b bg-workbench-panel px-2 py-1.5 lg:hidden">
        <Button ref={fileToggle} size="sm" variant="outline" aria-expanded={mobileFiles} aria-controls="writing-files"
          onClick={() => { if (!aiDocked && !wideTools) setAiOpen(false); setMobileFiles(open => !open) }}><PanelLeft /> Files</Button>
        <div className="ml-auto flex gap-1 rounded-lg bg-workbench-explorer p-0.5" aria-label="Writing pane" role="group">
          {(['source', 'pdf'] as const).map(pane => <Button key={pane} size="sm"
            variant={narrowView === pane ? 'outline' : 'ghost'} aria-pressed={narrowView === pane}
            onClick={() => { setNarrowView(pane); setMobileFiles(false); if (!aiDocked && !wideTools) setAiOpen(false) }}>{pane === 'source' ? 'Source' : 'PDF'}</Button>)}
        </div>
      </div>
      <ResizablePanelGroup ref={writingSplit} direction="horizontal" className="relative min-h-0 flex-1">
        {mobileFiles && <div className="absolute inset-0 z-10 bg-slate-900/25 lg:hidden" onClick={() => closeMobileFiles(true)} />}
        <ResizablePanel id="writing-work-area" order={1} minSize={52}>
        <ResizablePanelGroup direction="horizontal" className="min-w-0">
          <ResizablePanel id="writing-navigation" order={1} ref={navPanel} defaultSize={19} minSize={13} maxSize={35} collapsible
            onCollapse={() => setDesktopFiles(false)} onExpand={() => setDesktopFiles(true)}
            className={mobileFiles
              ? 'max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:w-64 max-lg:max-w-[85%] max-lg:!flex-none max-lg:shadow-lg'
              : 'hidden lg:block'}>
            <aside id="writing-files" aria-label="Project navigation"
              className={'flex h-full min-h-0 flex-col overflow-hidden bg-workbench-explorer text-sm ' + (desktopFiles ? '' : 'lg:hidden')}
              onKeyDown={event => { if (event.key === 'Escape' && mobileFiles) closeMobileFiles(true) }}>
              <div className="flex shrink-0 flex-wrap items-center gap-1 border-b p-2">
                {([['files', 'Files'], ['outline', 'Outline'], ['search', 'Search']] as const).map(([tab, label]) => (
                  <Button key={tab} ref={tab === 'files' ? firstFileTab : undefined}
                    size="sm" className="px-1.5 text-xs" variant={navigation === tab ? 'secondary' : 'ghost'}
                    aria-pressed={navigation === tab} onClick={() => setNavigation(tab)}>{label}</Button>
                ))}
                <Button size="icon-sm" variant="ghost" aria-label="Close file navigation" className="ml-auto lg:hidden"
                  onClick={() => closeMobileFiles(true)}><X /></Button>
              </div>
              {navigation === 'search' ? (
                <SourceSearchPanel files={workingProject.files} query={searchQuery} onQuery={setSearchQuery} onLocate={locate} />
              ) : (
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  {navigation === 'files'
                    ? <>
                        {project.metadata.sourceMode === 'archive' && <div className="flex flex-wrap gap-1 pb-2">
                          <Button size="sm" variant="outline" disabled={locked || editableSource(project, selected) === undefined || !isTex}
                            onClick={() => openFileOperation({ kind: 'chapter', parent: selected,
                              to: selected.replace(/\.tex$/i, '-detail.tex'), title: '' })}>New chapter</Button>
                          {fileUndo && <Button size="sm" variant="outline" disabled={locked} onClick={() => void undoFileOperation()}>
                            {fileUndo.references ? 'Undo reference changes' : 'Undo file changes'}
                          </Button>}
                        </div>}
                        <Files nodes={tree} selected={selected} main={main} dirty={drafts} sourcePaths={sourcePaths}
                          onSelect={openFile} onSetMain={setMain} onMove={project.metadata.sourceMode === 'archive' && !locked
                            ? path => openFileOperation({ kind: 'move', from: path, to: path }) : undefined} />
                      </>
                    : <OutlinePanel headings={headings} blocks={blocks} main={main} onLocate={locate} canvas={outlineCanvas} />}
                </div>
              )}
            </aside>
          </ResizablePanel>
          <ResizableHandle className="hidden lg:flex" />
          <ResizablePanel id="writing-source" order={2} defaultSize={44} minSize={28}
            className={narrowView === 'source' ? '' : 'hidden lg:block'}>
            <section aria-label="Source editor" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
              <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-workbench-panel px-2 py-1.5 text-xs sm:px-3">
                <Button size="icon-sm" variant="ghost" aria-label={desktopFiles ? 'Collapse file navigation' : 'Expand file navigation'}
                  aria-expanded={desktopFiles} aria-controls="writing-files" className="hidden lg:inline-flex"
                  onClick={() => desktopFiles ? navPanel.current?.collapse() : navPanel.current?.expand()}><PanelLeft /></Button>
                <FileCode2 className="size-4 shrink-0 text-workbench-accent" />
                <span className="min-w-0 flex-1 truncate font-medium" title={selected}>{selected || 'Select a source file'}</span>
                <Button size="sm" variant="outline" disabled={!isTex || !canSync} onClick={showInPdf}
                  title={canSync ? 'Find the editor cursor in the compiled PDF' : 'Compile the current source to enable positioning'}>
                  <LocateFixed /> Show in PDF
                </Button>
              </div>
              {currentFile?.type === 'generated' && <div className="flex shrink-0 flex-wrap items-center gap-x-2 border-b border-workbench-line bg-workbench-selection px-3 py-1 text-xs text-workbench-ink">
                Generated from the active canvas page · Read-only
                <Button variant="link" size="sm" className="h-7 px-1 text-workbench-accent" onClick={onOpenCanvas}>Edit in Canvas</Button>
              </div>}
              <div className="min-h-0 flex-1">
                {!journal.ready && <p role="status" className="p-3 text-sm">Restoring local drafts…</p>}
                {selected && journal.ready && <MonacoSourceEditor path={selected} value={draft} readOnly={locked || readOnly} problems={problems}
                  onChange={changeDraft} onEditor={applyPendingJump} onSave={save} onCursor={captureCursor} />}
              </div>
            </section>
          </ResizablePanel>
          <ResizableHandle withHandle className="hidden lg:flex" />
          <ResizablePanel id="writing-pdf" order={3} defaultSize={37} minSize={24}
            className={narrowView === 'pdf' ? '' : 'hidden lg:block'}>
            <section aria-label="PDF Preview" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-workbench-canvas">
              <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b bg-workbench-panel px-3 py-1.5 text-xs">
                <h2 className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-workbench-accent" /> PDF Preview</h2>
                {preflightAvailable && <Button size="sm" variant="outline" onClick={() => setLayoutCheckOpen(true)}>提交前版式检查</Button>}
                {wordLayoutReview && <Button size="sm" variant="outline" onClick={() => setWordReviewOpen(true)}>版式核对</Button>}
                {pdfUrl && <Button size="sm" variant="outline" asChild><a href={pdfUrl} download={pdfFilename}><Download /> Download PDF</a></Button>}
              </div>
              {pdfUrl ? <>
                <div className="shrink-0 border-b bg-workbench-panel px-3 py-1.5 text-xs">
              <p className={pdfStale ? 'font-medium text-amber-800' : 'text-slate-600'}>
                Last successful compile{pdfStale ? ' · Out of date' : ' · Up to date'}
                {!pdfStale && dirty && !conflicts.length && ' · Includes local drafts'}{busy && ' · Compiling…'}
                  </p>
                  <p role="status" className="break-words text-slate-600">
                    {busy ? 'Updating PDF…' : pdfStale ? 'Recompile to restore source and PDF navigation.'
                      : syncMessage || (canSync ? 'Click PDF content to find its source.' : 'This PDF has no source locations.')}
                  </p>
                </div>
                <SyncedPdfPreview key={pdfUrl} url={pdfUrl} page={pdfPage} regions={canSync ? sourceMap : []}
                  target={pdfStale ? null : pdfTarget} onLocate={showInSource}
                  onPage={changePdfPage} />
              </> : <div className="m-auto max-w-64 p-4 text-center">
                <FileText className="mx-auto mb-3 size-8 text-workbench-muted" />
                <p role="status" className="text-sm text-slate-600">{busy ? 'Running the LaTeX engine…' : 'Compile the main file to preview your PDF.'}</p>
              </div>}
              {wordReviewOpen && wordLayoutReview && <Dialog open onOpenChange={setWordReviewOpen}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto">
                  <DialogTitle>版式核对</DialogTitle>
                  <DialogDescription>当前模板的规则和编译结果。</DialogDescription>
                  <WordLayoutReview layout={wordLayoutReview.rules} issues={[
                    ...wordLayoutReview.issues,
                    ...(!diagnosticsStale && error ? [{ message: error }] : []),
                    ...currentDiagnostics,
                  ]} locate={(path, line) => { setWordReviewOpen(false); openFile(path, line) }} />
                </DialogContent>
              </Dialog>}
              {layoutCheckOpen && preflightAvailable && <Dialog open onOpenChange={setLayoutCheckOpen}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto">
                  <DialogTitle>提交前版式检查</DialogTitle>
                  <DialogDescription>{pdfStale ? '稿件已更改。重新编译以检查当前稿件。' : '当前编译 PDF 的自动检查结果。'}</DialogDescription>
                  <LayoutPreflight findings={pdfStale ? undefined : layoutFindings}
                    onSource={activeTemplate ? undefined : (path, line) => { setLayoutCheckOpen(false); openFile(path, line) }}
                    onPage={page => { setLayoutCheckOpen(false); changePdfPage(page) }} />
                </DialogContent>
              </Dialog>}
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle disabled={!aiDocked} aria-label="Resize Writing AI"
          className={aiDocked ? 'z-10 bg-workbench-selection-strong hover:bg-workbench-accent' : 'hidden'} />
        <ResizablePanel id="writing-ai-pane" order={2} defaultSize={0} minSize={22} maxSize={48} collapsible
          onResize={size => { if (size >= 22) aiWidth.current = size }}
          className={aiDocked ? 'min-w-0 border-l' : aiOpen ? 'absolute inset-y-0 right-0 z-30 w-[min(90%,26rem)] !flex-none border-l shadow-lg' : 'hidden'}>
        <RightToolPanel id="writing-ai" title="Writing AI" open={aiOpen} layout={aiLayout}
          onToggleLayout={() => setAiPlacement(aiLayout === 'docked' ? 'floating' : 'docked')}
          onClose={() => { setAiOpen(false); aiTrigger.current?.focus() }}
          icon={<Sparkles className="size-4 shrink-0 text-workbench-accent" />}>
          {storage && journal.key && <WritingAiWorkbench key={JSON.stringify(journal.key)} storage={storage} projectKey={journal.key}
            project={project} working={workingProject} saved={savedProject} drafts={drafts} selected={selected} main={main} active={active} sourceMoves={sourceMoves}
            disabled={locked || Boolean(conflicts.length)} compiler={aiCompiler} selection={aiSelection} onRevision={() => setRevision({})}
            onAction={applyChatAction} onUndoBatches={undoManuscriptBatches} onSaveManuscript={saveManuscript} onLocate={locateAiEvidence}
            onLocateReview={locateReviewSource} onOpenReview={() => setResumeManuscriptReview(undefined)}
            onReadExclusions={rules => setFileSystem(current => current ? {
              ...current, metadata: { ...current.metadata, aiReadExclusions: rules.length ? rules : undefined },
            } : current)}
            onCompile={signal => compile(undefined, signal)} onBuildSubmission={(selection, signal) => compile(selection, signal)}
            onExternalSubmission={(include, excluded) => {
              resetSubmissionBuild()
              setIncludeDrafts(include)
              setSubmissionExcluded(new Set(excluded))
              setSubmissionOpen(true)
            }} onLayout={setAiPlacement} />}
        </RightToolPanel>
        </ResizablePanel>
      </ResizablePanelGroup>

      <section aria-label="Writing tools" className="flex min-h-0 max-h-[42%] shrink-0 flex-col border-t bg-workbench-panel [@media(max-height:550px)]:max-h-[32%]">
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 px-1.5 py-1 sm:gap-1 sm:px-2">
          {([
            ['problems', 'Problems', CircleAlert], ['references', 'References', BookOpen], ['cross-references', 'Cross-references', Link2],
            ['review', 'Review', ListChecks],
          ] as const).map(([tab, label, Icon]) => <Button key={tab} size="sm" variant={panel === tab ? 'secondary' : 'ghost'}
            className="gap-1 px-1.5 text-xs sm:gap-1.5 sm:px-3 sm:text-sm" aria-expanded={panel === tab} aria-controls="writing-tools-content"
            onClick={() => {
              if (tab === 'review') setReviewCursor({ path: selected, line: editorRef.current?.getPosition()?.lineNumber ?? 1 })
              if (!aiDocked && !wideTools) setAiOpen(false)
              setPanel(current => current === tab ? null : tab)
            }}>
            <Icon className="hidden sm:block" /> {label}
            {tab === 'problems' && (problems.length > 0 || error || currentWarnings) && <span className={currentDiagnostics.some(problem => problem.severity === 'error') || error
              ? 'rounded-full bg-red-100 px-1.5 text-xs text-red-900' : 'rounded-full bg-amber-100 px-1.5 text-xs text-amber-900'}>
              {problems.length || (error ? 'Failed' : 'Warnings')}
            </span>}
          </Button>)}
          {panel && <Button size="icon-sm" variant="ghost" aria-label="Collapse writing tools" className="ml-auto"
            onClick={() => setPanel(null)}><X /></Button>}
        </div>
        <div id="writing-tools-content" hidden={!panel} className={panel ? 'h-[min(34dvh,20rem)] min-h-0 overflow-auto border-t' : undefined}>
          {panel === 'problems' && <div className="space-y-3 p-3">
            {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}
            {currentWarnings && !currentDiagnostics.length && <p className="text-sm text-amber-800">Compilation succeeded with warnings. See the compiler log for details.</p>}
            {!problems.length && !error && !currentWarnings && <p className="text-sm text-slate-600">No problems detected.</p>}
            <ul className="space-y-1">
              {problems.map((problem, index) => <li key={[problem.path, problem.line, index].join(':')}>
                <button type="button" onClick={() => openFile(problem.path, problem.line, problem.location, true)}
                  disabled={!sourcePaths.has(problem.path)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-workbench-selection disabled:opacity-60">
                  <CircleAlert aria-hidden className={'mt-0.5 size-4 shrink-0 ' + (problem.severity === 'error' ? 'text-red-600' : 'text-amber-600')} />
                  <span className="sr-only">{problem.severity === 'error' ? 'Compile error' : 'Warning'}</span>
                  <span className="min-w-0"><span className="block break-words text-sm">{problem.message}</span>
                    <span className="block break-all font-mono text-xs text-slate-600">{problem.path}:{problem.line}</span></span>
                </button>
              </li>)}
            </ul>
            {log && <details className="rounded-md border p-2 text-xs" open={!currentDiagnostics.length && Boolean(error)}>
              <summary className="cursor-pointer font-medium">Compiler log{diagnosticsStale && ' · Previous source snapshot'}</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{log}</pre>
            </details>}
          </div>}
          {panel === 'references' && <ReferencesPanel project={workingProject} entries={bibliography} path={selected} draft={draft}
            canInsert={isTex && !readOnly && !locked} onInsert={insertReference} onLocate={locate} canvasAction={referenceCanvasAction}
            onRename={canRefactorReferences ? from => openReferenceOperation({ kind: 'citation', from }) : undefined}
            onMerge={canRefactorReferences && [...sourcePaths].some(path => /\.bib$/i.test(path) && editableSource(project, path) !== undefined)
              ? () => openReferenceOperation({ kind: 'merge' }) : undefined} />}
          {panel === 'cross-references' && <CrossReferencesPanel index={crossReferences} titles={labelTitles} onLocate={locate}
            canInsert={isTex && !readOnly && !locked} onInsert={(command, key) => insertReference(key, command)}
            onRename={canRefactorReferences ? from => openReferenceOperation({ kind: 'label', from }) : undefined} />}
          {panel === 'review' && <WritingReviewPanel key={selected} path={selected} line={reviewCursor?.path === selected ? reviewCursor.line : 1}
            catalog={catalog} canvas={outlineCanvas.canvas} actions={review} canSelect={isTex && currentFile?.type !== 'generated'}
            readSelection={readReviewSelection} onLocate={locate} onOpenRevision={nodeId => setRevision({ cardId: nodeId })} />}
        </div>
      </section>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 border-t bg-workbench-explorer px-3 py-1 text-xs text-workbench-muted">
        <div className="flex items-center gap-2">
          <span role="status" className={dirty ? 'font-medium text-amber-800' : undefined}>
            {draftStatus}
          </span>
          {dirty && <Button variant="link" size="sm" className="h-6 px-0 text-slate-600" onClick={() => {
            if (confirmDiscard()) void discard(draftPaths)
          }} disabled={locked}>Discard drafts</Button>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3">
          <span>{/\.bib$/i.test(selected) ? 'BibTeX' : isTex ? 'LaTeX' : 'Plain text'} · Ctrl / ⌘ + S to save</span>
          {storage && journal.key && <Button variant="outline" size="sm" className="h-7" disabled={locked}
            onClick={() => setRevision({})}>Revision rounds</Button>}
          {activeTemplate && <span aria-label="当前编译模板" title={activeTemplate.name}>{activeTemplate.name} · {activeTemplate.origin.version}</span>}
          <Button variant="outline" size="sm" className="h-7" disabled={!main || locked || (!activeTemplate && Boolean(conflicts.length))}
            onClick={() => setTemplateExport({ files: workingProject.files, main })}>更换模板</Button>
          <Button variant="outline" size="sm" className="h-7" disabled={!main || locked} onClick={() => setSubmissionOpen(true)}>Prepare submission</Button>
        </div>
      </footer>
      {informationOpen && <ProjectInformationDialog information={information} projectName={project.metadata.projectName}
        onSave={saveProjectInformation} onClose={() => setInformationOpen(false)} />}
      {templateExport && <TemplateExportDialog {...templateExport} information={information} onEditInformation={() => {
        setTemplateExport(undefined)
        setInformationOpen(true)
      }} active={activeTemplate} database={storage ?? undefined} originalName={originalTemplateName}
        originalOrigin={project.metadata.templateOrigin}
        onSetCurrent={storage && storageKey ? setCurrentTemplate : undefined} onClose={() => setTemplateExport(undefined)} />}
      {compileSettingsOpen && <CompileSettingsDialog main={main} paths={texFiles.map(file => file.path)} profile={profile}
        onSave={saveCompileSettings} onClose={() => setCompileSettingsOpen(false)} />}
      {submission && <SubmissionDialog main={main} compileEntry={activeTemplate?.main} drafts={draftPaths} includeDrafts={includeDrafts} paths={submission.paths}
        target={submission.target} working={workingProject} onEditInformation={() => {
          setSubmissionOpen(false)
          setInformationOpen(true)
        }} onEvidenceLocate={(path, line) => {
          setSubmissionOpen(false)
          openFile(path, line)
        }}
        excluded={submission.excluded} issues={submission.issues} compilerIssues={submissionCompilerIssues}
        compatibility={activeEngine ? { engine: activeEngine, configuredEngine: activeEngine, eps: false, nestedStyles: false } : submission.compatibility}
        external={freshExternal} staleExternal={Boolean(externalSubmission && !freshExternal)}
        onPrepareExternal={prepareExternalSubmission} onAttachExternal={attachExternalPdf}
        conflicting={includeDrafts && conflicts.some(path => !submission.excluded.has(path))}
        ready={!locked} busy={busy} error={submissionError} log={submissionLog} result={freshResult} database={storage} storageKey={journal.key}
        stageOptions={submissionStageOptions} templateOriginId={activeTemplate?.origin.id ?? templateId} stage={stage} onStage={value => { setSelectedStage(value); resetSubmissionBuild() }}
        onBlindCover={cover => { setUploadedBlindCover(cover); resetSubmissionBuild() }}
        staleStage={Boolean(stage && submissionResult?.build.layoutReport?.delivery && !freshResult)}
        layoutAvailable={Boolean(stage || activeTemplate || layoutPreflightProfile(submission.target.files, templateId))} layoutFindings={freshResult ? submissionResult?.layout : undefined} generatedLayout={Boolean(activeTemplate)}
        onDraftChoice={include => { setIncludeDrafts(include); resetSubmissionBuild(true) }}
        onToggle={path => {
          setSubmissionExcluded(current => {
            const next = new Set(current)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
          })
          resetSubmissionBuild(true)
        }}
        onClose={() => setSubmissionOpen(false)} onLocate={issue => {
          const { location } = issue
          if (!location) return
          const checked = submission.target.files.get(location.path)
          const working = workingFiles.get(location.path)
          setSubmissionOpen(false)
          if (checked && working && 'content' in checked && 'content' in working && checked.content === working.content) locate(location)
          else openFile(location.path, location.line)
        }}
        onStartRevision={submissionId => { setSubmissionOpen(false); setRevision({ submissionId }) }}
        onCompile={() => {
          resetSubmissionBuild()
          const selection = getSubmissionSelection()
          if (selection) void compile(selection)
        }} />}
      {revision && storage && journal.key && <RevisionRoundsDialog database={storage} storageKey={journal.key}
        initialSubmission={revision.submissionId} initialCard={revision.cardId} roundId={revisionRoundId} onSelectRound={setRevisionRoundId}
        current={workingProject} catalog={catalog} cards={review.items} drafts={revisionDraftPaths} conflicts={conflicts}
        openSource={(path, location) => { setRevision(undefined); openFile(path, location?.line, location) }}
        openCanvas={card => { setRevision(undefined); review.locateCanvas(card) }} onClose={() => setRevision(undefined)} />}
      {fileOperation && <FileOperationDialog request={fileOperation.request} project={project} writing={{ drafts, view: fileOperation.view }}
        main={main} onClose={() => setFileOperation(undefined)} onApply={applyFileOperation} />}
      {referenceOperation && <ReferenceOperationDialog request={referenceOperation.request} project={project}
        writing={{ drafts, view: referenceOperation.view }} onClose={() => setReferenceOperation(undefined)}
        onApply={async (plan, before, prior) => {
          if (before !== project || prior.drafts !== drafts) throw new Error('Project data changed. Go back and preview the latest changes.')
          await writeFileOperation(before, plan.project, plan.writing)
          setFileUndo({ before, writing: prior, after: plan, references: true })
        }} />}
      {comparison && comparedDraft && <Dialog open onOpenChange={open => { if (!open) setComparison(undefined) }}>
        <DialogContent className="flex h-[85dvh] min-h-0 flex-col sm:max-w-[90vw]">
          <DialogTitle>Compare local draft</DialogTitle>
          <DialogDescription className="break-all">{comparison}. {comparedSource === undefined
            ? 'This file is missing or no longer editable. Copy the local text before discarding it.'
            : 'The project file changed after this draft was created. Choosing the draft keeps it local until you save.'}</DialogDescription>
          <div className="grid grid-cols-2 gap-2 text-sm font-medium"><span>Current project source</span><span>Local draft</span></div>
          <div className="min-h-0 flex-1 overflow-hidden rounded border">
            <WritingDraftComparison path={comparison} original={comparedSource ?? ''} modified={comparedDraft.text} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={locked} onClick={async () => {
              await discard([comparison])
              setComparison(undefined)
            }}>Discard local draft</Button>
            <Button disabled={locked || comparedSource === undefined} onClick={() => {
              if (comparedSource === undefined) return
              journal.change(comparison, { base: comparedSource, text: comparedDraft.text })
              setComparison(undefined)
              openFile(comparison)
            }}>Keep local draft</Button>
          </div>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
