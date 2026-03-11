import type { Editor } from 'tldraw'
import type { ResearchNodeType } from '@/app/research/research-node'
import { collectResearchNodes, sortNodesBySection, groupNodesBySection } from './latex-exporter'

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
function getSectionTitle(sectionType: ResearchNodeType): string {
    const titles: Record<ResearchNodeType, string> = {
        title: '',
        abstract: '摘要',
        keywords: '关键词',
        introduction: '1 引言',
        'related-work': '2 相关工作',
        method: '3 方法',
        experiment: '4 实验',
        result: '5 结果',
        discussion: '6 讨论',
        conclusion: '7 结论',
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
 * Generate HTML content for PDF
 */
function generatePdfHtml(editor: Editor, options: PdfExportOptions = {}): string {
    // Collect and sort nodes
    const nodes = collectResearchNodes(editor)

    if (nodes.length === 0) {
        throw new Error('没有找到可导出的研究节点')
    }

    const sortedNodes = sortNodesBySection(nodes)
    const groupedNodes = groupNodesBySection(sortedNodes)

    // Build HTML
    const parts: string[] = []

    // Add CSS for GB/T 7714 standards
    parts.push(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${options.title || '研究论文'}</title>
    <style>
        @page {
            size: A4;
            margin: 2.5cm 2.5cm 2.5cm 3cm; /* GB标准：上下2.5cm，左3cm，右2.5cm */
        }

        body {
            font-family: "SimSun", "宋体", serif;
            font-size: 12pt; /* 小四号 */
            line-height: 1.5;
            color: #000;
            margin: 0;
            padding: 20px;
        }

        .title {
            font-size: 22pt; /* 二号 */
            font-weight: bold;
            text-align: center;
            margin-bottom: 20px;
            font-family: "SimHei", "黑体", sans-serif;
        }

        .author {
            font-size: 14pt; /* 小四 */
            text-align: center;
            margin-bottom: 30px;
        }

        .abstract-title {
            font-size: 15pt; /* 小三 */
            font-weight: bold;
            text-align: center;
            margin-top: 20px;
            margin-bottom: 10px;
            font-family: "SimHei", "黑体", sans-serif;
        }

        .abstract-content {
            font-size: 12pt;
            line-height: 1.5;
            margin-bottom: 20px;
            text-align: justify;
        }

        .section-title {
            font-size: 16pt; /* 三号 */
            font-weight: bold;
            margin-top: 20px;
            margin-bottom: 10px;
            font-family: "SimHei", "黑体", sans-serif;
        }

        .section-content {
            font-size: 12pt;
            line-height: 1.5;
            text-align: justify;
            margin-bottom: 15px;
        }

        .section-content p {
            margin: 10px 0;
            text-indent: 2em; /* 首行缩进2字符 */
        }

        .reference-title {
            font-size: 16pt;
            font-weight: bold;
            margin-top: 20px;
            margin-bottom: 10px;
            font-family: "SimHei", "黑体", sans-serif;
        }

        .reference-item {
            font-size: 10.5pt; /* 五号 */
            line-height: 1.5;
            margin: 5px 0;
        }

        @media print {
            body {
                padding: 0;
            }

            .no-print {
                display: none;
            }
        }
    </style>
</head>
<body>
`)

    // Add title
    const titleData = groupedNodes.get('title')
    if (titleData) {
        parts.push(`    <div class="title">${escapeHtml(titleData.content)}</div>`)
    }

    // Add author
    if (options.author) {
        parts.push(`    <div class="author">${escapeHtml(options.author)}</div>`)
    }

    // Add abstract
    const abstractData = groupedNodes.get('abstract')
    if (abstractData) {
        parts.push(`    <div class="abstract-title">摘要</div>`)
        parts.push(`    <div class="abstract-content">${escapeHtml(abstractData.content)}</div>`)
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
            const sectionTitle = getSectionTitle(sectionType)
            parts.push(`    <div class="section-title">${escapeHtml(sectionTitle)}</div>`)
            parts.push(`    <div class="section-content">`)

            // Split into paragraphs
            const paragraphs = sectionData.content.split('\n\n').filter(p => p.trim())
            paragraphs.forEach(paragraph => {
                parts.push(`        <p>${escapeHtml(paragraph.trim())}</p>`)
            })

            parts.push(`    </div>`)
        }
    }

    // Add references
    const referenceData = groupedNodes.get('reference')
    if (referenceData) {
        parts.push(`    <div class="reference-title">参考文献</div>`)

        const references = referenceData.content.split('\n').filter(line => line.trim())
        references.forEach((ref, index) => {
            parts.push(`    <div class="reference-item">[${index + 1}] ${escapeHtml(ref.trim())}</div>`)
        })
    }

    parts.push(`
</body>
</html>
`)

    return parts.join('\n')
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
