/**
 * File Preview Dialog
 * Shows file content in a modal dialog
 */

'use client'

import { X } from 'lucide-react'
import { FileTreeNode } from '@/lib/project/file-system'

interface FilePreviewDialogProps {
  node: FileTreeNode | null
  content?: string
  onClose: () => void
}

export function FilePreviewDialog({
  node,
  content,
  onClose,
}: FilePreviewDialogProps) {
  if (!node) return null

  const isImage = node.mimeType?.startsWith('image/')
  const isText = node.mimeType?.startsWith('text/') || node.name.endsWith('.tex') || node.name.endsWith('.bib')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{node.name}</h3>
            <p className="text-sm text-gray-500">{node.path}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {isImage && node.path && (
            <div className="flex items-center justify-center h-full">
              <img
                src={node.path}
                alt={node.name}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {isText && content && (
            <pre className="text-sm font-mono bg-gray-50 p-4 rounded-lg overflow-auto">
              <code>{content}</code>
            </pre>
          )}

          {!isImage && !isText && (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <p className="text-lg mb-2">Preview not available</p>
                <p className="text-sm">This file type cannot be previewed</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
