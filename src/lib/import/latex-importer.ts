import type { ResearchNode } from '@/lib/project/research-graph'
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
 * LaTeX section patterns mapping
 */
const LATEX_SECTION_PATTERNS: Record<string, ResearchNodeType> = {
    'title': 'title',
    'abstract': 'abstract',
    'keywords': 'keywords',
    'introduction': 'introduction',
    'related work': 'related-work',
    'literature review': 'related-work',
    'method': 'method',
    'methodology': 'method',
    'approach': 'method',
    'experiment': 'experiment',
    'experimental setup': 'experiment',
    'evaluation': 'experiment',
    'result': 'result',
    'findings': 'result',
    'discussion': 'discussion',
    'analysis': 'discussion',
    'conclusion': 'conclusion',
    'limitations': 'limitations',
    'future work': 'future-work',
    'future directions': 'future-work',
    'acknowledgment': 'acknowledgments',
    'acknowledgments': 'acknowledgments',
    'reference': 'reference',
    'bibliography': 'reference',
    'appendix': 'appendix',
}

/**
 * Clean LaTeX commands from text
 */
function cleanLatexCommands(text: string): string {
    return text.replace(/\\bibliography(?:style)?\s*\{[^{}]*\}/g, '').trim()
}

/**
 * Extract title from LaTeX document
 */
function extractTitle(latex: string): string | null {
    const titleMatch = latex.match(/\\title\{([^}]+)\}/)
    if (titleMatch) {
        return cleanLatexCommands(titleMatch[1])
    }
    return null
}

/**
 * Extract abstract from LaTeX document
 */
function extractAbstract(latex: string): string | null {
    const abstractMatch = latex.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/)
    if (abstractMatch) {
        return cleanLatexCommands(abstractMatch[1])
    }
    return null
}

/**
 * Extract keywords from LaTeX document
 */
function extractKeywords(latex: string): string | null {
    const keywordsMatch = latex.match(/\\keywords?\{([^}]+)\}/)
    if (keywordsMatch) {
        return cleanLatexCommands(keywordsMatch[1])
    }
    return null
}

/**
 * Detect section type from section title
 */
function detectSectionType(title: string): ResearchNodeType {
    const normalizedTitle = title.toLowerCase().trim()

    for (const [pattern, type] of Object.entries(LATEX_SECTION_PATTERNS)) {
        if (normalizedTitle.includes(pattern)) {
            return type
        }
    }

    return 'custom'
}

/**
 * Parse LaTeX sections
 */
function parseSections(latex: string): ParsedSection[] {
    const sections: ParsedSection[] = []

    // Extract title
    const title = extractTitle(latex)
    if (title) {
        sections.push({
            type: 'title',
            content: title,
            level: 1,
        })
    }

    // Extract abstract
    const abstract = extractAbstract(latex)
    if (abstract) {
        sections.push({
            type: 'abstract',
            content: abstract,
            level: 1,
        })
    }

    // Extract keywords
    const keywords = extractKeywords(latex)
    if (keywords) {
        sections.push({
            type: 'keywords',
            content: keywords,
            level: 1,
        })
    }

    // Parse sections, subsections, and subsubsections
    const sectionRegex = /\\(section|subsection|subsubsection)\*?\{([^}]+)\}([\s\S]*?)(?=\\(?:section|subsection|subsubsection|appendix|end\{document\})|$)/g

    let match
    while ((match = sectionRegex.exec(latex)) !== null) {
        const [, command, sectionTitle, content] = match

        const level = command === 'section' ? 1 : command === 'subsection' ? 2 : 3
        const cleanContent = cleanLatexCommands(content)

        if (cleanContent.trim()) {
            const sectionType = detectSectionType(sectionTitle)

            sections.push({
                type: sectionType,
                content: cleanContent,
                level,
                customLabel: sectionTitle,
            })
        }
    }

    return sections
}

/**
 * Convert LaTeX sections into positioned research nodes.
 */
export function parseLatexNodes(latexContent: string): ResearchNode[] {
    const sections = parseSections(latexContent)
    if (!sections.length) throw new Error('No valid sections found in LaTeX document')
    const levels = new Map<number, string>()
    return sections.map((section, order) => {
        const id = crypto.randomUUID()
        for (const level of levels.keys()) {
            if (level >= section.level) levels.delete(level)
        }
        const parentId = [...levels.values()].at(-1)
        levels.set(section.level, id)
        return {
            id,
            position: { x: 100 + (order % 3) * 410, y: 100 + Math.floor(order / 3) * 340 },
            data: {
                section: section.type, content: section.content, order, level: section.level,
                parentId, customLabel: section.customLabel,
                metadata: { imported: true, importSource: 'latex', createdAt: new Date().toISOString() },
            },
        }
    })
}

/**
 * Validate LaTeX content
 */
export function validateLatexContent(content: string): { valid: boolean; error?: string } {
    if (!content || content.trim().length === 0) {
        return { valid: false, error: 'LaTeX content is empty' }
    }

    // Check for basic LaTeX structure
    if (!content.includes('\\documentclass') && !content.includes('\\section')) {
        return { valid: false, error: 'Invalid LaTeX format: missing document structure' }
    }

    return { valid: true }
}
