import type { AnswerIdentity, Bpic19Definition, Bpic19ProfileQuery } from "../generated/bpic19-profile";

export type Bpic19GroupRecipe = {
  definition_id: string;
  definition: Bpic19Definition;
  source_identity: AnswerIdentity;
  query: Bpic19ProfileQuery;
  group: { kind: "flow" | "flow_item_type" | "unresolved" | "cross_check" | "grain_issue" | "source_inclusion" | "attribute_value"; flow_id?: string; state?: string; item_type_value?: string | null; column_index?: number; value?: string | null };
  case_ids: string[];
};
export type Bpic19ComparisonSide = { name: string; caseIds: string[]; recipe: Bpic19GroupRecipe };
