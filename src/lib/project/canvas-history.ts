import type { ResearchPage } from './research-graph'

export type CanvasSnapshot = Pick<ResearchPage, 'nodes' | 'edges'>
export type CanvasHistory<T = CanvasSnapshot> = { undo: T[]; redo: T[]; group?: string }
export const emptyCanvasHistory: CanvasHistory = { undo: [], redo: [] }
const limit = 50

export function recordCanvasEdit(history: CanvasHistory, previous: CanvasSnapshot, next: CanvasSnapshot, group?: string): CanvasHistory {
  if (previous.nodes === next.nodes && previous.edges === next.edges) return history
  return recordHistory(history, previous, group)
}

export function recordHistory<T>(history: CanvasHistory<T>, previous: T, group?: string): CanvasHistory<T> {
  return {
    undo: group && group === history.group ? history.undo : [...history.undo.slice(1 - limit), previous],
    redo: [], group,
  }
}

export function stepCanvasHistory<T>(history: CanvasHistory<T>, current: T, direction: 'undo' | 'redo') {
  const snapshot = history[direction].at(-1)
  if (!snapshot) return undefined
  return {
    snapshot,
    history: direction === 'undo'
      ? { undo: history.undo.slice(0, -1), redo: [...history.redo, current] }
      : { undo: [...history.undo, current], redo: history.redo.slice(0, -1) },
  }
}
