import type { Editor } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'
import { collectResearchNodes, sortNodesBySection, groupNodesBySection } from './latex-exporter'
import { collectArrowOrderedNodes } from './arrow-ordering'
import type { ResearchNodeShape } from '@/shapes/research/ResearchNodeShape'

/**
 * PDF export options
 */
export interface PdfExportOptions {
    title?: string
    author?: string
    subject?: string
}

/**
 * Get section title for PDF
 */
function getSectionTitle(sectionType: ResearchNodeType, customLabel?: string): string {
    if (customLabel) return customLabel
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
    return titles[sectionType]
}

/**
 * PDF HTML head with GB/T 7714 styles
 */
function PDF_HTML_HEAD(title: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        @page { size: A4; margin: 2.5cm 2.5cm 2.5cm 3cm; }
        body { font-family: "SimSun","宋体",serif; font-size: 12pt; line-height: 1.5; color: #000; margin: 0; padding: 20px; }
        .title { font-size: 22pt; font-weight: bold; text-align: center; margin-bottom: 20px; font-family: "SimHei","黑体",sans-serif; }
        .author { font-size: 14pt; text-align: center; margin-bottom: 30px; }
        .abstract-title { font-size: 15pt; font-weight: bold; text-align: center; margin-top: 20px; margin-bottom: 10px; font-family: "SimHei","黑体",sans-serif; }
        .abstract-content { font-size: 12pt; line-height: 1.5; margin-bottom: 20px; text-align: justify; }
        .keywords { font-size: 12pt; margin-bottom: 20px; }
        .section-title { font-size: 16pt; font-weight: bold; margin-top: 20px; margin-bottom: 10px; font-family: "SimHei","黑体",sans-serif; }
        .section-content { font-size: 12pt; line-height: 1.5; text-align: justify; margin-bottom: 15px; }
        .section-content p { margin: 10px 0; text-indent: 2em; }
        .reference-title { font-size: 16pt; font-weight: bold; margin-top: 20px; margin-bottom: 10px; font-family: "SimHei","黑体",sans-serif; }
        .reference-item { font-size: 10.5pt; line-height: 1.5; margin: 5px 0; }
        @media print { body { padding: 0; } .no-print { display: none; } }
    </style>
</head>
<body>`
}

/**
 * Render a single research node as HTML block
 */
function renderNodeHtml(shape: ResearchNodeShape): string {
    const { section, content, customLabel } = shape.props
    const parts: string[] = []

    if (section === 'title') return '' // handled separately in header

    if (section === 'abstract') {
        parts.push(`    <div class="abstract-title">摘要</div>`)
        parts.push(`    <div class="abstract-content">${escapeHtml(content)}</div>`)
        return parts.join('\n')
    }

    if (section === 'keywords') {
        parts.push(`    <div class="keywords"><strong>关键词：</strong>${escapeHtml(content)}</div>`)
        return parts.join('\n')
    }

    if (section === 'reference') {
        parts.push(`    <div class="reference-title">参考文献</div>`)
        const refs = content.split('\n').filter(l => l.trim())
        refs.forEach((ref, i) => {
            parts.push(`    <div class="reference-item">[${i + 1}] ${escapeHtml(ref.trim())}</div>`)
        })
        return parts.join('\n')
    }

    const sectionTitle = getSectionTitle(section, customLabel)
    if (sectionTitle) {
        parts.push(`    <div class="section-title">${escapeHtml(sectionTitle)}</div>`)
    }
    parts.push(`    <div class="section-content">`)
    content.split('\n\n').filter(p => p.trim()).forEach(p => {
        parts.push(`        <p>${escapeHtml(p.trim())}</p>`)
    })
    parts.push(`    </div>`)
    return parts.join('\n')
}

/**
 * Generate HTML content for PDF from arrow-ordered shapes
 */
function generatePdfHtmlFromShapes(shapes: ResearchNodeShape[], options: PdfExportOptions = {}): string {
    const parts: string[] = []

    const titleShape = shapes.find(s => s.props.section === 'title')
    const titleText = options.title || titleShape?.props.content || '研究论文'

    parts.push(PDF_HTML_HEAD(titleText))

    if (titleShape) {
        parts.push(`    <div class="title">${escapeHtml(titleShape.props.content)}</div>`)
    }
    if (options.author) {
        parts.push(`    <div class="author">${escapeHtml(options.author)}</div>`)
    }

    for (const shape of shapes) {
        if (shape.props.section === 'title') continue
        const html = renderNodeHtml(shape)
        if (html) parts.push(html)
    }

    parts.push(`\n</body>\n</html>\n`)
    return parts.join('\n')
}

/**
 * Generate HTML content for PDF (fallback: section-type order, grouped)
 */
function generatePdfHtmlFallback(editor: Editor, options: PdfExportOptions = {}): string {
    const nodes = collectResearchNodes(editor)
    if (nodes.length === 0) throw new Error('没有找到可导出的研究节点')

    const sortedNodes = sortNodesBySection(nodes)
    const groupedNodes = groupNodesBySection(sortedNodes)

    const titleText = options.title || groupedNodes.get('title')?.content || '研究论文'
    const parts: string[] = []
    parts.push(PDF_HTML_HEAD(titleText))

    const titleData = groupedNodes.get('title')
    if (titleData) {
        parts.push(`    <div class="title">${escapeHtml(titleData.content)}</div>`)
    }
    if (options.author) {
        parts.push(`    <div class="author">${escapeHtml(options.author)}</div>`)
    }

    const allSections: ResearchNodeType[] = [
        'abstract', 'keywords',
        'introduction', 'related-work', 'method', 'experiment',
        'result', 'discussion', 'conclusion', 'limitations',
        'future-work', 'acknowledgments', 'reference', 'appendix', 'custom',
    ]

    for (const sectionType of allSections) {
        const data = groupedNodes.get(sectionType)
        if (!data) continue

        // Synthesise a minimal shape-like object to reuse renderNodeHtml
        const fakeShape = {
            props: {
                section: sectionType,
                content: data.content,
                customLabel: data.customLabel,
                level: data.level ?? 1,
            },
        } as ResearchNodeShape
        const html = renderNodeHtml(fakeShape)
        if (html) parts.push(html)
    }

    parts.push(`\n</body>\n</html>\n`)
    return parts.join('\n')
}

/**
 * Generate HTML content for PDF
 */
function generatePdfHtml(editor: Editor, options: PdfExportOptions = {}): string {
    const arrowOrdered = collectArrowOrderedNodes(editor)
    if (arrowOrdered && arrowOrdered.length > 0) {
        return generatePdfHtmlFromShapes(arrowOrdered, options)
    }
    return generatePdfHtmlFallback(editor, options)
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

/**
 * Export research nodes to PDF using browser print
 */
export async function exportToPdf(editor: Editor, options: PdfExportOptions = {}): Promise<void> {
    try {
        console.log('正在生成PDF预览...')

        // Generate HTML content
        const htmlContent = generatePdfHtml(editor, options)

        // Create a new window for printing
        const printWindow = window.open('', '_blank')
        if (!printWindow) {
            throw new Error('无法打开打印窗口，请检查浏览器弹窗设置')
        }

        // Write HTML content
        printWindow.document.write(htmlContent)
        printWindow.document.close()

        // Wait for content to load
        printWindow.onload = () => {
            // Trigger print dialog
            setTimeout(() => {
                printWindow.print()
                // Note: We don't close the window automatically
                // User can close it after printing/saving
            }, 250)
        }

        console.log('PDF预览已打开，请在打印对话框中选择"另存为PDF"')
    } catch (error) {
        console.error('Failed to export PDF:', error)
        throw error
    }
}
