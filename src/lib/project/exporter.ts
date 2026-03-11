/**
 * Enhanced LaTeX Exporter
 * Supports template selection, figures, and ZIP export
 */

import JSZip from 'jszip'
import type {
  ProjectFileSystem,
  ExportOptions,
  LatexTemplate,
  ResearchNodeData,
  ProjectFile,
} from '../project/types'
import { generatePreamble } from '../project/template-parser'
import { TEMPLATE_PRESETS } from '../project/templates'
import { listAllFiles } from '../project/file-system'
import type { ResearchNodeType } from '@/app/research/research-node'
import { RESEARCH_NODE_META } from '@/app/research/research-node'

/**
 * Export to LaTeX .tex file
 */
export async function exportToLatexFile(
  nodes: ResearchNodeData[],
  fileSystem: ProjectFileSystem,
  options: ExportOptions = { format: 'tex' }
): Promise<string> {
  const template = getExportTemplate(fileSystem, options)
  return generateLatexDocument(nodes, template, fileSystem, options)
}

/**
 * Export to ZIP file with complete project structure
 */
export async function exportToLatexZip(
  nodes: ResearchNodeData[],
  fileSystem: ProjectFileSystem,
  options: ExportOptions = { format: 'zip' }
): Promise<Blob> {
  const zip = new JSZip()

  // Generate main.tex
  const template = getExportTemplate(fileSystem, options)
  const mainContent = generateLatexDocument(nodes, template, fileSystem, options)
  zip.file('main.tex', mainContent)

  // Add preamble.tex if user has custom additions
  const preambleFile = fileSystem.files.get('preamble.tex')
  if (preambleFile && preambleFile.type !== 'directory' && preambleFile.content) {
    const content = preambleFile.content.trim()
    if (content && content !== '% Add custom packages and commands here\n') {
      zip.file('preamble.tex', content)
    }
  }

  // Add references.bib if exists
  if (options.includeReferences !== false) {
    const bibFile = fileSystem.files.get('references.bib')
    if (bibFile && bibFile.type !== 'directory' && bibFile.content) {
      zip.file('references.bib', bibFile.content)
    }
  }

  // Add figures
  if (options.includeFigures !== false) {
    const figuresFolder = zip.folder('figures')
    if (figuresFolder) {
      const allFiles = listAllFiles(fileSystem)
      const figures = allFiles.filter(f => f.path.startsWith('figures/') && f.blob)

      for (const figure of figures) {
        if (figure.blob) {
          figuresFolder.file(figure.name, figure.blob)
        }
      }
    }
  }

  // Add all other user-created files (excluding already added files)
  const excludedFiles = new Set(['main.tex', 'preamble.tex', 'references.bib', 'figures/'])
  for (const [path, file] of fileSystem.files.entries()) {
    if (excludedFiles.has(path)) continue
    if (file.type === 'directory') continue
    if (path.startsWith('figures/')) continue // Already handled above

    const projectFile = file as ProjectFile
    if (projectFile.content) {
      zip.file(path, projectFile.content)
    } else if (projectFile.blob) {
      zip.file(path, projectFile.blob)
    }
  }

  // Add README
  zip.file('README.md', generateReadme(fileSystem, template))

  return zip.generateAsync({ type: 'blob' })
}

/**
 * Get template for export
 */
function getExportTemplate(
  fileSystem: ProjectFileSystem,
  options: ExportOptions
): LatexTemplate {
  // Use custom template if provided
  if (options.customTemplate) {
    return options.customTemplate
  }

  // Use original imported template
  if (options.useOriginalTemplate && fileSystem.template.metadata.imported) {
    return fileSystem.template
  }

  // Use preset template
  if (options.templatePreset) {
    const preset = TEMPLATE_PRESETS[options.templatePreset]
    return {
      documentClass: preset.documentClass,
      documentClassOptions: preset.documentClassOptions,
      preamble: preset.preambleTemplate,
      packages: preset.packages.map(name => ({ name })),
      metadata: {
        language: preset.language,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
  }

  // Default: use file system template
  return fileSystem.template
}

/**
 * Generate complete LaTeX document
 */
function generateLatexDocument(
  nodes: ResearchNodeData[],
  template: LatexTemplate,
  fileSystem: ProjectFileSystem,
  options: ExportOptions
): string {
  const parts: string[] = []

  // Generate preamble
  parts.push(generatePreamble(template))

  // Add user's custom preamble if exists
  if (options.includePreamble !== false) {
    const preambleFile = fileSystem.files.get('preamble.tex')
    if (preambleFile && preambleFile.type !== 'directory' && preambleFile.content) {
      const content = preambleFile.content.trim()
      if (content && content !== '% Add custom packages and commands here\n') {
        parts.push('\n% User custom preamble')
        parts.push(content)
      }
    }
  }

  // Add metadata if provided
  if (options.metadata) {
    parts.push('')
    if (options.metadata.title) {
      parts.push(`\\title{${escapeLatex(options.metadata.title)}}`)
    }
    if (options.metadata.author) {
      parts.push(`\\author{${escapeLatex(options.metadata.author)}}`)
    }
    if (options.metadata.date) {
      parts.push(`\\date{${escapeLatex(options.metadata.date)}}`)
    }
  }

  // Begin document
  parts.push('')
  parts.push('\\begin{document}')
  parts.push('')

  // Add title and metadata
  if (options.metadata?.title) {
    parts.push('\\maketitle')
    parts.push('')
  }

  // Sort and group nodes
  const sortedNodes = sortNodesBySection(nodes)
  const groupedNodes = groupNodesBySection(sortedNodes)

  // Generate content for each section
  for (const [sectionType, sectionNodes] of groupedNodes) {
    const sectionContent = generateSectionContent(
      sectionType,
      sectionNodes,
      template
    )
    if (sectionContent) {
      parts.push(sectionContent)
      parts.push('')
    }
  }

  // Add bibliography if exists
  const bibFile = fileSystem.files.get('references.bib')
  if (bibFile && bibFile.type !== 'directory' && bibFile.content) {
    parts.push('\\bibliography{references}')
    parts.push('')
  }

  // End document
  parts.push('\\end{document}')

  return parts.join('\n')
}

/**
 * Sort nodes by section order
 */
function sortNodesBySection(nodes: ResearchNodeData[]): ResearchNodeData[] {
  return [...nodes].sort((a, b) => {
    const orderA = RESEARCH_NODE_META[a.section as ResearchNodeType]?.order ?? 999
    const orderB = RESEARCH_NODE_META[b.section as ResearchNodeType]?.order ?? 999

    if (orderA !== orderB) {
      return orderA - orderB
    }

    return a.order - b.order
  })
}

/**
 * Group nodes by section type
 */
function groupNodesBySection(
  nodes: ResearchNodeData[]
): Map<ResearchNodeType, ResearchNodeData[]> {
  const grouped = new Map<ResearchNodeType, ResearchNodeData[]>()

  for (const node of nodes) {
    const existing = grouped.get(node.section) || []
    existing.push(node)
    grouped.set(node.section, existing)
  }

  return grouped
}

/**
 * Generate content for a section
 */
function generateSectionContent(
  sectionType: ResearchNodeType,
  nodes: ResearchNodeData[],
  template: LatexTemplate
): string {
  if (nodes.length === 0) return ''

  const parts: string[] = []

  // Special handling for different section types
  switch (sectionType) {
    case 'title':
      // Title is handled in metadata
      break

    case 'abstract':
      parts.push('\\begin{abstract}')
      parts.push(nodes.map(n => escapeLatex(n.content)).join('\n\n'))
      parts.push('\\end{abstract}')
      break

    case 'keywords':
      parts.push('\\begin{keywords}')
      parts.push(nodes.map(n => escapeLatex(n.content)).join(', '))
      parts.push('\\end{keywords}')
      break

    case 'reference':
      // References are handled separately
      break

    default:
      // Regular sections
      for (const node of nodes) {
        const sectionCommand = getSectionCommand(node.level)
        const sectionTitle = node.customLabel || getDefaultSectionTitle(sectionType, template)

        parts.push(`\\${sectionCommand}{${escapeLatex(sectionTitle)}}`)
        if (node.metadata?.sectionNumber) {
          parts.push(`\\label{sec:${node.metadata.sectionNumber}}`)
        }
        parts.push('')
        parts.push(escapeLatex(node.content))
      }
  }

  return parts.join('\n')
}

/**
 * Get section command based on level
 */
function getSectionCommand(level: number): string {
  switch (level) {
    case 1:
      return 'section'
    case 2:
      return 'subsection'
    case 3:
      return 'subsubsection'
    default:
      return 'section'
  }
}

/**
 * Get default section title
 */
function getDefaultSectionTitle(
  sectionType: ResearchNodeType,
  template: LatexTemplate
): string {
  const meta = RESEARCH_NODE_META[sectionType]
  if (!meta) return 'Section'

  // Use language-specific title if available
  if (template.metadata.language === 'zh') {
    const zhTitles: Record<string, string> = {
      'introduction': '引言',
      'related-work': '相关工作',
      'method': '方法',
      'experiment': '实验',
      'result': '结果',
      'discussion': '讨论',
      'conclusion': '结论',
      'acknowledgments': '致谢',
      'appendix': '附录',
    }
    return zhTitles[sectionType] || meta.label
  }

  return meta.label
}

/**
 * Escape special LaTeX characters
 */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, '\\$&')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

/**
 * Generate README for exported project
 */
function generateReadme(
  fileSystem: ProjectFileSystem,
  template: LatexTemplate
): string {
  return `# ${fileSystem.metadata.projectName}

Exported from tldraw Research Tool

## Files

- \`main.tex\` - Main document
- \`preamble.tex\` - Custom preamble additions (if any)
- \`references.bib\` - Bibliography (if any)
- \`figures/\` - Figures and images (if any)

## Compilation

Compile with:

\`\`\`bash
pdflatex main.tex
bibtex main
pdflatex main.tex
pdflatex main.tex
\`\`\`

Or use latexmk:

\`\`\`bash
latexmk -pdf main.tex
\`\`\`

## Template

- Document Class: ${template.documentClass}
- Language: ${template.metadata.language || 'auto'}
${template.metadata.imported ? `- Imported from: ${template.metadata.importSource}` : ''}

## Generated

- Date: ${new Date().toISOString()}
- Version: ${fileSystem.metadata.version}
`
}
