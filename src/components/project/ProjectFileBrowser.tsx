/**
 * Project File Browser Component
 * Displays the file tree structure with preview and edit capabilities
 */

'use client'

import { useState, useRef } from 'react'
import { FileTreeNode } from '@/lib/project/file-system'
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Eye,
  Edit,
  Download,
  Image,
  Upload,
  FilePlus,
  FolderPlus,
  Trash2,
} from 'lucide-react'

interface ProjectFileBrowserProps {
  fileTree: FileTreeNode[]
  onFileClick?: (node: FileTreeNode) => void
  onFileEdit?: (node: FileTreeNode) => void
  onFileDownload?: (node: FileTreeNode) => void
  onFileUpload?: (file: File) => void
  onFileDelete?: (node: FileTreeNode) => void
  onNewFile?: () => void
  onNewFolder?: () => void
}

export function ProjectFileBrowser({
  fileTree,
  onFileClick,
  onFileEdit,
  onFileDownload,
  onFileUpload,
  onFileDelete,
  onNewFile,
  onNewFolder,
}: ProjectFileBrowserProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    console.log('Upload button clicked, triggering file input')
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('File input changed (React event)')
    const files = e.target.files
    console.log('Files selected:', files?.length)
    if (files) {
      Array.from(files).forEach(file => {
        console.log('Processing file:', file.name)
        onFileUpload?.(file)
      })
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="w-full h-full bg-white border-r border-gray-200 overflow-y-auto flex flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <div className="p-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Project Files</h3>
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleUploadClick}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            title="Upload files"
          >
            <Upload className="w-3 h-3" />
            Upload
          </button>
          <button
            onClick={onNewFile}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            title="New file"
          >
            <FilePlus className="w-3 h-3" />
          </button>
          <button
            onClick={onNewFolder}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            title="New folder"
          >
            <FolderPlus className="w-3 h-3" />
          </button>
        </div>
      </div>
      <div className="p-2 flex-1 overflow-y-auto">
        {fileTree.map((node) => (
          <FileTreeItem
            key={node.path}
            node={node}
            level={0}
            onFileClick={onFileClick}
            onFileEdit={onFileEdit}
            onFileDownload={onFileDownload}
            onFileDelete={onFileDelete}
          />
        ))}
      </div>
    </div>
  )
}

interface FileTreeItemProps {
  node: FileTreeNode
  level: number
  onFileClick?: (node: FileTreeNode) => void
  onFileEdit?: (node: FileTreeNode) => void
  onFileDownload?: (node: FileTreeNode) => void
  onFileDelete?: (node: FileTreeNode) => void
}

function FileTreeItem({
  node,
  level,
  onFileClick,
  onFileEdit,
  onFileDownload,
  onFileDelete,
}: FileTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(level === 0)

  const isDirectory = node.type === 'directory'
  const isImage = node.mimeType?.startsWith('image/')
  const isDeletable = !['main.tex'].includes(node.name) // Protect main.tex

  const handleClick = () => {
    if (isDirectory) {
      setIsExpanded(!isExpanded)
    } else {
      onFileClick?.(node)
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 rounded cursor-pointer group"
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse icon */}
        {isDirectory && (
          <span className="w-4 h-4 flex items-center justify-center text-gray-500">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        {!isDirectory && <span className="w-4" />}

        {/* File/folder icon */}
        <span className="w-4 h-4 flex items-center justify-center text-gray-600">
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-blue-500" />
            ) : (
              <Folder className="w-4 h-4 text-blue-500" />
            )
          ) : isImage ? (
            <Image className="w-4 h-4 text-green-500" />
          ) : (
            <File className="w-4 h-4 text-gray-500" />
          )}
        </span>

        {/* File name */}
        <span className="flex-1 text-sm text-gray-700 truncate">
          {node.name}
        </span>

        {/* File size */}
        {!isDirectory && node.size && (
          <span className="text-xs text-gray-400">
            {formatFileSize(node.size)}
          </span>
        )}

        {/* Action buttons */}
        {!isDirectory && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="p-1 hover:bg-gray-200 rounded"
              onClick={(e) => {
                e.stopPropagation()
                onFileClick?.(node)
              }}
              title="Preview"
            >
              <Eye className="w-3 h-3 text-gray-600" />
            </button>
            {node.editable && (
              <button
                className="p-1 hover:bg-gray-200 rounded"
                onClick={(e) => {
                  e.stopPropagation()
                  onFileEdit?.(node)
                }}
                title="Edit"
              >
                <Edit className="w-3 h-3 text-gray-600" />
              </button>
            )}
            <button
              className="p-1 hover:bg-gray-200 rounded"
              onClick={(e) => {
                e.stopPropagation()
                onFileDownload?.(node)
              }}
              title="Download"
            >
              <Download className="w-3 h-3 text-gray-600" />
            </button>
            {isDeletable && (
              <button
                className="p-1 hover:bg-red-100 rounded"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete ${node.name}?`)) {
                    onFileDelete?.(node)
                  }
                }}
                title="Delete"
              >
                <Trash2 className="w-3 h-3 text-red-600" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
              onFileEdit={onFileEdit}
              onFileDownload={onFileDownload}
              onFileDelete={onFileDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
