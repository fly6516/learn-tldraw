/**
 * Enhanced LaTeX Importer
 * Supports template extraction, figures, and bibliography
 */

import JSZip from 'jszip'
import { parseLatexTemplate } from '../project/template-parser'
import { createProjectFileSystem, addFigure } from '../project/file-system'
import type {
  ImportResult,
  ProjectFileSystem,
  LatexTemplate,
  ResearchNodeData,
} from '../project/types'
import type { ResearchNodeType } from '@/app/research/research-node'

/**
 * Parsed LaTeX section data
 */
interface ParsedSection {
  type: ResearchNodeType
  content: string
  level: number
  customLabel?: string
}

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
  const zip = new JSZip()
  const zipContent = await zip.loadAsync(file)

  // Find main .tex file
  let mainTexContent = ''
  let mainTexName = ''
  const texFiles: Map<string, string> = new Map()
  const figures: Map<string, Blob> = new Map()
  let bibliography = ''

  // Extract all files
  for (const [filename, zipFile] of Object.entries(zipContent.files)) {
    if (zipFile.dir) continue

    const name = filename.split('/').pop() || filename

    // .tex files
    if (filename.endsWith('.tex')) {
      const content = await zipFile.async('text')
      texFiles.set(name, content)

      // Detect main file
      if (
        content.includes('\\begin{document}') ||
        name.toLowerCase().includes('main') ||
        name.toLowerCase() === 'paper.tex'
      ) {
        mainTexContent = content
        mainTexName = name
      }
    }

    // .bib files
    else if (filename.endsWith('.bib')) {
      bibliography = await zipFile.async('text')
    }

    // Image files
    else if (
      filename.match(/\.(png|jpg|jpeg|pdf|eps|svg)$/i) &&
      (filename.includes('figure') || filename.includes('image'))
    ) {
      const blob = await zipFile.async('blob')
      figures.set(name, blob)
    }
  }

  // If no main file found, use the first one
  if (!mainTexContent && texFiles.size > 0) {
    const first = texFiles.entries().next().value
    if (first) {
      mainTexContent = first[1]
      mainTexName = first[0]
    }
  }

  if (!mainTexContent) {
    throw new Error('No .tex files found in ZIP')
  }

  const result = parseLatexContent(mainTexContent, mainTexName)

  // Add extracted files
  result.files = {
    figures,
    bibliography: bibliography || undefined,
    additionalFiles: new Map(
      Array.from(texFiles.entries()).filter(([name]) => name !== mainTexName)
    ),
  }

  return result
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
  } catch (error) {
    warnings.push('Failed to parse template, using default')
    template = createDefaultTemplate()
  }

  // Parse sections and content
  const nodes = parseSections(content)

  return {
    template,
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

  // Add figures
  if (result.files.figures) {
    result.files.figures.forEach((blob, fileName) => {
      fs = addFigure(fs, fileName, blob)
    })
  }

  return fs
}
