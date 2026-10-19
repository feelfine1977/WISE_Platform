import type { Bpic19IntervalComparisonAnswer } from "../generated/bpic19-interval-comparison";
import type { Bpic19PipelineAction } from "../generated/saving";
import type { SelectionPredicate } from "../generated/selection";
import { sameJson } from "../data/coordinator";
import { savingContract } from "../saved/client";

export type IntervalSideSupport = "items" | "zero" | "unavailable";

/** The named side's items, known zero-day items or items without an admitted interval, in exactly this answer. */
export function intervalSideMembers(answer: Bpic19IntervalComparisonAnswer, side: "target" | "reference", support: IntervalSideSupport): string[] {
  const named = answer.comparison[side];
  return support === "items" ? named.case_ids : support === "zero" ? named.zero_case_ids : named.unavailable_case_ids;
}

/** Bind a Keep of one reviewed interval side to exactly this answer and selection step. */
export function intervalKeepAction(answer: Bpic19IntervalComparisonAnswer, side: "target" | "reference", support: IntervalSideSupport,
  predicate: SelectionPredicate, stepIndex: number, parentPosition: number | null = stepIndex): Bpic19PipelineAction | null {
  const members = intervalSideMembers(answer, side, support);
  if (!members.length || predicate.kind !== "case_id_in" || predicate.negate ||
      !sameJson([...members].sort(), [...predicate.case_ids].sort())) return null;
  const action = { operation: "bpic19_interval_comparison", identity: answer.identity, definition_id: answer.definition_id, query: { ...answer.query },
    selection_prefix_length: parentPosition, selection_keep: { policy_id: "bpic19.interval_side_keep.v1", step_index: stepIndex,
      group: { kind: "interval_side", side, support } } };
  return savingContract.pipelineAction(action) ? action : null;
}
