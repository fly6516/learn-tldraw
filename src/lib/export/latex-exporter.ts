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
import { collectArrowOrderedNodes } from './arrow-ordering'

/**
 * Collected research node data
 */
interface ResearchNodeData {
    section: ResearchNodeType
    content: string
    order: number
    level: number
    parentId?: string
    customLabel?: string
    tags?: string[]
    metadata?: {
        sectionNumber?: string
    }
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
                level: researchShape.props.level || 1,
                parentId: researchShape.props.parentId,
                customLabel: researchShape.props.customLabel,
                tags: researchShape.props.tags,
                metadata: {
                    sectionNumber: researchShape.props.metadata?.sectionNumber,
                },
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
    content: string,
    customLabel?: string,
    level?: number,
    sectionNumber?: string
): string {
    const mapping = SECTION_LATEX_MAPPING[section]
    const escapedContent = escapeLatex(content.trim())

    // Use custom format if available
    if (mapping.customFormat) {
        return mapping.customFormat(escapedContent)
    }

    // For sections that need titles
    if (mapping.needsTitle) {
        const title = customLabel || getDefaultSectionTitle(section)
        const sectionNumberPrefix = sectionNumber ? `${sectionNumber} ` : ''

        // Determine section command based on level
        let command = mapping.command
        if (level && level > 1) {
            const levelCommands = ['section', 'subsection', 'subsubsection', 'paragraph']
            command = levelCommands[Math.min(level - 1, levelCommands.length - 1)]
        }

        return `\\${command}{${sectionNumberPrefix}${title}}\n\n${escapedContent}`
    }

    return escapedContent
}

/**
 * Group nodes by section type and concatenate content
 */
export function groupNodesBySection(
    nodes: ResearchNodeData[]
): Map<ResearchNodeType, { content: string; customLabel?: string; level?: number; sectionNumber?: string }> {
    const grouped = new Map<ResearchNodeType, { content: string; customLabel?: string; level?: number; sectionNumber?: string }>()

    for (const node of nodes) {
        const existing = grouped.get(node.section)
        if (existing) {
            existing.content += '\n\n' + node.content
        } else {
            grouped.set(node.section, {
                content: node.content,
                customLabel: node.customLabel,
                level: node.level,
                sectionNumber: node.metadata?.sectionNumber,
            })
        }
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
    const titleData = groupedNodes.get('title')
    if (titleData && !options.title) {
        options = { ...options, title: titleData.content }
    }

    // Build document parts
    const parts: string[] = []

    // Add preamble
    parts.push(generatePreamble(options))

    // Add document begin
    parts.push(generateDocumentBegin())

    // Add abstract if available
    const abstractData = groupedNodes.get('abstract')
    if (abstractData) {
        parts.push(formatSectionContent('abstract', abstractData.content, abstractData.customLabel, abstractData.level, abstractData.sectionNumber))
        parts.push('')
    }

    // Add keywords if available
    const keywordsData = groupedNodes.get('keywords')
    if (keywordsData) {
        parts.push(formatSectionContent('keywords', keywordsData.content, keywordsData.customLabel, keywordsData.level, keywordsData.sectionNumber))
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
        'limitations',
        'future-work',
    ]

    for (const sectionType of mainSections) {
        const sectionData = groupedNodes.get(sectionType)
        if (sectionData) {
            parts.push(formatSectionContent(sectionType, sectionData.content, sectionData.customLabel, sectionData.level, sectionData.sectionNumber))
            parts.push('')
        }
    }

    // Add acknowledgments if available
    const acknowledgementsData = groupedNodes.get('acknowledgments')
    if (acknowledgementsData) {
        parts.push(formatSectionContent('acknowledgments', acknowledgementsData.content, acknowledgementsData.customLabel, acknowledgementsData.level, acknowledgementsData.sectionNumber))
        parts.push('')
    }

    // Add references if available
    const referenceData = groupedNodes.get('reference')
    if (referenceData) {
        parts.push(formatSectionContent('reference', referenceData.content, referenceData.customLabel, referenceData.level, referenceData.sectionNumber))
        parts.push('')
    }

    // Add appendix if available
    const appendixData = groupedNodes.get('appendix')
    if (appendixData) {
        parts.push(formatSectionContent('appendix', appendixData.content, appendixData.customLabel, appendixData.level, appendixData.sectionNumber))
        parts.push('')
    }

    // Add custom sections if available
    const customData = groupedNodes.get('custom')
    if (customData) {
        parts.push(formatSectionContent('custom', customData.content, customData.customLabel, customData.level, customData.sectionNumber))
        parts.push('')
    }

    // Add document end
    parts.push(generateDocumentEnd())

    return parts.join('\n')
}

/**
 * Generate LaTeX document ordered by arrow topology.
 * Each node appears exactly in the order defined by arrows.
 * Only `title` is hoisted to the preamble; all other nodes
 * (including abstract/keywords) follow the arrow chain order.
 */
export function generateArrowOrderedLatexDocument(
    orderedShapes: ResearchNodeShape[],
    options: LatexTemplateOptions = {}
): string {
    if (orderedShapes.length === 0) {
        throw new Error('No research nodes found to export')
    }

    // Extract title for the preamble \title{} command
    const titleShape = orderedShapes.find((s) => s.props.section === 'title')
    if (titleShape && !options.title) {
        options = { ...options, title: titleShape.props.content }
    }

    const parts: string[] = []
    parts.push(generatePreamble(options))
    parts.push(generateDocumentBegin())

    // Emit every node in arrow-topology order; skip title (already in preamble)
    for (const shape of orderedShapes) {
        if (shape.props.section === 'title') continue

        parts.push(formatSectionContent(
            shape.props.section,
            shape.props.content,
            shape.props.customLabel,
            shape.props.level,
            shape.props.metadata?.sectionNumber,
        ))
        parts.push('')
    }

    parts.push(generateDocumentEnd())
    return parts.join('\n')
}

/**
 * Main export function - generates LaTeX from editor.
 * If arrows connect research nodes, uses arrow-topology order.
 * Otherwise falls back to fixed section-type order.
 */
export function exportToLatex(
    editor: Editor,
    options: LatexTemplateOptions = {}
): string {
    // Try arrow-ordered export first
    const arrowOrdered = collectArrowOrderedNodes(editor)
    if (arrowOrdered && arrowOrdered.length > 0) {
        return generateArrowOrderedLatexDocument(arrowOrdered, options)
    }

    const nodes = collectResearchNodes(editor)

    if (nodes.length === 0) {
        throw new Error('No research nodes found to export')
    }

    return generateLatexDocument(nodes, options)
}
