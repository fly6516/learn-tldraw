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
  createProjectFileSystem,
  updateFileContent,
  addFigure,
  getFile,
  getFileTree,
  addFile as addFileToFs,
  deleteFile as deleteFileFromFs,
  type FileTreeNode,
} from '@/lib/project/file-system'
import { openProjectStorage, readProject, writeProject } from '@/lib/project/storage'
import { TEMPLATE_PRESETS } from '@/lib/project/templates'

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
}

const ProjectFileSystemContext = createContext<ProjectFileSystemContextValue | null>(null)

export function ProjectFileSystemProvider({ children, storageKey }: { children: ReactNode; storageKey?: string }) {
  const [fileSystem, setFileSystem] = useState<ProjectFileSystem | null>(null)

  const [storage, setStorage] = useState<IDBDatabase | null>(null)
  const [ready, setReady] = useState(!storageKey)
  const [storageError, setStorageError] = useState(false)
  const lastStored = useRef<ProjectFileSystem | null>(null)

  const acceptStoredProject = useCallback((project: ProjectFileSystem, previous?: ProjectFileSystem) => {
    lastStored.current = project
    setFileSystem(current => !previous || current === previous ? project : current?.metadata.createdAt === project.metadata.createdAt
      ? { ...project, canvas: current.canvas } : current)
  }, [])

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
    if (!storageKey || !storage || !fileSystem || fileSystem === lastStored.current) return
    void writeProject(storage, storageKey, fileSystem).catch(() => setStorageError(true))
  }, [storage, storageKey, fileSystem])

  const fileTree = fileSystem ? getFileTree(fileSystem) : []

  const initializeProject = useCallback(
    (template?: LatexTemplate, projectName: string = 'Untitled Project') => {
      const defaultTemplate = template || {
        documentClass: TEMPLATE_PRESETS['english-article'].documentClass,
        documentClassOptions: TEMPLATE_PRESETS['english-article'].documentClassOptions,
        preamble: TEMPLATE_PRESETS['english-article'].preambleTemplate,
        packages: TEMPLATE_PRESETS['english-article'].packages.map(name => ({ name })),
        metadata: {
          language: 'en',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }

      const fs = createProjectFileSystem(defaultTemplate, projectName)
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
      }}
    >
      {storageError && (
        <p role="alert" className="fixed bottom-4 right-4 z-[1000] rounded bg-red-900 p-3 text-white">
          Project files could not be saved or restored in this browser. Export a LaTeX ZIP to keep a copy.
        </p>
      )}
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
