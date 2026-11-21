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
} from '../project/types'
import { generatePreamble } from '../project/template-parser'
import { TEMPLATE_PRESETS } from '../project/templates'
import type { ResearchNodeType } from '@/app/research/research-node'
import { RESEARCH_NODE_META } from '@/app/research/research-node'

/**
 * Export to LaTeX .tex file
 */
export function exportToLatexFile(
  nodes: ResearchNodeData[],
  fileSystem: ProjectFileSystem,
  options: ExportOptions = { format: 'tex' }
): string {
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
  const mainContent = exportToLatexFile(nodes, fileSystem, options)
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

  const excludedFiles = new Set(['main.tex', 'preamble.tex'])
  for (const [path, file] of fileSystem.files) {
    if (excludedFiles.has(path) || file.type === 'directory') continue
    if (options.includeReferences === false && /\.bib$/i.test(path)) continue
    if (options.includeFigures === false && path.startsWith('figures/')) continue

    const content = file.content ?? file.blob
    if (content !== undefined) {
      zip.file(path, typeof content === 'string' ? content : await content.arrayBuffer())
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

  const title = nodes.find(node => node.section === 'title')?.content.trim()
  const metadata = options.metadata ?? (!template.metadata.title && title ? { title } : undefined)
  // Add metadata if provided
  if (metadata) {
    parts.push('')
    if (metadata.title) {
      parts.push(`\\title{${escapeLatex(metadata.title)}}`)
    }
    if (metadata.author) {
      parts.push(`\\author{${escapeLatex(metadata.author)}}`)
    }
    if (metadata.date) {
      parts.push(`\\date{${escapeLatex(metadata.date)}}`)
    }
  }

  // Begin document
  parts.push('')
  parts.push('\\begin{document}')
  parts.push('')

  // Add title and metadata
  if (metadata?.title || template.metadata.title) {
    parts.push('\\maketitle')
    parts.push('')
  }

  // Sort and group nodes
  const groupedNodes = options.preserveNodeOrder
    ? nodes.map(node => [node.section, [node]] as const)
    : groupNodesBySection(sortNodesBySection(nodes))

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
  const hasBibliography = template.bibliographyFiles || (bibFile && bibFile.type !== 'directory' && bibFile.content)
  if (options.includeReferences !== false && hasBibliography) {
    if (!/\\bibliographystyle\s*\{/.test(parts.join('\n'))) parts.push(template.bibliography?.command ?? '\\bibliographystyle{plain}')
    parts.push(`\\bibliography{${template.bibliographyFiles ?? 'references'}}`)
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
  nodes: readonly ResearchNodeData[],
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
      parts.push(nodes.map(n => n.content).join('\n\n'))
      parts.push('\\end{abstract}')
      break

    case 'keywords':
      parts.push('\\noindent\\textbf{Keywords:} ')
      parts.push(nodes.map(n => n.content).join(', '))
      break

    case 'reference':
      if (nodes.some(node => node.content.trim())) {
        parts.push('\\section*{References}', ...nodes.map(node => node.content))
      }
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
        parts.push(node.content)
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
