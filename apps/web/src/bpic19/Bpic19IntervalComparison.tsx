import { useEffect, useId, useRef, useState } from "react";
import type { AnswerIdentity, Bpic19IntervalComparisonAnswer, IntervalComparisonQuery, IntervalSide, Milestone } from "../generated/bpic19-interval-comparison";
import { sameJson } from "../data/coordinator";
import { answersIntervalComparison, httpIntervalComparisonClient, type Bpic19IntervalComparisonClient, type Bpic19IntervalComparisonOutcome } from "./interval-comparison-client";
import "./measures.css";

export function intervalComparisonQuery(target: IntervalSide, reference: IntervalSide,
  intervalSource = ["Record Invoice Receipt"], intervalTarget = ["Clear Invoice"]): IntervalComparisonQuery {
  return { policy_id: "bpic19.interval_distribution_comparison.v1", interval_policy: "independent_minimum",
    interval_source: intervalSource, interval_target: intervalTarget, target, reference, page: { role: "target", offset: 0, limit: 50 } };
}
export interface Bpic19IntervalComparisonProps {
  workspaceId: string; identity: AnswerIdentity; revision: number; query: IntervalComparisonQuery;
  client?: Bpic19IntervalComparisonClient;
  onReviewed?: (answer: Bpic19IntervalComparisonAnswer) => void; onValidityChange?: (valid: boolean) => void;
  onInspect: (caseId: string, rowIds?: string[]) => void; onKeepCases: (caseIds: string[]) => void; onReturn?: () => void;
}
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });
const display = (value: number | null) => value === null ? "unavailable" : number.format(value);
const reason = (value: string | null) => value?.replaceAll("_", " ") ?? "available";
const ids = (value: string[]) => value.join(", ") || "none";
const lines = (value: string) => value.split("\n").filter(item => item.length > 0);
function meaning({ page: _page, ...definition }: IntervalComparisonQuery) { return definition; }
const textOf = (query: IntervalComparisonQuery) => ({ source: query.interval_source.join("\n"), target: query.interval_target.join("\n"), targetIds: query.target.recipe.case_ids.join("\n"), referenceIds: query.reference.recipe.case_ids.join("\n") });

function EndpointEvidence({ label, endpoint, inspect, paused }: { label: string; endpoint: Milestone; inspect: (ids: string[]) => void; paused: boolean }) {
  return <tr><th scope="row">{label}</th><td>{endpoint.timestamp ?? "unavailable"}<small>{reason(endpoint.reason)} · {reason(endpoint.endpoint_state)}</small></td><td>
    <p>Co-minimum records: {ids(endpoint.row_ids)}. Display representative: {endpoint.selected_row_id ?? "none"}.</p>
    <p>Later parsed candidates: {ids(endpoint.later_row_ids)}. Unparseable candidates: {ids(endpoint.unparseable_row_ids)}. Unknown activity records: {ids(endpoint.unknown_activity_row_ids)}.</p>
    <button type="button" disabled={paused || !endpoint.candidate_row_ids.length && !endpoint.unknown_activity_row_ids.length} onClick={() => inspect([...new Set([...endpoint.candidate_row_ids, ...endpoint.unknown_activity_row_ids])])}>Inspect {label.toLowerCase()} endpoint evidence</button>
  </td></tr>;
}

/** One frozen parent, explicit whole-item side recipes, independently admitted endpoint minima. */
export function Bpic19IntervalComparison({ workspaceId, identity, revision, query, client = httpIntervalComparisonClient, onReviewed, onValidityChange, onInspect, onKeepCases, onReturn }: Bpic19IntervalComparisonProps) {
  const heading = useId();
  const [draft, setDraft] = useState(query), [answer, setAnswer] = useState<Bpic19IntervalComparisonAnswer | null>(null);
  const [text, setText] = useState(() => textOf(query));
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [cancelled, setCancelled] = useState(false);
  const serial = useRef(0), controller = useRef<AbortController | null>(null), retry = useRef(query);
  const callbacks = useRef({ onReviewed, onValidityChange }); callbacks.current = { onReviewed, onValidityChange };
  const basis = JSON.stringify([workspaceId, identity, revision, query]);
  async function load(next: IntervalComparisonQuery) {
    callbacks.current.onValidityChange?.(false); const token = ++serial.current; controller.current?.abort();
    const abort = new AbortController(); controller.current = abort; retry.current = next; setBusy(true); setProblem(null); setCancelled(false);
    const request = { schema_version: 1 as const, message_type: "bpic19_interval_comparison_request" as const, request_id: `interval-comparison-${revision}-${token}`, query_revision: revision, workspace_id: workspaceId, identity, query: next };
    let result: Bpic19IntervalComparisonOutcome;
    try { result = await client.compare(request, abort.signal); }
    catch { result = { ok: false, problem: { kind: "unreachable" } }; }
    if (token !== serial.current || abort.signal.aborted) return;
    setBusy(false);
    if (!result.ok) { setProblem(result.problem.kind === "refusal" ? `${result.problem.refusal.message} (${result.problem.refusal.code})` : result.problem.kind === "unreachable" ? "The local service could not be reached. Retry the interval comparison." : result.problem.detail); return; }
    if (!answersIntervalComparison(request, result.answer)) { setProblem("The reply belongs to a different source, parent or interval recipe."); return; }
    setAnswer(result.answer); setDraft(next); setText(textOf(next)); callbacks.current.onReviewed?.(result.answer);
  }
  useEffect(() => { setAnswer(null); setDraft(query); setText(textOf(query)); setCancelled(false); void load(query); return () => { ++serial.current; controller.current?.abort(); callbacks.current.onValidityChange?.(false); };
    // Both answers and errors are fenced by the source, parent, recipe and revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis, client]);
  const changed = answer !== null && !sameJson(meaning(draft), meaning(answer.query));
  const valid = [draft.interval_source, draft.interval_target].every(labels => labels.length > 0 && labels.length <= 100) && !!draft.target.label.trim() && !!draft.reference.label.trim();
  const paused = busy || !!problem || cancelled || changed || !valid || answer === null;
  useEffect(() => { callbacks.current.onValidityChange?.(!paused); }, [paused]);
  function edit(next: IntervalComparisonQuery) {
    ++serial.current; controller.current?.abort(); setBusy(false); setProblem(null); setCancelled(false); setDraft(next); callbacks.current.onValidityChange?.(false);
  }
  function cancel() { ++serial.current; controller.current?.abort(); setBusy(false); setCancelled(true); callbacks.current.onValidityChange?.(false); }
  function restore() { if (answer) { ++serial.current; controller.current?.abort(); setBusy(false); setDraft(answer.query); setText(textOf(answer.query)); setProblem(null); setCancelled(false); callbacks.current.onReviewed?.(answer); } }
  const comparison = answer?.comparison;
  const sideControls = (role: "target" | "reference") => <fieldset><legend>{role === "target" ? "Target" : "Comparator"} membership</legend>
    <label>{role === "target" ? "Target" : "Comparator"} name<input value={draft[role].label} onChange={event => edit({ ...draft, [role]: { ...draft[role], label: event.target.value }, page: { ...draft.page, offset: 0 } })} /></label>
    <label>{role === "target" ? "Target" : "Comparator"} complete item IDs<textarea value={text[role === "target" ? "targetIds" : "referenceIds"]} onChange={event => { setText(current => ({ ...current, [role === "target" ? "targetIds" : "referenceIds"]: event.target.value })); edit({ ...draft, [role]: { ...draft[role], recipe: { kind: "complete_case_ids", case_ids: lines(event.target.value) } }, page: { ...draft.page, offset: 0 } }); }} /></label>
  </fieldset>;
  return <section className="bpic19-measures" aria-labelledby={heading} aria-busy={busy}>
    <h2 id={heading}>Compare recorded milestone intervals</h2>
    <p>Choose two named whole-item sides of the current frozen parent. Empty sides are explicit. Overlap remains visible; the comparator is not inferred from the target.</p>
    <details open><summary>Review both sides and endpoint sets</summary><div className="bpic19-measures-grid">{sideControls("target")}{sideControls("reference")}
      <fieldset><legend>Independent minimum endpoints</legend><label>Comparison source activity selector<textarea value={text.source} onChange={event => { setText(current => ({ ...current, source: event.target.value })); edit({ ...draft, interval_source: lines(event.target.value), page: { ...draft.page, offset: 0 } }); }} /></label>
        <label>Comparison target activity selector<textarea value={text.target} onChange={event => { setText(current => ({ ...current, target: event.target.value })); edit({ ...draft, interval_target: lines(event.target.value), page: { ...draft.page, offset: 0 } }); }} /></label>
        <p>Exact source labels and complete item IDs, one per line. Earliest parsed endpoints are selected first; 2017 ≤ timestamp &lt; 2020 and nonnegative recorded differences are admitted. Ties yield known zero days.</p></fieldset></div>
      <button type="button" disabled={busy || !valid} onClick={() => void load({ ...draft, page: { ...draft.page, offset: 0 } })}>Review interval comparison</button>
      <button type="button" disabled={busy} onClick={() => { const next = { ...draft, target: draft.reference, reference: draft.target, page: { ...draft.page, role: "target" as const, offset: 0 } }; setText(textOf(next)); edit(next); }}>Swap interval sides</button>
      {answer && (changed || problem || cancelled) && <button type="button" onClick={restore}>Restore reviewed interval comparison</button>}
      {!valid && <p role="alert">Name both sides and provide 1–100 exact labels for each endpoint. An explicitly empty side is allowed.</p>}
    </details>
    {onReturn && <button type="button" onClick={onReturn}>Return to interval parent</button>}
    {busy && <p role="status">Reading the interval comparison… Earlier actions are paused. <button type="button" onClick={cancel}>Cancel interval comparison</button></p>}
    {changed && <p role="status">The interval recipe has unreviewed changes. Earlier evidence, Keep and saving are paused.</p>}
    {cancelled && <p role="status">Comparison cancelled. Review the draft or restore the earlier answer.</p>}
    {problem && <div role="alert"><p>{problem}</p><button type="button" disabled={busy} onClick={() => void load(retry.current)}>Retry interval comparison</button></div>}
    {comparison && <div data-stale={paused ? "true" : undefined}>
      <p>Current parent: {number.format(comparison.parent.case_count)} complete items / {number.format(comparison.parent.record_count)} original records. Side union: {number.format(comparison.union_case_ids.length)} items. Overlap: {number.format(comparison.overlap_case_ids.length)} items. Outside both sides: {number.format(comparison.outside_case_ids.length)} items.</p>
      <p>Clock: {comparison.definition.clock_kind} / {comparison.definition.clock_policy_id}. Endpoint sets: {comparison.definition.interval_source.join(" + ")} → {comparison.definition.interval_target.join(" + ")}. Unit: days.</p>
      <table className="plain-table"><caption>Interval distributions over explicitly named item sides</caption><thead><tr><th>Role / name</th><th>Items / records</th><th>Eligible</th><th>Known zero</th><th>Unavailable</th><th>Min</th><th>Median</th><th>Mean</th><th>Max</th><th>Whole-item actions</th></tr></thead><tbody>{(["target", "reference"] as const).map(role => {
        const side = comparison[role], summary = side.summary;
        return <tr key={role}><th scope="row">{role === "target" ? "Target" : "Comparator"}: {side.label}</th><td>{side.case_count} / {side.record_count}</td><td>{summary.available_case_count}</td><td>{summary.zero_case_count}</td><td>{summary.unavailable_case_count}<small>{Object.entries(side.unavailable_reasons).map(([key, count]) => `${reason(key)}: ${count}`).join("; ") || "none"}</small></td><td>{display(summary.minimum)}</td><td>{display(summary.median)}</td><td>{display(summary.mean)}</td><td>{display(summary.maximum)}</td><td>
          <button type="button" disabled={paused || !side.case_count} onClick={() => onKeepCases(side.case_ids)}>Keep {role} items</button>
          <button type="button" disabled={paused || !side.unavailable_case_ids.length} onClick={() => onKeepCases(side.unavailable_case_ids)}>Keep {role} unavailable items</button>
          <button type="button" disabled={paused || !side.zero_case_ids.length} onClick={() => onKeepCases(side.zero_case_ids)}>Keep {role} zero-day items</button>
        </td></tr>;
      })}</tbody></table>
      <p>Unavailable values are excluded from numeric summaries and retained in the named side denominator. Missing intervals and reversed signed differences never become zero observations.</p>
      <label>Interval evidence side<select disabled={paused} value={comparison.page.role} onChange={event => { const role = event.target.value; if (role === "target" || role === "reference") void load({ ...answer!.query, page: { ...answer!.query.page, role, offset: 0 } }); }}><option value="target">Target</option><option value="reference">Comparator</option></select></label>
      {comparison.page.items.map(item => <details key={`${comparison.definition_id}-${item.case_id}`}><summary>Interval item {item.case_id} · {item.interval.available ? `${display(item.interval.value)} days` : reason(item.interval.reason)}</summary>
        <p>{item.record_count} original records. Signed diagnostic: {item.interval.recorded_difference_days === undefined ? "unavailable" : display(item.interval.recorded_difference_days)} days. State: {reason(item.interval.interval_state ?? null)}.</p>
        <button type="button" disabled={paused} onClick={() => onInspect(item.case_id, item.record_row_ids)}>Inspect complete interval history {item.case_id}</button>
        <button type="button" disabled={paused} onClick={() => onKeepCases([item.case_id])}>Keep complete interval item {item.case_id}</button>
        <table className="plain-table"><caption>Item {item.case_id} original endpoint witnesses</caption><thead><tr><th>Endpoint</th><th>Minimum and admission</th><th>Original records</th></tr></thead><tbody><EndpointEvidence label="Source" endpoint={item.source} inspect={rowIds => onInspect(item.case_id, rowIds)} paused={paused} /><EndpointEvidence label="Target" endpoint={item.target} inspect={rowIds => onInspect(item.case_id, rowIds)} paused={paused} /></tbody></table>
      </details>)}
      <button type="button" disabled={paused || comparison.page.offset === 0} onClick={() => void load({ ...answer!.query, page: { ...answer!.query.page, offset: Math.max(0, comparison.page.offset - comparison.page.limit) } })}>Previous interval evidence</button>
      <button type="button" disabled={paused || comparison.page.next_offset === null} onClick={() => void load({ ...answer!.query, page: { ...answer!.query.page, offset: comparison.page.next_offset ?? 0 } })}>Next interval evidence</button>
      <ul>{comparison.limitations.map(text => <li key={text}>{text}</li>)}</ul>
      <details><summary>Both interval recipes and parent identity</summary><p>{comparison.definition_id}</p><p>{answer!.identity.population_id}</p><pre>{JSON.stringify(comparison.definition, null, 2)}</pre></details>
    </div>}
  </section>;
}
