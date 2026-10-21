import { useEffect, useMemo, useRef, useState } from "react";
import { sameJson } from "../data/coordinator";
import type { AnswerIdentity, Bpic19PipelineAction } from "../generated/saving";
import type { Bpic19FlowComparisonAnswer, Bpic19FlowComparisonRequest } from "../generated/bpic19-flow-comparison";
import { Bpic19FlowComparison } from "./Bpic19FlowComparison";
import { answersFlowComparison, bpic19FlowComparisonContract, httpFlowComparisonClient,
  type Bpic19FlowComparisonClient, type Bpic19FlowComparisonOutcome } from "./flow-comparison-client";

/** Validate the retained recipe as data; never replace missing fields with current mappings. */
export function retainedFlowComparisonRequest(workspaceId: string, action: Bpic19PipelineAction): Bpic19FlowComparisonRequest | null {
  if (action.operation !== "bpic19_flow_comparison" || !action.definition_id.trim()) return null;
  const candidate: unknown = { schema_version: 1, message_type: "bpic19_flow_comparison_request",
    request_id: "retained-flow-contract", query_revision: 1, workspace_id: workspaceId,
    identity: structuredClone(action.identity), query: structuredClone(action.query) };
  return bpic19FlowComparisonContract.request(candidate) ? candidate : null;
}

function sameSource(identity: AnswerIdentity, base: AnswerIdentity): boolean {
  return sameJson({ ...identity, population_id: base.population_id }, base);
}
function unsupported(detail: string): Bpic19FlowComparisonOutcome {
  return { ok: false, problem: { kind: "unsupported_reply", detail } };
}

export type RecordedFlowReturn = { ok: true } | { ok: false; message: string };
export interface Bpic19RetainedFlowComparisonsProps {
  workspaceId: string;
  baseIdentity: AnswerIdentity;
  currentIdentity: AnswerIdentity;
  actions: readonly Bpic19PipelineAction[];
  revision: number;
  client?: Bpic19FlowComparisonClient;
  onInspect: (identity: AnswerIdentity, caseId: string, rowIds: string[], reason: string) => void;
  onReturnParent: (action: Bpic19PipelineAction) => RecordedFlowReturn;
}
type Choice = { scope: string; index: string; action: Bpic19PipelineAction };

/** Read a declared comparison on its recorded parent, separately from the current child. */
export function Bpic19RetainedFlowComparisons({ workspaceId, baseIdentity, currentIdentity, actions, revision,
  client = httpFlowComparisonClient, onInspect, onReturnParent }: Bpic19RetainedFlowComparisonsProps) {
  const declared = actions.filter(action => action.operation === "bpic19_flow_comparison");
  const scope = JSON.stringify([workspaceId, baseIdentity, currentIdentity, revision, declared]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [returnProblem, setReturnProblem] = useState<string | null>(null);
  const current = choice?.scope === scope ? choice : null;
  const active = JSON.stringify([scope, current?.index]);
  const activeRef = useRef(active); activeRef.current = active;
  const latest = useRef<Bpic19FlowComparisonAnswer | null>(null);
  useEffect(() => { setChoice(null); setReturnProblem(null); latest.current = null; }, [scope]);
  const request = useMemo(() => current ? retainedFlowComparisonRequest(workspaceId, current.action) : null,
    [current, workspaceId]);
  const sourceMatches = current && sameSource(current.action.identity, baseIdentity) && sameSource(currentIdentity, baseIdentity);
  const retainedClient = useMemo<Bpic19FlowComparisonClient | null>(() => {
    if (!current || !request || !sourceMatches) return null;
    const saved = current, expected = request, captured = active;
    return { compare: async (asked, signal) => {
      if (activeRef.current !== captured || asked.workspace_id !== workspaceId || asked.query_revision !== revision ||
          !sameJson(asked.identity, saved.action.identity) ||
          !sameJson({ ...asked.query, page: expected.query.page }, expected.query) || !bpic19FlowComparisonContract.request(asked))
        return unsupported("Read the recorded parent and exact subgroup recipes. Current fields or selection cannot replace them.");
      let outcome: Bpic19FlowComparisonOutcome;
      try { outcome = await client.compare(asked, signal); }
      catch { return { ok: false, problem: { kind: "unreachable" } }; }
      if (activeRef.current !== captured || signal.aborted)
        return unsupported("The retained comparison request was cancelled after the displayed population changed.");
      if (!outcome.ok) return outcome;
      if (!bpic19FlowComparisonContract.answer(outcome.answer) || !answersFlowComparison(asked, outcome.answer) ||
          outcome.answer.definition_id !== saved.action.definition_id)
        return unsupported("The returned source, parent, subgroup recipe or definition differs from the retained comparison. No current-selection substitute was used.");
      latest.current = outcome.answer;
      return outcome;
    } };
  }, [current, request, sourceMatches, active, workspaceId, revision, client]);

  if (!declared.length) return null;
  return <details className="bpic19-profile"><summary>Reviewed and retained flow comparisons ({declared.length})</summary>
    <p>Read either named side on its recorded parent. Reading evidence keeps the current selection fixed; returning to the recorded branch is a separate action.</p>
    <label>Retained flow comparison<select value={current?.index ?? ""} onChange={event => {
      const index = event.target.value, action = declared.find((_, position) => index === String(position));
      latest.current = null; setReturnProblem(null);
      setChoice(action ? { scope, index, action: structuredClone(action) } : null);
    }}><option value="">Choose a recorded comparison</option>{declared.map((action, index) =>
      <option key={index} value={String(index)}>{action.definition_id} · parent {action.identity.population_id}</option>)}</select></label>
    {current && (!request || !sourceMatches) && <p role="alert">The retained declaration has an unsupported recipe or belongs to another source preparation. No current fields were substituted.</p>}
    {current && request && retainedClient && <>
      <p>Recorded parent: {current.action.identity.population_id}. Current selection: {currentIdentity.population_id}. Definition: {current.action.definition_id}.</p>
      {returnProblem && <p role="alert">{returnProblem}</p>}
      <Bpic19FlowComparison key={active} workspaceId={workspaceId} identity={request.identity} revision={revision}
        query={request.query} client={retainedClient} readOnly recordedDefinitionId={current.action.definition_id}
        onReturn={!sameJson(current.action.identity, currentIdentity) ? () => {
          if (activeRef.current !== active) return;
          const result = onReturnParent(structuredClone(current.action));
          setReturnProblem(result.ok ? null : result.message);
        } : undefined}
        onInspect={(caseId, rowIds = []) => {
          if (activeRef.current !== active) return;
          const answer = latest.current, item = answer?.comparison.page.items.find(item => item.case_id === caseId);
          if (!answer || !item || !sameJson(answer.identity, current.action.identity) ||
              !sameJson(rowIds, item.witness_row_ids)) return;
          onInspect(structuredClone(current.action.identity), caseId, [...rowIds],
            `Recorded ${item.role === "reference" ? "comparator" : item.role} · flow comparison ${current.action.definition_id}`);
        }} />
    </>}
  </details>;
}
