import { useEffect, useRef, useState } from "react";
import type { AnswerIdentity, Bpic19CohortsAnswer, Bpic19CohortsRequest, CohortQuery, CohortRoles, CohortTotals } from "../generated/bpic19-cohorts";
import { sameJson } from "../data/coordinator";
import { answersCohorts, cohortsContract, httpCohortsClient, type CohortsClient, type CohortsOutcome } from "./cohorts-client";
import "./cohorts.css";

export interface Bpic19CohortsProps {
  workspaceId: string; identity: AnswerIdentity; revision: number; roles: CohortRoles;
  timestampKind: "utc_instant" | "wall_clock"; query?: CohortQuery; client?: CohortsClient;
  onReviewed?: (answer: Bpic19CohortsAnswer) => void; onValidityChange?: (valid: boolean) => void;
  onRetain?: (answer: Bpic19CohortsAnswer) => void;
  retainedQueries?: readonly { definition_id: string; label: string; query: CohortQuery }[];
  restoredComparison?: Bpic19CohortComparison;
  onCompared?: (comparison: Bpic19CohortComparison) => void;
  onComparisonValidityChange?: (current: boolean) => void;
  onInspect: (caseId: string, rowIds?: string[]) => void; onKeepCases: (ids: string[]) => void;
}
export interface Bpic19CohortComparison {
  policy_id: "bpic19.same_parent_completion_comparison.v1";
  identity: AnswerIdentity;
  target: { name: string; definition_id: string; query: CohortQuery };
  reference: { name: string; definition_id: string; query: CohortQuery };
}
export function defaultCohortQuery(roles: CohortRoles, timestamp_kind: "utc_instant" | "wall_clock"): CohortQuery {
  return { policy_id: "bpic19.flow_completion_cohorts.v1", roles,
    inclusion: { kind: "all_items", timestamp_kind, start_inclusive: null, end_exclusive: null },
    completion: { recipe: "flow_presence", receipt: "goods_only", tie_policy: "unknown" },
    retain: "all_included", horizon: { timestamp_kind, value: null, provenance: null }, page: { offset: 0, limit: 50 } };
}
const number = new Intl.NumberFormat();
function counts(value: CohortTotals) { return `${number.format(value.case_count)} PO items · ${number.format(value.record_count)} original records · ${number.format(value.document_count)} known documents · ${number.format(value.document_unknown_case_count)} items with unavailable document relation`; }
function label(state: string) { return state === "observed_closed" ? "Recorded closed" : state === "open_recorded" ? "Recorded open" : state === "unknown" ? "Unknown" : state; }
function recipeLabel(query: CohortQuery) { return `${query.completion.recipe === "flow_presence" ? "Flow presence" : query.completion.recipe === "kpmg_last_ending" ? "KPMG last Clear/Delete" : "Botti mandatory presence"} · ${query.inclusion.kind} · ${query.retain} · ties ${query.completion.tie_policy}`; }
function cohortMeaning({page:_page,...definition}:CohortQuery){return definition;}

/** Presentation emits existing complete-item and evidence intents; it never computes membership. */
export function Bpic19Cohorts({ workspaceId, identity, revision, roles, timestampKind, query, client = httpCohortsClient, onReviewed, onValidityChange, onRetain, retainedQueries = [], restoredComparison, onCompared, onComparisonValidityChange, onInspect, onKeepCases }: Bpic19CohortsProps) {
  const [draft, setDraft] = useState<CohortQuery>(() => query ?? defaultCohortQuery(roles, timestampKind));
  const [answer, setAnswer] = useState<Bpic19CohortsAnswer | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const serial = useRef(0); const abort = useRef<AbortController | null>(null);
  const valid = useRef(onValidityChange); valid.current = onValidityChange;
  const reviewed = useRef(onReviewed); reviewed.current = onReviewed;
  const retry = useRef(draft);
  const [retained, setRetained] = useState<Record<string, { definition_id: string; label: string; query: CohortQuery }>>({});
  const [retainedChoice, setRetainedChoice] = useState("");
  const [targetChoice, setTargetChoice] = useState(""), [referenceChoice, setReferenceChoice] = useState("");
  const [comparison, setComparison] = useState<[Bpic19CohortsAnswer, Bpic19CohortsAnswer] | null>(null);
  const [compareBusy, setCompareBusy] = useState(false), [compareError, setCompareError] = useState<string | null>(null);
  const [comparisonCurrent,setComparisonCurrent]=useState(false);
  const compareSerial = useRef(0), compareAbort = useRef<AbortController | null>(null);
  const reviewedComparison = useRef<Bpic19CohortComparison | null>(null);
  const comparisonCallbacks = useRef({onCompared,onComparisonValidityChange}); comparisonCallbacks.current={onCompared,onComparisonValidityChange};
  const identityKey = JSON.stringify(identity), restoredComparisonKey = JSON.stringify(restoredComparison ?? null);
  const basis = JSON.stringify([workspaceId, identity, revision, roles, timestampKind, query]);
  function envelope(next: CohortQuery, request_id: string): Bpic19CohortsRequest { return {schema_version:1,message_type:"bpic19_cohorts_request",request_id,query_revision:revision,workspace_id:workspaceId,identity,query:next}; }
  function invalidateComparison() {
    ++compareSerial.current; compareAbort.current?.abort(); setCompareBusy(false);setComparisonCurrent(false);
    if (reviewedComparison.current) comparisonCallbacks.current.onComparisonValidityChange?.(false);
  }
  async function load(next: CohortQuery) {
    if(answer && !sameJson(cohortMeaning(next),cohortMeaning(answer.query)))invalidateComparison();
    valid.current?.(false); const token = ++serial.current; abort.current?.abort();
    const controller = new AbortController(); abort.current = controller; retry.current = next;
    setBusy(true); setError(null);
    const request=envelope(next,`cohorts-${revision}-${token}`);
    let result:CohortsOutcome;
    try { result=await client.cohorts(request,controller.signal); }
    catch { result={ok:false,problem:{kind:"unreachable"}}; }
    if (serial.current !== token || controller.signal.aborted) return;
    setBusy(false);
    if (!result.ok) { setError(result.problem.kind === "refusal" ? result.problem.refusal.message : result.problem.kind === "unreachable" ? "The local service could not be reached. Retry this cohort." : result.problem.detail); return; }
    if(!answersCohorts(request,result.answer)){setError("The cohort answer belongs to a different source, parent or recipe.");return;}
    setAnswer(result.answer); setDraft(next); reviewed.current?.(result.answer);
  }
  useEffect(() => {
    ++compareSerial.current;compareAbort.current?.abort();reviewedComparison.current=null;setRetained({});setRetainedChoice("");setTargetChoice("");setReferenceChoice("");setComparison(null);setCompareBusy(false);setCompareError(null);setComparisonCurrent(false);
    setAnswer(null); const next = query ?? defaultCohortQuery(roles, timestampKind); setDraft(next); void load(next);
    return () => { ++serial.current; abort.current?.abort(); ++compareSerial.current; compareAbort.current?.abort(); valid.current?.(false); if(reviewedComparison.current)comparisonCallbacks.current.onComparisonValidityChange?.(false); };
    // Publication is fenced against changes of source, parent, roles and query revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, client]);
  useEffect(()=>{
    if(!restoredComparison)return;
    if(restoredComparison.policy_id!=="bpic19.same_parent_completion_comparison.v1" || !sameJson(restoredComparison.identity,identity) ||
      restoredComparison.target.definition_id===restoredComparison.reference.definition_id || !restoredComparison.target.name.trim() || !restoredComparison.reference.name.trim() ||
      !cohortsContract.request(envelope(restoredComparison.target.query,"cohort-restore-target")) || !cohortsContract.request(envelope(restoredComparison.reference.query,"cohort-restore-reference"))) {
      invalidateComparison();setComparison(null);setCompareError("The restored comparison has no two distinct admitted cohort definitions on this exact parent. No defaults were substituted.");comparisonCallbacks.current.onComparisonValidityChange?.(false);return;
    }
    if(comparisonCurrent && sameJson(reviewedComparison.current,restoredComparison) && comparison?.every(answer=>answer.workspace_id===workspaceId && sameJson(answer.identity,identity) && answer.query_revision===revision))return;
    setTargetChoice(restoredComparison.target.definition_id);setReferenceChoice(restoredComparison.reference.definition_id);
    void readComparison(restoredComparison.target,restoredComparison.reference);
    return()=>{++compareSerial.current;compareAbort.current?.abort();};
    // Only an explicitly saved pair is restored; callback feedback does not choose a new pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[workspaceId,identityKey,revision,restoredComparisonKey,client]);
  const changed = answer !== null && JSON.stringify(draft) !== JSON.stringify(answer.query);
  const paused = busy || !!error || changed || answer === null;
  useEffect(() => { valid.current?.(!paused); }, [paused]);
  const result = answer?.cohorts;
  const update = (next: CohortQuery) => { invalidateComparison();valid.current?.(false); setDraft(next); };
  function keep(ids: string[]) { if (!paused && ids.length) onKeepCases(ids); }
  const choices=new Map([...retainedQueries.map(value=>[value.definition_id,value] as const),...Object.values(retained).map(value=>[value.definition_id,value] as const)]);
  if(restoredComparison && sameJson(restoredComparison.identity,identity))for(const side of [restoredComparison.target,restoredComparison.reference])choices.set(side.definition_id,{definition_id:side.definition_id,label:side.name,query:side.query});
  function retain(){if(answer && !paused){setRetained(current=>({...current,[answer.definition_id]:{definition_id:answer.definition_id,label:recipeLabel(answer.query),query:structuredClone(answer.query)}}));onRetain?.(answer);}}
  function chooseComparison(side:"target"|"reference",value:string){invalidateComparison();setCompareError(null);setComparison(null);(side==="target"?setTargetChoice:setReferenceChoice)(value);}
  async function readComparison(target:Bpic19CohortComparison["target"],reference:Bpic19CohortComparison["reference"]) {
    const token=++compareSerial.current;compareAbort.current?.abort();const controller=new AbortController();compareAbort.current=controller;setCompareBusy(true);setCompareError(null);comparisonCallbacks.current.onComparisonValidityChange?.(false);
    const requests=[target,reference].map((side,index)=>envelope(side.query,`cohort-pair-${revision}-${token}-${index}`));
    let results:CohortsOutcome[];
    try{results=await Promise.all(requests.map(request=>client.cohorts(request,controller.signal)));}catch{results=[{ok:false,problem:{kind:"unreachable"}}];}
    if(token!==compareSerial.current || controller.signal.aborted)return;
    setCompareBusy(false);const accepted:Bpic19CohortsAnswer[]=[];
    for(const [index,result] of results.entries()){
      if(!result.ok){setCompareError(result.problem.kind==="refusal"?result.problem.refusal.message:result.problem.kind==="unreachable"?"The paired cohort definitions could not be read. Retry both explicit recipes.":result.problem.detail);return;}
      if(!answersCohorts(requests[index],result.answer) || result.answer.definition_id!==[target,reference][index].definition_id){setCompareError("A cohort differs from its retained source, parent or definition. No alternative was substituted.");return;}
      accepted.push(result.answer);
    }
    if(accepted.length!==2 || !sameJson(accepted[0].parent_identity,accepted[1].parent_identity) || !sameJson(accepted[0].cohorts.original,accepted[1].cohorts.original)) {setCompareError("Both cohort recipes must be evaluated over the same complete original parent.");return;}
    const pair:Bpic19CohortComparison={policy_id:"bpic19.same_parent_completion_comparison.v1",identity:structuredClone(identity),target:structuredClone(target),reference:structuredClone(reference)};
    reviewedComparison.current=pair;setComparison([accepted[0],accepted[1]]);setComparisonCurrent(true);comparisonCallbacks.current.onCompared?.(structuredClone(pair));comparisonCallbacks.current.onComparisonValidityChange?.(true);
  }
  function compare(){const target=choices.get(targetChoice),reference=choices.get(referenceChoice);if(paused || !target || !reference || target.definition_id===reference.definition_id)return;void readComparison({name:target.label,definition_id:target.definition_id,query:target.query},{name:reference.label,definition_id:reference.definition_id,query:reference.query});}
  const comparisonPaused=paused || compareBusy || !!compareError || !comparisonCurrent;
  return <section className="bpic19-cohorts" aria-labelledby="cohorts-title" aria-busy={busy}>
    <h2 id="cohorts-title">Choose the analysis cohort</h2>
    <p>The paper analysis retains every original PO item, including missing-clearing histories. Recorded completion is a separate, reviewed rule; it does not prove payment, compliance or lateness.</p>
    <details><summary>Inclusion and completion definition</summary>
      <label>Whole-item inclusion<select value={draft.inclusion.kind} disabled={busy} onChange={e => { const kind = e.target.value as CohortQuery["inclusion"]["kind"]; update({ ...draft, inclusion: { ...draft.inclusion, kind, ...(kind === "all_items" ? { start_inclusive: null, end_exclusive: null } : {}) } }); }}>
        <option value="all_items">All original items (paper)</option><option value="item_start_window">Item starts inside a window</option><option value="document_start_window">Document starts inside a window</option><option value="item_any_event_window">Item has any event inside a window</option>
      </select></label>
      {draft.inclusion.kind !== "all_items" && <><label>Start inclusive (ISO, {timestampKind})<input value={draft.inclusion.start_inclusive ?? ""} disabled={busy} onChange={e => update({ ...draft, inclusion: { ...draft.inclusion, start_inclusive: e.target.value || null } })} /></label><label>End exclusive (ISO)<input value={draft.inclusion.end_exclusive ?? ""} disabled={busy} onChange={e => update({ ...draft, inclusion: { ...draft.inclusion, end_exclusive: e.target.value || null } })} /></label></>}
      <label>Recorded-completion recipe<select disabled={busy} value={draft.completion.recipe} onChange={e => update({ ...draft, completion: { ...draft.completion, recipe: e.target.value as CohortQuery["completion"]["recipe"], tie_policy: "unknown" } })}>
        <option value="flow_presence">Presence: Consignment receipt; other flows clearing</option><option value="kpmg_last_ending">KPMG: last record is Clear Invoice or Delete Item</option><option value="botti_mandatory_presence">Botti: unordered mandatory activity sets</option>
      </select></label>
      <label>Receipt milestone<select disabled={busy} value={draft.completion.receipt} onChange={e => update({ ...draft, completion: { ...draft.completion, receipt: e.target.value as CohortQuery["completion"]["receipt"] } })}><option value="goods_only">Goods receipt only</option><option value="goods_or_service">Goods receipt or service entry sheet (reviewed alternative)</option></select></label>
      {draft.completion.recipe === "kpmg_last_ending" && <label>Equal-time ending policy<select value={draft.completion.tie_policy} disabled={busy} onChange={e => update({ ...draft, completion: { ...draft.completion, tie_policy: e.target.value as CohortQuery["completion"]["tie_policy"] } })}><option value="unknown">Order unknown when endings tie</option><option value="source_position">Reviewed source-position convention (does not prove causality)</option></select></label>}
      <label>Retain for analysis<select value={draft.retain} disabled={busy} onChange={e => update({ ...draft, retain: e.target.value as CohortQuery["retain"] })}><option value="all_included">Every included item (no completion exclusion)</option><option value="observed_closed">Recorded closed</option><option value="open_recorded">Recorded open</option><option value="unknown">Completion unknown</option></select></label>
      <label>Declared observation horizon (optional ISO)<input disabled={busy} value={draft.horizon.value ?? ""} onChange={e => update({ ...draft, horizon: { ...draft.horizon, value: e.target.value || null, ...(e.target.value ? {} : { provenance: null }) } })} /></label>
      {draft.horizon.value !== null && <label>Reviewed horizon source/provenance<input disabled={busy} value={draft.horizon.provenance ?? ""} onChange={e => update({ ...draft, horizon: { ...draft.horizon, provenance: e.target.value || null } })} /></label>}
      <p>Unknown horizon remains unknown. A declared horizon is stored as provenance; no contractual due date is supplied.</p>
      <button type="button" disabled={busy} onClick={() => void load({ ...draft, page: { ...draft.page, offset: 0 } })}>Review this cohort</button>
    </details>
    {busy && <p role="status">Reviewing cohort… Earlier actions are paused. <button onClick={() => { ++serial.current; abort.current?.abort(); setBusy(false); setError("Cohort review cancelled. Retry or review the current definition."); valid.current?.(false); }}>Cancel cohort review</button></p>}
    {changed && <p role="status">The definition has changed. Review it before keeping or saving the earlier answer.</p>}
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => void load(retry.current)}>Retry cohort</button></div>}
    {result && <div data-stale={paused ? "true" : undefined}>
      {onRetain && <button type="button" disabled={paused || choices.size>=32 && !choices.has(answer!.definition_id)} onClick={retain}>Retain reviewed cohort</button>}
      {!!choices.size && <div><label>Previously retained cohort<select disabled={busy} value={retainedChoice} onChange={event=>setRetainedChoice(event.target.value)}><option value="">Choose a retained definition</option>{[...choices.values()].map(value=><option key={value.definition_id} value={value.definition_id}>{value.label}</option>)}</select></label><button type="button" disabled={busy || !choices.has(retainedChoice)} onClick={()=>{const choice=choices.get(retainedChoice);if(choice)void load(structuredClone(choice.query));}}>Read retained cohort</button></div>}
      <p><strong>Original parent:</strong> {counts(result.original)}</p>
      <table className="plain-table"><caption>Whole-item stages and recorded completion</caption><thead><tr><th>Stage / state</th><th>Exact original support</th><th>Evidence / selection</th></tr></thead><tbody>
        {[{ name: "Included", support: result.inclusion.retained }, { name: "Excluded by inclusion", support: result.inclusion.excluded }, { name: "Inclusion unknown", support: result.inclusion.unknown }, ...result.completion_groups.map(g => ({ name: label(g.state), support: g })), { name: "Retained for analysis", support: result.retention.retained }].map(group => <tr key={group.name}><th scope="row">{group.name}</th><td>{counts(group.support)}</td><td><button disabled={paused || !group.support.case_count} onClick={() => keep(group.support.case_ids)}>Keep {group.name}</button>{group.support.case_ids[0] && <button disabled={paused} onClick={() => onInspect(group.support.case_ids[0])}>Inspect {group.name}</button>}</td></tr>)}
      </tbody></table>
      <p>Completion groups partition included items. Unknown completion can be retained by the all-items recipe; it is never silently declared closed or overdue.</p>
      <table className="plain-table"><caption>Complete-item evidence · {result.page.total ? `${result.page.offset + 1}–${Math.min(result.page.offset + result.page.limit, result.page.total)} of ${result.page.total}` : "no parent items"}</caption><thead><tr><th>PO item</th><th>Inclusion</th><th>Recorded completion</th><th>Required milestones / reason</th><th>Evidence</th></tr></thead><tbody>{result.page.items.map(item => <tr key={item.case_id}><th scope="row">{item.case_id}</th><td>{item.inclusion_state}: {item.inclusion_reason}{item.inclusion_witnesses.map(w => <button key={w.case_id} disabled={paused} onClick={() => onInspect(w.case_id, w.row_ids)}>Inspect inclusion witness {w.case_id}</button>)}</td><td>{label(item.completion_state)}</td><td>{item.required_activity_sets.map(a => a.join(" or ")).join("; ")}<br />{item.reasons.join("; ")}<br />Due assessment unavailable</td><td><button disabled={paused} onClick={() => onInspect(item.case_id, item.witness_row_ids)}>Inspect {item.case_id}</button></td></tr>)}</tbody></table>
      <button disabled={paused || result.page.offset === 0} onClick={() => void load({ ...answer!.query, page: { ...answer!.query.page, offset: Math.max(0, result.page.offset - result.page.limit) } })}>Previous evidence page</button><button disabled={paused || result.page.offset + result.page.limit >= result.page.total} onClick={() => void load({ ...answer!.query, page: { ...answer!.query.page, offset: result.page.offset + result.page.limit } })}>Next evidence page</button>
      <ul>{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </div>}
    {onCompared && <details open={comparison!==null}><summary>Compare two retained completion definitions on this parent</summary>
      <p>Explicitly retain each reviewed recipe, then name its target/comparator role. Both definitions are re-read on this same original population; no current default, completion exclusion or observed order is substituted.</p>
      <label>Target retained completion definition<select disabled={compareBusy} value={targetChoice} onChange={event=>chooseComparison("target",event.target.value)}><option value="">Choose target</option>{[...choices.values()].map(value=><option key={value.definition_id} value={value.definition_id}>{value.label}</option>)}</select></label>
      <label>Comparator retained completion definition<select disabled={compareBusy} value={referenceChoice} onChange={event=>chooseComparison("reference",event.target.value)}><option value="">Choose comparator</option>{[...choices.values()].map(value=><option key={value.definition_id} value={value.definition_id}>{value.label}</option>)}</select></label>
      <button type="button" disabled={paused || compareBusy || !choices.has(targetChoice) || !choices.has(referenceChoice) || targetChoice===referenceChoice} onClick={compare}>Review paired completion definitions</button>
      {reviewedComparison.current && comparisonPaused && <button type="button" disabled={paused || compareBusy} onClick={()=>{const pair=reviewedComparison.current;if(pair && sameJson(pair.identity,identity)){setTargetChoice(pair.target.definition_id);setReferenceChoice(pair.reference.definition_id);void readComparison(pair.target,pair.reference);}}}>Restore reviewed completion comparison</button>}
      {compareBusy && <p role="status">Reading both declared cohort definitions… <button type="button" onClick={()=>{invalidateComparison();setCompareError("Completion comparison cancelled. Review both declared recipes before saving.");}}>Cancel completion comparison</button></p>}
      {compareError && <p role="alert">{compareError}</p>}
      {comparison && <div data-stale={comparisonPaused?"true":undefined}><table className="plain-table"><caption>Two reviewed same-parent completion answers</caption><thead><tr><th>Role and recipe</th><th>Original parent</th><th>Recorded closed</th><th>Recorded open</th><th>Unknown completion</th><th>Definition evidence</th></tr></thead><tbody>{comparison.map((value,index)=><tr key={index}><th scope="row">{index===0?"Target":"Comparator"}: {recipeLabel(value.query)}</th><td>{counts(value.cohorts.original)}</td><td>{value.cohorts.completion_groups.find(group=>group.state==="observed_closed")?.case_count ?? "unavailable"}</td><td>{value.cohorts.completion_groups.find(group=>group.state==="open_recorded")?.case_count ?? "unavailable"}</td><td>{value.cohorts.completion_groups.find(group=>group.state==="unknown")?.case_count ?? "unavailable"}</td><td><small>{value.definition_id}</small><details><summary>Exact {index===0?"target":"comparator"} declaration</summary><pre>{JSON.stringify(value.query,null,2)}</pre></details></td></tr>)}</tbody></table>
        <p>The registered comparison supplies exact closed/open/unknown transitions, overlap and difference memberships, and outside-inclusion support. These two API answers do not recategorize a purchasing flow or establish actual payment or contractual lateness.</p>
      </div>}
    </details>}
  </section>;
}
