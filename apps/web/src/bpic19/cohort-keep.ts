import type { Bpic19CohortsAnswer, CohortSupport } from "../generated/bpic19-cohorts";
import type { Bpic19PipelineAction } from "../generated/saving";
import type { SelectionPredicate } from "../generated/selection";
import { sameJson } from "../data/coordinator";
import { savingContract } from "../saved/client";

export type CompletionSupport = "inclusion_retained" | "inclusion_excluded" | "inclusion_unknown" |
  "observed_closed" | "open_recorded" | "completion_unknown" | "retention_retained";

/** The named whole-item stage or completion state of exactly this answer. */
export function completionSupport(answer: Bpic19CohortsAnswer, support: CompletionSupport): CohortSupport | undefined {
  const result = answer.cohorts;
  if (support === "inclusion_retained") return result.inclusion.retained;
  if (support === "inclusion_excluded") return result.inclusion.excluded;
  if (support === "inclusion_unknown") return result.inclusion.unknown;
  if (support === "retention_retained") return result.retention.retained;
  const state = support === "completion_unknown" ? "unknown" : support;
  return result.completion_groups.find(group => group.state === state);
}

/** Bind a Keep of one reviewed cohort stage to exactly this answer and selection step. */
export function cohortKeepAction(answer: Bpic19CohortsAnswer, support: CompletionSupport, predicate: SelectionPredicate,
  stepIndex: number, parentPosition: number | null = stepIndex): Bpic19PipelineAction | null {
  const members = completionSupport(answer, support)?.case_ids;
  if (!members?.length || predicate.kind !== "case_id_in" || predicate.negate ||
      !sameJson([...members].sort(), [...predicate.case_ids].sort())) return null;
  const action = { operation: "bpic19_cohorts", identity: answer.identity, definition_id: answer.definition_id, query: { ...answer.query },
    selection_prefix_length: parentPosition, selection_keep: { policy_id: "bpic19.completion_cohort_keep.v1", step_index: stepIndex,
      group: { kind: "completion_cohort", support } } };
  return savingContract.pipelineAction(action) ? action : null;
}
