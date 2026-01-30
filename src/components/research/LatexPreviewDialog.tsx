"use client";

import * as React from "react";
import type { Editor } from "tldraw";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LatexRenderedView } from "./LatexRenderedView";
import { LatexSourceView } from "./LatexSourceView";
import { exportToLatex } from "@/lib/export/latex-exporter";

interface LatexPreviewDialogProps {
    editor: Editor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LatexPreviewDialog({
    editor,
    open,
    onOpenChange,
}: LatexPreviewDialogProps) {
    const [latexContent, setLatexContent] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);

    // Generate LaTeX content when dialog opens or editor changes
    React.useEffect(() => {
        if (!open) return;

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
    }, [editor, open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>LaTeX Preview</DialogTitle>
                </DialogHeader>
                {error ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <p className="text-destructive font-semibold mb-2">Error</p>
                            <p className="text-sm text-muted-foreground">{error}</p>
                        </div>
                    </div>
                ) : (
                    <Tabs defaultValue="preview" className="flex-1 flex flex-col min-h-0">
                        <TabsList>
                            <TabsTrigger value="preview">Preview</TabsTrigger>
                            <TabsTrigger value="source">Source</TabsTrigger>
                        </TabsList>
                        <TabsContent value="preview" className="flex-1 min-h-0 mt-4">
                            <LatexRenderedView latexContent={latexContent} />
                        </TabsContent>
                        <TabsContent value="source" className="flex-1 min-h-0 mt-4">
                            <LatexSourceView latexContent={latexContent} />
                        </TabsContent>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}
