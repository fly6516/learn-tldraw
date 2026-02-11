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
  currentCustomLabel,
  currentSection,
}: {
  editor: Editor;
  currentCustomLabel: string;
  currentSection: ResearchNodeType | "";
}) {
  const [localValue, setLocalValue] = React.useState(currentCustomLabel);
  const [isComposing, setIsComposing] = React.useState(false);

  // Update local value when selection changes or currentCustomLabel changes
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
          metadata: {
            ...shape.props.metadata,
            updatedAt: new Date().toISOString(),
          },
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
          if (!isComposing) {
            updateShapes(e.target.value);
          }
        }}
        onCompositionStart={() => {
          setIsComposing(true);
        }}
        onCompositionEnd={(e) => {
          setIsComposing(false);
          const target = e.target as HTMLInputElement;
          updateShapes(target.value);
        }}
        onBlur={(e) => {
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
 * Level and Hierarchy Control
 */
function HierarchyControl({
  editor,
  researchNodes,
}: {
  editor: Editor;
  researchNodes: ResearchNodeShape[];
}) {
  const levels = researchNodes.map((node) => node.props.level || 1);
  const allSameLevel = levels.every((l) => l === levels[0]);
  const currentLevel = allSameLevel ? levels[0] : 1;

  // Get all research nodes for parent selection
  const allShapes = editor.getCurrentPageShapes();
  const allResearchNodes = allShapes.filter(
    (shape) => shape.type === 'research-node'
  ) as ResearchNodeShape[];

  // Get potential parent nodes (exclude selected nodes)
  const selectedIds = new Set(researchNodes.map((n) => n.id));
  const potentialParents = allResearchNodes.filter(
    (node) => !selectedIds.has(node.id)
  );

  const parentIds = researchNodes.map((node) => node.props.parentId || '');
  const allSameParent = parentIds.every((p) => p === parentIds[0]);
  const currentParentId = allSameParent ? parentIds[0] : '';

  return (
    <div className="mt-3 space-y-3">
      {/* Level Control */}
      <div>
        <div className="text-xs text-muted-foreground mb-1 font-medium">
          Level
        </div>
        <Select
          key={`level-${currentLevel}-${researchNodes.map(n => n.id).join('-')}`}
          value={currentLevel.toString()}
          onValueChange={(value) => {
            const newLevel = parseInt(value);
            editor.markHistoryStoppingPoint();

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
                  level: newLevel,
                  metadata: {
                    ...shape.props.metadata,
                    updatedAt: new Date().toISOString(),
                  },
                },
              });
            });

            // Force re-render
            setTimeout(() => {
              const currentSelection = editor.getSelectedShapeIds();
              editor.setSelectedShapes([]);
              editor.setSelectedShapes(currentSelection);
            }, 0);
          }}
        >
          <SelectTrigger className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Level 1 (Main Section)</SelectItem>
            <SelectItem value="2">Level 2 (Subsection)</SelectItem>
            <SelectItem value="3">Level 3 (Sub-subsection)</SelectItem>
            <SelectItem value="4">Level 4</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Parent Node Selection */}
      {potentialParents.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-1 font-medium">
            Parent Node
          </div>
          <Select
            key={`parent-${currentParentId}-${researchNodes.map(n => n.id).join('-')}`}
            value={currentParentId || "none"}
            onValueChange={(value) => {
              editor.markHistoryStoppingPoint();

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
                    parentId: value === "none" ? undefined : value,
                    metadata: {
                      ...shape.props.metadata,
                      updatedAt: new Date().toISOString(),
                    },
                  },
                });
              });

              // Force re-render
              setTimeout(() => {
                const currentSelection = editor.getSelectedShapeIds();
                editor.setSelectedShapes([]);
                editor.setSelectedShapes(currentSelection);
              }, 0);
            }}
          >
            <SelectTrigger className="w-full h-8">
              <SelectValue placeholder="None (top-level)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (top-level)</SelectItem>
              {potentialParents.map((parent) => {
                const meta = RESEARCH_NODE_META[parent.props.section];
                const label = parent.props.customLabel || meta.label;
                return (
                  <SelectItem key={parent.id} value={parent.id}>
                    {label} {parent.props.metadata?.sectionNumber && `(${parent.props.metadata.sectionNumber})`}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground mt-1">
            Set parent to create subsections
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tags Management
 */
function TagsControl({
  editor,
  researchNodes,
}: {
  editor: Editor;
  researchNodes: ResearchNodeShape[];
}) {
  const [newTag, setNewTag] = React.useState('');
  const [isComposing, setIsComposing] = React.useState(false);
  const [editingTag, setEditingTag] = React.useState<{ oldTag: string; newTag: string } | null>(null);

  // Get current tags (show if all nodes have same tags)
  const allTags = researchNodes.map((node) => node.props.tags || []);
  const currentTags = allTags[0] || [];

  const addTag = (tag: string) => {
    if (!tag.trim()) return;

    editor.markHistoryStoppingPoint();

    const currentSelectedShapes = editor.getSelectedShapes();
    const currentResearchNodes = currentSelectedShapes.filter(
      (shape) => shape.type === 'research-node'
    ) as ResearchNodeShape[];

    currentResearchNodes.forEach((shape) => {
      const existingTags = shape.props.tags || [];
      if (!existingTags.includes(tag.trim())) {
        editor.updateShape<ResearchNodeShape>({
          id: shape.id,
          type: shape.type,
          props: {
            ...shape.props,
            tags: [...existingTags, tag.trim()],
            metadata: {
              ...shape.props.metadata,
              updatedAt: new Date().toISOString(),
            },
          },
        });
      }
    });

    setNewTag('');
  };

  const removeTag = (tagToRemove: string) => {
    editor.markHistoryStoppingPoint();

    const currentSelectedShapes = editor.getSelectedShapes();
    const currentResearchNodes = currentSelectedShapes.filter(
      (shape) => shape.type === 'research-node'
    ) as ResearchNodeShape[];

    currentResearchNodes.forEach((shape) => {
      const existingTags = shape.props.tags || [];
      editor.updateShape<ResearchNodeShape>({
        id: shape.id,
        type: shape.type,
        props: {
          ...shape.props,
          tags: existingTags.filter((t) => t !== tagToRemove),
          metadata: {
            ...shape.props.metadata,
            updatedAt: new Date().toISOString(),
          },
        },
      });
    });
  };

  const updateTag = (oldTag: string, newTagValue: string) => {
    if (!newTagValue.trim() || oldTag === newTagValue.trim()) {
      setEditingTag(null);
      return;
    }

    editor.markHistoryStoppingPoint();

    const currentSelectedShapes = editor.getSelectedShapes();
    const currentResearchNodes = currentSelectedShapes.filter(
      (shape) => shape.type === 'research-node'
    ) as ResearchNodeShape[];

    currentResearchNodes.forEach((shape) => {
      const existingTags = shape.props.tags || [];
      const updatedTags = existingTags.map((t) => (t === oldTag ? newTagValue.trim() : t));
      editor.updateShape<ResearchNodeShape>({
        id: shape.id,
        type: shape.type,
        props: {
          ...shape.props,
          tags: updatedTags,
          metadata: {
            ...shape.props.metadata,
            updatedAt: new Date().toISOString(),
          },
        },
      });
    });

    setEditingTag(null);
  };

  return (
    <div className="mt-3">
      <div className="text-xs text-muted-foreground mb-1 font-medium">
        Tags
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="Add tag..."
          value={newTag}
          onChange={(e) => {
            setNewTag(e.target.value);
          }}
          onCompositionStart={() => {
            setIsComposing(true);
          }}
          onCompositionEnd={() => {
            setIsComposing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposing) {
              e.preventDefault();
              addTag(newTag);
            }
          }}
          className="h-8 text-sm flex-1"
        />
      </div>
      {currentTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {currentTags.map((tag, idx) => (
            <div key={idx}>
              {editingTag?.oldTag === tag ? (
                <Input
                  type="text"
                  value={editingTag.newTag}
                  onChange={(e) => {
                    setEditingTag({ oldTag: tag, newTag: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      updateTag(tag, editingTag.newTag);
                    } else if (e.key === 'Escape') {
                      setEditingTag(null);
                    }
                  }}
                  onBlur={() => {
                    updateTag(tag, editingTag.newTag);
                  }}
                  autoFocus
                  className="h-6 text-xs w-24"
                />
              ) : (
                <span
                  className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded text-xs cursor-pointer hover:bg-secondary/80"
                  onDoubleClick={() => {
                    setEditingTag({ oldTag: tag, newTag: tag });
                  }}
                  title="Double-click to edit"
                >
                  {tag}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(tag);
                    }}
                    className="hover:text-destructive ml-1"
                    title="Remove tag"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-muted-foreground mt-1">
        Press Enter to add • Double-click to edit • Click × to remove
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

  // Force re-render when selection changes
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    // Listen to selection changes
    const handleSelectionChange = () => {
      forceUpdate();
    };

    editor.on('change', handleSelectionChange);

    return () => {
      editor.off('change', handleSelectionChange);
    };
  }, [editor]);

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

  // Create a unique key based on selected node IDs to force re-render on selection change
  const selectionKey = researchNodes.map(n => n.id).sort().join('-');

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
          key={`section-${selectionKey}`}
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
              <SelectItem value="mixed" disabled>
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
            key={`label-${selectionKey}`}
            editor={editor}
            currentCustomLabel={currentCustomLabel}
            currentSection={currentSection}
          />
        )}

        {/* Hierarchy Control */}
        <HierarchyControl
          key={`hierarchy-${selectionKey}`}
          editor={editor}
          researchNodes={researchNodes}
        />

        {/* Tags Control */}
        <TagsControl
          key={`tags-${selectionKey}`}
          editor={editor}
          researchNodes={researchNodes}
        />
      </div>
    </DefaultStylePanel>
  );
}
