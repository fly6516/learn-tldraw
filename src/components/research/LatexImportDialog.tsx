"use client";

import * as React from "react";
import type { Editor } from "tldraw";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { importLatexToEditor, importLatexZip, validateLatexContent } from "@/lib/import/latex-importer";
import { importLatexZip as importLatexZipToFileSystem } from "@/lib/project/importer";
import { useProjectFileSystem } from "@/contexts/ProjectFileSystemContext";

interface LatexImportDialogProps {
    editor: Editor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LatexImportDialog({
    editor,
    open,
    onOpenChange,
}: LatexImportDialogProps) {
    const [latexContent, setLatexContent] = React.useState("");
    const [error, setError] = React.useState<string | null>(null);
    const [isImporting, setIsImporting] = React.useState(false);
    const [uploadedFileName, setUploadedFileName] = React.useState<string | null>(null);
    const texFileInputRef = React.useRef<HTMLInputElement>(null);
    const zipFileInputRef = React.useRef<HTMLInputElement>(null);
    const { setFileSystem } = useProjectFileSystem();

    const handleImport = () => {
        setError(null);
        setIsImporting(true);

        try {
            // Validate content
            const validation = validateLatexContent(latexContent);
            if (!validation.valid) {
                setError(validation.error || "Invalid LaTeX content");
                setIsImporting(false);
                return;
            }

            // Import to editor
            importLatexToEditor(editor, latexContent);

            // Success - close dialog
            setLatexContent("");
            setUploadedFileName(null);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to import LaTeX");
        } finally {
            setIsImporting(false);
        }
    };

    const handleTexFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploadedFileName(file.name);
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            setLatexContent(content);
            setError(null);
        };
        reader.onerror = () => {
            setError("Failed to read file");
            setUploadedFileName(null);
        };
        reader.readAsText(file);
    };

    const handleZipFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setError(null);
        setIsImporting(true);
        setUploadedFileName(file.name);

        try {
            // Import to file system
            const result = await importLatexZipToFileSystem(file);

            // Create file system from import result
            const { createProjectFileSystem } = await import('@/lib/project/file-system');
            const fs = createProjectFileSystem(result.template, file.name.replace('.zip', ''));

            // Add figures if any
            if (result.files.figures) {
                const { addFigure } = await import('@/lib/project/file-system');
                let updatedFs = fs;
                for (const [name, blob] of result.files.figures.entries()) {
                    updatedFs = addFigure(updatedFs, name, blob);
                }
                setFileSystem(updatedFs);
            } else {
                setFileSystem(fs);
            }

            // Import nodes to editor
            await importLatexZip(editor, file);

            // Success - close dialog
            setLatexContent("");
            setUploadedFileName(null);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to import zip file");
            setUploadedFileName(null);
        } finally {
            setIsImporting(false);
            if (zipFileInputRef.current) {
                zipFileInputRef.current.value = "";
            }
        }
    };

    const handleClear = () => {
        setLatexContent("");
        setError(null);
        setUploadedFileName(null);
        if (texFileInputRef.current) {
            texFileInputRef.current.value = "";
        }
        if (zipFileInputRef.current) {
            zipFileInputRef.current.value = "";
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Import LaTeX Document</DialogTitle>
                    <DialogDescription>
                        Paste LaTeX content, upload a .tex file, or upload a .zip archive
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 flex flex-col gap-4 min-h-0">
                    {/* File upload buttons */}
                    <div className="flex gap-2 flex-wrap">
                        <input
                            ref={texFileInputRef}
                            type="file"
                            accept=".tex,.txt"
                            onChange={handleTexFileUpload}
                            className="hidden"
                            id="latex-tex-file-input"
                        />
                        <input
                            ref={zipFileInputRef}
                            type="file"
                            accept=".zip"
                            onChange={handleZipFileUpload}
                            className="hidden"
                            id="latex-zip-file-input"
                        />
                        <Button
                            variant="outline"
                            onClick={() => texFileInputRef.current?.click()}
                            disabled={isImporting}
                        >
                            Upload .tex File
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => zipFileInputRef.current?.click()}
                            disabled={isImporting}
                        >
                            Upload .zip Archive
                        </Button>
                        {(latexContent || uploadedFileName) && (
                            <Button variant="outline" onClick={handleClear} disabled={isImporting}>
                                Clear
                            </Button>
                        )}
                        {uploadedFileName && (
                            <div className="flex items-center text-sm text-muted-foreground ml-2">
                                📄 {uploadedFileName}
                            </div>
                        )}
                    </div>

                    {/* LaTeX content textarea */}
                    <Textarea
                        value={latexContent}
                        onChange={(e) => {
                            setLatexContent(e.target.value);
                            setUploadedFileName(null);
                            setError(null);
                        }}
                        placeholder="Paste your LaTeX content here...&#10;&#10;Example:&#10;\documentclass{article}&#10;\begin{document}&#10;\title{My Research Paper}&#10;\section{Introduction}&#10;Content here...&#10;\end{document}"
                        className="flex-1 font-mono text-sm resize-none"
                        disabled={isImporting}
                    />

                    {/* Error message */}
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Action buttons */}
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isImporting}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleImport}
                            disabled={!latexContent.trim() || isImporting}
                        >
                            {isImporting ? "Importing..." : "Import"}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
