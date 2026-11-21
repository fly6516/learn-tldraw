'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { sourcePosition, type SourceLocation } from '@/lib/project/latex-source'

export interface SourceProblem {
  path: string
  line: number
  severity: 'warning' | 'error'
  message: string
  location?: SourceLocation
}

globalThis.MonacoEnvironment ??= {
  getWorker: () => new Worker(new URL('./monaco-worker.ts', import.meta.url), { type: 'module' }),
}
loader.config({ monaco })

monaco.editor.defineTheme('research-paper', {
  base: 'vs', inherit: true,
  rules: [{ token: 'keyword', foreground: '5A3BC0' }, { token: 'annotation', foreground: 'A13869' },
    { token: 'number', foreground: '086E61' }, { token: 'comment', foreground: '596E7C' },
    { token: 'string', foreground: '096653' }],
  colors: { 'editor.background': '#FFFEFC', 'editorLineNumber.foreground': '#687789', 'editor.lineHighlightBackground': '#F0F4FB' },
})
monaco.languages.register({ id: 'research-tex' })
monaco.languages.setMonarchTokensProvider('research-tex', {
  tokenizer: {
    root: [
      [/\\[A-Za-z@]+\*?/, 'keyword'], [/\\./, 'keyword'],
      [/%.*$/, 'comment'], [/\$\$?/, 'annotation'], [/[{}[\]]/, 'delimiter.bracket'],
      [/\b\d+(?:\.\d+)?\b/, 'number'],
    ],
  },
})
monaco.languages.register({ id: 'research-bib' })
monaco.languages.setMonarchTokensProvider('research-bib', {
  tokenizer: {
    root: [
      [/%.*$/, 'comment'], [/@[A-Za-z]+/, 'keyword'],
      [/([({])(\s*)([^\s,{}()]+)(?=\s*,)/, ['delimiter.bracket', 'white', 'annotation']],
      [/[A-Za-z][\w-]*(?=\s*=)/, 'attribute.name'],
      [/=/, { token: 'delimiter', next: '@bibValue' }], [/[{}(),#]/, 'delimiter'],
    ],
    bibValue: [
      [/\s+/, 'white'],
      [/\{/, { token: 'delimiter.bracket', switchTo: '@bibBraces' }],
      [/"/, { token: 'string', switchTo: '@bibQuotes' }],
      [/\d+/, { token: 'number', next: '@pop' }],
      [/[\w-]+/, { token: 'variable', next: '@pop' }],
      [/./, { token: '@rematch', next: '@pop' }],
    ],
    bibBraces: [
      [/\\./, 'string'], [/\{/, 'delimiter.bracket', '@push'], [/\}/, 'delimiter.bracket', '@pop'],
      [/[^{}\\]+|\\/, 'string'],
    ],
    bibQuotes: [
      [/\\./, 'string'], [/"/, 'string', '@pop'], [/[^"\\]+|\\/, 'string'],
    ],
  },
})

export function WritingDraftComparison({ path, original, modified }: { path: string; original: string; modified: string }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!container.current) return
    const language = /\.bib$/i.test(path) ? 'research-bib' : /\.tex$/i.test(path) ? 'research-tex' : 'plaintext'
    const before = monaco.editor.createModel(original, language)
    const after = monaco.editor.createModel(modified, language)
    const diff = monaco.editor.createDiffEditor(container.current, {
      theme: 'research-paper', automaticLayout: true, readOnly: true, originalEditable: false,
      originalAriaLabel: 'Project source', modifiedAriaLabel: 'Local draft',
      renderSideBySide: true, minimap: { enabled: false }, wordWrap: 'on',
    })
    diff.setModel({ original: before, modified: after })
    return () => {
      diff.setModel(null)
      diff.dispose()
      before.dispose()
      after.dispose()
    }
  }, [path, original, modified])
  return <div ref={container} className="size-full" />
}

export function MonacoSourceEditor({ path, value, readOnly, problems, onChange, onEditor, onSave, onCursor }: {
  path: string
  value: string
  readOnly: boolean
  problems: SourceProblem[]
  onChange: (value: string) => void
  onEditor: (editor: monaco.editor.IStandaloneCodeEditor | null) => void
  onSave: () => void | Promise<void>
  onCursor: (path: string, position: { lineNumber: number; column: number }) => void
}) {
  const namespace = useId()
  const modelPath = (path: string) => `inmemory://research/${namespace}/${path.split('/').map(encodeURIComponent).join('/')}`
  const uri = modelPath(path)
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor>()
  const [model, setModel] = useState<monaco.editor.ITextModel | null>(null)

  useEffect(() => {
    if (!editor) return
    const listener = editor.onDidChangeModel(() => {
      setModel(editor.getModel())
      onEditor(editor)
    })
    const save = editor.addAction({
      id: 'research.save', label: 'Save Project Files',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: onSave,
    })
    return () => { listener.dispose(); save.dispose() }
  }, [editor, onEditor, onSave])

  useEffect(() => {
    if (!editor) return
    const currentUri = monaco.Uri.parse(uri).toString()
    const cursor = editor.onDidChangeCursorPosition(({ position }) => {
      if (editor.getModel()?.uri.toString() === currentUri) onCursor(path, position)
    })
    return () => cursor.dispose()
  }, [editor, onCursor, path, uri])

  useEffect(() => () => {
    for (const item of monaco.editor.getModels()) {
      if (item.uri.path.startsWith(`/${namespace}/`)) item.dispose()
    }
  }, [namespace])

  useEffect(() => {
    if (!model || model.isDisposed() || model.uri.toString() !== monaco.Uri.parse(uri).toString()) return
    const markers = problems.filter(problem => problem.path === path).map(problem => {
      const start = problem.location ? sourcePosition(value, problem.location.start) : {
        lineNumber: Math.min(problem.line, model.getLineCount()), column: 1,
      }
      const end = problem.location ? sourcePosition(value, problem.location.end) : {
        ...start, column: Math.max(2, model.getLineMaxColumn(start.lineNumber)),
      }
      return {
        startLineNumber: start.lineNumber, startColumn: start.column,
        endLineNumber: end.lineNumber, endColumn: end.column,
        severity: problem.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: problem.message,
      }
    })
    monaco.editor.setModelMarkers(model, 'research-diagnostics', markers)
  }, [model, path, problems, uri, value])

  const language = /\.bib$/i.test(path) ? 'research-bib'
    : /\.(tex|sty|cls|ltx|bst|def)$/i.test(path) ? 'research-tex' : 'plaintext'
  const bom = value.charCodeAt(0) === 0xfeff ? '\uFEFF' : ''
  return (
    <Editor height="100%" path={uri} language={language} value={value.slice(bom.length)} theme="research-paper" keepCurrentModel saveViewState
      onMount={instance => { setEditor(instance); setModel(instance.getModel()); onEditor(instance) }}
      onChange={next => { if (next !== undefined) onChange(bom + next) }}
      loading={<p role="status" className="p-4 text-sm text-muted-foreground">Loading source editor…</p>}
      options={{
        ariaLabel: 'Project source editor', automaticLayout: true, fontSize: 14, lineHeight: 23,
        glyphMargin: true, readOnly, minimap: { enabled: false }, scrollBeyondLastLine: false,
        wordWrap: 'on', padding: { top: 14, bottom: 12 }, renderValidationDecorations: 'on',
      }} />
  )
}
