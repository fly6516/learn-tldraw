"use client";

import * as React from "react";
import {Editor, Tldraw} from "tldraw";
import "tldraw/tldraw.css";

// import { useSyncDemo } from "@tldraw/sync";

import { ResearchNodeTool } from "@/shapes/research/ResearchNodeTool";
import { ResearchNodeShapeUtil } from "@/shapes/research/ResearchNodeShapeUtil";
import { ResearchNodeStylePanel } from "@/shapes/research/ResearchNodeStylePanel";
import { exportResearchToLatex, exportResearchToMarkdown, exportResearchToPdf } from "@/lib/export/export-actions";
import { LatexPreviewDialog } from "@/components/research/LatexPreviewDialog";

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
            icon: "note",
            label: "Research Node",
            kbd: "r",
            onSelect: () => {
                editor.setCurrentTool("research-node");
            },
        };

        return tools;
    },
    actions(editor, actions) {
        // Add preview LaTeX action
        actions["preview-latex"] = {
            id: "preview-latex",
            label: "Preview LaTeX",
            kbd: "$!p",
            onSelect() {
                // This will be handled by the component state
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
            "action.preview-latex": "Preview LaTeX",
            "action.export-latex": "Export to LaTeX",
            "action.export-markdown": "Export to Markdown",
            "action.export-pdf": "Export to PDF",
        },
        zh: {
            "tool.research-node": "科研节点",
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

function ResearchCanvas() {
    const [previewOpen, setPreviewOpen] = React.useState(false);
    const [editor, setEditor] = React.useState<Editor | null>(null);

    React.useEffect(() => {
        const handleOpenPreview = () => {
            setPreviewOpen(true);
        };

        window.addEventListener("open-latex-preview", handleOpenPreview);
        return () => {
            window.removeEventListener("open-latex-preview", handleOpenPreview);
        };
    }, []);

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
                <LatexPreviewDialog
                    editor={editor}
                    open={previewOpen}
                    onOpenChange={setPreviewOpen}
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
        <div className="fixed inset-0" style={{background: "#f9f9f9"}}>
            <ResearchCanvas />
        </div>
    );
}