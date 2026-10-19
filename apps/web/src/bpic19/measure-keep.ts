import type { Bpic19MeasuresAnswer } from "../generated/bpic19-measures";
import type { Bpic19PipelineAction } from "../generated/saving";
import type { SelectionPredicate } from "../generated/selection";
import { sameJson } from "../data/coordinator";
import { savingContract } from "../saved/client";

export type ActivityCohort = "positive" | "zero" | "unavailable";

/** Bind a Keep of one reviewed activity cohort to exactly this measures answer and selection step. */
export function measureKeepAction(answer: Bpic19MeasuresAnswer, cohort: ActivityCohort, predicate: SelectionPredicate,
  stepIndex: number, parentPosition: number | null = stepIndex): Bpic19PipelineAction | null {
  const members = answer.activity_cohorts[`${cohort}_case_ids`];
  if (predicate.kind !== "case_id_in" || predicate.negate || !members.length ||
      !sameJson([...members].sort(), [...predicate.case_ids].sort())) return null;
  const action = { operation: "bpic19_measures", identity: answer.identity, definition_id: answer.definition_id, query: { ...answer.query },
    selection_prefix_length: parentPosition, selection_keep: { policy_id: "bpic19.measure_cohort_keep.v1", step_index: stepIndex,
      group: { kind: "activity_cohort", cohort } } };
  return savingContract.pipelineAction(action) ? action : null;
}
