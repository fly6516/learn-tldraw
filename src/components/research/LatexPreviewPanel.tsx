"use client";

import * as React from "react";
import type { ResearchPage } from "@/lib/project/research-graph";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LatexRenderedView } from "./LatexRenderedView";
import { LatexSourceView } from "./LatexSourceView";
import { exportToLatex } from "@/lib/export/latex-exporter";
import { generateProjectSource } from "@/lib/export/export-actions";
import { useProjectFileSystem } from "@/contexts/ProjectFileSystemContext";
import { X } from "lucide-react";

interface LatexPreviewPanelProps {
    page: ResearchPage;
    onClose: () => void;
}

export function LatexPreviewPanel({
    page,
    onClose,
}: LatexPreviewPanelProps) {
    const { fileSystem } = useProjectFileSystem();
    const { latexContent, error } = React.useMemo(() => {
        try {
            return { latexContent: fileSystem ? generateProjectSource(page, fileSystem) : exportToLatex(page), error: null };
        } catch (cause) {
            return { latexContent: "", error: cause instanceof Error ? cause.message : "Failed to generate LaTeX" };
        }
    }, [page, fileSystem]);

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
