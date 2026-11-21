'use client'

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Cable, Hand, Maximize, MousePointer2, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import {
  Background, Controls, getViewportForBounds, Handle, MarkerType, Position, ReactFlow,
  type Connection, type EdgeChangeset, type Node, type NodeChangeset, type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RESEARCH_NODE_META, type ResearchNodeType } from '@/app/research/research-node'
import {
  removeResearchNodes, validResearchConnection, type ResearchPage, type ResearchNode,
} from '@/lib/project/research-graph'
import { researchNodeTitle as nodeTitle } from '@/lib/project/canvas-search'

type FlowNode = Node<ResearchNode['data'], 'research'>
type CanvasTool = 'select' | 'pan' | 'connect'
const alternatePanButtons = [1, 2]
const canvasTools = [
  ['select', 'Select', 'V', MousePointer2],
  ['pan', 'Pan', 'H', Hand],
  ['connect', 'Connect', 'C', Cable],
] as const

const ResearchCard = memo(function ResearchCard({ data, selected }: NodeProps<FlowNode>) {
  const subsection = Boolean(data.parentId)
  const title = nodeTitle(data)
  return (
    <article className={`w-80 rounded-lg border bg-card text-card-foreground shadow-sm ${subsection ? 'border-blue-500' : ''} ${selected ? 'ring-2 ring-primary' : ''}`}>
      <Handle type="target" position={Position.Left} aria-label="Incoming connection" />
      <header className={`flex items-start gap-2 rounded-t-lg border-b px-3 py-2 ${subsection ? 'bg-blue-50 dark:bg-blue-950' : 'bg-muted/60'}`}>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold">
            {data.level > 1 && <span aria-label={`Heading level ${data.level}`} className="text-xs text-muted-foreground">{'└'.repeat(data.level - 1)}</span>}
            <span className="[overflow-wrap:anywhere]">{title}</span>
            {data.metadata?.sectionNumber && <span className="text-xs text-muted-foreground">({data.metadata.sectionNumber})</span>}
          </h3>
          {data.customLabel && <p className="text-xs text-muted-foreground">{RESEARCH_NODE_META[data.section].label}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {data.metadata?.imported && <span title={data.metadata.importSource}
            className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-900">imported</span>}
          {subsection && <span aria-label="Subsection" className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-900">sub</span>}
        </div>
      </header>
      {Boolean(data.tags?.length) && <ul aria-label="Node tags" className="flex flex-wrap gap-1 border-b px-3 py-1.5">
        {data.tags?.map((tag, index) => <li key={index}
          className="max-w-full rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{tag}</li>)}
      </ul>}
      <p className="nowheel max-h-28 overflow-auto px-3 py-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
        {data.content || 'Select this node to edit its content.'}
      </p>
      <Handle type="source" position={Position.Right} aria-label="Outgoing connection" />
    </article>
  )
})

const nodeTypes = { research: ResearchCard }
const edgeDefaults = { markerEnd: { type: MarkerType.ArrowClosed } }

function reconcileFlowNodes(projectNodes: ResearchNode[], selectedIds: string[], current: FlowNode[]) {
  const existing = new Map(current.map(node => [node.id, node]))
  const selection = new Set(selectedIds)
  return projectNodes.map(node => {
    const previous = existing.get(node.id)
    const position = previous?.dragging ? previous.position : node.position
    const selected = selection.has(node.id)
    if (previous && previous.data === node.data && previous.selected === selected
      && previous.position.x === position.x && previous.position.y === position.y) return previous
    return { ...previous, ...node, type: 'research' as const, position, selected, ariaLabel: nodeTitle(node.data) }
  })
}

function canSetParent(page: ResearchPage, nodeId: string, parentId: string) {
  const byId = new Map(page.nodes.map(node => [node.id, node.data.parentId]))
  const seen = new Set([nodeId])
  for (let id: string | undefined = parentId; id; id = byId.get(id)) {
    if (seen.has(id)) return false
    seen.add(id)
  }
  return true
}

function NodeDetails({ node, page, onEdit, onFinishEdit, onConnect, onOpenSource, sourceUnavailable, onUnlinkSource }: {
  node: ResearchNode
  page: ResearchPage
  onEdit: (data: ResearchNode['data'], field?: string) => void
  onFinishEdit: () => void
  onConnect: (target: string) => void
  onOpenSource?: () => void
  sourceUnavailable: boolean
  onUnlinkSource?: () => void
}) {
  const { data } = node
  const others = page.nodes.filter(other => other.id !== node.id)
  const [target, setTarget] = useState('')
  return (
    <aside aria-label="Research node properties" className="min-h-0 w-full shrink-0 space-y-3 overflow-auto border-t bg-background p-3 max-sm:max-h-[45%] max-sm:shrink sm:w-72 sm:border-t-0 sm:border-l">
      <h2 className="font-semibold">Research Node</h2>
      {(onOpenSource || onUnlinkSource) && <div className="flex flex-wrap gap-2">
        {onOpenSource && <Button size="sm" variant="outline" onClick={onOpenSource}>Open source</Button>}
        {onUnlinkSource && <Button size="sm" variant="ghost" onClick={onUnlinkSource}>Remove source link</Button>}
      </div>}
      {sourceUnavailable && <p className="text-sm text-muted-foreground">Linked section unavailable. Use the Writing outline to bind this node again.</p>}
      <label className="grid gap-1 text-sm">Section type
        <select className="rounded border bg-background p-2" value={data.section}
          onChange={event => onEdit({ ...data, section: event.target.value as ResearchNodeType })}>
          {Object.entries(RESEARCH_NODE_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Section title
        <Input value={data.customLabel ?? ''} onBlur={onFinishEdit}
          onChange={event => onEdit({ ...data, customLabel: event.target.value }, 'title')} />
      </label>
      <label className="grid gap-1 text-sm">Node content
        <Textarea rows={7} value={data.content} onBlur={onFinishEdit}
          onChange={event => onEdit({ ...data, content: event.target.value }, 'content')} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm">Level
          <select className="rounded border bg-background p-2" value={data.level}
            onChange={event => onEdit({ ...data, level: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(level => <option key={level}>{level}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Order
          <Input type="number" value={data.order} onBlur={onFinishEdit} onChange={event => {
            if (Number.isFinite(event.target.valueAsNumber)) onEdit({ ...data, order: event.target.valueAsNumber }, 'order')
          }} />
        </label>
      </div>
      <label className="grid gap-1 text-sm">Parent section
        <select className="min-w-0 rounded border bg-background p-2" value={data.parentId ?? ''}
          onChange={event => onEdit({ ...data, parentId: event.target.value || undefined })}>
          <option value="">None (top-level)</option>
          {others.filter(other => canSetParent(page, node.id, other.id)).map(other =>
            <option key={other.id} value={other.id}>{nodeTitle(other.data)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Section number
        <Input value={data.metadata?.sectionNumber ?? ''} onBlur={onFinishEdit} onChange={event => onEdit({
          ...data, metadata: { ...data.metadata, sectionNumber: event.target.value || undefined },
        }, 'number')} />
      </label>
      <div className="space-y-1 text-sm">
        <label className="grid gap-1">Add tag
          <Input placeholder="Press Enter to add" onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            const input = event.currentTarget
            const tag = input.value.trim()
            if (tag && !data.tags?.includes(tag)) onEdit({ ...data, tags: [...(data.tags ?? []), tag] })
            input.value = ''
          }} />
        </label>
        {data.tags?.map((tag, index) => (
          <Button key={index} variant="outline" size="sm" className="mr-1"
            aria-label={`Remove tag ${tag}`} onClick={() => onEdit({ ...data, tags: data.tags?.filter((_, i) => i !== index) })}>
            {tag} ×
          </Button>
        ))}
      </div>
      <div className="space-y-2 border-t pt-2">
        <label className="grid gap-1 text-sm">Connect to
          <select className="min-w-0 rounded border bg-background p-2" value={target}
            onChange={event => setTarget(event.target.value)}>
            <option value="">Select a target</option>
            {others.map(other => <option key={other.id} value={other.id}>{nodeTitle(other.data)}</option>)}
          </select>
        </label>
        <Button size="sm" variant="outline" disabled={!others.some(other => other.id === target)}
          onClick={() => onConnect(target)}>Add Connection</Button>
      </div>
    </aside>
  )
}

export function ResearchGraphEditor({ page, updatePage, editPage, onFinishEdit, onHistory, canUndo, canRedo,
  sample, actions, sourceStatus, onOpenSource, onUnlinkSource, jumpTo, onJumpHandled }: {
  page: ResearchPage
  updatePage: (update: (current: ResearchPage) => ResearchPage) => void
  editPage: (update: (current: ResearchPage) => ResearchPage, group?: string) => void
  onFinishEdit: () => void
  onHistory: (direction: 'undo' | 'redo') => void
  canUndo: boolean
  canRedo: boolean
  sample: boolean
  actions: HTMLElement | null
  sourceStatus: (node: ResearchNode['data']) => 'available' | 'unavailable' | undefined
  onOpenSource: (node: ResearchNode['data']) => void
  onUnlinkSource: (nodeId: string) => void
  jumpTo?: string
  onJumpHandled: () => void
}) {
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [nodeState, setNodeState] = useState(() => ({
    projectNodes: page.nodes, selection: selectedNodes, nodes: reconcileFlowNodes(page.nodes, selectedNodes, []),
  }))
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode>>()
  const [error, setError] = useState('')
  const [tool, setTool] = useState<CanvasTool>('select')
  const [connectionStart, setConnectionStart] = useState<string>()
  const canvasElement = useRef<HTMLDivElement>(null)
  const canJump = jumpTo !== undefined && page.nodes.some(node => node.id === jumpTo)
  const activeNode = selectedNodes.length === 1 ? page.nodes.find(node => node.id === selectedNodes[0]) : undefined
  if (nodeState.projectNodes !== page.nodes || nodeState.selection !== selectedNodes) {
    setNodeState({
      projectNodes: page.nodes, selection: selectedNodes,
      nodes: reconcileFlowNodes(page.nodes, selectedNodes, nodeState.nodes),
    })
  }
  const edges = useMemo(() => page.edges.map(edge => ({
    ...edge, selected: selectedEdges.includes(edge.id), reconnectable: false,
  })), [page.edges, selectedEdges])
  const sourceNode = page.nodes.find(node => node.id === connectionStart)
  const nodes = useMemo(() => tool === 'connect' && sourceNode
    ? nodeState.nodes.map(node => node.id === sourceNode.id ? { ...node, className: 'rounded-lg ring-2 ring-indigo-500' } : node)
    : nodeState.nodes, [nodeState.nodes, sourceNode, tool])

  useEffect(() => {
    if (!canJump || !jumpTo || activeNode?.id === jumpTo) return
    const selectFrame = requestAnimationFrame(() => {
      setSelectedNodes([jumpTo])
      setSelectedEdges([])
    })
    return () => cancelAnimationFrame(selectFrame)
  }, [activeNode?.id, canJump, jumpTo])

  useEffect(() => {
    if (!flow?.viewportInitialized || !jumpTo || activeNode?.id !== jumpTo) return
    // Selecting the node opens its properties and changes the usable canvas size.
    const frame = requestAnimationFrame(() => {
      const container = canvasElement.current
      const target = flow.getInternalNode(jumpTo)
      if (container && target && container.clientWidth && container.clientHeight) {
        const bounds = {
          ...target.internals.positionAbsolute,
          width: target.measured.width ?? 320, height: target.measured.height ?? 104,
        }
        const viewport = getViewportForBounds(bounds, container.clientWidth, container.clientHeight, 0.15, 1.1, 0.2)
        void flow.setViewport(viewport)
        updatePage(current => ({ ...current, viewport }))
        container.focus({ preventScroll: true })
      }
      onJumpHandled()
    })
    return () => cancelAnimationFrame(frame)
  }, [activeNode?.id, flow, jumpTo, onJumpHandled, updatePage])

  function changeNodes(changes: NodeChangeset<FlowNode>) {
    // React Flow uses measured dimensions to keep controlled nodes visible.
    // Keep its transient changes in the canvas instead of rebuilding every node.
    setNodeState(current => ({ ...current, nodes: changes.applyTo(current.nodes) }))
    const selected = changes.getByType('select')
    const removed = new Set(changes.getByType('remove').map(change => change.id))
    const committed = new Map(changes.getByType('position').flatMap(change =>
      change.position && !change.dragging ? [[change.id, change.position] as const] : []))
    if (selected.length || removed.size) setSelectedNodes(current => {
      const next = new Set(current.filter(id => !removed.has(id)))
      for (const change of selected) {
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      }
      return [...next]
    })
    if (removed.size || committed.size) editPage(current => {
      const next = removed.size ? removeResearchNodes(current, removed) : current
      let moved = false
      const nodes = next.nodes.map(node => {
        const position = committed.get(node.id)
        if (!position || (position.x === node.position.x && position.y === node.position.y)) return node
        moved = true
        return { ...node, position }
      })
      return moved ? { ...next, nodes } : next
    })
  }

  function changeEdges(changes: EdgeChangeset) {
    const removed = new Set(changes.getByType('remove').map(change => change.id))
    const selected = changes.getByType('select')
    if (removed.size) editPage(current => {
      const edges = current.edges.filter(edge => !removed.has(edge.id))
      return edges.length === current.edges.length ? current : { ...current, edges }
    })
    if (selected.length || removed.size) setSelectedEdges(current => {
      const next = new Set(current.filter(id => !removed.has(id)))
      for (const change of selected) {
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      }
      return [...next]
    })
  }

  function connect({ source, target }: Pick<Connection, 'source' | 'target'>) {
    if (!validResearchConnection(page, source, target)) {
      setError('Choose a different target. Connections cannot repeat, point to themselves, or create a cycle.')
      return false
    }
    setError('')
    const edge = { id: crypto.randomUUID(), source, target }
    editPage(current => validResearchConnection(current, source, target)
      ? { ...current, edges: [...current.edges, edge] } : current)
    setConnectionStart(undefined)
    return true
  }

  function pickTool(next: CanvasTool) {
    setTool(next)
    setConnectionStart(undefined)
    setError('')
  }

  function chooseEndpoint(id: string) {
    if (tool !== 'connect') return
    if (sourceNode) connect({ source: sourceNode.id, target: id })
    else {
      setConnectionStart(id)
      setError('')
    }
  }

  function addNode() {
    const id = crypto.randomUUID()
    const box = document.getElementById('research-flow')?.getBoundingClientRect()
    const position = box && flow ? flow.screenToFlowPosition({
      x: box.left + box.width / 2 - 160, y: box.top + box.height / 2 - 50,
    }) : { x: 50, y: 50 }
    editPage(current => {
      let y = position.y
      while (current.nodes.some(node => Math.abs(node.position.x - position.x) < 330 && Math.abs(node.position.y - y) < 170)) y += 190
      return {
        ...current, nodes: [...current.nodes, {
          id, position: { x: position.x, y }, data: { section: 'custom', content: '', order: current.nodes.length, level: 1 },
        }],
      }
    })
    setSelectedNodes([id])
    setSelectedEdges([])
  }

  function deleteSelection() {
    const ids = new Set(selectedNodes)
    editPage(current => {
      const next = current.nodes.some(node => ids.has(node.id)) ? removeResearchNodes(current, ids) : current
      const edges = next.edges.filter(edge => !selectedEdges.includes(edge.id))
      return edges.length === next.edges.length ? next : { ...next, edges }
    })
    setSelectedNodes([])
    setSelectedEdges([])
    setConnectionStart(undefined)
    canvasElement.current?.focus({ preventScroll: true })
  }

  const canDelete = page.nodes.some(node => selectedNodes.includes(node.id)) || page.edges.some(edge => selectedEdges.includes(edge.id))

  function moveHistory(direction: 'undo' | 'redo') {
    setSelectedNodes([])
    setSelectedEdges([])
    setConnectionStart(undefined)
    setError('')
    onHistory(direction)
    canvasElement.current?.focus({ preventScroll: true })
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable="true"]')) return
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === 'z' || key === 'y')) {
      event.preventDefault()
      const redo = key === 'y' || event.shiftKey
      if (redo ? canRedo : canUndo) moveHistory(redo ? 'redo' : 'undo')
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (key === 'escape' && tool === 'connect') {
      pickTool('select')
    } else if ((key === 'delete' || key === 'backspace') && tool === 'select' && canDelete) {
      event.preventDefault()
      deleteSelection()
    } else if (key === 'enter' && tool === 'connect') {
      const id = target.closest<HTMLElement>('.react-flow__node')?.dataset.id
      if (id) {
        event.preventDefault()
        event.stopPropagation()
        chooseEndpoint(id)
      }
    } else {
      const shortcut = canvasTools.find(([, , letter]) => letter.toLowerCase() === key)
      if (shortcut) pickTool(shortcut[0])
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" onKeyDownCapture={handleKey}>
      {actions && createPortal(
        <Button size="sm" onClick={addNode}><Plus /> Add node</Button>, actions,
      )}
      <div className="shrink-0 border-b bg-background p-2">
        <div role="group" aria-label="Canvas tools" className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-muted p-0.5">
            {canvasTools.map(([mode, label, shortcut, Icon]) => (
              <Button key={mode} size="sm" variant={tool === mode ? 'outline' : 'ghost'} aria-pressed={tool === mode}
                aria-label={label} title={`${label} (${shortcut})`} onClick={() => pickTool(mode)}><Icon /><span className="hidden sm:inline">{label}</span></Button>
            ))}
          </div>
          <div className="flex gap-0.5">
            <Button size="icon-sm" variant="ghost" aria-label="Undo" title="Undo (Ctrl / Cmd + Z)" disabled={!canUndo}
              onClick={() => moveHistory('undo')}><Undo2 /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Redo" title="Redo (Ctrl / Cmd + Shift + Z)" disabled={!canRedo}
              onClick={() => moveHistory('redo')}><Redo2 /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete Selection" title="Delete selection" disabled={!canDelete}
              onClick={deleteSelection}><Trash2 /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="Fit View" title="Fit all nodes" disabled={!page.nodes.length}
              onClick={() => void flow?.fitView()}><Maximize /></Button>
          </div>
          {tool === 'connect' && <p role="status" className="text-xs text-muted-foreground">
            {sourceNode ? `From ${nodeTitle(sourceNode.data)} · Choose a target · Esc to cancel` : 'Choose a source node, or drag from an outgoing handle.'}
          </p>}
        </div>
        {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div id="research-flow" className="relative min-h-24 min-w-0 flex-1 sm:min-h-40" ref={canvasElement} tabIndex={-1}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultEdgeOptions={edgeDefaults}
            className="[color-scheme:light] [--xy-background-color:var(--muted)] [--xy-edge-stroke:var(--muted-foreground)] [--xy-edge-stroke-width:2] dark:[color-scheme:dark]"
            defaultMarkerColor={null}
            onInit={setFlow} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={connect}
            onNodeClick={(_, node) => chooseEndpoint(node.id)}
            onPaneClick={() => { setConnectionStart(undefined); setError(''); canvasElement.current?.focus({ preventScroll: true }) }}
            isValidConnection={connection => validResearchConnection(page, connection.source, connection.target)}
            nodesDraggable={tool === 'select'} nodesConnectable={tool === 'connect'} connectOnClick={tool === 'connect'}
            elementsSelectable={tool === 'select'} selectionOnDrag={tool === 'select'} deleteKeyCode={null}
            panOnDrag={tool === 'pan' || alternatePanButtons}
            defaultViewport={page.viewport} fitView={sample}
            onMoveEnd={(_, viewport) => updatePage(current =>
              viewport.x === current.viewport.x && viewport.y === current.viewport.y && viewport.zoom === current.viewport.zoom
                ? current : { ...current, viewport })}
            edgesReconnectable={false} minZoom={0.15} maxZoom={3}>
            <Background />
            <Controls showInteractive={false} showFitView={false} />
          </ReactFlow>
          {!page.nodes.length && <p className="pointer-events-none absolute inset-x-4 top-6 text-center text-sm text-muted-foreground">
            Add a research node to organize your paper.
          </p>}
        </div>
        {activeNode && (
          <NodeDetails key={activeNode.id} node={activeNode} page={page}
            onOpenSource={sourceStatus(activeNode.data) === 'available' ? () => onOpenSource(activeNode.data) : undefined}
            sourceUnavailable={sourceStatus(activeNode.data) === 'unavailable'}
            onUnlinkSource={activeNode.data.sourceAnchor ? () => onUnlinkSource(activeNode.id) : undefined}
            onFinishEdit={onFinishEdit}
            onEdit={(data, field) => editPage(current => ({
              ...current, nodes: current.nodes.map(node => node.id === activeNode.id ? { ...node, data } : node),
            }), field && `${activeNode.id}:${field}`)}
            onConnect={target => connect({ source: activeNode.id, target })} />
        )}
      </div>
    </div>
  )
}
