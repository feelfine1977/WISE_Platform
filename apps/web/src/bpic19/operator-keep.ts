import type { Bpic19PipelineAction } from "../generated/saving";
import type { SelectionPredicate } from "../generated/selection";
import { sameJson } from "../data/coordinator";
import { savingContract } from "../saved/client";
import type { Bpic19OperatorAnswer } from "./operators-types";

/** The named selection group's complete item IDs in exactly this operator answer. */
export function operatorGroupMembers(answer: Bpic19OperatorAnswer, key: string): string[] {
  return answer.selection_groups.find(group => group.key === key)?.case_ids ?? [];
}

/** Bind a Keep of one reviewed recorded-event operator group to exactly this answer and selection step. */
export function operatorKeepAction(answer: Bpic19OperatorAnswer, key: string, predicate: SelectionPredicate,
  stepIndex: number, parentPosition: number | null = stepIndex): Bpic19PipelineAction | null {
  const members = operatorGroupMembers(answer, key);
  if (answer.operation === "bpic19_catalogue" || !members.length || predicate.kind !== "case_id_in" || predicate.negate ||
      !sameJson([...members].sort(), [...predicate.case_ids].sort())) return null;
  const action = { operation: answer.operation, identity: answer.identity, definition_id: answer.definition_id, query: { ...answer.query },
    selection_prefix_length: parentPosition, selection_keep: { policy_id: "bpic19.operator_group_keep.v1", step_index: stepIndex,
      group: { kind: "operator_group", key } } };
  return savingContract.pipelineAction(action) ? action as Bpic19PipelineAction : null;
}
