'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Connection, type EdgeChangeset, type Node, type NodeChangeset, type NodeProps,
  type ReactFlowInstance, type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RESEARCH_NODE_META, type ResearchNodeType } from '@/app/research/research-node'
import {
  removeResearchNodes, validResearchConnection, type ResearchPage, type ResearchNode,
} from '@/lib/project/research-graph'

type FlowNode = Node<ResearchNode['data'], 'research'>

function nodeTitle(data: ResearchNode['data']) {
  return data.customLabel || RESEARCH_NODE_META[data.section].label
}

function ResearchCard({ data, selected }: NodeProps<FlowNode>) {
  return (
    <article className={`w-80 rounded-lg border bg-card p-4 text-card-foreground shadow-sm ${selected ? 'ring-2 ring-primary' : ''}`}>
      <Handle type="target" position={Position.Left} aria-label="Incoming connection" />
      <h3 className="break-words font-semibold">{nodeTitle(data)}</h3>
      {data.customLabel && <p className="text-xs text-muted-foreground">{RESEARCH_NODE_META[data.section].label}</p>}
      <p className="mt-2 line-clamp-5 whitespace-pre-wrap break-words text-sm">{data.content || 'Select this node to edit its content.'}</p>
      {data.tags?.length ? <p className="mt-2 truncate text-xs text-muted-foreground">{data.tags.join(' · ')}</p> : null}
      <Handle type="source" position={Position.Right} aria-label="Outgoing connection" />
    </article>
  )
}

const nodeTypes = { research: ResearchCard }
const edgeDefaults = { markerEnd: { type: MarkerType.ArrowClosed } }

function canSetParent(page: ResearchPage, nodeId: string, parentId: string) {
  const byId = new Map(page.nodes.map(node => [node.id, node.data.parentId]))
  const seen = new Set([nodeId])
  for (let id: string | undefined = parentId; id; id = byId.get(id)) {
    if (seen.has(id)) return false
    seen.add(id)
  }
  return true
}

function NodeDetails({ node, page, onEdit, onConnect, onOpenSource }: {
  node: ResearchNode
  page: ResearchPage
  onEdit: (data: ResearchNode['data']) => void
  onConnect: (target: string) => void
  onOpenSource?: () => void
}) {
  const { data } = node
  const others = page.nodes.filter(other => other.id !== node.id)
  const [target, setTarget] = useState('')
  return (
    <aside aria-label="Research node properties" className="min-h-0 w-full shrink-0 space-y-3 overflow-auto border-t bg-background p-3 max-sm:max-h-[45%] max-sm:shrink sm:w-72 sm:border-t-0 sm:border-l">
      <h2 className="font-semibold">Research Node</h2>
      {onOpenSource && <Button size="sm" variant="outline" onClick={onOpenSource}>Open source</Button>}
      <label className="grid gap-1 text-sm">Section type
        <select className="rounded border bg-background p-2" value={data.section}
          onChange={event => onEdit({ ...data, section: event.target.value as ResearchNodeType })}>
          {Object.entries(RESEARCH_NODE_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">Section title
        <Input value={data.customLabel ?? ''} onChange={event => onEdit({ ...data, customLabel: event.target.value })} />
      </label>
      <label className="grid gap-1 text-sm">Node content
        <Textarea rows={7} value={data.content} onChange={event => onEdit({ ...data, content: event.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-sm">Level
          <select className="rounded border bg-background p-2" value={data.level}
            onChange={event => onEdit({ ...data, level: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(level => <option key={level}>{level}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Order
          <Input type="number" value={data.order} onChange={event => {
            if (Number.isFinite(event.target.valueAsNumber)) onEdit({ ...data, order: event.target.valueAsNumber })
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
        <Input value={data.metadata?.sectionNumber ?? ''} onChange={event => onEdit({
          ...data, metadata: { ...data.metadata, sectionNumber: event.target.value || undefined },
        })} />
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

export function ResearchGraphEditor({ page, updatePage, sample, actions, sourceNodes, onOpenSource }: {
  page: ResearchPage
  updatePage: (update: (current: ResearchPage) => ResearchPage) => void
  sample: boolean
  actions: HTMLElement | null
  sourceNodes: ReadonlySet<ResearchNode['data']>
  onOpenSource: (node: ResearchNode['data']) => void
}) {
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [dragPositions, setDragPositions] = useState<Record<string, XYPosition>>({})
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode>>()
  const [error, setError] = useState('')
  const activeNode = selectedNodes.length === 1 ? page.nodes.find(node => node.id === selectedNodes[0]) : undefined
  const nodes = useMemo<FlowNode[]>(() => page.nodes.map(node => ({
    ...node, type: 'research', position: dragPositions[node.id] ?? node.position,
    selected: selectedNodes.includes(node.id), ariaLabel: nodeTitle(node.data),
  })), [page.nodes, selectedNodes, dragPositions])
  const edges = useMemo(() => page.edges.map(edge => ({
    ...edge, selected: selectedEdges.includes(edge.id), reconnectable: false,
  })), [page.edges, selectedEdges])

  function changeNodes(changes: NodeChangeset<FlowNode>) {
    const selected = changes.getByType('select')
    const removed = new Set(changes.getByType('remove').map(change => change.id))
    const positions = changes.getByType('position').filter(change => change.position)
    const committed = new Map(positions.filter(change => !change.dragging).map(change => [change.id, change.position!]))
    if (selected.length || removed.size) setSelectedNodes(current => {
      const next = new Set(current.filter(id => !removed.has(id)))
      for (const change of selected) {
        if (change.selected) next.add(change.id)
        else next.delete(change.id)
      }
      return [...next]
    })
    if (positions.length || removed.size) setDragPositions(current => {
      const next = { ...current }
      for (const id of removed) delete next[id]
      for (const change of positions) {
        if (change.dragging) next[change.id] = change.position!
        else delete next[change.id]
      }
      return next
    })
    if (removed.size || committed.size) updatePage(current => {
      const next = removed.size ? removeResearchNodes(current, removed) : current
      return { ...next, nodes: next.nodes.map(node => {
        const position = committed.get(node.id)
        return position ? { ...node, position } : node
      }) }
    })
  }

  function changeEdges(changes: EdgeChangeset) {
    const removed = new Set(changes.getByType('remove').map(change => change.id))
    const selected = changes.getByType('select')
    if (removed.size) updatePage(current => ({ ...current, edges: current.edges.filter(edge => !removed.has(edge.id)) }))
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
      return
    }
    setError('')
    const edge = { id: crypto.randomUUID(), source, target }
    updatePage(current => validResearchConnection(current, source, target)
      ? { ...current, edges: [...current.edges, edge] } : current)
  }

  function addNode() {
    const id = crypto.randomUUID()
    const box = document.getElementById('research-flow')?.getBoundingClientRect()
    const position = box && flow ? flow.screenToFlowPosition({
      x: box.left + box.width / 2 - 160, y: box.top + box.height / 2 - 50,
    }) : { x: 50, y: 50 }
    updatePage(current => {
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
    updatePage(current => {
      const next = removeResearchNodes(current, ids)
      return { ...next, edges: next.edges.filter(edge => !selectedEdges.includes(edge.id)) }
    })
    setSelectedNodes([])
    setSelectedEdges([])
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {actions && createPortal(
        <Button size="sm" onClick={addNode}><Plus /> Add node</Button>, actions,
      )}
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Button size="sm" variant="outline" onClick={() => void flow?.fitView()} disabled={!page.nodes.length}>Fit View</Button>
        <Button size="sm" variant="outline" onClick={deleteSelection}
          disabled={!page.nodes.some(node => selectedNodes.includes(node.id)) && !page.edges.some(edge => selectedEdges.includes(edge.id))}>
          Delete Selection
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div id="research-flow" className="relative min-h-24 min-w-0 flex-1 sm:min-h-40">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultEdgeOptions={edgeDefaults}
            className="[color-scheme:light] [--xy-background-color:var(--muted)] [--xy-edge-stroke:var(--muted-foreground)] [--xy-edge-stroke-width:2] dark:[color-scheme:dark]"
            defaultMarkerColor={null}
            onInit={setFlow} onNodesChange={changeNodes} onEdgesChange={changeEdges} onConnect={connect}
            isValidConnection={connection => validResearchConnection(page, connection.source, connection.target)}
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
            onOpenSource={sourceNodes.has(activeNode.data) ? () => onOpenSource(activeNode.data) : undefined}
            onEdit={data => updatePage(current => ({
              ...current, nodes: current.nodes.map(node => node.id === activeNode.id ? { ...node, data } : node),
            }))}
            onConnect={target => connect({ source: activeNode.id, target })} />
        )}
      </div>
    </div>
  )
}
