import type { Editor } from 'tldraw'
import type { ResearchNodeShape } from '@/shapes/research/ResearchNodeShape'
import type { ResearchNodeType } from '@/app/research/research-node'
import { RESEARCH_NODE_META } from '@/app/research/research-node'
import {
    generatePreamble,
    generateDocumentBegin,
    generateDocumentEnd,
    SECTION_LATEX_MAPPING,
    getDefaultSectionTitle,
    type LatexTemplateOptions,
} from './latex-template'

/**
 * Collected research node data
 */
interface ResearchNodeData {
    section: ResearchNodeType
    content: string
    order: number
}

/**
 * Collect all research nodes from the tldraw editor
 */
export function collectResearchNodes(editor: Editor): ResearchNodeData[] {
    const shapes = editor.getCurrentPageShapes()
    const researchNodes: ResearchNodeData[] = []

    for (const shape of shapes) {
        if (shape.type === 'research-node') {
            const researchShape = shape as ResearchNodeShape
            researchNodes.push({
                section: researchShape.props.section,
                content: researchShape.props.content,
                order: researchShape.props.order,
            })
        }
    }

    return researchNodes
}

/**
 * Sort nodes by section type order, then by node order
 */
export function sortNodesBySection(nodes: ResearchNodeData[]): ResearchNodeData[] {
    return nodes.sort((a, b) => {
        const sectionOrderA = RESEARCH_NODE_META[a.section].order
        const sectionOrderB = RESEARCH_NODE_META[b.section].order

        if (sectionOrderA !== sectionOrderB) {
            return sectionOrderA - sectionOrderB
        }

        // If same section type, sort by node order
        return a.order - b.order
    })
}

/**
 * Escape special LaTeX characters
 */
export function escapeLatex(text: string): string {
    const replacements: Record<string, string> = {
        '\\': '\\textbackslash{}',
        '{': '\\{',
        '}': '\\}',
        '&': '\\&',
        '%': '\\%',
        '$': '\\$',
        '#': '\\#',
        '_': '\\_',
        '^': '\\^{}',
        '~': '\\~{}',
    }

    // First handle backslash separately to avoid double-escaping
    let escaped = text.replace(/\\/g, '\\textbackslash{}')

    // Then handle other special characters
    for (const [char, replacement] of Object.entries(replacements)) {
        if (char !== '\\') {
            escaped = escaped.replace(new RegExp('\\' + char, 'g'), replacement)
        }
    }

    return escaped
}

/**
 * Format content for a specific section type
 */
export function formatSectionContent(
    section: ResearchNodeType,
    content: string
): string {
    const mapping = SECTION_LATEX_MAPPING[section]
    const escapedContent = escapeLatex(content.trim())

    // Use custom format if available
    if (mapping.customFormat) {
        return mapping.customFormat(escapedContent)
    }

    // For sections that need titles
    if (mapping.needsTitle) {
        const title = getDefaultSectionTitle(section)
        return `\\${mapping.command}{${title}}\n\n${escapedContent}`
    }

    return escapedContent
}

/**
 * Group nodes by section type and concatenate content
 */
export function groupNodesBySection(
    nodes: ResearchNodeData[]
): Map<ResearchNodeType, string> {
    const grouped = new Map<ResearchNodeType, string>()

    for (const node of nodes) {
        const existing = grouped.get(node.section) || ''
        const separator = existing ? '\n\n' : ''
        grouped.set(node.section, existing + separator + node.content)
    }

    return grouped
}

/**
 * Generate complete LaTeX document from research nodes
 */
export function generateLatexDocument(
    nodes: ResearchNodeData[],
    options: LatexTemplateOptions = {}
): string {
    // Sort nodes by section order
    const sortedNodes = sortNodesBySection(nodes)

    // Group nodes by section type
    const groupedNodes = groupNodesBySection(sortedNodes)

    // Extract title if available
    const titleContent = groupedNodes.get('title')
    if (titleContent && !options.title) {
        options = { ...options, title: titleContent }
    }

    // Build document parts
    const parts: string[] = []

    // Add preamble
    parts.push(generatePreamble(options))

    // Add document begin
    parts.push(generateDocumentBegin())

    // Add abstract if available
    const abstractContent = groupedNodes.get('abstract')
    if (abstractContent) {
        parts.push(formatSectionContent('abstract', abstractContent))
        parts.push('')
    }

    // Add main sections in order
    const mainSections: ResearchNodeType[] = [
        'introduction',
        'related-work',
        'method',
        'experiment',
        'result',
        'discussion',
        'conclusion',
    ]

    for (const sectionType of mainSections) {
        const content = groupedNodes.get(sectionType)
        if (content) {
            parts.push(formatSectionContent(sectionType, content))
            parts.push('')
        }
    }

    // Add references if available
    const referenceContent = groupedNodes.get('reference')
    if (referenceContent) {
        parts.push(formatSectionContent('reference', referenceContent))
        parts.push('')
    }

    // Add document end
    parts.push(generateDocumentEnd())

    return parts.join('\n')
}

/**
 * Main export function - generates LaTeX from editor
 */
export function exportToLatex(
    editor: Editor,
    options: LatexTemplateOptions = {}
): string {
    const nodes = collectResearchNodes(editor)

    if (nodes.length === 0) {
        throw new Error('No research nodes found to export')
    }

    return generateLatexDocument(nodes, options)
}
