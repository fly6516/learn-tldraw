/**
 * Export Options Dialog
 * Allows users to configure export settings
 */

'use client'

import { useState } from 'react'
import { X, Download, FileText, Archive } from 'lucide-react'
import type { ExportOptions, TemplatePresetType } from '@/lib/project/types'
import { TEMPLATE_PRESETS } from '@/lib/project/templates'

interface ExportOptionsDialogProps {
  onExport: (options: ExportOptions) => void
  onClose: () => void
  hasImportedTemplate?: boolean
}

export function ExportOptionsDialog({
  onExport,
  onClose,
  hasImportedTemplate = false,
}: ExportOptionsDialogProps) {
  const [format, setFormat] = useState<'tex' | 'zip'>('zip')
  const [templateSource, setTemplateSource] = useState<'original' | 'preset'>(
    hasImportedTemplate ? 'original' : 'preset'
  )
  const [templatePreset, setTemplatePreset] = useState<TemplatePresetType>('english-article')
  const [includeReferences, setIncludeReferences] = useState(true)
  const [includeFigures, setIncludeFigures] = useState(true)
  const [includePreamble, setIncludePreamble] = useState(true)

  const handleExport = () => {
    const options: ExportOptions = {
      format,
      useOriginalTemplate: templateSource === 'original',
      templatePreset: templateSource === 'preset' ? templatePreset : undefined,
      includeReferences,
      includeFigures,
      includePreamble,
    }
    onExport(options)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[600px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Export Options</h3>
            <p className="text-sm text-gray-500">Configure your LaTeX export</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-6">
          {/* Export Format */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Export Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat('tex')}
                className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-colors ${
                  format === 'tex'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <FileText className="w-5 h-5 text-gray-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">.tex File</div>
                  <div className="text-xs text-gray-500">Single file</div>
                </div>
              </button>
              <button
                onClick={() => setFormat('zip')}
                className={`flex items-center gap-3 p-4 border-2 rounded-lg transition-colors ${
                  format === 'zip'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Archive className="w-5 h-5 text-gray-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">.zip Archive</div>
                  <div className="text-xs text-gray-500">Complete project</div>
                </div>
              </button>
            </div>
          </div>

          {/* Template Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Template
            </label>
            <div className="space-y-2">
              {hasImportedTemplate && (
                <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="template"
                    checked={templateSource === 'original'}
                    onChange={() => setTemplateSource('original')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      Use Original Template
                    </div>
                    <div className="text-xs text-gray-500">
                      Keep the imported template settings
                    </div>
                  </div>
                </label>
              )}
              <label className="flex items-center gap-2 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="template"
                  checked={templateSource === 'preset'}
                  onChange={() => setTemplateSource('preset')}
                  className="w-4 h-4 text-blue-600"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">
                    Use Preset Template
                  </div>
                  {templateSource === 'preset' && (
                    <select
                      value={templatePreset}
                      onChange={(e) => setTemplatePreset(e.target.value as TemplatePresetType)}
                      className="mt-2 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {Object.entries(TEMPLATE_PRESETS).map(([key, preset]) => (
                        <option key={key} value={key}>
                          {preset.name} - {preset.description}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Include Options (only for ZIP) */}
          {format === 'zip' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Include Files
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeReferences}
                    onChange={(e) => setIncludeReferences(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">Bibliography (.bib)</span>
                </label>
                <label className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeFigures}
                    onChange={(e) => setIncludeFigures(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">Figures</span>
                </label>
                <label className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePreamble}
                    onChange={(e) => setIncludePreamble(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm text-gray-700">Custom Preamble</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>
    </div>
  )
}
