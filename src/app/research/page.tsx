"use client";

import * as React from "react";
import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";

// import { useSyncDemo } from "@tldraw/sync";

import { ResearchNodeTool } from "@/shapes/research/ResearchNodeTool";
import { ResearchNodeShapeUtil } from "@/shapes/research/ResearchNodeShapeUtil";

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
    translations: {
        en: {
            "tool.research-node": "Research Node",
        },
        zh: {
            "tool.research-node": "科研节点",
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
};

const shapeUtils = [ResearchNodeShapeUtil];
const tools = [ResearchNodeTool];

export default function ResearchPage() {
    // const store = useSyncDemo({
    //     roomId: "research-room-001",
    // });

    return (
        <div className="fixed inset-0" style={{background: "#f9f9f9"}}>
            <Tldraw
                // store={store}
                shapeUtils={shapeUtils}
                tools={tools}
                overrides={uiOverrides}
                components={components}
            />
        </div>
    );
}