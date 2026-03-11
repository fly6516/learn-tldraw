/**
 * Project File System Context
 * Manages the project file system state
 */

'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
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
  setFileSystem: (fs: ProjectFileSystem) => void
}

const ProjectFileSystemContext = createContext<ProjectFileSystemContextValue | null>(null)

export function ProjectFileSystemProvider({ children }: { children: ReactNode }) {
  const [fileSystem, setFileSystem] = useState<ProjectFileSystem | null>(null)

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
      if (!fileSystem) return

      try {
        const updatedFs = addFigure(fileSystem, fileName, blob)
        setFileSystem(updatedFs)
      } catch (error) {
        console.error('Failed to add image:', error)
      }
    },
    [fileSystem]
  )

  const addFile = useCallback(
    (file: ProjectFile) => {
      if (!fileSystem) {
        console.error('Cannot add file: fileSystem is null')
        return
      }

      try {
        console.log('Adding file to file system:', file.name, file.path)
        const updatedFs = addFileToFs(fileSystem, file)
        console.log('File system updated, new files count:', updatedFs.files.size)
        setFileSystem(updatedFs)
        console.log('State updated successfully')
      } catch (error) {
        console.error('Failed to add file:', error)
      }
    },
    [fileSystem]
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
      return projectFile.content || projectFile.blob
    },
    [fileSystem]
  )

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
