import type { Editor } from 'tldraw'
import { createShapeId } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'
import { RESEARCH_NODE_META } from '@/app/research/research-node'
import JSZip from 'jszip'

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
    let cleaned = text

    // Remove comments
    cleaned = cleaned.replace(/%.*/g, '')

    // Remove common formatting commands but keep their content
    cleaned = cleaned.replace(/\\textbf\{([^}]+)\}/g, '$1')
    cleaned = cleaned.replace(/\\textit\{([^}]+)\}/g, '$1')
    cleaned = cleaned.replace(/\\emph\{([^}]+)\}/g, '$1')
    cleaned = cleaned.replace(/\\texttt\{([^}]+)\}/g, '$1')

    // Remove citations
    cleaned = cleaned.replace(/\\cite\{[^}]+\}/g, '')
    cleaned = cleaned.replace(/\\citep?\{[^}]+\}/g, '')

    // Remove labels and refs
    cleaned = cleaned.replace(/\\label\{[^}]+\}/g, '')
    cleaned = cleaned.replace(/\\ref\{[^}]+\}/g, '')

    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim()

    return cleaned
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
                customLabel: sectionType === 'custom' ? sectionTitle : undefined,
            })
        }
    }

    return sections
}

/**
 * Import LaTeX content into tldraw editor
 */
export function importLatexToEditor(editor: Editor, latexContent: string): void {
    const sections = parseSections(latexContent)

    if (sections.length === 0) {
        throw new Error('No valid sections found in LaTeX document')
    }

    // Calculate positions for nodes
    const startX = 100
    const startY = 100
    const nodeWidth = 400
    const nodeHeight = 200
    const horizontalGap = 50
    const verticalGap = 50

    // Group sections by type to determine order
    const sectionsByType = new Map<ResearchNodeType, ParsedSection[]>()
    sections.forEach(section => {
        const existing = sectionsByType.get(section.type) || []
        existing.push(section)
        sectionsByType.set(section.type, existing)
    })

    // Sort sections by their defined order
    const sortedSections = sections.sort((a, b) => {
        const orderA = RESEARCH_NODE_META[a.type].order
        const orderB = RESEARCH_NODE_META[b.type].order
        return orderA - orderB
    })

    // Create shapes
    const shapes = sortedSections.map((section, index) => {
        const row = Math.floor(index / 3)
        const col = index % 3

        const x = startX + col * (nodeWidth + horizontalGap)
        const y = startY + row * (nodeHeight + verticalGap)

        return {
            id: createShapeId(),
            type: 'research-node' as const,
            x,
            y,
            props: {
                section: section.type,
                content: section.content,
                order: index,
                level: section.level,
                customLabel: section.customLabel,
                metadata: {
                    imported: true,
                    importSource: 'latex',
                    createdAt: new Date().toISOString(),
                },
            },
        }
    })

    // Add shapes to editor
    editor.createShapes(shapes)

    // Zoom to fit all shapes
    editor.zoomToFit({ animation: { duration: 300 } })
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

/**
 * Extract main .tex file from zip contents
 */
function findMainTexFile(files: { [key: string]: string }): string | null {
    const texFiles = Object.keys(files).filter(name => name.endsWith('.tex'))

    if (texFiles.length === 0) {
        return null
    }

    // Priority order for finding main file
    const priorities = [
        'main.tex',
        'paper.tex',
        'manuscript.tex',
        'article.tex',
    ]

    // Check priority files first
    for (const priority of priorities) {
        const found = texFiles.find(name => name.toLowerCase().endsWith(priority))
        if (found) {
            return files[found]
        }
    }

    // Find the file with \documentclass
    for (const filename of texFiles) {
        const content = files[filename]
        if (content.includes('\\documentclass')) {
            return content
        }
    }

    // Return the first .tex file as fallback
    return files[texFiles[0]]
}

/**
 * Import LaTeX zip file
 */
export async function importLatexZip(editor: Editor, zipFile: File): Promise<void> {
    try {
        const zip = new JSZip()
        const zipContent = await zip.loadAsync(zipFile)

        // Extract all .tex files
        const texFiles: { [key: string]: string } = {}

        for (const [filename, file] of Object.entries(zipContent.files)) {
            if (!file.dir && filename.endsWith('.tex')) {
                const content = await file.async('text')
                texFiles[filename] = content
            }
        }

        if (Object.keys(texFiles).length === 0) {
            throw new Error('No .tex files found in the zip archive')
        }

        // Find and use the main .tex file
        const mainContent = findMainTexFile(texFiles)

        if (!mainContent) {
            throw new Error('Could not find a valid main .tex file')
        }

        // Import the main file content
        importLatexToEditor(editor, mainContent)
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to process zip file: ${error.message}`)
        }
        throw new Error('Failed to process zip file')
    }
}
