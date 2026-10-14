import { useEffect, useRef, useState } from "react";
import type { AnswerIdentity, Bpic19FlowComparisonAnswer, FlowComparisonQuery, FlowSubtypeRule } from "../generated/bpic19-flow-comparison";
import { sameJson } from "../data/coordinator";
import { httpFlowComparisonClient, type Bpic19FlowComparisonClient } from "./flow-comparison-client";
import type { Bpic19ComparisonSide } from "./profile-types";
import "./profile.css";

function rule(side: Bpic19ComparisonSide): FlowSubtypeRule {
  const group = side.recipe.group;
  const flow = group.flow_id;
  if (group.kind !== "flow_item_type" || (flow !== "after_gr" && flow !== "before_gr" && flow !== "two_way" && flow !== "consignment") ||
      (group.state !== "invariant" && group.state !== "missing" && group.state !== "conflicting")) throw new Error("Choose a reviewed flow/subtype cell.");
  return { flow_id: flow, item_type_state: group.state, item_type_value: group.item_type_value ?? null };
}

/** A typed intent preserving both predicates; IDs are an answer, not the recipe. */
export function flowComparisonQuery(target: Bpic19ComparisonSide, reference: Bpic19ComparisonSide): FlowComparisonQuery {
  if (target.recipe.definition_id !== reference.recipe.definition_id || !sameJson(target.recipe.source_identity, reference.recipe.source_identity) ||
      !sameJson(target.recipe.query, reference.recipe.query)) throw new Error("Both subtype rules must come from the same reviewed parent and source profile.");
  return { policy_id: "bpic19.flow_item_type_comparison.v1", profile_definition_id: target.recipe.definition_id,
    profile_query: structuredClone(target.recipe.query), target: rule(target), reference: rule(reference),
    page: { role: "target", offset: 0, limit: 50 } };
}

export interface Bpic19FlowComparisonProps {
  workspaceId: string; identity: AnswerIdentity; revision: number; query: FlowComparisonQuery;
  client?: Bpic19FlowComparisonClient;
  onReviewed?: (answer: Bpic19FlowComparisonAnswer) => void; onValidityChange?: (valid: boolean) => void;
  onInspect: (caseId: string, rowIds?: string[]) => void;
  onKeepCases: (caseIds: string[]) => void;
  onReturn?: () => void;
}
const number = new Intl.NumberFormat("en");
const percentage = (value: number | null) => value === null ? "unavailable" : new Intl.NumberFormat("en", {style:"percent",maximumFractionDigits:2}).format(value);
const subtype = (value: FlowSubtypeRule) => `${value.flow_id.replaceAll("_"," ")} × ${value.item_type_state === "invariant" ? value.item_type_value : value.item_type_state}`;

/** Descriptive count comparison; every population, share and witness is supplied by the API. */
export function Bpic19FlowComparison({ workspaceId, identity, revision, query, client = httpFlowComparisonClient, onReviewed, onValidityChange, onInspect, onKeepCases, onReturn }: Bpic19FlowComparisonProps) {
  const [draft,setDraft] = useState(query), [answer,setAnswer] = useState<Bpic19FlowComparisonAnswer | null>(null);
  const [busy,setBusy] = useState(false), [problem,setProblem] = useState<string | null>(null);
  const serial=useRef(0), controller=useRef<AbortController | null>(null), retry=useRef(query);
  const callbacks=useRef({onReviewed,onValidityChange});callbacks.current={onReviewed,onValidityChange};
  const basis=JSON.stringify([workspaceId,identity,revision,query]);
  async function load(next:FlowComparisonQuery) {
    callbacks.current.onValidityChange?.(false);const token=++serial.current;controller.current?.abort();
    const abort=new AbortController();controller.current=abort;retry.current=next;setBusy(true);setProblem(null);
    const result=await client.compare({schema_version:1,message_type:"bpic19_flow_comparison_request",request_id:`flow-comparison-${revision}-${token}`,query_revision:revision,workspace_id:workspaceId,identity,query:next},abort.signal);
    if(token!==serial.current || abort.signal.aborted)return;
    setBusy(false);
    if(!result.ok) {setProblem(result.problem.kind==="refusal" ? result.problem.refusal.message : result.problem.kind==="unreachable" ? "The local service could not be reached. Retry the subtype comparison." : result.problem.detail);return;}
    setAnswer(result.answer);setDraft(next);callbacks.current.onReviewed?.(result.answer);
  }
  useEffect(()=>{setAnswer(null);setDraft(query);void load(query);return()=>{++serial.current;controller.current?.abort();callbacks.current.onValidityChange?.(false);};
    // The source/profile/parent/revision fence applies to both results and failures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[basis,client]);
  const changed=answer!==null && !sameJson(draft,answer.query), paused=busy || !!problem || changed || answer===null;
  useEffect(()=>{callbacks.current.onValidityChange?.(!paused);},[paused]);
  const comparison=answer?.comparison;
  function edit(next:FlowComparisonQuery) {callbacks.current.onValidityChange?.(false);setDraft(next);}
  return <section className="bpic19-profile" aria-labelledby="flow-comparison-title" aria-busy={busy}>
    <h2 id="flow-comparison-title">Compare the reviewed item types</h2>
    <p>Target and comparator each retain their exact category and invariant subtype rule on one reviewed parent. The comparator is explicitly named; missing/changing subtypes remain visible outside known sides.</p>
    <p>Target: {subtype(draft.target)}. Comparator: {subtype(draft.reference)}.</p>
    <button type="button" disabled={busy} onClick={()=>edit({...draft,target:draft.reference,reference:draft.target,page:{...draft.page,role:"target",offset:0}})}>Swap target and comparator</button>
    <button type="button" disabled={busy || !changed} onClick={()=>void load(draft)}>Review comparison roles</button>
    {onReturn && <button type="button" onClick={onReturn}>Return to purchasing parent</button>}
    {busy && <p role="status">Reading the subtype comparison… Earlier actions are paused. <button type="button" onClick={()=>{++serial.current;controller.current?.abort();setBusy(false);setProblem("Comparison cancelled. Review or retry before keeping or saving.");callbacks.current.onValidityChange?.(false);}}>Cancel comparison</button></p>}
    {changed && <p role="status">Comparison roles have changed. Review them before using the earlier answer.</p>}
    {problem && <div role="alert"><p>{problem}</p><button disabled={busy} type="button" onClick={()=>void load(retry.current)}>Retry subtype comparison</button></div>}
    {comparison && <div data-stale={paused ? "true" : undefined}>
      <p>Reviewed current parent: {number.format(comparison.parent.case_count)} items / {number.format(comparison.parent.record_count)} records. Flow parent: {number.format(comparison.flow_parent.case_count)} items. Named union comparison parent: {number.format(comparison.comparison_parent.case_count)} items / {number.format(comparison.comparison_parent.record_count)} records.</p>
      <table className="plain-table"><caption>Exact subgroup support and distinct denominators</caption><thead><tr><th>Role / scope</th><th>Items</th><th>Original records</th><th>Known documents</th><th>Full-history actions</th></tr></thead><tbody>{([
        ["Target",comparison.target], ["Comparator",comparison.reference], ["Outside both sides in flow parent",comparison.outside], ["Unavailable subtype in flow parent",comparison.unavailable],
      ] as const).map(([label,support])=><tr key={label}><th scope="row">{label}</th><td>{number.format(support.case_count)}</td><td>{number.format(support.record_count)}</td><td>{number.format(support.document_count)}</td><td><button type="button" disabled={paused || !support.case_count} onClick={()=>onKeepCases(support.case_ids)}>Keep {label.toLowerCase()}</button></td></tr>)}</tbody></table>
      <p>Target item share: {percentage(comparison.shares.target_item_share)} of {number.format(comparison.shares.item_denominator)} union items; target record share: {percentage(comparison.shares.target_record_share)} of {number.format(comparison.shares.record_denominator)} original union records. These use different denominators.</p>
      <p>Distinct union documents: {number.format(comparison.documents.union_document_count)}; documents in both sides: {number.format(comparison.documents.overlap_document_count)} ({comparison.documents.overlap_document_ids.join(", ") || "none"}). Sum of side document supports is not a distinct-document total. {number.format(comparison.documents.unknown_document_case_ids.length)} union items have unavailable document relation.</p>
      <p>{number.format(comparison.outside_flow.case_count)} current-parent items are outside the selected flow; {number.format(comparison.scope_unavailable.case_count)} have unavailable flow scope. This does not remove them from the original parent.</p>
      <label>Evidence side<select disabled={paused} value={comparison.page.role} onChange={event=>{const role=event.target.value;if(role==="target" || role==="reference" || role==="outside" || role==="unavailable")void load({...answer!.query,page:{...answer!.query.page,role,offset:0}});}}><option value="target">Target</option><option value="reference">Comparator</option><option value="outside">Outside both sides</option><option value="unavailable">Unavailable subtype</option></select></label>
      <table className="plain-table"><caption>Comparison complete-item evidence</caption><thead><tr><th>Item and role</th><th>Subtype state and membership reason</th><th>Original records</th><th>Evidence</th></tr></thead><tbody>{comparison.page.items.map(item=><tr key={item.case_id}><th scope="row">{item.case_id} · {item.role}</th><td>{item.item_type_state}: {item.item_type_value ?? "unavailable"} · {item.reason.replaceAll("_"," ")}</td><td>{item.record_count}</td><td><button type="button" disabled={paused} onClick={()=>onInspect(item.case_id,item.witness_row_ids)}>Inspect comparison item {item.case_id}</button><button type="button" disabled={paused} onClick={()=>onKeepCases([item.case_id])}>Keep comparison item {item.case_id}</button></td></tr>)}</tbody></table>
      <button type="button" disabled={paused || comparison.page.offset===0} onClick={()=>void load({...answer!.query,page:{...answer!.query.page,offset:Math.max(0,comparison.page.offset-comparison.page.limit)}})}>Previous comparison evidence</button><button type="button" disabled={paused || comparison.page.next_offset===null} onClick={()=>void load({...answer!.query,page:{...answer!.query.page,offset:comparison.page.next_offset ?? 0}})}>Next comparison evidence</button>
      <ul>{comparison.limitations.map(text=><li key={text}>{text}</li>)}</ul>
      <details><summary>Both subgroup recipes and reviewed parent</summary><p>{comparison.definition_id}</p><p>Current parent: {answer!.identity.population_id}</p><pre>{JSON.stringify(comparison.definition,null,2)}</pre></details>
    </div>}
  </section>;
}
