"use client";

import { CodeBlockShapeTool } from "@/shapes/codeblock/CodeBlockShapeTool";
import { CodeBlockShapeUtil } from "@/shapes/codeblock/CodeBlockShapeUtil";
import {
  DefaultKeyboardShortcutsDialog,
  DefaultKeyboardShortcutsDialogContent,
  DefaultToolbar,
  DefaultToolbarContent,
  TLComponents,
  Tldraw,
  TldrawUiMenuItem,
  TLUiOverrides,
  useIsToolSelected,
  useTools,
} from "tldraw";
import { StylePanelCodeLanguagePicker } from "@/shapes/codeblock/StylePanelCodeLanguagePicker";
import "tldraw/tldraw.css";
import { useSyncDemo } from '@tldraw/sync'

const uiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    tools.codeblock = {
      id: "codeblock",
      icon: "code",
      label: "tool.codeblock",
      kbd: "c",
      onSelect: () => {
        editor.setCurrentTool("codeblock");
      },
    };
    return tools;
  },
  translations: {
    en: {
      "tool.codeblock": "Code Block",
    },
    zh: {
      "tool.codeblock": "代码块",
    },
  },
};

const components: TLComponents = {
  Toolbar: (props) => {
    const tools = useTools();
    const isCodeBlockSelected = useIsToolSelected(tools["codeblock"]);
    return (
      <DefaultToolbar {...props}>
        <TldrawUiMenuItem
          {...tools["codeblock"]}
          isSelected={isCodeBlockSelected}
        />
        <DefaultToolbarContent />
      </DefaultToolbar>
    );
  },
  KeyboardShortcutsDialog: (props) => {
    const tools = useTools();
    return (
      <DefaultKeyboardShortcutsDialog {...props}>
        <TldrawUiMenuItem {...tools["codeblock"]} />
        <DefaultKeyboardShortcutsDialogContent />
      </DefaultKeyboardShortcutsDialog>
    );
  },
  StylePanel: StylePanelCodeLanguagePicker,
};

const shapeUtils = [CodeBlockShapeUtil];
const tools = [CodeBlockShapeTool];

export default function Page() {
    const store = useSyncDemo({
        roomId: '1145141919810-HOMO', // 同一个 roomId = 同一协作房间
    })

    return (
        <div className="fixed inset-0">
            <Tldraw
                store={store}              // ⭐ 关键
                shapeUtils={shapeUtils}
                tools={tools}
                overrides={uiOverrides}
                components={components}
            />
        </div>
  );
}
