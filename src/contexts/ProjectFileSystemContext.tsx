/**
 * Project File System Context
 * Manages the project file system state
 */

'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import type {
  ProjectFileSystem,
  LatexTemplate,
  ProjectFile,
} from '@/lib/project/types'
import {
  createDefaultProject,
  createProjectFileSystem,
  updateFileContent,
  addFigure,
  getFile,
  getFileTree,
  addFile as addFileToFs,
  deleteFile as deleteFileFromFs,
  type FileTreeNode,
} from '@/lib/project/file-system'
import { openProjectStorage, ProjectStorageConflict, readProject, writeProject } from '@/lib/project/storage'

interface ProjectFileSystemContextValue {
  fileSystem: ProjectFileSystem | null
  fileTree: FileTreeNode[]
  initializeProject: (template?: LatexTemplate, projectName?: string) => void
  updateFile: (path: string, content: string | Blob) => void
  addImage: (fileName: string, blob: Blob) => void
  addFile: (file: ProjectFile) => void
  deleteFile: (path: string) => void
  getFileContent: (path: string) => string | Blob | undefined
  setFileSystem: React.Dispatch<React.SetStateAction<ProjectFileSystem | null>>
  storage: IDBDatabase | null
  storageKey?: string
  acceptStoredProject: (project: ProjectFileSystem, previous?: ProjectFileSystem) => void
  flushProject: (project: ProjectFileSystem) => Promise<ProjectFileSystem>
  projectConflict: boolean
  storageError: boolean
  retryStorage: () => Promise<boolean>
  hasUnstoredProject: () => boolean
}

const ProjectFileSystemContext = createContext<ProjectFileSystemContextValue | null>(null)

function sameLocalProject(first: ProjectFileSystem, second: ProjectFileSystem) {
  return first.files === second.files && first.canvas === second.canvas && first.metadata === second.metadata && first.template === second.template
}

export function ProjectFileSystemProvider({ children, storageKey }: { children: ReactNode; storageKey?: string }) {
  const [fileSystem, setFileSystem] = useState<ProjectFileSystem | null>(null)

  const [storage, setStorage] = useState<IDBDatabase | null>(null)
  const [ready, setReady] = useState(!storageKey)
  const [storageError, setStorageError] = useState(false)
  const [projectConflict, setProjectConflict] = useState(false)
  const [persisting, setPersisting] = useState(false)
  const lastStored = useRef<ProjectFileSystem | null>(null)
  const pendingWrite = useRef<Promise<ProjectFileSystem> | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)
  const hasUnstoredProject = useCallback(() => Boolean(fileSystem && (!lastStored.current || !sameLocalProject(fileSystem, lastStored.current))), [fileSystem])

  const acceptStoredProject = useCallback((project: ProjectFileSystem, previous?: ProjectFileSystem) => {
    lastStored.current = project
    channel.current?.postMessage(project.storageRevision)
    setFileSystem(current => !previous || current === previous ? project : current?.metadata.createdAt === project.metadata.createdAt
      ? { ...project, canvas: current.canvas } : current)
  }, [])

  const flushProject = useCallback(async (value: ProjectFileSystem): Promise<ProjectFileSystem> => {
    if (!storageKey || !storage) return value
    while (pendingWrite.current) await pendingWrite.current
    const expected = lastStored.current
    if (expected && sameLocalProject(value, expected)) return expected
    if (expected && expected.storageRevision !== value.storageRevision) throw new ProjectStorageConflict()
    const operation = writeProject(storage, storageKey, value, expected)
    pendingWrite.current = operation
    setPersisting(true)
    try {
      const saved = await operation
      setStorageError(false)
      lastStored.current = saved
      channel.current?.postMessage(saved.storageRevision)
      setFileSystem(current => !current || current.storageRevision !== value.storageRevision ? current
        : current === value ? saved : { ...current, storageRevision: saved.storageRevision })
      return saved
    } catch (error) {
      if (error instanceof ProjectStorageConflict) setProjectConflict(true)
      else setStorageError(true)
      throw error
    } finally {
      pendingWrite.current = null
      setPersisting(false)
    }
  }, [storage, storageKey])

  useEffect(() => {
    if (!storageKey) return
    let active = true
    let database: IDBDatabase | undefined
    async function restore(key: string) {
      try {
        database = await openProjectStorage()
        if (!active) {
          database.close()
          return
        }
        const saved = await readProject(database, key)
        if (!active) return
        lastStored.current = saved ?? null
        setFileSystem(saved ?? null)
        setStorage(database)
      } catch {
        if (active) setStorageError(true)
      } finally {
        if (active) setReady(true)
      }
    }
    void restore(storageKey)
    return () => {
      active = false
      database?.close()
    }
  }, [storageKey])

  useEffect(() => {
    if (!storageKey || !storage || !fileSystem || fileSystem === lastStored.current || projectConflict || persisting || storageError) return
    void flushProject(fileSystem).catch(() => {})
  }, [storage, storageKey, fileSystem, flushProject, projectConflict, persisting, storageError])

  useEffect(() => {
    if (!storage || !storageKey) return
    const mailbox = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`research-project:${storageKey}`)
    channel.current = mailbox
    let alive = true
    const check = async () => {
      const before = lastStored.current
      if (!before || pendingWrite.current) return
      try {
        const saved = await readProject(storage, storageKey)
        if (alive && !pendingWrite.current && lastStored.current === before &&
          (saved?.storageRevision !== before.storageRevision || saved?.metadata.createdAt !== before.metadata.createdAt)) setProjectConflict(true)
      } catch { if (alive) setStorageError(true) }
    }
    mailbox?.addEventListener('message', check)
    window.addEventListener('focus', check)
    return () => {
      alive = false
      mailbox?.close()
      channel.current = null
      window.removeEventListener('focus', check)
    }
  }, [storage, storageKey])

  async function retryStorage() {
    if (!storage || !fileSystem || projectConflict) return false
    try { await flushProject(fileSystem); setStorageError(false); return true }
    catch { return false }
  }

  const fileTree = fileSystem ? getFileTree(fileSystem) : []

  const initializeProject = useCallback(
    (template?: LatexTemplate, projectName: string = 'Untitled Project') => {
      const fs = template ? createProjectFileSystem(template, projectName) : createDefaultProject(projectName)
      setFileSystem(fs)
    },
    []
  )

  const updateFile = useCallback(
    (path: string, content: string | Blob) => {
      if (!fileSystem) return

      try {
        const updatedFs = updateFileContent(fileSystem, path, content)
        setFileSystem(updatedFs)
      } catch (error) {
        console.error('Failed to update file:', error)
      }
    },
    [fileSystem]
  )

  const addImage = useCallback(
    (fileName: string, blob: Blob) => {
      setFileSystem(current => current ? addFigure(current, fileName, blob) : current)
    },
    []
  )

  const addFile = useCallback(
    (file: ProjectFile) => {
      setFileSystem(current => current ? addFileToFs(current, file) : current)
    },
    []
  )

  const deleteFile = useCallback(
    (path: string) => {
      if (!fileSystem) {
        console.error('Cannot delete file: fileSystem is null')
        return
      }

      try {
        console.log('Deleting file from file system:', path)
        const updatedFs = deleteFileFromFs(fileSystem, path)
        console.log('File deleted, new files count:', updatedFs.files.size)
        setFileSystem(updatedFs)
      } catch (error) {
        console.error('Failed to delete file:', error)
      }
    },
    [fileSystem]
  )

  const getFileContent = useCallback(
    (path: string): string | Blob | undefined => {
      if (!fileSystem) return undefined

      const file = getFile(fileSystem, path)
      if (!file || file.type === 'directory') return undefined

      const projectFile = file as ProjectFile
      return projectFile.content ?? projectFile.blob
    },
    [fileSystem]
  )

  if (!ready) return <p role="status">Restoring project…</p>

  return (
    <ProjectFileSystemContext.Provider
      value={{
        fileSystem,
        fileTree,
        initializeProject,
        updateFile,
        addImage,
        addFile,
        deleteFile,
        getFileContent,
        setFileSystem,
        storage,
        storageKey,
        acceptStoredProject,
        flushProject,
        projectConflict,
        storageError,
        retryStorage,
        hasUnstoredProject,
      }}
    >
      {children}
    </ProjectFileSystemContext.Provider>
  )
}

export function useProjectFileSystem() {
  const context = useContext(ProjectFileSystemContext)
  if (!context) {
    throw new Error('useProjectFileSystem must be used within ProjectFileSystemProvider')
  }
  return context
}
