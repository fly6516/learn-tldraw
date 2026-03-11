/**
 * BibTeX Editor Dialog
 * Allows users to edit bibliography entries
 */

'use client'

import { useState, useEffect } from 'react'
import { X, Save, Plus, Trash2 } from 'lucide-react'

interface BibTeXEditorProps {
  initialContent: string
  onSave: (content: string) => void
  onClose: () => void
}

export function BibTeXEditor({
  initialContent,
  onSave,
  onClose,
}: BibTeXEditorProps) {
  const [content, setContent] = useState(initialContent)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setHasChanges(content !== initialContent)
  }, [content, initialContent])

  const handleSave = () => {
    onSave(content)
    onClose()
  }

  const addTemplate = (type: string) => {
    const templates: Record<string, string> = {
      article: `@article{key,
  author = {Author Name},
  title = {Article Title},
  journal = {Journal Name},
  year = {2024},
  volume = {1},
  pages = {1--10}
}`,
      book: `@book{key,
  author = {Author Name},
  title = {Book Title},
  publisher = {Publisher},
  year = {2024}
}`,
      inproceedings: `@inproceedings{key,
  author = {Author Name},
  title = {Paper Title},
  booktitle = {Conference Name},
  year = {2024},
  pages = {1--10}
}`,
    }

    const template = templates[type] || templates.article
    setContent(content + '\n\n' + template)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[900px] h-[700px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Edit Bibliography</h3>
            <p className="text-sm text-gray-500">Manage BibTeX entries</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 bg-gray-50">
          <span className="text-sm text-gray-600">Add entry:</span>
          <button
            onClick={() => addTemplate('article')}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Article
          </button>
          <button
            onClick={() => addTemplate('book')}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Book
          </button>
          <button
            onClick={() => addTemplate('inproceedings')}
            className="px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Conference
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full font-mono text-sm bg-gray-50 border border-gray-300 rounded-lg p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="@article{key,&#10;  author = {Author Name},&#10;  title = {Article Title},&#10;  journal = {Journal Name},&#10;  year = {2024}&#10;}"
            spellCheck={false}
          />
        </div>

        {/* Help text */}
        <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
          <p className="text-xs text-blue-700">
            <strong>Tip:</strong> Each entry starts with <code className="bg-blue-100 px-1 rounded">@type{'{key}'}</code>.
            Use <code className="bg-blue-100 px-1 rounded">\cite{'{key}'}</code> in your document to reference entries.
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
