import type { Editor } from 'tldraw'
import { exportToLatex } from './latex-exporter'
import { exportToMarkdown } from './markdown-exporter'
import { exportToPdf } from './pdf-exporter'
import JSZip from 'jszip'

/**
 * Download a file in the browser
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
    // Create a blob from the content
    const blob = new Blob([content], { type: mimeType })

    // Create a temporary URL for the blob
    const url = URL.createObjectURL(blob)

    // Create a temporary anchor element and trigger download
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()

    // Cleanup
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

/**
 * Export research nodes to LaTeX and download as zip file
 */
export async function exportResearchToLatex(editor: Editor): Promise<void> {
    try {
        // Generate LaTeX content
        const latexContent = exportToLatex(editor)

        // Generate timestamp for filenames
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
        const projectName = `research-paper-${timestamp}`

        // Create zip file
        const zip = new JSZip()

        // Add main .tex file
        zip.file(`${projectName}.tex`, latexContent)

        // Add .latexmkrc configuration file for XeLaTeX
        const latexmkrc = `# 强制使用 XeLaTeX 编译（支持中文）
# Force XeLaTeX compilation (for Chinese support)
$pdf_mode = 5;  # 5 = xelatex (必须使用 XeLaTeX)
$xelatex = 'xelatex -synctex=1 -interaction=nonstopmode -file-line-error %O %S';
$bibtex_use = 2;  # Use bibtex if .bib file exists
$clean_ext = 'synctex.gz synctex.gz(busy) run.xml tex.bak bbl bcf fdb_latexmk run tdo %R-blx.bib';

# 不要使用 pdflatex！
# DO NOT use pdflatex!
$pdflatex = 'echo "错误：请使用 xelatex 而不是 pdflatex！" && exit 1';
`
        zip.file('.latexmkrc', latexmkrc)

        // Add compile script for easy compilation
        const compileScript = `#!/bin/bash
# 编译脚本 - 使用 XeLaTeX 编译
# Compile script - Use XeLaTeX

echo "正在使用 XeLaTeX 编译..."
echo "Compiling with XeLaTeX..."

xelatex ${projectName}.tex

echo ""
echo "编译完成！"
echo "Compilation complete!"
echo ""
echo "如果需要处理参考文献，请运行："
echo "If you need to process references, run:"
echo "  bibtex ${projectName}"
echo "  xelatex ${projectName}.tex"
echo "  xelatex ${projectName}.tex"
`
        zip.file('compile.sh', compileScript)

        // Add Windows batch script
        const compileBat = `@echo off
REM 编译脚本 - 使用 XeLaTeX 编译
REM Compile script - Use XeLaTeX

echo 正在使用 XeLaTeX 编译...
echo Compiling with XeLaTeX...

xelatex ${projectName}.tex

echo.
echo 编译完成！
echo Compilation complete!
echo.
echo 如果需要处理参考文献，请运行：
echo If you need to process references, run:
echo   bibtex ${projectName}
echo   xelatex ${projectName}.tex
echo   xelatex ${projectName}.tex
pause
`
        zip.file('compile.bat', compileBat)

        // Add README file with instructions
        const readme = `# ${projectName}

## ⚠️ 重要警告 / IMPORTANT WARNING

**必须使用 XeLaTeX 编译！不能使用 pdfLaTeX！**

**MUST use XeLaTeX! DO NOT use pdfLaTeX!**

如果使用 pdfLaTeX 会出现以下错误：
- CTeX fontset 'fandol' is unavailable
- Font not found errors
- 中文无法显示

---

## 快速开始

### 方法1：使用编译脚本（推荐）

**Linux/macOS**:
\`\`\`bash
chmod +x compile.sh
./compile.sh
\`\`\`

**Windows**:
双击 \`compile.bat\` 文件

### 方法2：使用 latexmk（推荐）

\`\`\`bash
latexmk ${projectName}.tex
\`\`\`

### 方法3：直接使用 XeLaTeX

\`\`\`bash
xelatex ${projectName}.tex
\`\`\`

---

## 在 Overleaf 中使用

### 步骤1：上传文件
将此 zip 文件上传到 Overleaf

### 步骤2：设置编译器（最重要！）
1. 点击左上角的菜单图标（三条横线）
2. 找到 "Settings" 部分
3. 在 "Compiler" 下拉菜单中选择 **"XeLaTeX"**
4. ⚠️ 确保不是 "pdfLaTeX"！

### 步骤3：编译
点击 "Recompile" 按钮

---

## 为什么必须使用 XeLaTeX？

| 编译器 | 中文支持 | Unicode | 系统字体 | 说明 |
|--------|---------|---------|---------|------|
| **XeLaTeX** | ✅ 完美 | ✅ 支持 | ✅ 支持 | **推荐使用** |
| pdfLaTeX | ❌ 不支持 | ❌ 有限 | ❌ 不支持 | **不能使用** |
| LuaLaTeX | ✅ 支持 | ✅ 支持 | ✅ 支持 | 可用但不推荐 |

---

## 格式标准

本文档遵循 **GB/T 7714** 中国国家标准：

- **纸张**: A4
- **页边距**: 上下 2.5cm，左 3cm，右 2.5cm
- **行距**: 1.5 倍
- **字体**: 宋体（正文），黑体（标题）
- **引用格式**: GB/T 7714 数字式

---

## 文件说明

- \`${projectName}.tex\` - 主LaTeX文件
- \`.latexmkrc\` - latexmk配置文件（自动使用XeLaTeX）
- \`compile.sh\` - Linux/macOS编译脚本
- \`compile.bat\` - Windows编译脚本
- \`README.md\` - 本说明文件

---

## 常见问题

### Q1: 出现 "CTeX fontset 'fandol' is unavailable" 错误？
**A**: 您使用了 pdfLaTeX！请改用 XeLaTeX。

### Q2: 出现 "Font not found" 错误？
**A**: 您使用了 pdfLaTeX！请改用 XeLaTeX。

### Q3: 中文显示为乱码或方框？
**A**: 您使用了 pdfLaTeX！请改用 XeLaTeX。

### Q4: Overleaf 上如何设置编译器？
**A**: 左上角菜单 → Settings → Compiler → 选择 "XeLaTeX"

### Q5: 本地编译找不到 xelatex 命令？
**A**: 需要安装 TeX Live 或 MiKTeX：
- **Linux**: \`sudo apt-get install texlive-xetex texlive-lang-chinese\`
- **macOS**: 安装 MacTeX
- **Windows**: 安装 TeX Live 或 MiKTeX

### Q6: 如何添加图片？
**A**: 使用 \`\\includegraphics{filename}\` 命令，图片文件放在同一目录。

### Q7: 如何添加参考文献？
**A**: 在 Reference 节点中添加文献条目，每行一条。

---

## 依赖包

文档使用以下 LaTeX 包（Overleaf 和 TeX Live 2020+ 都已预装）：

- **ctex**: 中文支持（自动配置字体）
- **geometry**: 页面设置
- **setspace**: 行距设置
- **titlesec**: 标题格式
- **gbt7714**: GB/T 7714 引用格式
- **graphicx**: 图片支持
- **amsmath**: 数学公式
- **hyperref**: 超链接支持

---

## 技术支持

如果遇到问题：

1. **首先确认**: 是否使用了 XeLaTeX 编译器
2. **检查错误日志**: 查看具体错误信息
3. **查看本 README**: 大多数问题都有解答

---

**导出时间**: ${new Date().toLocaleString('zh-CN')}

**编译器要求**: XeLaTeX（必须）

**格式标准**: GB/T 7714
`
        zip.file('README.md', readme)

        // Generate zip blob
        const zipBlob = await zip.generateAsync({ type: 'blob' })

        // Download zip file
        const url = URL.createObjectURL(zipBlob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${projectName}.zip`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)

        console.log('LaTeX export successful:', `${projectName}.zip`)
    } catch (error) {
        console.error('Failed to export LaTeX:', error)
        alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
}

/**
 * Export research nodes to Markdown and download the file
 */
export function exportResearchToMarkdown(editor: Editor): void {
    try {
        // Generate Markdown content
        const markdownContent = exportToMarkdown(editor)

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
        const filename = `research-paper-${timestamp}.md`

        // Download the file
        downloadFile(markdownContent, filename, 'text/markdown')

        console.log('Markdown export successful:', filename)
    } catch (error) {
        console.error('Failed to export Markdown:', error)
        alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
}

/**
 * Export research nodes to PDF and download the file
 */
export async function exportResearchToPdf(editor: Editor): Promise<void> {
    try {
        console.log('正在生成PDF...')

        // Export to PDF
        await exportToPdf(editor)

        console.log('PDF导出成功')
    } catch (error) {
        console.error('Failed to export PDF:', error)
        const errorMessage = error instanceof Error ? error.message : '未知错误'
        alert(`导出失败: ${errorMessage}`)
    }
}
