"use client";

import * as React from "react";
import type { Editor } from "tldraw";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LatexRenderedView } from "./LatexRenderedView";
import { LatexSourceView } from "./LatexSourceView";
import { exportToLatex } from "@/lib/export/latex-exporter";
import { X } from "lucide-react";

interface LatexPreviewPanelProps {
    editor: Editor;
    onClose: () => void;
}

export function LatexPreviewPanel({
    editor,
    onClose,
}: LatexPreviewPanelProps) {
    const [latexContent, setLatexContent] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);

    // Generate LaTeX content when panel mounts or editor changes
    React.useEffect(() => {
        const generateLatex = () => {
            try {
                const content = exportToLatex(editor);
                setLatexContent(content);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to generate LaTeX");
                setLatexContent("");
            }
        };

        // Generate immediately
        generateLatex();

        // Listen for editor changes with debounce
        let timeoutId: NodeJS.Timeout;
        const unsubscribe = editor.store.listen(() => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(generateLatex, 500);
        });

        return () => {
            unsubscribe();
            clearTimeout(timeoutId);
        };
    }, [editor]);

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h2 className="text-lg font-semibold">LaTeX Preview</h2>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-gray-100 rounded transition-colors"
                    aria-label="Close panel"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {error ? (
                    <div className="h-full flex items-center justify-center p-4">
                        <div className="text-center">
                            <p className="text-red-600 font-semibold mb-2">Error</p>
                            <p className="text-sm text-gray-600">{error}</p>
                        </div>
                    </div>
                ) : (
                    <Tabs defaultValue="preview" className="h-full flex flex-col">
                        <div className="px-4 pt-2">
                            <TabsList>
                                <TabsTrigger value="preview">Preview</TabsTrigger>
                                <TabsTrigger value="source">Source</TabsTrigger>
                            </TabsList>
                        </div>
                        <TabsContent value="preview" className="flex-1 min-h-0 mt-2 px-4 pb-4">
                            <LatexRenderedView latexContent={latexContent} />
                        </TabsContent>
                        <TabsContent value="source" className="flex-1 min-h-0 mt-2 px-4 pb-4">
                            <LatexSourceView latexContent={latexContent} />
                        </TabsContent>
                    </Tabs>
                )}
            </div>
        </div>
    );
}
