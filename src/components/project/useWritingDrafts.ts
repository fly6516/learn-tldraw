'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readWritingState, writeWritingDraft, writeWritingView } from '@/lib/project/storage'
import { sameDraft, type PortableWritingState, type WritingDraft, type WritingDrafts, type WritingKey, type WritingView } from '@/lib/project/writing-drafts'

export function useWritingDrafts(storage: IDBDatabase | null, workspace: string | undefined, project: string) {
  const key = useMemo<WritingKey | undefined>(() => workspace ? [workspace, project] : undefined, [workspace, project])
  const [drafts, setDrafts] = useState<WritingDrafts>({})
  const [restoredView, setRestoredView] = useState<WritingView>()
  const [ready, setReady] = useState(!storage)
  const [loadError, setLoadError] = useState(!storage)
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const stored = useRef<WritingDrafts>(Object.create(null))
  const queued = useRef(new Map<string, Promise<void>>())
  const lastView = useRef<WritingView>(null)

  useEffect(() => {
    if (!storage || !key) return
    let active = true
    void readWritingState(storage, key).then(state => {
      if (!active) return
      stored.current = { ...state.drafts }
      lastView.current = state.view ?? null
      setDrafts(state.drafts)
      setRestoredView(state.view)
    }).catch(() => { if (active) setLoadError(true) })
      .finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [storage, key])

  const recordView = useCallback((view: WritingView) => {
    const last = lastView.current
    if (!storage || !key || !ready || (last?.path === view.path && last.lineNumber === view.lineNumber && last.column === view.column)) return
    lastView.current = view
    void writeWritingView(storage, key, view).catch(() => {
      if (lastView.current === view) lastView.current = null
    })
  }, [storage, key, ready])

  function forget(paths: string[]) {
    setDrafts(current => {
      const next = { ...current }
      for (const path of paths) delete next[path]
      return next
    })
    for (const path of paths) delete stored.current[path]
    setFailed(current => new Set([...current].filter(path => !paths.includes(path))))
  }

  function persist(path: string, draft: WritingDraft | undefined) {
    if (!storage || !key) return Promise.resolve(false)
    const previous = queued.current.get(path) ?? Promise.resolve()
    setPending(count => count + 1)
    const next = previous.then(async () => {
      const expected = Object.hasOwn(stored.current, path) ? stored.current[path] : undefined
      if (!sameDraft(draft, expected)) {
        await writeWritingDraft(storage, key, path, draft, expected)
        if (draft) stored.current = { ...stored.current, [path]: draft }
        else delete stored.current[path]
      }
    })
    const finished = next.then(() => {
      setFailed(current => { const updated = new Set(current); updated.delete(path); return updated })
      return true
    }, () => {
      setFailed(current => new Set(current).add(path))
      return false
    }).finally(() => setPending(count => count - 1))
    const settled = finished.then(() => {})
    queued.current.set(path, settled)
    void settled.then(() => { if (queued.current.get(path) === settled) queued.current.delete(path) })
    return finished
  }

  function change(path: string, draft: WritingDraft | undefined) {
    setDrafts(current => {
      const next = { ...current }
      if (draft) next[path] = draft
      else delete next[path]
      return next
    })
    void persist(path, draft)
  }

  async function discard(paths: string[]) {
    const results = await Promise.all(paths.map(path => storage ? persist(path, undefined) : true))
    forget(paths.filter((_, index) => results[index]))
  }

  async function storedDrafts() {
    await Promise.all(queued.current.values())
    return { ...stored.current }
  }

  function acceptWritingState(writing: PortableWritingState) {
    stored.current = { ...writing.drafts }
    lastView.current = writing.view ?? null
    setDrafts(writing.drafts)
    setRestoredView(writing.view)
    setFailed(new Set())
  }

  return { key, drafts, restoredView, ready, loadError, pending, failed, change, discard, storedDrafts, forget, recordView, acceptWritingState }
}
