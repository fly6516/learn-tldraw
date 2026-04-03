import type { Editor, TLArrowBinding, TLShapeId } from 'tldraw'
import type { ResearchNodeShape } from '@/shapes/research/ResearchNodeShape'
import { RESEARCH_NODE_META } from '@/app/research/research-node'

/**
 * Build a topological order of research-node IDs based on arrow connections.
 *
 * Algorithm:
 * 1. Collect all arrows that have BOTH start and end bound to research-node shapes.
 * 2. Build an adjacency graph (A → B means "A comes before B").
 * 3. Run Kahn's algorithm for topological sort.
 * 4. Nodes not involved in any arrow retain their canvas Y-position order.
 *
 * Returns an ordered array of TLShapeIds (research-nodes only).
 */
export function getArrowOrderedShapeIds(editor: Editor): TLShapeId[] | null {
    const shapes = editor.getCurrentPageShapes()
    const researchIds = new Set<TLShapeId>(
        shapes
            .filter((s) => s.type === 'research-node')
            .map((s) => s.id as TLShapeId)
    )

    if (researchIds.size === 0) return null

    // Find all arrow shapes
    const arrowShapes = shapes.filter((s) => s.type === 'arrow')

    if (arrowShapes.length === 0) return null

    // Build directed edges: fromId → toId
    const edges: Array<[TLShapeId, TLShapeId]> = []

    for (const arrow of arrowShapes) {
        const startBindings = editor.getBindingsFromShape<TLArrowBinding>(arrow.id, 'arrow')
            .filter((b) => b.props.terminal === 'start')
        const endBindings = editor.getBindingsFromShape<TLArrowBinding>(arrow.id, 'arrow')
            .filter((b) => b.props.terminal === 'end')

        const startId = startBindings[0]?.toId as TLShapeId | undefined
        const endId = endBindings[0]?.toId as TLShapeId | undefined

        // Only care about arrows between research-node shapes
        if (
            startId && endId &&
            researchIds.has(startId) &&
            researchIds.has(endId) &&
            startId !== endId
        ) {
            edges.push([startId, endId])
        }
    }

    if (edges.length === 0) return null

    // Build adjacency list and in-degree map for nodes involved in arrows
    const involved = new Set<TLShapeId>()
    for (const [a, b] of edges) {
        involved.add(a)
        involved.add(b)
    }

    const adj = new Map<TLShapeId, TLShapeId[]>()
    const indegree = new Map<TLShapeId, number>()

    for (const id of involved) {
        adj.set(id, [])
        indegree.set(id, 0)
    }

    for (const [from, to] of edges) {
        adj.get(from)!.push(to)
        indegree.set(to, (indegree.get(to) ?? 0) + 1)
    }

    // Kahn's topological sort
    const queue: TLShapeId[] = []
    for (const [id, deg] of indegree.entries()) {
        if (deg === 0) queue.push(id)
    }

    // Stable-sort queue by Y position for equal in-degree nodes
    const yOf = (id: TLShapeId) => editor.getShape(id)?.y ?? 0
    queue.sort((a, b) => yOf(a) - yOf(b))

    const ordered: TLShapeId[] = []
    const visited = new Set<TLShapeId>()

    while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        ordered.push(current)

        const neighbors = (adj.get(current) ?? []).slice()
        neighbors.sort((a, b) => yOf(a) - yOf(b))

        for (const neighbor of neighbors) {
            const newDeg = (indegree.get(neighbor) ?? 1) - 1
            indegree.set(neighbor, newDeg)
            if (newDeg === 0) {
                queue.push(neighbor)
            }
        }
    }

    // Merge: interleave unconnected nodes into the ordered chain
    // using their section's default order as insertion key.
    // Strategy: insert each unconnected node after the last already-placed
    // node whose section order <= this node's section order.
    const sectionOrderOf = (id: TLShapeId) => {
        const shape = editor.getShape(id) as ResearchNodeShape | undefined
        return shape ? RESEARCH_NODE_META[shape.props.section].order : 999
    }

    const unconnected = [...researchIds]
        .filter((id) => !involved.has(id))
        .sort((a, b) => sectionOrderOf(a) - sectionOrderOf(b) || yOf(a) - yOf(b))

    // Build final list by inserting each unconnected node at the right position
    const final: TLShapeId[] = [...ordered]
    for (const uid of unconnected) {
        const uOrder = sectionOrderOf(uid)
        // Find the rightmost position where the preceding node has section order <= uOrder
        let insertAt = 0
        for (let i = 0; i < final.length; i++) {
            if (sectionOrderOf(final[i]) <= uOrder) {
                insertAt = i + 1
            }
        }
        final.splice(insertAt, 0, uid)
    }

    return final
}

/**
 * Collect research node data ordered by arrow topology.
 * Returns null if no arrows are defined (fall back to section-order).
 */
export function collectArrowOrderedNodes(editor: Editor): ResearchNodeShape[] | null {
    const orderedIds = getArrowOrderedShapeIds(editor)
    if (!orderedIds) return null

    return orderedIds
        .map((id) => editor.getShape(id))
        .filter((s): s is ResearchNodeShape => s?.type === 'research-node')
}
