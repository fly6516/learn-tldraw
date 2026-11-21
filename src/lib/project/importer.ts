/**
 * Enhanced LaTeX Importer
 * Supports template extraction, figures, and bibliography
 */

import JSZip from 'jszip'
import { parseLatexTemplate } from '../project/template-parser'
import { createProjectFileSystem, addFile } from '../project/file-system'
import type {
  ImportResult,
  ProjectFileSystem,
  LatexTemplate,
  ResearchNodeData,
} from '../project/types'
import type { ResearchNodeType } from '@/app/research/research-node'

/**
 * Import LaTeX from .tex file
 */
export async function importLatexFile(file: File): Promise<ImportResult> {
  const content = await file.text()
  return parseLatexContent(content, file.name)
}

/**
 * Import LaTeX from ZIP file
 */
export async function importLatexZip(file: File): Promise<ImportResult> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const files = Object.values(archive.files).filter(entry => !entry.dir)
  const texFiles = new Map<string, string>()
  const assets = new Map<string, string | Blob>()
  for (const entry of files) {
    if (/\.tex$/i.test(entry.name)) {
      texFiles.set(entry.name, await entry.async('text'))
    } else if (/\.(bib|cls|sty|bst|bbl)$/i.test(entry.name)) {
      assets.set(entry.name, await entry.async('text'))
    } else {
      const extension = entry.name.split('.').at(-1)?.toLowerCase()
      const imageTypes: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      }
      assets.set(entry.name, new Blob([await entry.async('arraybuffer')], {
        type: imageTypes[extension ?? ''] ?? 'application/octet-stream',
      }))
    }
  }

  const candidates = [...texFiles]
  const main = candidates.find(([path, text]) => /(^|\/)main\.tex$/i.test(path) && /\\begin\s*\{document\}/.test(text))
    ?? candidates.find(([, text]) => /\\begin\s*\{document\}/.test(text))
    ?? candidates[0]
  if (!main) throw new Error('No .tex files found in ZIP')

  const [mainPath] = main
  const prefix = mainPath.slice(0, mainPath.lastIndexOf('/') + 1)
  function expand(path: string, ancestors = new Set<string>()): string {
    if (ancestors.has(path)) throw new Error(`Circular LaTeX include: ${path}`)
    const text = texFiles.get(path)
    if (text === undefined) throw new Error(`Missing LaTeX file: ${path}`)
    const chain = new Set([...ancestors, path])
    return text.replace(/(%[^\r\n]*|\\%)|\\(input|include)\s*\{([^{}]+)\}/g,
      (match, comment: string | undefined, _command: string, name: string) => {
        if (comment) return match
        const filename = name.trim()
        const target = /\.tex$/i.test(filename) ? filename : `${filename}.tex`
        const relative = resolveArchivePath(path.slice(0, path.lastIndexOf('/') + 1), target)
        const fromMain = resolveArchivePath(prefix, target)
        return expand(texFiles.has(relative) ? relative : fromMain, chain)
      })
  }

  // Keep the original project assets alongside the generated document.
  const pathInProject = (path: string) => path.startsWith(prefix) ? path.slice(prefix.length) : path
  const result = parseLatexContent(expand(mainPath), pathInProject(mainPath))
  result.files.additionalFiles = new Map(
    [...texFiles, ...assets]
      .filter(([path]) => path !== mainPath)
      .map(([path, content]) => [pathInProject(path), content])
  )
  return result
}

function resolveArchivePath(directory: string, target: string): string {
  const parts: string[] = []
  for (const part of (directory + target).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/**
 * Parse LaTeX content
 */
function parseLatexContent(content: string, fileName: string): ImportResult {
  const warnings: string[] = []

  // Extract template
  let template: LatexTemplate
  try {
    template = parseLatexTemplate(content)
    template.metadata.importSource = fileName
  } catch {
    warnings.push('Failed to parse template, using default')
    template = createDefaultTemplate()
  }

  // Parse sections and content
  const nodes = parseSections(content)

  return {
    template,
    source: content,
    nodes,
    files: {},
    metadata: {
      sourceFileName: fileName,
      importedAt: new Date().toISOString(),
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  }
}

/**
 * Parse sections from LaTeX content
 */
function parseSections(content: string): ResearchNodeData[] {
  const nodes: ResearchNodeData[] = []

  // Extract document body
  const bodyMatch = content.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/)
  if (!bodyMatch) {
    return nodes
  }

  const body = bodyMatch[1]

  // Extract title
  const titleMatch = content.match(/\\title\{([^}]+)\}/)
  if (titleMatch) {
    nodes.push({
      section: 'title',
      content: cleanLatexCommands(titleMatch[1]),
      order: 0,
      level: 1,
    })
  }

  // Extract abstract
  const abstractMatch = body.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)
  if (abstractMatch) {
    nodes.push({
      section: 'abstract',
      content: cleanLatexCommands(abstractMatch[1]),
      order: 1,
      level: 1,
    })
  }

  // Extract sections
  const sectionRegex = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}([\s\S]*?)(?=\\(?:section|subsection|subsubsection|end\{document\})|$)/g
  let match
  let order = 2

  while ((match = sectionRegex.exec(body)) !== null) {
    const [, level, title, content] = match
    const sectionType = detectSectionType(title)

    nodes.push({
      section: sectionType,
      content: cleanLatexCommands(content),
      customLabel: sectionType === 'custom' ? title : undefined,
      level: level === 'section' ? 1 : level === 'subsection' ? 2 : 3,
      order: order++,
    })
  }

  return nodes
}

/**
 * Detect section type from title
 */
function detectSectionType(title: string): ResearchNodeType {
  const normalized = title.toLowerCase().trim()

  const patterns: Record<string, ResearchNodeType> = {
    'introduction': 'introduction',
    'related work': 'related-work',
    'literature review': 'related-work',
    'method': 'method',
    'methodology': 'method',
    'approach': 'method',
    'experiment': 'experiment',
    'evaluation': 'experiment',
    'result': 'result',
    'findings': 'result',
    'discussion': 'discussion',
    'conclusion': 'conclusion',
    'acknowledgment': 'acknowledgments',
    'reference': 'reference',
    'appendix': 'appendix',
  }

  for (const [pattern, type] of Object.entries(patterns)) {
    if (normalized.includes(pattern)) {
      return type
    }
  }

  return 'custom'
}

/**
 * Clean LaTeX commands from text
 */
function cleanLatexCommands(text: string): string {
  let cleaned = text

  // Remove comments
  cleaned = cleaned.replace(/%.*/g, '')

  // Remove formatting commands but keep content
  cleaned = cleaned.replace(/\\textbf\{([^}]+)\}/g, '$1')
  cleaned = cleaned.replace(/\\textit\{([^}]+)\}/g, '$1')
  cleaned = cleaned.replace(/\\emph\{([^}]+)\}/g, '$1')

  // Remove citations
  cleaned = cleaned.replace(/\\cite\{[^}]+\}/g, '[citation]')

  // Remove labels and refs
  cleaned = cleaned.replace(/\\label\{[^}]+\}/g, '')
  cleaned = cleaned.replace(/\\ref\{[^}]+\}/g, '[ref]')

  // Clean whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return cleaned
}

/**
 * Create default template
 */
function createDefaultTemplate(): LatexTemplate {
  return {
    documentClass: 'article',
    documentClassOptions: ['12pt', 'a4paper'],
    preamble: '',
    packages: [],
    metadata: {
      language: 'auto',
      imported: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
}

/**
 * Create project file system from import result
 */
export function createProjectFromImport(
  result: ImportResult,
  projectName?: string
): ProjectFileSystem {
  let fs = createProjectFileSystem(
    result.template,
    projectName || result.metadata.sourceFileName.replace(/\.tex$/, '')
  )

  // Add bibliography if present
  if (result.files.bibliography) {
    fs = {
      ...fs,
      files: new Map([
        ...fs.files,
        [
          'references.bib',
          {
            name: 'references.bib',
            type: 'editable',
            path: 'references.bib',
            content: result.files.bibliography,
            metadata: {
              editable: true,
              description: 'Bibliography',
              lastModified: new Date().toISOString(),
            },
          },
        ],
      ]),
    }
  }

  for (const [path, content] of result.files.additionalFiles ?? []) {
    if (path === 'main.tex') continue
    fs = addFile(fs, {
      name: path.split('/').at(-1) ?? path,
      path,
      type: typeof content === 'string' ? 'editable' : 'asset',
      content: typeof content === 'string' ? content : undefined,
      blob: typeof content === 'string' ? undefined : content,
      mimeType: typeof content === 'string' ? 'text/plain' : content.type,
      metadata: { editable: typeof content === 'string', lastModified: new Date().toISOString() },
    })
  }

  return fs
}
