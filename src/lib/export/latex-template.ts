import type { ResearchNodeType } from '@/app/research/research-node'

/**
 * LaTeX template following GB/T 7714 Chinese national standards
 * Includes proper document structure, fonts, spacing, and citation format
 */

export interface LatexTemplateOptions {
    title?: string
    author?: string
    date?: string
}

/**
 * Generate the LaTeX document preamble with GB/T 7714 standards
 */
export function generatePreamble(options: LatexTemplateOptions = {}): string {
    const { author = '', date = '\\today', title = '' } = options

    return `\\documentclass[12pt,a4paper,UTF8]{ctexart}

% 检查编译器
\\RequireXeTeX

% GB/T 7714 packages and settings
\\usepackage[top=2.5cm,bottom=2.5cm,left=3cm,right=2.5cm]{geometry}
\\usepackage{setspace}
\\usepackage{titlesec}
\\usepackage{gbt7714}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{hyperref}

% Line spacing (1.5 for GB standards)
\\setstretch{1.5}

% Section numbering format (1, 1.1, 1.1.1)
\\titleformat{\\section}{\\Large\\bfseries\\sffamily}{\\thesection}{1em}{}
\\titleformat{\\subsection}{\\large\\bfseries\\sffamily}{\\thesubsection}{1em}{}
\\titleformat{\\subsubsection}{\\normalsize\\bfseries\\sffamily}{\\thesubsubsection}{1em}{}

% Citation style GB/T 7714
\\bibliographystyle{gbt7714-numerical}

% Hyperref settings
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    citecolor=blue,
    urlcolor=blue
}

% Title, Author and date
${title ? `\\title{${title}}` : '\\title{研究论文}'}
${author ? `\\author{${author}}` : ''}
\\date{${date}}
`
}

/**
 * Generate the document beginning
 */
export function generateDocumentBegin(): string {
    return `\\begin{document}

\\maketitle
`
}

/**
 * Generate the document ending
 */
export function generateDocumentEnd(): string {
    return `\\end{document}
`
}

/**
 * Map research node section types to LaTeX section commands
 */
export const SECTION_LATEX_MAPPING: Record<
    ResearchNodeType,
    {
        command: string
        needsTitle: boolean
        customFormat?: (content: string) => string
    }
> = {
    title: {
        command: 'title',
        needsTitle: false,
        customFormat: (content: string) => `\\title{${content}}`,
    },
    abstract: {
        command: 'abstract',
        needsTitle: false,
        customFormat: (content: string) =>
            `\\begin{abstract}\n${content}\n\\end{abstract}`,
    },
    introduction: {
        command: 'section',
        needsTitle: true,
    },
    'related-work': {
        command: 'section',
        needsTitle: true,
    },
    method: {
        command: 'section',
        needsTitle: true,
    },
    experiment: {
        command: 'section',
        needsTitle: true,
    },
    result: {
        command: 'section',
        needsTitle: true,
    },
    discussion: {
        command: 'section',
        needsTitle: true,
    },
    conclusion: {
        command: 'section',
        needsTitle: true,
    },
    reference: {
        command: 'bibliography',
        needsTitle: false,
        customFormat: (content: string) => {
            // If content contains bibliography entries, format them
            if (content.trim()) {
                return `\\begin{thebibliography}{99}\n${content}\n\\end{thebibliography}`
            }
            return ''
        },
    },
}

/**
 * Get the default section title for a research node type
 */
export function getDefaultSectionTitle(sectionType: ResearchNodeType): string {
    const titles: Record<ResearchNodeType, string> = {
        title: '',
        abstract: '',
        introduction: '引言',
        'related-work': '相关工作',
        method: '方法',
        experiment: '实验',
        result: '结果',
        discussion: '讨论',
        conclusion: '结论',
        reference: '参考文献',
    }
    return titles[sectionType]
}
