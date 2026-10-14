import { useEffect, useRef, useState } from "react";
import type { AnswerIdentity, Bpic19CohortsAnswer, CohortQuery, CohortRoles, CohortTotals } from "../generated/bpic19-cohorts";
import { httpCohortsClient, type CohortsClient } from "./cohorts-client";
import "./cohorts.css";

export interface Bpic19CohortsProps {
  workspaceId: string; identity: AnswerIdentity; revision: number; roles: CohortRoles;
  timestampKind: "utc_instant" | "wall_clock"; query?: CohortQuery; client?: CohortsClient;
  onReviewed?: (answer: Bpic19CohortsAnswer) => void; onValidityChange?: (valid: boolean) => void;
  onInspect: (caseId: string, rowIds?: string[]) => void; onKeepCases: (ids: string[]) => void;
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

/** Presentation emits existing complete-item and evidence intents; it never computes membership. */
export function Bpic19Cohorts({ workspaceId, identity, revision, roles, timestampKind, query, client = httpCohortsClient, onReviewed, onValidityChange, onInspect, onKeepCases }: Bpic19CohortsProps) {
  const [draft, setDraft] = useState<CohortQuery>(() => query ?? defaultCohortQuery(roles, timestampKind));
  const [answer, setAnswer] = useState<Bpic19CohortsAnswer | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const serial = useRef(0); const abort = useRef<AbortController | null>(null);
  const valid = useRef(onValidityChange); valid.current = onValidityChange;
  const reviewed = useRef(onReviewed); reviewed.current = onReviewed;
  const retry = useRef(draft);
  const basis = JSON.stringify([workspaceId, identity, revision, roles, timestampKind, query]);
  async function load(next: CohortQuery) {
    valid.current?.(false); const token = ++serial.current; abort.current?.abort();
    const controller = new AbortController(); abort.current = controller; retry.current = next;
    setBusy(true); setError(null);
    const result = await client.cohorts({ schema_version: 1, message_type: "bpic19_cohorts_request", request_id: `cohorts-${revision}-${token}`, query_revision: revision, workspace_id: workspaceId, identity, query: next }, controller.signal);
    if (serial.current !== token || controller.signal.aborted) return;
    setBusy(false);
    if (!result.ok) { setError(result.problem.kind === "refusal" ? result.problem.refusal.message : result.problem.kind === "unreachable" ? "The local service could not be reached. Retry this cohort." : result.problem.detail); return; }
    setAnswer(result.answer); setDraft(next); reviewed.current?.(result.answer);
  }
  useEffect(() => {
    setAnswer(null); const next = query ?? defaultCohortQuery(roles, timestampKind); setDraft(next); void load(next);
    return () => { ++serial.current; abort.current?.abort(); valid.current?.(false); };
    // Publication is fenced against changes of source, parent, roles and query revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, client]);
  const changed = answer !== null && JSON.stringify(draft) !== JSON.stringify(answer.query);
  const paused = busy || !!error || changed || answer === null;
  useEffect(() => { valid.current?.(!paused); }, [paused]);
  const result = answer?.cohorts;
  const update = (next: CohortQuery) => { valid.current?.(false); setDraft(next); };
  function keep(ids: string[]) { if (!paused && ids.length) onKeepCases(ids); }
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
      <p><strong>Original parent:</strong> {counts(result.original)}</p>
      <table className="plain-table"><caption>Whole-item stages and recorded completion</caption><thead><tr><th>Stage / state</th><th>Exact original support</th><th>Evidence / selection</th></tr></thead><tbody>
        {[{ name: "Included", support: result.inclusion.retained }, { name: "Excluded by inclusion", support: result.inclusion.excluded }, { name: "Inclusion unknown", support: result.inclusion.unknown }, ...result.completion_groups.map(g => ({ name: label(g.state), support: g })), { name: "Retained for analysis", support: result.retention.retained }].map(group => <tr key={group.name}><th scope="row">{group.name}</th><td>{counts(group.support)}</td><td><button disabled={paused || !group.support.case_count} onClick={() => keep(group.support.case_ids)}>Keep {group.name}</button>{group.support.case_ids[0] && <button disabled={paused} onClick={() => onInspect(group.support.case_ids[0])}>Inspect {group.name}</button>}</td></tr>)}
      </tbody></table>
      <p>Completion groups partition included items. Unknown completion can be retained by the all-items recipe; it is never silently declared closed or overdue.</p>
      <table className="plain-table"><caption>Complete-item evidence · {result.page.total ? `${result.page.offset + 1}–${Math.min(result.page.offset + result.page.limit, result.page.total)} of ${result.page.total}` : "no parent items"}</caption><thead><tr><th>PO item</th><th>Inclusion</th><th>Recorded completion</th><th>Required milestones / reason</th><th>Evidence</th></tr></thead><tbody>{result.page.items.map(item => <tr key={item.case_id}><th scope="row">{item.case_id}</th><td>{item.inclusion_state}: {item.inclusion_reason}{item.inclusion_witnesses.map(w => <button key={w.case_id} disabled={paused} onClick={() => onInspect(w.case_id, w.row_ids)}>Inspect inclusion witness {w.case_id}</button>)}</td><td>{label(item.completion_state)}</td><td>{item.required_activity_sets.map(a => a.join(" or ")).join("; ")}<br />{item.reasons.join("; ")}<br />Due assessment unavailable</td><td><button disabled={paused} onClick={() => onInspect(item.case_id, item.witness_row_ids)}>Inspect {item.case_id}</button></td></tr>)}</tbody></table>
      <button disabled={paused || result.page.offset === 0} onClick={() => void load({ ...answer!.query, page: { ...answer!.query.page, offset: Math.max(0, result.page.offset - result.page.limit) } })}>Previous evidence page</button><button disabled={paused || result.page.offset + result.page.limit >= result.page.total} onClick={() => void load({ ...answer!.query, page: { ...answer!.query.page, offset: result.page.offset + result.page.limit } })}>Next evidence page</button>
      <ul>{result.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </div>}
  </section>;
}
