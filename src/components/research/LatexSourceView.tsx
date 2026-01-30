"use client";

import * as React from "react";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
// import { ScrollArea } from "@/components/ui/scroll-area";

interface LatexSourceViewProps {
    latexContent: string;
}

export function LatexSourceView({ latexContent }: LatexSourceViewProps) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(latexContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                    LaTeX Source Code
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    className="gap-2"
                >
                    {copied ? (
                        <>
                            <Check className="h-4 w-4" />
                            Copied
                        </>
                    ) : (
                        <>
                            <Copy className="h-4 w-4" />
                            Copy All
                        </>
                    )}
                </Button>
            </div>
            <div className="flex-1 overflow-hidden rounded-md border">
                <Editor
                    height="100%"
                    defaultLanguage="latex"
                    value={latexContent}
                    theme="vs-light"
                    options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineNumbers: "on",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        automaticLayout: true,
                    }}
                />
            </div>
        </div>
    );
}
