import type { Editor } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'
//import { RESEARCH_NODE_META } from '@/app/research/research-node'
import { collectResearchNodes, sortNodesBySection, groupNodesBySection } from './latex-exporter'

/**
 * Markdown export options
 */
export interface MarkdownExportOptions {
    title?: string
    author?: string
    date?: string
}

/**
 * Get section title for Markdown
 */
function getMarkdownSectionTitle(sectionType: ResearchNodeType, level: number = 1): string {
    const titles: Record<ResearchNodeType, string> = {
        title: '',
        abstract: '摘要',
        keywords: '关键词',
        introduction: '引言',
        'related-work': '相关工作',
        method: '方法',
        experiment: '实验',
        result: '结果',
        discussion: '讨论',
        conclusion: '结论',
        limitations: '局限性',
        'future-work': '未来工作',
        acknowledgments: '致谢',
        reference: '参考文献',
        appendix: '附录',
        custom: '自定义',
    }

    const title = titles[sectionType]
    if (!title) return ''

    // Generate markdown heading
    const heading = '#'.repeat(level)
    return `${heading} ${title}`
}

/**
 * Format content for Markdown section
 */
function formatMarkdownSection(sectionType: ResearchNodeType, content: string): string {
    const parts: string[] = []

    // Handle title specially
    if (sectionType === 'title') {
        parts.push(`# ${content}`)
        parts.push('')
        return parts.join('\n')
    }

    // Handle abstract specially
    if (sectionType === 'abstract') {
        parts.push('## 摘要')
        parts.push('')
        parts.push(content)
        parts.push('')
        return parts.join('\n')
    }

    // Handle references specially
    if (sectionType === 'reference') {
        parts.push('## 参考文献')
        parts.push('')

        // Split references by line breaks
        const references = content.split('\n').filter(line => line.trim())
        references.forEach((ref, index) => {
            parts.push(`[${index + 1}] ${ref.trim()}`)
        })
        parts.push('')
        return parts.join('\n')
    }

    // Regular sections
    const sectionTitle = getMarkdownSectionTitle(sectionType, 2)
    if (sectionTitle) {
        parts.push(sectionTitle)
        parts.push('')
    }

    // Add content with proper paragraph spacing
    const paragraphs = content.split('\n\n').filter(p => p.trim())
    paragraphs.forEach(paragraph => {
        parts.push(paragraph.trim())
        parts.push('')
    })

    return parts.join('\n')
}

/**
 * Generate complete Markdown document from research nodes
 */
export function generateMarkdownDocument(
    editor: Editor,
    options: MarkdownExportOptions = {}
): string {
    // Collect and sort nodes
    const nodes = collectResearchNodes(editor)

    if (nodes.length === 0) {
        throw new Error('No research nodes found to export')
    }

    const sortedNodes = sortNodesBySection(nodes)
    const groupedNodes = groupNodesBySection(sortedNodes)

    // Build document parts
    const parts: string[] = []

    // Add title
    const titleData = groupedNodes.get('title')
    if (titleData) {
        parts.push(formatMarkdownSection('title', titleData.content))
    }

    // Add author if provided
    if (options.author) {
        parts.push(`**作者**: ${options.author}`)
        parts.push('')
    }

    // Add date if provided
    if (options.date) {
        parts.push(`**日期**: ${options.date}`)
        parts.push('')
    }

    // Add horizontal rule after metadata
    if (options.author || options.date) {
        parts.push('---')
        parts.push('')
    }

    // Add abstract
    const abstractData = groupedNodes.get('abstract')
    if (abstractData) {
        parts.push(formatMarkdownSection('abstract', abstractData.content))
    }

    // Add main sections
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
        const sectionData = groupedNodes.get(sectionType)
        if (sectionData) {
            parts.push(formatMarkdownSection(sectionType, sectionData.content))
        }
    }

    // Add references
    const referenceData = groupedNodes.get('reference')
    if (referenceData) {
        parts.push(formatMarkdownSection('reference', referenceData.content))
    }

    return parts.join('\n')
}

/**
 * Main export function - generates Markdown from editor
 */
export function exportToMarkdown(
    editor: Editor,
    options: MarkdownExportOptions = {}
): string {
    return generateMarkdownDocument(editor, options)
}
