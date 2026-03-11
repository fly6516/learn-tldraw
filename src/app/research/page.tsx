"use client";

import * as React from "react";
import {Editor, Tldraw} from "tldraw";
import "tldraw/tldraw.css";

// import { useSyncDemo } from "@tldraw/sync";

import { ResearchNodeTool } from "@/shapes/research/ResearchNodeTool";
import { ResearchNodeShapeUtil } from "@/shapes/research/ResearchNodeShapeUtil";
import { ResearchNodeStylePanel } from "@/shapes/research/ResearchNodeStylePanel";
import type { ResearchNodeShape } from "@/shapes/research/ResearchNodeShape";
import type { TLShape } from "tldraw";
import { exportResearchToLatex, exportResearchToMarkdown, exportResearchToPdf, exportResearchToLatexWithFileSystem } from "@/lib/export/export-actions";
import { LatexPreviewPanel } from "@/components/research/LatexPreviewPanel";
import { LatexImportDialog } from "@/components/research/LatexImportDialog";
import { ProjectFileSystemProvider, useProjectFileSystem } from "@/contexts/ProjectFileSystemContext";
import { ProjectPanel } from "@/components/project/ProjectPanel";

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

// Type guard for ResearchNodeShape
function isResearchNodeShape(shape: TLShape): shape is ResearchNodeShape {
    return shape.type === 'research-node';
}

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
    actions(editor, actions, { addDialog }) {
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
            kbd: "$shift+p",
            onSelect() {
                const event = new CustomEvent("toggle-latex-panel");
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
        // Add toggle file panel action
        actions["toggle-file-panel"] = {
            id: "toggle-file-panel",
            label: "Toggle File Panel",
            kbd: "$shift+f",
            onSelect() {
                const event = new CustomEvent("toggle-file-panel");
                window.dispatchEvent(event);
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
            "action.toggle-file-panel": "Toggle File Panel",
        },
        zh: {
            "tool.research-node": "科研节点",
            "action.import-latex": "导入 LaTeX",
            "action.preview-latex": "预览 LaTeX",
            "action.export-latex": "导出为 LaTeX",
            "action.export-markdown": "导出为 Markdown",
            "action.export-pdf": "导出为 PDF",
            "action.toggle-file-panel": "切换文件面板",
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
                <TldrawUiMenuGroup id="project">
                    <TldrawUiMenuSubmenu id="project-submenu" label="Project">
                        <TldrawUiMenuActionItem actionId="toggle-file-panel" />
                    </TldrawUiMenuSubmenu>
                </TldrawUiMenuGroup>
            </DefaultMainMenu>
        );
    },
    StylePanel: ResearchNodeStylePanel,
};

const shapeUtils = [ResearchNodeShapeUtil];
const tools = [ResearchNodeTool];

function ResearchCanvas() {
    const [previewOpen, setPreviewOpen] = React.useState(false);
    const [importOpen, setImportOpen] = React.useState(false);
    const [editor, setEditor] = React.useState<Editor | null>(null);
    const [showFilePanel, setShowFilePanel] = React.useState(false);
    const [showLatexPanel, setShowLatexPanel] = React.useState(false);
    const { fileSystem, initializeProject, setFileSystem } = useProjectFileSystem();

    // Initialize file system on mount
    React.useEffect(() => {
        if (!fileSystem) {
            initializeProject(undefined, 'My Research Project');
        }
    }, [fileSystem, initializeProject]);

    // Sync editor changes to file system
    React.useEffect(() => {
        if (!editor || !fileSystem) return;

        const handleChange = () => {
            // Collect nodes from editor
            const shapes = editor.getCurrentPageShapes();
            const researchNodes = shapes
                .filter(isResearchNodeShape)
                .map((shape) => ({
                    section: shape.props.section,
                    content: shape.props.content,
                    order: shape.props.order,
                    level: shape.props.level || 1,
                    parentId: shape.props.parentId,
                    customLabel: shape.props.customLabel,
                    tags: shape.props.tags,
                    metadata: {
                        sectionNumber: shape.props.metadata?.sectionNumber,
                    },
                }));

            // Update main.tex in file system
            import('@/lib/project/file-system').then(({ updateMainTex }) => {
                const updatedFs = updateMainTex(fileSystem, researchNodes);
                setFileSystem(updatedFs);
            });
        };

        // Listen to store changes
        const unsubscribe = editor.store.listen(handleChange, { scope: 'document' });

        return () => {
            unsubscribe();
        };
    }, [editor, fileSystem, setFileSystem]);

    // Create dynamic overrides that can access fileSystem
    const dynamicOverrides = React.useMemo<TLUiOverrides>(() => ({
        ...uiOverrides,
        actions(editor, actions, helpers) {
            const baseActions = uiOverrides.actions?.(editor, actions, helpers) || actions;

            // Override export-latex to use file system
            baseActions["export-latex"] = {
                id: "export-latex",
                label: "Export to LaTeX",
                kbd: "$e",
                async onSelect() {
                    await exportResearchToLatexWithFileSystem(editor, fileSystem);
                },
            };

            return baseActions;
        },
    }), [fileSystem]);

    React.useEffect(() => {
        const handleOpenPreview = () => {
            setShowLatexPanel(prev => !prev);
        };

        const handleOpenImport = () => {
            setImportOpen(true);
        };

        const handleToggleFilePanel = () => {
            setShowFilePanel(prev => !prev);
        };

        const handleToggleLatexPanel = () => {
            setShowLatexPanel(prev => !prev);
        };

        window.addEventListener("open-latex-preview", handleOpenPreview);
        window.addEventListener("open-latex-import", handleOpenImport);
        window.addEventListener("toggle-file-panel", handleToggleFilePanel);
        window.addEventListener("toggle-latex-panel", handleToggleLatexPanel);
        return () => {
            window.removeEventListener("open-latex-preview", handleOpenPreview);
            window.removeEventListener("open-latex-import", handleOpenImport);
            window.removeEventListener("toggle-file-panel", handleToggleFilePanel);
            window.removeEventListener("toggle-latex-panel", handleToggleLatexPanel);
        };
    }, []);

    return (
        <>
            <div style={{ display: 'flex', width: '100%', height: '100%' }}>
                {showFilePanel && (
                    <div style={{
                        width: '320px',
                        height: '100%',
                        borderRight: '1px solid #e5e7eb',
                        background: 'white'
                    }}>
                        <ProjectPanel />
                    </div>
                )}
                <div style={{ flex: 1, position: 'relative' }}>
                    <Tldraw
                        onMount={(editor) => {
                            setEditor(editor);
                        }}
                        shapeUtils={shapeUtils}
                        tools={tools}
                        overrides={dynamicOverrides}
                        components={components}
                    />
                </div>
                {showLatexPanel && editor && (
                    <div style={{
                        width: '480px',
                        height: '100%',
                        borderLeft: '1px solid #e5e7eb',
                        background: 'white'
                    }}>
                        <LatexPreviewPanel editor={editor} onClose={() => setShowLatexPanel(false)} />
                    </div>
                )}
            </div>
            {editor && (
                <LatexImportDialog
                    editor={editor}
                    open={importOpen}
                    onOpenChange={setImportOpen}
                />
            )}
        </>
    );
}

export default function ResearchPage() {
    // const store = useSyncDemo({
    //     roomId: "research-room-001",
    // });

    return (
        <ProjectFileSystemProvider>
            <div className="fixed inset-0" style={{background: "#f9f9f9"}}>
                <ResearchCanvas />
            </div>
        </ProjectFileSystemProvider>
    );
}