import { expect, test } from 'bun:test'
import { emptyCanvasHistory, recordCanvasEdit, stepCanvasHistory } from './canvas-history'

test('undoes a moved node and its edge edits without rewinding the viewport', () => {
  const first = { nodes: [{ id: 'n', position: { x: 0, y: 0 } }], edges: [] }
  const moved = { ...first, nodes: [{ ...first.nodes[0], position: { x: 50, y: 80 } }] }
  const connected = { ...moved, edges: [{ id: 'edge' }] }
  const history = recordCanvasEdit(recordCanvasEdit(emptyCanvasHistory, first, moved), moved, connected)
  const undo = stepCanvasHistory(history, connected, 'undo')
  expect(undo.snapshot).toEqual(moved)
  expect(stepCanvasHistory(undo.history, moved, 'undo').snapshot).toEqual(first)
  expect(stepCanvasHistory(undo.history, moved, 'redo').snapshot).toEqual(connected)
  expect(undo.snapshot).not.toHaveProperty('viewport')
})

test('groups one field editing session and clears redo after a new edit', () => {
  const make = text => ({ nodes: [{ id: 'n', text }], edges: [] })
  const initial = make('')
  const first = make('A')
  const last = make('AB')
  const history = recordCanvasEdit(recordCanvasEdit(emptyCanvasHistory, initial, first, 'n:title'), first, last, 'n:title')
  expect(history.undo).toHaveLength(1)
  const undo = stepCanvasHistory(history, last, 'undo')
  expect(undo.snapshot).toBe(initial)
  expect(recordCanvasEdit(undo.history, initial, make('C')).redo).toHaveLength(0)
  expect(recordCanvasEdit(history, last, last)).toBe(history)
})
