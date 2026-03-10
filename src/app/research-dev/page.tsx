"use client";

import * as React from "react";
import {Editor, Tldraw, createShapeId} from "tldraw";
import "tldraw/tldraw.css";

import { ResearchNodeTool } from "@/shapes/research/ResearchNodeTool";
import { ResearchNodeShapeUtil } from "@/shapes/research/ResearchNodeShapeUtil";
import { ResearchNodeStylePanel } from "@/shapes/research/ResearchNodeStylePanel";
import { exportResearchToLatex, exportResearchToMarkdown, exportResearchToPdf } from "@/lib/export/export-actions";
import { LatexPreviewDialog } from "@/components/research/LatexPreviewDialog";
import { LatexImportDialog } from "@/components/research/LatexImportDialog";
import type { ResearchNodeShape } from "@/shapes/research/ResearchNodeShape";
import type { ResearchNodeType } from "@/app/research/research-node";

import {
    DefaultKeyboardShortcutsDialog,
    DefaultKeyboardShortcutsDialogContent,
    DefaultToolbar,
    DefaultToolbarContent,
    TLComponents,
    TldrawUiMenuItem,
    TLUiOverrides,
    useIsToolSelected,
    useTools,
    DefaultMainMenu,
    TldrawUiMenuGroup,
    TldrawUiMenuSubmenu,
    TldrawUiMenuActionItem,
} from "tldraw";

const uiOverrides: TLUiOverrides = {
    tools(editor, tools) {
        // 删除默认形状工具
        Object.keys(tools).forEach((k) => {
            if (
                [
                    "draw",
                    "arrow",
                    "line",
                    "highlight",
                    "eraser",
                    "laser",
                    "note",
                    "frame",
                    "embed",
                    "image",
                    "video",
                    "text",
                    "bookmark",
                    "geo",
                    "group",
                ].includes(k)
            ) {
                delete tools[k];
            }
        });

        // 添加 Research Node 按钮
        tools["research-node"] = {
            id: "research-node",
            icon: "tool-note",
            label: "Research Node",
            kbd: "r",
            onSelect: () => {
                editor.setCurrentTool("research-node");
            },
        };

        return tools;
    },
    actions(editor, actions) {
        // Add import LaTeX action
        actions["import-latex"] = {
            id: "import-latex",
            label: "Import LaTeX",
            kbd: "$!i",
            onSelect() {
                const event = new CustomEvent("open-latex-import");
                window.dispatchEvent(event);
            },
        };
        // Add preview LaTeX action
        actions["preview-latex"] = {
            id: "preview-latex",
            label: "Preview LaTeX",
            kbd: "$!p",
            onSelect() {
                const event = new CustomEvent("open-latex-preview");
                window.dispatchEvent(event);
            },
        };
        // Add export to LaTeX action
        actions["export-latex"] = {
            id: "export-latex",
            label: "Export to LaTeX",
            kbd: "$e",
            async onSelect() {
                await exportResearchToLatex(editor);
            },
        };
        // Add export to Markdown action
        actions["export-markdown"] = {
            id: "export-markdown",
            label: "Export to Markdown",
            kbd: "$m",
            onSelect() {
                exportResearchToMarkdown(editor);
            },
        };
        // Add export to PDF action
        actions["export-pdf"] = {
            id: "export-pdf",
            label: "Export to PDF",
            kbd: "$p",
            async onSelect() {
                await exportResearchToPdf(editor);
            },
        };
        return actions;
    },
    translations: {
        en: {
            "tool.research-node": "Research Node",
            "action.import-latex": "Import LaTeX",
            "action.preview-latex": "Preview LaTeX",
            "action.export-latex": "Export to LaTeX",
            "action.export-markdown": "Export to Markdown",
            "action.export-pdf": "Export to PDF",
        },
        zh: {
            "tool.research-node": "科研节点",
            "action.import-latex": "导入 LaTeX",
            "action.preview-latex": "预览 LaTeX",
            "action.export-latex": "导出为 LaTeX",
            "action.export-markdown": "导出为 Markdown",
            "action.export-pdf": "导出为 PDF",
        },
    },
};

const components: TLComponents = {
    Toolbar: (props) => {
        const tools = useTools();
        const isSelected = useIsToolSelected(tools["research-node"]);
        return (
            <DefaultToolbar {...props}>
                <TldrawUiMenuItem {...tools["research-node"]} isSelected={isSelected} />
                <DefaultToolbarContent />
            </DefaultToolbar>
        );
    },
    KeyboardShortcutsDialog: (props) => {
        const tools = useTools();
        return (
            <DefaultKeyboardShortcutsDialog {...props}>
                <TldrawUiMenuItem {...tools["research-node"]} />
                <DefaultKeyboardShortcutsDialogContent />
            </DefaultKeyboardShortcutsDialog>
        );
    },
    MainMenu: () => {
        return (
            <DefaultMainMenu>
                <TldrawUiMenuGroup id="import">
                    <TldrawUiMenuSubmenu id="import-submenu" label="Import">
                        <TldrawUiMenuActionItem actionId="import-latex" />
                    </TldrawUiMenuSubmenu>
                </TldrawUiMenuGroup>
                <TldrawUiMenuGroup id="preview">
                    <TldrawUiMenuSubmenu id="preview-submenu" label="Preview">
                        <TldrawUiMenuActionItem actionId="preview-latex" />
                    </TldrawUiMenuSubmenu>
                </TldrawUiMenuGroup>
                <TldrawUiMenuGroup id="export">
                    <TldrawUiMenuSubmenu id="export-submenu" label="Export">
                        <TldrawUiMenuActionItem actionId="export-markdown" />
                        <TldrawUiMenuActionItem actionId="export-latex" />
                        <TldrawUiMenuActionItem actionId="export-pdf" />
                    </TldrawUiMenuSubmenu>
                </TldrawUiMenuGroup>
            </DefaultMainMenu>
        );
    },
    StylePanel: ResearchNodeStylePanel,
};

const shapeUtils = [ResearchNodeShapeUtil];
const tools = [ResearchNodeTool];

// Test data generator
function createTestData(editor: Editor) {
    const testNodes: Array<{
        section: ResearchNodeType;
        content: string;
        x: number;
        y: number;
        level?: number;
        customLabel?: string;
        tags?: string[];
    }> = [
        {
            section: 'title',
            content: '基于深度学习的图像识别系统研究',
            x: 100,
            y: 50,
            level: 1,
        },
        {
            section: 'abstract',
            content: '本文提出了一种基于深度学习的图像识别系统。该系统采用卷积神经网络（CNN）架构，在多个公开数据集上取得了优异的性能。实验结果表明，我们的方法在准确率和效率方面都优于现有方法。',
            x: 100,
            y: 150,
            level: 1,
        },
        {
            section: 'keywords',
            content: '深度学习, 图像识别, 卷积神经网络, 计算机视觉',
            x: 100,
            y: 250,
            level: 1,
        },
        {
            section: 'introduction',
            content: '随着深度学习技术的快速发展，图像识别已经成为计算机视觉领域的核心问题之一。本研究旨在开发一个高效、准确的图像识别系统。',
            x: 100,
            y: 350,
            level: 1,
            tags: ['核心', '重要'],
        },
        {
            section: 'related-work',
            content: '近年来，许多研究者在图像识别领域做出了重要贡献。AlexNet、VGG、ResNet等经典网络架构为后续研究奠定了基础。',
            x: 550,
            y: 50,
            level: 1,
            tags: ['文献综述'],
        },
        {
            section: 'method',
            content: '我们提出的方法包括三个主要步骤：数据预处理、特征提取和分类。我们使用改进的ResNet架构作为骨干网络。',
            x: 550,
            y: 200,
            level: 1,
            tags: ['核心', '创新点'],
        },
        {
            section: 'method',
            content: '数据预处理阶段，我们对图像进行归一化、数据增强等操作，以提高模型的泛化能力。',
            x: 550,
            y: 350,
            level: 2,
            customLabel: '数据预处理',
        },
        {
            section: 'experiment',
            content: '我们在CIFAR-10、ImageNet等数据集上进行了大量实验。实验环境为：NVIDIA RTX 3090 GPU，PyTorch 2.0框架。',
            x: 1000,
            y: 50,
            level: 1,
            tags: ['实验设置'],
        },
        {
            section: 'result',
            content: '实验结果显示，我们的方法在CIFAR-10数据集上达到了95.2%的准确率，在ImageNet上达到了82.5%的Top-1准确率。',
            x: 1000,
            y: 200,
            level: 1,
            tags: ['关键结果'],
        },
        {
            section: 'discussion',
            content: '分析实验结果可以发现，我们的方法在小样本场景下表现尤为出色。这主要归功于改进的数据增强策略。',
            x: 1000,
            y: 350,
            level: 1,
        },
        {
            section: 'limitations',
            content: '本研究存在一些局限性：1) 计算资源需求较高；2) 在某些特定场景下性能有待提升；3) 模型可解释性需要进一步研究。',
            x: 100,
            y: 500,
            level: 1,
            tags: ['待改进'],
        },
        {
            section: 'future-work',
            content: '未来工作包括：探索更轻量级的网络架构、研究模型压缩技术、以及在更多实际应用场景中验证方法的有效性。',
            x: 550,
            y: 500,
            level: 1,
        },
        {
            section: 'conclusion',
            content: '本文提出了一种有效的图像识别方法，实验证明了其优越性。该方法为相关领域的研究提供了新的思路。',
            x: 1000,
            y: 500,
            level: 1,
            tags: ['总结'],
        },
        {
            section: 'acknowledgments',
            content: '感谢国家自然科学基金的支持（项目编号：12345678）。感谢实验室全体成员的帮助和建议。',
            x: 100,
            y: 650,
            level: 1,
        },
        {
            section: 'reference',
            content: '[1] He, K., et al. (2016). Deep Residual Learning for Image Recognition. CVPR.\n[2] Krizhevsky, A., et al. (2012). ImageNet Classification with Deep CNNs. NIPS.',
            x: 550,
            y: 650,
            level: 1,
        },
    ];

    // Create shapes
    testNodes.forEach((node) => {
        const shapeId = createShapeId();
        editor.createShape<ResearchNodeShape>({
            id: shapeId,
            type: 'research-node',
            x: node.x,
            y: node.y,
            props: {
                section: node.section,
                content: node.content,
                order: 0,
                level: node.level || 1,
                customLabel: node.customLabel,
                tags: node.tags,
                metadata: {
                    createdAt: new Date().toISOString(),
                },
            },
        });
    });

    // Zoom to fit
    editor.zoomToFit({ animation: { duration: 500 } });
}

function ResearchDevCanvas() {
    const [previewOpen, setPreviewOpen] = React.useState(false);
    const [importOpen, setImportOpen] = React.useState(false);
    const [editor, setEditor] = React.useState<Editor | null>(null);
    const [dataLoaded, setDataLoaded] = React.useState(false);

    React.useEffect(() => {
        const handleOpenPreview = () => {
            setPreviewOpen(true);
        };

        const handleOpenImport = () => {
            setImportOpen(true);
        };

        window.addEventListener("open-latex-preview", handleOpenPreview);
        window.addEventListener("open-latex-import", handleOpenImport);
        return () => {
            window.removeEventListener("open-latex-preview", handleOpenPreview);
            window.removeEventListener("open-latex-import", handleOpenImport);
        };
    }, []);

    // Auto-load test data when editor is ready
    React.useEffect(() => {
        if (editor && !dataLoaded) {
            // Wait a bit for editor to be fully initialized
            setTimeout(() => {
                createTestData(editor);
                setDataLoaded(true);
            }, 500);
        }
    }, [editor, dataLoaded]);

    return (
        <>
            <Tldraw
                onMount={(editor) => {
                    setEditor(editor);
                }}
                shapeUtils={shapeUtils}
                tools={tools}
                overrides={uiOverrides}
                components={components}
            />
            {editor && (
                <>
                    <LatexImportDialog
                        editor={editor}
                        open={importOpen}
                        onOpenChange={setImportOpen}
                    />
                    <LatexPreviewDialog
                        editor={editor}
                        open={previewOpen}
                        onOpenChange={setPreviewOpen}
                    />
                </>
            )}
            {/* Dev mode indicator */}
            <div style={{
                position: 'absolute',
                bottom: 10,
                right: 10,
                padding: '6px 12px',
                background: 'rgba(239, 68, 68, 0.9)',
                color: 'white',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                zIndex: 1000,
                pointerEvents: 'none',
            }}>
                🧪 DEV MODE
            </div>
        </>
    );
}

export default function ResearchDevPage() {
    return (
        <div className="fixed inset-0" style={{background: "#f9f9f9"}}>
            <ResearchDevCanvas />
        </div>
    );
}
