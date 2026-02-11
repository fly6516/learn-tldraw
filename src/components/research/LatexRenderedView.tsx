"use client";

import * as React from "react";
import { InlineMath, BlockMath } from "react-katex";
import "katex/dist/katex.min.css";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LatexRenderedViewProps {
    latexContent: string;
}

/**
 * Parse LaTeX content and extract document structure
 */
function parseLatexDocument(latex: string) {
    const lines = latex.split("\n");
    const sections: Array<{
        type: "title" | "abstract" | "keywords" | "section" | "paragraph" | "math" | "bibliography";
        content: string;
        level?: number;
    }> = [];

    let inAbstract = false;
    let inBibliography = false;
    let inDocument = false;
    let currentParagraph = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Extract title from preamble (before \begin{document})
        if (!inDocument && line.includes("\\title{")) {
            const match = line.match(/\\title\{([^}]+)}/);
            if (match) {
                sections.push({ type: "title", content: match[1] });
            }
            continue;
        }

        // Start of document
        if (line.includes("\\begin{document}")) {
            inDocument = true;
            continue;
        }
        if (line.includes("\\end{document}")) {
            break;
        }
        if (!inDocument) continue;

        // Skip \maketitle command
        if (line.includes("\\maketitle")) {
            continue;
        }

        // Handle abstract
        if (line.includes("\\begin{abstract}")) {
            inAbstract = true;
            continue;
        }
        if (line.includes("\\end{abstract}")) {
            inAbstract = false;
            if (currentParagraph) {
                sections.push({ type: "abstract", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            continue;
        }

        // Handle bibliography
        if (line.includes("\\begin{thebibliography}")) {
            inBibliography = true;
            if (currentParagraph) {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            continue;
        }
        if (line.includes("\\end{thebibliography}")) {
            inBibliography = false;
            if (currentParagraph) {
                sections.push({ type: "bibliography", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            continue;
        }

        // Handle keywords (special format)
        if (line.includes("\\noindent\\textbf{关键词：}") || line.includes("\\noindent\\textbf{Keywords:}")) {
            if (currentParagraph) {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            const keywordsContent = line.replace(/\\noindent\\textbf\{[^}]+}\s*/, "");
            sections.push({ type: "keywords", content: keywordsContent });
            continue;
        }

        // Extract sections (including numbered and unnumbered)
        const sectionMatch = line.match(/\\section\*?\{([^}]+)}/);
        if (sectionMatch) {
            if (currentParagraph) {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            sections.push({ type: "section", content: sectionMatch[1], level: 1 });
            continue;
        }

        const subsectionMatch = line.match(/\\subsection\*?\{([^}]+)}/);
        if (subsectionMatch) {
            if (currentParagraph) {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            sections.push({ type: "section", content: subsectionMatch[1], level: 2 });
            continue;
        }

        const subsubsectionMatch = line.match(/\\subsubsection\*?\{([^}]+)}/);
        if (subsubsectionMatch) {
            if (currentParagraph) {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            sections.push({ type: "section", content: subsubsectionMatch[1], level: 3 });
            continue;
        }

        // Handle display math
        if (line.startsWith("$$") || line.includes("\\[")) {
            if (currentParagraph) {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
            // Extract math content
            const mathContent = line.replace(/^\$\$|\$\$$/g, "").replace(/\\\[|\\]/g, "");
            sections.push({ type: "math", content: mathContent });
            continue;
        }

        // Skip LaTeX commands that don't need rendering
        if (line.startsWith("\\") && (
            line.includes("\\appendix") ||
            line.includes("\\bibliographystyle") ||
            line.includes("\\bibliography{")
        )) {
            continue;
        }

        // Accumulate paragraph content
        if (line && !line.startsWith("%")) {
            if (inAbstract || inBibliography) {
                currentParagraph += (currentParagraph ? " " : "") + line;
            } else {
                currentParagraph += (currentParagraph ? " " : "") + line;
            }
        } else if (currentParagraph && line === "") {
            // Empty line marks end of paragraph
            if (inBibliography) {
                // Don't push yet, accumulate all bibliography content
            } else {
                sections.push({ type: "paragraph", content: currentParagraph.trim() });
                currentParagraph = "";
            }
        }
    }

    // Add remaining paragraph
    if (currentParagraph) {
        if (inBibliography) {
            sections.push({ type: "bibliography", content: currentParagraph.trim() });
        } else {
            sections.push({ type: "paragraph", content: currentParagraph.trim() });
        }
    }

    return sections;
}

/**
 * Unescape LaTeX special characters for display
 */
function unescapeLatex(text: string): string {
    return text
        .replace(/\\textbackslash\{}/g, "\\")
        .replace(/\\\{/g, "{")
        .replace(/\\}/g, "}")
        .replace(/\\&/g, "&")
        .replace(/\\%/g, "%")
        .replace(/\\\$/g, "$")
        .replace(/\\#/g, "#")
        .replace(/\\_/g, "_")
        .replace(/\\\^\{}/g, "^")
        .replace(/\\~\{}/g, "~");
}

/**
 * Render text with inline math support
 */
function renderTextWithMath(text: string) {
    const parts: React.ReactNode[] = [];
    let currentText = "";
    let inMath = false;
    let mathContent = "";

    for (let i = 0; i < text.length; i++) {
        if (text[i] === "$" && text[i - 1] !== "\\") {
            if (inMath) {
                // End of inline math
                parts.push(currentText);
                currentText = "";
                try {
                    parts.push(<InlineMath key={i} math={mathContent} />);
                } catch {
                    parts.push(`$${mathContent}$`);
                }
                mathContent = "";
                inMath = false;
            } else {
                // Start of inline math
                if (currentText) {
                    parts.push(unescapeLatex(currentText));
                    currentText = "";
                }
                inMath = true;
            }
        } else {
            if (inMath) {
                mathContent += text[i];
            } else {
                currentText += text[i];
            }
        }
    }

    if (currentText) {
        parts.push(unescapeLatex(currentText));
    }

    return parts.length > 0 ? parts : text;
}

export function LatexRenderedView({ latexContent }: LatexRenderedViewProps) {
    const sections = React.useMemo(() => parseLatexDocument(latexContent), [latexContent]);

    return (
        <ScrollArea className="h-full">
            <div className="mx-auto max-w-4xl bg-white p-12 shadow-lg" style={{ minHeight: "297mm" }}>
                {sections.map((section, index) => {
                    switch (section.type) {
                        case "title":
                            return (
                                <h1 key={index} className="mb-8 text-center text-3xl font-bold">
                                    {renderTextWithMath(section.content)}
                                </h1>
                            );
                        case "abstract":
                            return (
                                <div key={index} className="mb-8">
                                    <h2 className="mb-2 text-center text-lg font-semibold">Abstract</h2>
                                    <p className="text-justify text-sm leading-relaxed">
                                        {renderTextWithMath(section.content)}
                                    </p>
                                </div>
                            );
                        case "keywords":
                            return (
                                <div key={index} className="mb-6">
                                    <p className="text-sm">
                                        <strong>关键词：</strong>
                                        {renderTextWithMath(section.content)}
                                    </p>
                                </div>
                            );
                        case "section":
                            if (section.level === 1) {
                                return (
                                    <h2 key={index} className="mb-4 mt-6 text-2xl font-bold">
                                        {renderTextWithMath(section.content)}
                                    </h2>
                                );
                            } else if (section.level === 2) {
                                return (
                                    <h3 key={index} className="mb-3 mt-4 text-xl font-semibold">
                                        {renderTextWithMath(section.content)}
                                    </h3>
                                );
                            } else {
                                return (
                                    <h4 key={index} className="mb-2 mt-3 text-lg font-medium">
                                        {renderTextWithMath(section.content)}
                                    </h4>
                                );
                            }
                        case "paragraph":
                            return (
                                <p key={index} className="mb-4 text-justify leading-relaxed">
                                    {renderTextWithMath(section.content)}
                                </p>
                            );
                        case "math":
                            return (
                                <div key={index} className="my-4 overflow-x-auto text-center">
                                    <BlockMath math={section.content} />
                                </div>
                            );
                        case "bibliography":
                            return (
                                <div key={index} className="mt-8">
                                    <h2 className="mb-4 text-2xl font-bold">参考文献</h2>
                                    <div className="space-y-2 text-sm">
                                        {section.content.split('\n').map((ref, refIndex) => {
                                            const trimmedRef = ref.trim();
                                            if (!trimmedRef) return null;
                                            return (
                                                <p key={refIndex} className="pl-4 text-justify">
                                                    {renderTextWithMath(trimmedRef)}
                                                </p>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        default:
                            return null;
                    }
                })}
            </div>
        </ScrollArea>
    );
}
