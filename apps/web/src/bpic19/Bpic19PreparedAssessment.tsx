import { useEffect, useId, useRef, useState } from "react";
import "./scoring.css";
import "./measures.css";

/** Names from the frozen prepared-input candidate; this is not a scoring catalogue. */
export const BPIC19_PREPARED_ATTRIBUTES = [
  "c_l1_invoice_present", "c_l1_clear_invoice_present", "c_l1_goods_or_ses_present",
  "c_l2_df1_invoice_after_goods", "c_l2_df2_release_after_goods",
  "c_l2_2way_no_goods_expected", "c_l2_consignment_no_clear_invoice",
  "c_l3_df1_goods_to_invoice_days", "c_l3_invoice_to_clear_days",
  "c_l3_df2_goods_to_rpb_days", "c_l3_df2_rpb_to_clear_days",
  "c_l4_goods_fragmentation", "c_l4_change_approval_repeats",
  "c_l4_repeated_invoice_receipt", "c_l4_change_payment_terms_repeats",
  "c_l5_cancel_invoice_receipt", "c_l5_cancel_goods_receipt", "c_l5_delete_item",
  "c_l5_debit_memo", "c_l5_credit_memo", "c_l6_change_price", "c_l6_change_quantity",
  "c_l6_high_exposure_memo", "c_l6_high_exposure_price_change",
  "c_l7_manual_touches", "c_l7_distinct_human_resources", "c_l7_total_events",
  "c_l7_manual_share", "c_l6_bal_networth_volatility",
] as const;
export type Bpic19PreparedAttribute = typeof BPIC19_PREPARED_ATTRIBUTES[number];
export type Bpic19PreparedFlow = "DF1" | "DF2" | "two_way" | "Consignment";
export type Bpic19PreparedView = "Finance" | "Logistics" | "Compliance" | "Automation";
export interface Bpic19PreparedContext {
  readonly workspace_id: string;
  readonly source_context_id: string;
  readonly revision: number;
}
export interface Bpic19PreparedProvenance {
  readonly kind: "declared_prepared_measurement";
  readonly declaration_ref: string;
  readonly assessment_row_refs: readonly string[];
  readonly original_row_refs: readonly { readonly source_id: string; readonly row_id: string }[];
}
/** Text permits incomplete edits. The host, not this component, admits numeric input. */
export type Bpic19PreparedDraftCell = {
  readonly unit: string;
  readonly provenance: Bpic19PreparedProvenance;
} & (
  | { readonly state: "available"; readonly value: string; readonly reason: null }
  | { readonly state: "unavailable"; readonly value: null; readonly reason: string }
);
export interface Bpic19PreparedDraftRow {
  readonly assessment_item_id: string;
  readonly assessment_row_ref: string;
  readonly flow: Bpic19PreparedFlow;
  readonly measurements: Readonly<Record<Bpic19PreparedAttribute, Bpic19PreparedDraftCell>>;
}
export interface Bpic19PreparedDraft { readonly rows: readonly Bpic19PreparedDraftRow[] }
export interface Bpic19PreparedReviewIntent {
  readonly kind: "review_declared_measurements";
  readonly context: Bpic19PreparedContext;
  readonly draft: Bpic19PreparedDraft;
}
export interface Bpic19PreparedReviewReceipt {
  readonly context: Bpic19PreparedContext;
  readonly draft: Bpic19PreparedDraft;
  readonly review_id: string;
  readonly input_id: string;
}
export interface Bpic19PreparedRunIntent {
  readonly kind: "run_declared_measurements";
  readonly context: Bpic19PreparedContext;
  readonly review_id: string;
  readonly input_id: string;
  readonly view: Bpic19PreparedView;
}
export type Bpic19PreparedNativeValue = {
  readonly label: string;
  readonly unit: string;
  readonly provenance: string;
  readonly references: readonly string[];
} & (
  | { readonly state: "available"; readonly value: number; readonly reason: null }
  | { readonly state: "unavailable"; readonly value: null; readonly reason: string }
);
export interface Bpic19PreparedNativeScope {
  readonly state: "in_scope" | "out_of_scope" | "unavailable";
  readonly label: string;
  readonly reason: string | null;
}
export interface Bpic19PreparedNativeRun {
  readonly context: Bpic19PreparedContext;
  readonly review_id: string;
  readonly input_id: string;
  readonly run_id: string;
  readonly definition_id: string;
  readonly view: Bpic19PreparedView;
  readonly scope: Bpic19PreparedNativeScope;
  readonly totals: readonly Bpic19PreparedNativeValue[];
  readonly contributions: readonly {
    readonly assessment_item_id: string;
    readonly attribute: Bpic19PreparedAttribute;
    readonly scope: Bpic19PreparedNativeScope;
    readonly measurement: Bpic19PreparedNativeValue;
    readonly contribution: Bpic19PreparedNativeValue;
  }[];
}
export interface Bpic19PreparedRetainIntent {
  readonly kind: "retain_declared_measurements";
  readonly context: Bpic19PreparedContext;
  readonly review_id: string;
  readonly input_id: string;
  readonly run_id: string;
  readonly definition_id: string;
  readonly view: Bpic19PreparedView;
}
export type Bpic19PreparedOutcome<T> =
  | { readonly status: "success"; readonly value: T }
  | { readonly status: "cancelled" }
  | { readonly status: "error"; readonly message: string };
export interface Bpic19PreparedAssessmentProps {
  readonly context: Bpic19PreparedContext;
  readonly input:
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message: string }
    | { readonly status: "ready"; readonly draft: Bpic19PreparedDraft };
  readonly criterionLabels: Readonly<Record<Bpic19PreparedAttribute, string>>;
  readonly nativeRun?: Bpic19PreparedNativeRun | null;
  readonly onDraftChange?: (draft: Bpic19PreparedDraft) => void;
  readonly onReview: (intent: Bpic19PreparedReviewIntent, signal: AbortSignal) => Promise<Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>>;
  readonly onRun: (intent: Bpic19PreparedRunIntent, signal: AbortSignal) => Promise<Bpic19PreparedOutcome<Bpic19PreparedNativeRun>>;
  readonly onRetain?: (intent: Bpic19PreparedRetainIntent) => void;
}

const views: readonly Bpic19PreparedView[] = ["Finance", "Logistics", "Compliance", "Automation"];
const flows: readonly Bpic19PreparedFlow[] = ["DF1", "DF2", "two_way", "Consignment"];
const contextMeaning = (context: Bpic19PreparedContext) => JSON.stringify([
  context.workspace_id, context.source_context_id, context.revision,
]);
// Equality only: object-key order is immaterial; declared row/reference array order matters.
const draftMeaning = (draft: Bpic19PreparedDraft) => JSON.stringify(draft.rows.map(row => [
  row.assessment_item_id, row.assessment_row_ref, row.flow,
  BPIC19_PREPARED_ATTRIBUTES.map(attribute => {
    const cell = row.measurements[attribute], provenance = cell.provenance;
    return [cell.state, cell.value, cell.reason, cell.unit, provenance.kind, provenance.declaration_ref,
      provenance.assessment_row_refs, provenance.original_row_refs.map(ref => [ref.source_id, ref.row_id])];
  }),
]));
const sameContext = (left: Bpic19PreparedContext, right: Bpic19PreparedContext) => contextMeaning(left) === contextMeaning(right);
const matchesRun = (run: Bpic19PreparedNativeRun, receipt: Bpic19PreparedReviewReceipt, view: Bpic19PreparedView) =>
  sameContext(run.context, receipt.context) && run.review_id === receipt.review_id &&
  run.input_id === receipt.input_id && run.view === view && Boolean(run.run_id.trim() && run.definition_id.trim());

function NativeValue({ value }: { value: Bpic19PreparedNativeValue }) {
  return <>
    {value.state === "available" ? <span>{String(value.value)} {value.unit}<small>Available</small></span> :
      <span className="bpic19-measure-unavailable">Unavailable: {value.reason}<small>Unit: {value.unit}</small></span>}
    <small>Supplied provenance: {value.provenance}</small>
    <small>Supplied references: {value.references.join(", ") || "None supplied"}</small>
  </>;
}
function NativeScope({ scope }: { scope: Bpic19PreparedNativeScope }) {
  return <>{scope.label} · {scope.state.replaceAll("_", " ")}{scope.reason && <small>{scope.reason}</small>}</>;
}

/** Presentation only. Every review identity and every analytical value is supplied by the host. */
export function Bpic19PreparedAssessment(props: Bpic19PreparedAssessmentProps) {
  const heading = useId();
  const sessionKey = JSON.stringify([contextMeaning(props.context), props.input.status,
    props.input.status === "ready" ? draftMeaning(props.input.draft) : null]);
  // Also fences callbacks between render and effect cleanup when the host changes context.
  const activeSession = useRef(sessionKey); activeSession.current = sessionKey;
  return <section className="bpic19-scoring bpic19-measures" aria-labelledby={heading}>
    <h2 id={heading}>Declared measurement assessment</h2>
    <p>Prepared attributes declared per assessment item. These rows are not raw records or event histories.</p>
    <p className="bpic19-muted">Workspace: <code>{props.context.workspace_id}</code> · Source context: <code>{props.context.source_context_id}</code> · Revision: {props.context.revision}</p>
    {props.input.status === "loading" ? <p role="status">Loading declared measurement draft…</p> :
      props.input.status === "error" ? <p role="alert">Declared draft unavailable: {props.input.message}. Supply a draft to continue.</p> :
        <AssessmentSession key={sessionKey} {...props} initialDraft={props.input.draft}
          isActive={() => activeSession.current === sessionKey} />}
  </section>;
}

function AssessmentSession({ context, initialDraft, criterionLabels, nativeRun, onDraftChange, onReview, onRun, onRetain, isActive }:
  Bpic19PreparedAssessmentProps & { initialDraft: Bpic19PreparedDraft; isActive: () => boolean }) {
  const [draft, setDraft] = useState(initialDraft);
  const [selectedItem, setSelectedItem] = useState(initialDraft.rows[0]?.assessment_item_id ?? "");
  const [view, setView] = useState<Bpic19PreparedView>("Finance");
  const [receipt, setReceipt] = useState<Bpic19PreparedReviewReceipt | null>(null);
  const [lastRun, setLastRun] = useState<Bpic19PreparedNativeRun | null>(null);
  const [pending, setPending] = useState<"review" | "run" | null>(null);
  const [message, setMessage] = useState("Review required before running or retaining an assessment.");
  const [problem, setProblem] = useState<string | null>(null);
  const serial = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { ++serial.current; controller.current?.abort(); }, []);
  const currentRow = draft.rows.find(row => row.assessment_item_id === selectedItem);
  const dirty = draftMeaning(draft) !== draftMeaning(initialDraft);
  const currentReceipt = receipt && sameContext(receipt.context, context) && draftMeaning(receipt.draft) === draftMeaning(draft) ? receipt : null;

  function stop() { ++serial.current; controller.current?.abort(); setPending(null); }
  function change(next: Bpic19PreparedDraft) {
    if (draftMeaning(next) === draftMeaning(draft)) return;
    stop(); setReceipt(null); setProblem(null); setDraft(next);
    setMessage("Draft changed. Review required before running or retaining an assessment.");
    onDraftChange?.(next);
  }
  function changeRow(next: Bpic19PreparedDraftRow) {
    change({ rows: draft.rows.map(row => row.assessment_item_id === next.assessment_item_id ? next : row) });
  }
  function changeCell(attribute: Bpic19PreparedAttribute, cell: Bpic19PreparedDraftCell) {
    if (currentRow) changeRow({ ...currentRow, measurements: { ...currentRow.measurements, [attribute]: cell } });
  }
  function cancel() {
    stop(); setReceipt(null); setProblem(null);
    setMessage("Request cancelled. Review required before running or retaining an assessment.");
  }
  function selectView(next: Bpic19PreparedView) {
    if (next === view) return;
    // Views change the execution request, not the reviewed input. A pending review
    // may finish; a pending run for the former view must never publish here.
    if (pending === "run") { stop(); setProblem(null); setMessage("Run cancelled after view change. Choose Run for the selected view."); }
    setView(next);
  }
  function begin(kind: "review" | "run") {
    stop(); const abort = new AbortController(); controller.current = abort;
    const token = serial.current; setPending(kind); setProblem(null);
    setMessage(kind === "review" ? "Review pending. Waiting for an authoritative receipt…" : `Native ${view} assessment pending…`);
    return { abort, current: () => token === serial.current && !abort.signal.aborted && isActive() };
  }
  async function review() {
    if (pending || !draft.rows.length) return;
    setReceipt(null);
    const request = begin("review");
    let outcome: Bpic19PreparedOutcome<Bpic19PreparedReviewReceipt>;
    try { outcome = await onReview({ kind: "review_declared_measurements", context, draft }, request.abort.signal); }
    catch { outcome = { status: "error", message: "Review failed. Request Review again when it is available." }; }
    if (!request.current()) return;
    setPending(null);
    if (outcome.status === "cancelled") { setMessage("Review cancelled. Review required before running or retaining an assessment."); return; }
    if (outcome.status === "error") { setMessage("Review required before running or retaining an assessment."); setProblem(outcome.message); return; }
    const supplied = outcome.value;
    if (!sameContext(supplied.context, context) || draftMeaning(supplied.draft) !== draftMeaning(draft) || !supplied.input_id.trim() || !supplied.review_id.trim()) {
      setMessage("Review required before running or retaining an assessment.");
      setProblem("The supplied review does not match this draft and context or lacks its authoritative identity. Request Review again."); return;
    }
    setReceipt(supplied); setMessage("Authoritative review received. Choose a view and request Run.");
  }
  async function run() {
    if (!currentReceipt || pending) return;
    const intent: Bpic19PreparedRunIntent = { kind: "run_declared_measurements", context,
      review_id: currentReceipt.review_id, input_id: currentReceipt.input_id, view };
    const request = begin("run");
    let outcome: Bpic19PreparedOutcome<Bpic19PreparedNativeRun>;
    try { outcome = await onRun(intent, request.abort.signal); }
    catch { outcome = { status: "error", message: "Native assessment failed. Retry Run or request a new Review." }; }
    if (!request.current()) return;
    setPending(null);
    if (outcome.status === "cancelled") { setMessage("Native run cancelled. Request Run to try the selected view again."); return; }
    if (outcome.status === "error") { setProblem(outcome.message); setMessage("Native run failed. Retry Run or request Review again."); return; }
    if (!matchesRun(outcome.value, currentReceipt, view)) {
      setProblem("The supplied native result belongs to another review, input, context or view. Request Run again.");
      setMessage("No current native result was received."); return;
    }
    setLastRun(outcome.value); setMessage("Native result received for the exact reviewed input.");
  }

  const shownRuns = [nativeRun, lastRun].filter((value): value is Bpic19PreparedNativeRun => Boolean(value))
    .filter((value, index, all) => all.findIndex(other => other.run_id === value.run_id &&
      other.input_id === value.input_id && other.review_id === value.review_id && sameContext(other.context, value.context)) === index);
  return <>
    {!draft.rows.length ? <p role="status">No declared assessment items supplied. Supply a prepared draft before Review.</p> : <>
      <div className="bpic19-controls">
        <label>Declared assessment item<select value={selectedItem} onChange={event => setSelectedItem(event.target.value)}>
          {draft.rows.map(row => <option key={row.assessment_item_id} value={row.assessment_item_id}>{row.assessment_item_id}</option>)}
        </select></label>
        {currentRow && <label>Declared flow<select value={currentRow.flow} onChange={event => changeRow({ ...currentRow, flow: event.target.value as Bpic19PreparedFlow })}>
          {flows.map(flow => <option key={flow} value={flow}>{flow}</option>)}
        </select></label>}
      </div>
      {currentRow && <>
        <p>Declared assessment reference: <code>{currentRow.assessment_row_ref}</code> · Flow: {currentRow.flow}</p>
        <p className="bpic19-muted">29 declared cells. Availability and flow scope are separate; native results supply scope. Units follow the supplied binding.</p>
        <div className="bpic19-measures-scroll" role="region" aria-label="Declared measurement grid" tabIndex={0}>
          <table><caption>Declared prepared attributes for {currentRow.assessment_item_id}</caption>
            <thead><tr><th scope="col">Exact criterion / attribute</th><th scope="col">Declared availability</th><th scope="col">Value or reason</th><th scope="col">Unit</th><th scope="col">Declared provenance and references</th></tr></thead>
            <tbody>{BPIC19_PREPARED_ATTRIBUTES.map(attribute => {
              const cell = currentRow.measurements[attribute];
              const provenance = cell.provenance;
              const updateProvenance = (next: Bpic19PreparedProvenance) => changeCell(attribute, { ...cell, provenance: next });
              return <tr key={`${currentRow.assessment_item_id}:${attribute}`}>
                <th scope="row">{criterionLabels[attribute]} <small><code>{attribute}</code></small></th>
                <td><label><span className="bpic19-muted">Availability</span><select aria-label={`Availability for ${attribute}`} value={cell.state}
                  onChange={event => changeCell(attribute, event.target.value === "available" ? { ...cell, state: "available", value: "", reason: null } : { ...cell, state: "unavailable", value: null, reason: "" })}>
                  <option value="available">Available</option><option value="unavailable">Unavailable</option>
                </select></label></td>
                <td>{cell.state === "available" ? <label>Numeric value<input type="text" inputMode="decimal" aria-label={`Value for ${attribute}`} value={cell.value}
                  onChange={event => changeCell(attribute, { ...cell, value: event.target.value })} />
                  <small>{cell.value.trim() ? `Declared value: ${cell.value}` : "Numeric draft incomplete — Review required"}</small></label> :
                  <label>Unavailable reason<input type="text" aria-label={`Unavailable reason for ${attribute}`} value={cell.reason}
                    onChange={event => changeCell(attribute, { ...cell, reason: event.target.value })} />
                    <small className="bpic19-measure-unavailable">Unavailable: {cell.reason || "Declare a reason before Review"}</small></label>}</td>
                <td>{cell.unit}</td>
                <td><span>{provenance.declaration_ref || "Declaration reference not entered"}</span>
                  <small>Assessment references: {provenance.assessment_row_refs.join(", ") || "None declared"}</small>
                  <small>Unverified original-reference declarations: {provenance.original_row_refs.length || "None declared"}</small>
                  <details className="bpic19-measure-case"><summary onKeyDown={event => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    const details = event.currentTarget.closest("details");
                    if (details) details.open = !details.open;
                  }}>Declared measurement evidence details for {attribute}</summary>
                    <p>Provenance kind: <code>{provenance.kind}</code>. Declarations do not establish raw history qualification.</p>
                    <label>Declaration reference<input aria-label={`Declaration reference for ${attribute}`} value={provenance.declaration_ref}
                      onChange={event => updateProvenance({ ...provenance, declaration_ref: event.target.value })} /></label>
                    <label>Assessment row references (one per line)<textarea aria-label={`Assessment row references for ${attribute}`}
                      value={provenance.assessment_row_refs.join("\n")} onChange={event => updateProvenance({ ...provenance, assessment_row_refs: event.target.value.split("\n") })} /></label>
                    <fieldset><legend>Unverified original-reference declarations</legend>
                      <p>Separate from assessment references. These declarations assert neither source presence nor a verified raw witness.</p>
                      {!provenance.original_row_refs.length && <p>No original references declared.</p>}
                      {provenance.original_row_refs.map((reference, index) => <fieldset key={index}>
                        <legend>Unverified original reference {index + 1}</legend>
                        <label>Declared source identity<input aria-label={`Unverified source ${index + 1} for ${attribute}`} value={reference.source_id}
                          onChange={event => updateProvenance({ ...provenance, original_row_refs: provenance.original_row_refs.map((ref, i) => i === index ? { ...ref, source_id: event.target.value } : ref) })} /></label>
                        <label>Declared original row identity<input aria-label={`Unverified original row ${index + 1} for ${attribute}`} value={reference.row_id}
                          onChange={event => updateProvenance({ ...provenance, original_row_refs: provenance.original_row_refs.map((ref, i) => i === index ? { ...ref, row_id: event.target.value } : ref) })} /></label>
                        <button type="button" onClick={() => updateProvenance({ ...provenance, original_row_refs: provenance.original_row_refs.filter((_, i) => i !== index) })}>Remove unverified original reference {index + 1} for {attribute}</button>
                      </fieldset>)}
                      <button type="button" onClick={() => updateProvenance({ ...provenance, original_row_refs: [...provenance.original_row_refs, { source_id: "", row_id: "" }] })}>Add unverified original reference for {attribute}</button>
                    </fieldset>
                  </details>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </>}
    <p className="bpic19-muted">{dirty ? "Draft differs from the supplied input." : "Draft matches the supplied input."} Every meaning-bearing change requires a new Review, including a reverted edit.</p>
    <div className="bpic19-controls">
      <button type="button" disabled={Boolean(pending) || !draft.rows.length} onClick={() => void review()}>Review declared measurements</button>
      <label>Assessment view<select value={view} onChange={event => selectView(event.target.value as Bpic19PreparedView)}>
        {views.map(option => <option key={option} value={option}>{option}</option>)}
      </select></label>
      <button type="button" disabled={!currentReceipt || Boolean(pending)} onClick={() => void run()}>Run {view} assessment</button>
      {pending && <button type="button" onClick={cancel}>Cancel {pending === "review" ? "review" : "native run"}</button>}
    </div>
    <p role="status" aria-live="polite">{message}</p>
    {problem && <p role="alert">{problem}</p>}
    {currentReceipt && <p>Authoritative review: <code>{currentReceipt.review_id}</code> · Reviewed input: <code>{currentReceipt.input_id}</code></p>}
    {!shownRuns.length && <p>No native result supplied yet. Review the draft and request Run for a selected view.</p>}
    {shownRuns.map((result, index) => {
      const current = Boolean(currentReceipt && matchesRun(result, currentReceipt, view) && !pending && !problem);
      return <section key={index} aria-label={`Supplied native run ${result.run_id}`} data-stale={!current}>
        <h3>{current ? "Current supplied native result" : "Retained/stale supplied native result"} · {result.view}</h3>
        {!current && <p>Execution and retain authority paused for this result. A matching current review, input, context and view are required.</p>}
        <p>Run: <code>{result.run_id}</code> · Definition: <code>{result.definition_id}</code> · Input: <code>{result.input_id}</code> · Review: <code>{result.review_id}</code></p>
        <p>Result workspace: <code>{result.context.workspace_id}</code> · Source context: <code>{result.context.source_context_id}</code> · Revision: {result.context.revision}</p>
        <p>Supplied scope: <NativeScope scope={result.scope} /></p>
        <h4>Supplied native totals</h4>
        {!result.totals.length ? <p>No native totals supplied.</p> : <dl>{result.totals.map((value, i) => <div key={i}><dt>{value.label}</dt><dd><NativeValue value={value} /></dd></div>)}</dl>}
        <div className="bpic19-measures-scroll" role="region" aria-label={`Native contributions for ${result.run_id}`} tabIndex={0}>
          <table><caption>Supplied native contributions · {result.run_id}</caption>
            <thead><tr><th scope="col">Declared item / criterion</th><th scope="col">Supplied scope</th><th scope="col">Supplied measurement</th><th scope="col">Supplied contribution</th></tr></thead>
            <tbody>{result.contributions.map((contribution, i) => <tr key={i}>
              <th scope="row">{contribution.assessment_item_id} · {criterionLabels[contribution.attribute]} <small><code>{contribution.attribute}</code></small></th>
              <td><NativeScope scope={contribution.scope} /></td>
              <td><small>{contribution.measurement.label}</small><NativeValue value={contribution.measurement} /></td>
              <td><small>{contribution.contribution.label}</small><NativeValue value={contribution.contribution} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!result.contributions.length && <p>No native contributions supplied.</p>}
        {onRetain ? <button type="button" disabled={!current} onClick={() => {
          if (!current) return;
          onRetain({ kind: "retain_declared_measurements", context, review_id: result.review_id,
            input_id: result.input_id, run_id: result.run_id, definition_id: result.definition_id, view: result.view });
          setMessage("Retain intent emitted for the matching native run. Persistence is handled by the host.");
        }}>Request retain of {result.run_id}</button> : <p>Retain action unavailable: no retain handler supplied.</p>}
      </section>;
    })}
  </>;
}
