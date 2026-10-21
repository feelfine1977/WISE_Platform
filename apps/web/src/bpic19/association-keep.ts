import type { Bpic19PipelineAction } from "../generated/saving";
import type { SelectionPredicate } from "../generated/selection";
import { sameJson } from "../data/coordinator";
import { savingContract } from "../saved/client";
import type { Bpic19Client } from "./scoring-client";
import type { Bpic19ReadRequest, Bpic19ScoreAnswer } from "./scoring-types";

/** One named set of a reviewed native association comparison, exactly as its read filter names it. */
export type AssociationSet = NonNullable<NonNullable<Bpic19ReadRequest["case_filter"]>["association_set"]>;

const PAGE = 200;

/** The set's complete item IDs: the answer's list when it is complete, otherwise every page of the stored run's read. */
export async function associationSetMembers(client: Bpic19Client, answer: Bpic19ScoreAnswer, set: AssociationSet, bounded: string[] | null,
  complete: boolean, signal: AbortSignal): Promise<{ ok: true; members: string[] } | { ok: false; message: string }> {
  if (bounded && complete) return { ok: true, members: bounded };
  const members: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const outcome = await client.read({ schema_version: 1, message_type: "bpic19_read_request", request_id: crypto.randomUUID(), query_revision: 1,
      workspace_id: answer.workspace_id, run_id: answer.run_id, case_offset: offset, case_limit: PAGE, group_offset: 0, group_limit: 50,
      case_filter: { association_set: set } }, signal);
    if (!outcome.ok) return outcome;
    const page = outcome.answer.report.case_page;
    members.push(...page.cases.map(item => item.case_id));
    if (!page.cases.length || offset + PAGE >= page.total) return members.length === page.total ? { ok: true, members } : { ok: false, message: "The association set changed while it was read. Nothing was kept." };
  }
}

/** Bind a Keep of one reviewed association set to exactly this native association run and selection step. */
export function associationKeepAction(answer: Bpic19ScoreAnswer, set: AssociationSet, members: string[], predicate: SelectionPredicate,
  stepIndex: number, parentPosition: number | null = stepIndex): Bpic19PipelineAction | null {
  if (!members.length || typeof answer.definition_id !== "string" || predicate.kind !== "case_id_in" || predicate.negate ||
      !sameJson([...members].sort(), [...predicate.case_ids].sort())) return null;
  const action = { operation: "bpic19_score", identity: answer.named_population.identity, definition_id: answer.definition_id,
    query: { run_id: answer.run_id, case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50 },
    selection_prefix_length: parentPosition, selection_keep: { policy_id: "bpic19.association_set_keep.v1", step_index: stepIndex,
      group: { kind: "association_set", ...set } } };
  return savingContract.pipelineAction(action) ? action as Bpic19PipelineAction : null;
}
