import { StyleProp } from "tldraw";
import { T } from "@tldraw/validate";
import type { ResearchNodeType } from "@/app/research/research-node";

/**
 * Style property for research node section selection.
 * This is needed to trigger the custom StylePanel component.
 */
export const ResearchNodeSectionStyle = StyleProp.defineEnum(
  "research-node:section",
  {
    defaultValue: "introduction" as ResearchNodeType,
    values: [
      "title",
      "abstract",
      "keywords",
      "introduction",
      "related-work",
      "method",
      "experiment",
      "result",
      "discussion",
      "conclusion",
      "limitations",
      "future-work",
      "acknowledgments",
      "reference",
      "appendix",
      "custom",
    ] as const,
  }
);

/**
 * Type representing the research node section style options.
 */
export type TLResearchNodeSectionStyle = T.TypeOf<typeof ResearchNodeSectionStyle>;
