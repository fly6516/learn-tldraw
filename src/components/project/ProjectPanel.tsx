/**
 * Project Panel Component
 * Integrates file browser with preview and edit capabilities
 */

'use client'

import { useState } from 'react'
import { ProjectFileBrowser } from './ProjectFileBrowser'
import { FilePreviewDialog } from './FilePreviewDialog'
import { PreambleEditor } from './PreambleEditor'
import { BibTeXEditor } from './BibTeXEditor'
import { useProjectFileSystem } from '@/contexts/ProjectFileSystemContext'
import type { FileTreeNode } from '@/lib/project/file-system'
import type { ProjectFile } from '@/lib/project/types'

export function ProjectPanel() {
  const { fileTree, getFileContent, updateFile, addImage, addFile, deleteFile } = useProjectFileSystem()

  const [previewNode, setPreviewNode] = useState<FileTreeNode | null>(null)
  const [previewContent, setPreviewContent] = useState<string>('')
  const [editingPreamble, setEditingPreamble] = useState(false)
  const [editingBibTeX, setEditingBibTeX] = useState(false)
  const [preambleContent, setPreambleContent] = useState('')
  const [bibTeXContent, setBibTeXContent] = useState('')

  const handleFileClick = (node: FileTreeNode) => {
    const content = getFileContent(node.path)

    if (typeof content === 'string') {
      setPreviewContent(content)
      setPreviewNode(node)
    } else if (content instanceof Blob) {
      // For images, create object URL
      const url = URL.createObjectURL(content)
      setPreviewNode({ ...node, path: url })
      setPreviewContent('')
    }
  }

  const handleFileEdit = (node: FileTreeNode) => {
    const content = getFileContent(node.path)

    if (typeof content !== 'string') return

    if (node.name === 'preamble.tex') {
      setPreambleContent(content)
      setEditingPreamble(true)
    } else if (node.name === 'references.bib') {
      setBibTeXContent(content)
      setEditingBibTeX(true)
    }
  }

  const handleFileDownload = (node: FileTreeNode) => {
    const content = getFileContent(node.path)
    if (!content) return

    let blob: Blob
    if (typeof content === 'string') {
      blob = new Blob([content], { type: 'text/plain' })
    } else {
      blob = content
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = node.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleFileUpload = (file: File) => {
    console.log('Uploading file:', file.name, file.type, file.size)

    if (file.type.startsWith('image/')) {
      addImage(file.name, file)
    } else {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        console.log('File read successfully:', file.name, 'content length:', content?.length)
        addFile({
          name: file.name,
          type: 'editable',
          path: file.name,
          content,
          metadata: {
            editable: true,
            description: 'Uploaded file',
            lastModified: new Date().toISOString(),
          },
        })
        console.log('File added to system:', file.name)
      }
      reader.onerror = (e) => {
        console.error('Failed to read file:', file.name, e)
        alert(`Failed to read file: ${file.name}`)
      }
      reader.readAsText(file)
    }
  }

  const handleFileDelete = (node: FileTreeNode) => {
    console.log('Deleting file:', node.path)
    deleteFile(node.path)
  }

  const handleNewFile = () => {
    const fileName = prompt('Enter file name (e.g., notes.tex):')
    if (fileName) {
      addFile({
        name: fileName,
        type: 'editable',
        path: fileName,
        content: '% New file\n',
        metadata: {
          editable: true,
          description: 'User created file',
          lastModified: new Date().toISOString(),
        },
      })
    }
  }

  const handleNewFolder = () => {
    alert('Folder creation not yet implemented')
  }

  const handlePreambleSave = (content: string) => {
    updateFile('preamble.tex', content)
  }

  const handleBibTeXSave = (content: string) => {
    updateFile('references.bib', content)
  }

  const handlePreviewClose = () => {
    setPreviewNode(null)
    setPreviewContent('')
  }

  if (fileTree.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg mb-2">No project loaded</p>
          <p className="text-sm">Import a LaTeX file to get started</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <ProjectFileBrowser
        fileTree={fileTree}
        onFileClick={handleFileClick}
        onFileEdit={handleFileEdit}
        onFileDownload={handleFileDownload}
        onFileUpload={handleFileUpload}
        onFileDelete={handleFileDelete}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
      />

      {previewNode && (
        <FilePreviewDialog
          node={previewNode}
          content={previewContent}
          onClose={handlePreviewClose}
        />
      )}

      {editingPreamble && (
        <PreambleEditor
          initialContent={preambleContent}
          onSave={handlePreambleSave}
          onClose={() => setEditingPreamble(false)}
        />
      )}

      {editingBibTeX && (
        <BibTeXEditor
          initialContent={bibTeXContent}
          onSave={handleBibTeXSave}
          onClose={() => setEditingBibTeX(false)}
        />
      )}
    </>
  )
}
