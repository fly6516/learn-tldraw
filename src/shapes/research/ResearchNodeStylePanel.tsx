import {
  DefaultStylePanel,
  DefaultStylePanelContent,
  useEditor,
  useRelevantStyles,
} from "tldraw";
import { RESEARCH_NODE_META } from "@/app/research/research-node";
import type { ResearchNodeType } from "@/app/research/research-node";
import type { ResearchNodeShape } from "./ResearchNodeShape";
import { ResearchNodeSectionStyle } from "./ResearchNodeStyles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import * as React from "react";
import type { Editor } from "tldraw";

/**
 * Custom Label Input Component with IME support
 */
function CustomLabelInput({
  editor,
  researchNodes,
  currentCustomLabel,
  currentSection,
}: {
  editor: Editor;
  researchNodes: ResearchNodeShape[];
  currentCustomLabel: string;
  currentSection: ResearchNodeType | "";
}) {
  const [localValue, setLocalValue] = React.useState(currentCustomLabel);
  const [isComposing, setIsComposing] = React.useState(false);

  // Update local value when selection changes
  React.useEffect(() => {
    setLocalValue(currentCustomLabel);
  }, [currentCustomLabel]);

  const updateShapes = (newLabel: string) => {
    const currentSelectedShapes = editor.getSelectedShapes();
    const currentResearchNodes = currentSelectedShapes.filter(
      (shape) => shape.type === 'research-node'
    ) as ResearchNodeShape[];

    currentResearchNodes.forEach((shape) => {
      editor.updateShape<ResearchNodeShape>({
        id: shape.id,
        type: shape.type,
        props: {
          ...shape.props,
          customLabel: newLabel || undefined,
        },
      });
    });
  };

  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground mb-1 font-medium">
        Custom Label
      </div>
      <Input
        type="text"
        placeholder="Enter custom section name"
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value);
          // Only update shapes if not composing (for IME support)
          if (!isComposing) {
            updateShapes(e.target.value);
          }
        }}
        onCompositionStart={() => {
          setIsComposing(true);
        }}
        onCompositionEnd={(e) => {
          setIsComposing(false);
          // Update shapes after composition ends
          const target = e.target as HTMLInputElement;
          updateShapes(target.value);
        }}
        onBlur={(e) => {
          // Ensure update on blur
          updateShapes(e.target.value);
        }}
        className="h-8 text-sm"
      />
      <div className="text-xs text-muted-foreground mt-1">
        {currentSection === 'custom'
          ? 'Required for custom sections'
          : 'Optional: Override default section name'}
      </div>
    </div>
  );
}

/**
 * Style panel component for selecting research node section type.
 * Displays a dropdown with all available paper sections.
 */
export function ResearchNodeStylePanel() {
  const editor = useEditor();
  const styles = useRelevantStyles();

  // This check is important - if no styles, return default panel
  if (!styles) {
    return (
      <DefaultStylePanel>
        <DefaultStylePanelContent />
      </DefaultStylePanel>
    );
  }
    styles.get(ResearchNodeSectionStyle);
// Get selected shapes to read actual props
  const selectedShapes = editor.getSelectedShapes();
  const researchNodes = selectedShapes.filter(
    (shape) => shape.type === 'research-node'
  ) as ResearchNodeShape[];

  if (researchNodes.length === 0) {
    return (
      <DefaultStylePanel>
        <DefaultStylePanelContent />
      </DefaultStylePanel>
    );
  }

  // Get current section from props (not style)
  const sections = researchNodes.map((node) => node.props.section);
  const allSame = sections.every((s) => s === sections[0]);
  const currentSection = allSame ? sections[0] : "";

  // Get custom label
  const customLabels = researchNodes.map((node) => node.props.customLabel || '');
  const allSameLabel = customLabels.every((l) => l === customLabels[0]);
  const currentCustomLabel = allSameLabel ? customLabels[0] : "";
  const showCustomLabel = currentSection === 'custom' || researchNodes.some(n => n.props.customLabel);

  return (
    <DefaultStylePanel>
      <DefaultStylePanelContent />
      <div className="ml-3 mr-4 mb-2">
        <div className="text-xs text-muted-foreground mb-1 font-medium">
          Paper Section
        </div>
        <Select
          value={currentSection}
          onValueChange={(value) => {
            editor.markHistoryStoppingPoint();
            const validatedValue = value as ResearchNodeType;

            // Get currently selected shapes (not the ones from closure)
            const currentSelectedShapes = editor.getSelectedShapes();
            const currentResearchNodes = currentSelectedShapes.filter(
              (shape) => shape.type === 'research-node'
            ) as ResearchNodeShape[];

            // Update both style and props
            editor.setStyleForSelectedShapes(ResearchNodeSectionStyle, validatedValue);

            // Update props for all currently selected research nodes
            currentResearchNodes.forEach((shape) => {
              editor.updateShape<ResearchNodeShape>({
                id: shape.id,
                type: shape.type,
                props: {
                  section: validatedValue,
                  order: RESEARCH_NODE_META[validatedValue].order,
                },
              });
            });

            // Force re-render by triggering a selection change
            setTimeout(() => {
              const currentSelection = editor.getSelectedShapeIds();
              editor.setSelectedShapes([]);
              editor.setSelectedShapes(currentSelection);
            }, 0);
          }}
        >
          <SelectTrigger className="w-[135px]">
            <SelectValue>
              {currentSection ? RESEARCH_NODE_META[currentSection].label : "Select section"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-[280px]">
            {!allSame && (
              <SelectItem value="" disabled>
                Mixed
              </SelectItem>
            )}
            {Object.entries(RESEARCH_NODE_META).map(([key, meta]) => (
              <SelectItem
                key={key}
                value={key}
                className="cursor-pointer"
              >
                <div className="flex items-center justify-between gap-3 w-full">
                  <span className="font-medium whitespace-nowrap">{meta.label}</span>
                  <span className="text-xs text-muted-foreground" title={meta.description}>
                    {meta.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Custom Label Input */}
        {showCustomLabel && (
          <CustomLabelInput
            editor={editor}
            researchNodes={researchNodes}
            currentCustomLabel={currentCustomLabel}
            currentSection={currentSection}
          />
        )}
      </div>
    </DefaultStylePanel>
  );
}
