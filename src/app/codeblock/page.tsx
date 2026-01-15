"use client"

import {
    DefaultKeyboardShortcutsDialog,
    DefaultKeyboardShortcutsDialogContent,
    DefaultToolbar,
    DefaultToolbarContent,
    DefaultStylePanel,
    DefaultActionsMenu,
    DefaultQuickActions,
    TLComponents,
    Tldraw,
    TldrawUiMenuItem,
    TldrawUiToolbar,
    TLUiOverrides,
    TldrawOptions,
    useEditor,
    useIsToolSelected,
    useTools,
    useValue,
} from "tldraw"
import "tldraw/tldraw.css"

// ======================
// CodeBlock imports
// ======================
import { CodeBlockShapeTool } from "@/shapes/codeblock/CodeBlockShapeTool"
import { CodeBlockShapeUtil } from "@/shapes/codeblock/CodeBlockShapeUtil"
import { StylePanelCodeLanguagePicker } from "@/shapes/codeblock/StylePanelCodeLanguagePicker"

// ======================
// Workflow imports
// ======================
import { NodeShapeUtil } from "@/shapes/nodes/NodeShapeUtil"
import { ConnectionShapeUtil } from "@/connection/ConnectionShapeUtil"
import { ConnectionBindingUtil } from "@/connection/ConnectionBindingUtil"
import { keepConnectionsAtBottom } from "@/connection/keepConnectionsAtBottom"
import { PointingPort } from "@/ports/PointingPort"
import { disableTransparency } from "./disableTransparency"

import { OnCanvasComponentPicker } from "@/components/OnCanvasComponentPicker"
import { WorkflowRegions } from "@/components/WorkflowRegions"
import { overrides as workflowOverrides, WorkflowToolbar } from "@/components/WorkflowToolbar"

import '@/app/codeblock/index.css';

// ======================
// UI Overrides（合并）
// ======================
const uiOverrides: TLUiOverrides = {
    ...workflowOverrides,

    tools(editor, tools, helpers) { // ← 注意这里加上 helpers 参数

        const next = workflowOverrides.tools
            ? workflowOverrides.tools(editor, tools, helpers) // ← 直接用 helpers
            : tools

        next.codeblock = {
            id: "codeblock",
            icon: "code",
            label: "tool.codeblock",
            kbd: "c",
            onSelect: () => editor.setCurrentTool("codeblock"),
        }

        return next
    },

    translations: {
        en: {
            "tool.codeblock": "Code Block",
        },
        zh: {
            "tool.codeblock": "代码块",
        },
    },
}

// ======================
// Components（组合）
// ======================
const components: TLComponents = {
    InFrontOfTheCanvas: () => (
        <>
            <OnCanvasComponentPicker />
            <WorkflowRegions />
        </>
    ),

    Toolbar: (props) => {
        const tools = useTools()
        const isCodeBlockSelected = useIsToolSelected(tools["codeblock"])

        return (
            <>
                <WorkflowToolbar />

                <DefaultToolbar {...props}>
                    <TldrawUiMenuItem
                        {...tools["codeblock"]}
                        isSelected={isCodeBlockSelected}
                    />
                    <DefaultToolbarContent />
                </DefaultToolbar>

                <div className="tlui-main-toolbar tlui-main-toolbar--horizontal">
                    <TldrawUiToolbar className="tlui-main-toolbar__tools" label="Actions">
                        <DefaultQuickActions />
                        <DefaultActionsMenu />
                    </TldrawUiToolbar>
                </div>
            </>
        )
    },

    KeyboardShortcutsDialog: (props) => {
        const tools = useTools()
        return (
            <DefaultKeyboardShortcutsDialog {...props}>
                <TldrawUiMenuItem {...tools["codeblock"]} />
                <DefaultKeyboardShortcutsDialogContent />
            </DefaultKeyboardShortcutsDialog>
        )
    },

    StylePanel: () => {
        const editor = useEditor()
        const shouldShowStylePanel = useValue(
            "shouldShowStylePanel",
            () =>
                !editor.isIn("select") ||
                editor
                    .getSelectedShapes()
                    .some((s) => s.type !== "node" && s.type !== "connection"),
            [editor]
        )

        if (!shouldShowStylePanel) return null

        return (
            <>
                <StylePanelCodeLanguagePicker />
                <DefaultStylePanel />
            </>
        )
    },

    MenuPanel: () => null,
}

// ======================
// Shape / Binding Utils（合并）
// ======================
const shapeUtils = [
    CodeBlockShapeUtil,
    NodeShapeUtil,
    ConnectionShapeUtil,
]

const bindingUtils = [ConnectionBindingUtil]

const tools = [CodeBlockShapeTool]

// ======================
// Options
// ======================
const options: Partial<TldrawOptions> = {
    actionShortcutsLocation: "menu",
    maxPages: 1,
}

// ======================
// Page
// ======================
export default function Page() {
    return (
        <div className="fixed inset-0">
            <Tldraw
                persistenceKey="workflow-with-codeblock"
                shapeUtils={shapeUtils}
                bindingUtils={bindingUtils}
                tools={tools}
                overrides={uiOverrides}
                components={components}
                options={options}
                onMount={(editor) => {
                    ;(window as any).editor = editor

                    if (!editor.getCurrentPageShapes().some((s) => s.type === "node")) {
                        editor.createShape({ type: "node", x: 200, y: 200 })
                    }

                    editor.user.updateUserPreferences({ isSnapMode: true })

                    const select = editor.getStateDescendant("select")

                    if (select && !select.children?.[PointingPort.id]) {
                        select.addChild(PointingPort)
                    }

                    keepConnectionsAtBottom(editor)

                    disableTransparency(editor, ["node", "connection"])
                }}
            />
        </div>
    )
}
