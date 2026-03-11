/**
 * Preamble Editor Dialog
 * Allows users to edit custom LaTeX preamble
 */

'use client'

import { useState, useEffect } from 'react'
import { X, Save } from 'lucide-react'

interface PreambleEditorProps {
  initialContent: string
  onSave: (content: string) => void
  onClose: () => void
}

export function PreambleEditor({
  initialContent,
  onSave,
  onClose,
}: PreambleEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setHasChanges(content !== initialContent)
  }, [content, initialContent])

  const handleSave = () => {
    onSave(content)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[800px] h-[600px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Edit Preamble</h3>
            <p className="text-sm text-gray-500">Add custom packages and commands</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full font-mono text-sm bg-gray-50 border border-gray-300 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="% Add custom packages and commands here&#10;\usepackage{algorithm}&#10;\usepackage{tikz}&#10;&#10;% Custom commands&#10;\newcommand{\R}{\mathbb{R}}"
            spellCheck={false}
          />
        </div>

        {/* Help text */}
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
          <p className="text-xs text-blue-700">
            <strong>Tip:</strong> Add LaTeX packages with <code className="bg-blue-100 px-1 rounded">\usepackage{'{package}'}</code> and custom commands with <code className="bg-blue-100 px-1 rounded">\newcommand</code>
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <div className="text-sm text-gray-500">
            {hasChanges && <span className="text-orange-600">Unsaved changes</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
