import { useEffect, useId, useRef, useState } from "react";
import type { AnswerIdentity, Bpic19MeasuresAnswer, CaseFeatures, MeasureQuery, MeasureRoles, Milestone, RawMeasure, RepresentationGroup } from "../generated/bpic19-measures";
import { answersBpic19Measures, httpBpic19MeasuresClient, type Bpic19MeasuresClient, type Bpic19MeasuresOutcome } from "./measures-client";
import "./measures.css";

const policy = "bpic19.source_witnessed_measures.v1";
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });
const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 });
const names: Record<string, string> = {
  selected_activity: "Reviewed activity measure", selected_interval: "Reviewed milestone interval", selected_value: "Reviewed item value",
  invoice_count: "Invoice receipt occurrences", clearing_count: "Clearing occurrences", receipt_count: "Goods receipt or service entry occurrences",
  cancellation_count: "Invoice cancellations", edit_count: "Price or quantity changes", invoice_to_clearing_days: "Earliest invoice to earliest clearing",
  invoice_precedes_receipt: "Earliest invoice before earliest receipt", user_event_count: "User-attributed events", distinct_user_count: "Distinct normalized user identities",
  creation_value: "Unique finite creation value", exposure: "Corrected maximum absolute event value", historical_invoice_count: "Historical invoice union: receipt or vendor invoice",
  invoice_plus_subsequent_count: "Receipt or subsequent invoice occurrences", historical_invoice_precedes_receipt: "Historical invoice before receipt",
  historical_release_precedes_receipt: "Historical release before receipt", historical_goods_to_invoice_days: "Historical receipt to invoice",
  historical_invoice_to_clear_days: "Historical invoice to clearing", historical_goods_to_release_days: "Historical receipt to release",
  historical_release_to_clear_days: "Historical release to clearing", historical_manual_touch_count: "Historical human touches",
  historical_distinct_human_resources: "Historical distinct raw human labels", historical_manual_share: "Historical human event share",
  historical_networth_cv: "Historical net worth coefficient of variation", exposure_abs_max: "Historical maximum absolute value",
  exposure_norm: "Historical value divided by frozen P95", historical_memo_exposure: "Historical memo indicator × normalized value",
  historical_price_exposure: "Historical price change indicator × normalized value", event_replication_ratio: "Events per distinct parsed time",
};
const display = (value: number | null) => value === null ? "unavailable" : number.format(value);
const reason = (value: string | null | undefined) => value?.replaceAll("_", " ") ?? "not recorded";
const name = (key: string) => names[key] ?? reason(key);
const rows = (ids: string[]) => ids.length ? ids.join(", ") : "none";
const raw = (value: string | null) => value === null ? "No bound source cell" : JSON.stringify(value);
const selector = (text: string) => text.split("\n").filter(label => label.length > 0);

function defaults(roles: MeasureRoles): MeasureQuery {
  return { policy_id: policy, measure_profile: "paper_v1", roles, offset: 0, limit: 20, calibration_population: "parent",
    activity_selector: ["Record Invoice Receipt"], activity_operator: "count", interval_source: ["Record Invoice Receipt"], interval_target: ["Clear Invoice"],
    interval_policy: "independent_minimum", value_reducer: "unique_creation_value", representation_policy: "first_occurrence", value_unit: "source_units", value_band_edges: [] };
}
function normalized(query: MeasureQuery, roles: MeasureRoles): MeasureQuery { return { ...defaults(roles), ...query }; }
function meaning(query: MeasureQuery, roles: MeasureRoles) {
  const { offset: _offset, limit: _limit, ...definition } = normalized(query, roles);
  return JSON.stringify(definition);
}

export interface Bpic19MeasuresProps {
  workspaceId: string;
  identity: AnswerIdentity;
  revision: number;
  roles: MeasureRoles;
  columns?: { index: number; name: string }[];
  query?: MeasureQuery;
  client?: Bpic19MeasuresClient;
  onInspect: (caseId: string, rowIds?: string[]) => void;
  onKeepCases?: (caseIds: string[], label: string) => void;
  onReviewed?: (answer: Bpic19MeasuresAnswer) => void;
  onRetain?: (answer: Bpic19MeasuresAnswer) => void;
  retainedQueries?: readonly { definition_id: string; label: string; query: MeasureQuery }[];
  onValidityChange?: (current: boolean) => void;
}

function MeasureEvidence({ measure }: { measure: RawMeasure }) {
  return <><strong>{display(measure.value)}</strong>{measure.unit && <> {reason(measure.unit)}</>}
    {!measure.available && <span className="bpic19-measure-unavailable"> · {reason(measure.reason)}</span>}
    {measure.lower_bound !== undefined && <small>Known matching lower bound: {number.format(measure.lower_bound)} · unknown labels: {number.format(measure.unknown_label_count ?? 0)}</small>}
    <small>Witness records: {rows(measure.row_ids)}</small>
    {!!measure.absence_row_ids?.length && <small>Recorded absence checked against all records: {rows(measure.absence_row_ids)}</small>}
    {measure.recorded_difference_days !== undefined && <small>Signed diagnostic: {display(measure.recorded_difference_days)} days</small>}
    {measure.activation_timestamp && <small>Activation: {measure.activation_timestamp}</small>}
    {measure.response_timestamp && <small>Response: {measure.response_timestamp}</small>}
    {measure.candidate_count !== undefined && <small>Candidate records: {number.format(measure.candidate_count)} · winners: {rows(measure.winner_row_ids ?? [])}</small>}
    {measure.first_candidate_row_id && <small>First original creation: {measure.first_candidate_row_id} · source position {measure.first_candidate_source_position == null ? "unavailable" : number.format(measure.first_candidate_source_position)} (zero based), independent of timestamp or display order.</small>}
    {!!measure.invalid_row_ids?.length && <small>Unresolved records: {rows(measure.invalid_row_ids)}</small>}
    {!!measure.missing_fill_row_ids?.length && <small>Historical missing-to-zero records: {rows(measure.missing_fill_row_ids)}</small>}
  </>;
}

function Endpoint({ label, endpoint, disabled, inspect }: { label: string; endpoint: Milestone; disabled: boolean; inspect: (ids: string[]) => void }) {
  return <tr><th scope="row">{label}</th><td>{endpoint.timestamp ?? "unavailable"}<small>{reason(endpoint.endpoint_state)}{endpoint.reason && ` · ${reason(endpoint.reason)}`}</small></td>
    <td>Co-minimum records: {rows(endpoint.row_ids)}<small>Display representative: {endpoint.selected_row_id ?? "none"}</small>
      <small>Later parsed candidates: {rows(endpoint.later_row_ids)}</small><small>Unparseable candidates: {rows(endpoint.unparseable_row_ids)}</small>
      {!!endpoint.unknown_activity_row_ids.length && <small>Unknown activity records: {rows(endpoint.unknown_activity_row_ids)}</small>}
      <button type="button" disabled={disabled || !endpoint.candidate_row_ids.length} onClick={() => inspect(endpoint.candidate_row_ids)}>Inspect {label.toLowerCase()} candidates</button></td></tr>;
}

function RepresentationSupport({ representation, groups, reviewed, disabled, onInspect, onKeepCases }: {
  representation: "exact" | "first_occurrence"; groups: RepresentationGroup[]; reviewed: boolean; disabled: boolean;
  onInspect: Bpic19MeasuresProps["onInspect"]; onKeepCases: Bpic19MeasuresProps["onKeepCases"];
}) {
  const [offset, setOffset] = useState(0);
  const label = representation === "exact" ? "Exact variant" : "First-occurrence signature";
  return <div><h4>{representation === "exact" ? "Exact baseline" : "First-occurrence signature"}</h4><p>{number.format(groups.length)} groups · {reviewed ? "reviewed representation" : "comparison representation"}</p>
    <div className="bpic19-measures-scroll"><table className="plain-table"><caption>{label} support</caption><thead><tr><th>Recorded path</th><th>PO items</th><th>Original records</th><th>Full-history actions</th></tr></thead><tbody>{groups.slice(offset, offset + 20).map(group => <tr key={group.group_id}><th scope="row">{group.sequence.join(" → ")}</th><td>{number.format(group.case_count)}</td><td>{number.format(group.record_count)}</td><td>{onKeepCases && <button type="button" disabled={disabled || !group.case_count} onClick={() => onKeepCases(group.case_ids, `${representation === "exact" ? "Exact" : "First occurrence"}: ${group.sequence.join(" → ")}`)}>Keep group</button>}{group.case_ids[0] && <button type="button" disabled={disabled} onClick={() => onInspect(group.case_ids[0])}>Inspect member {group.case_ids[0]}</button>}</td></tr>)}</tbody></table></div>
    {groups.length > 20 && <div className="bpic19-measures-controls"><p>Showing {number.format(offset + 1)}–{number.format(Math.min(offset + 20, groups.length))} of {number.format(groups.length)} supplied groups.</p><button type="button" disabled={offset === 0} onClick={() => setOffset(current => Math.max(0, current - 20))}>Previous {label.toLowerCase()} groups</button><button type="button" disabled={offset + 20 >= groups.length} onClick={() => setOffset(current => current + 20)}>Next {label.toLowerCase()} groups</button></div>}
  </div>;
}

function ItemEvidence({ feature, disabled, onInspect, onKeepCases }: { feature: CaseFeatures; disabled: boolean; onInspect: Bpic19MeasuresProps["onInspect"]; onKeepCases: Bpic19MeasuresProps["onKeepCases"] }) {
  const [open, setOpen] = useState(false);
  const inspect = (ids: string[]) => onInspect(feature.case_id, ids);
  const actors = feature.actor_summary;
  return <details className="bpic19-measure-case" onToggle={event => setOpen(event.currentTarget.open)}><summary>Item {feature.case_id} · {feature.flow ?? "unresolved flow"} · {number.format(feature.record_count)} records</summary>
    {open && <>
      <button type="button" disabled={disabled} onClick={() => onInspect(feature.case_id, feature.record_row_ids)}>Inspect complete history of {feature.case_id}</button>
      {onKeepCases && <button type="button" disabled={disabled} onClick={() => onKeepCases([feature.case_id], `Reviewed evidence: ${feature.case_id}`)}>Keep complete item {feature.case_id}</button>}
      <p>Document {feature.document ?? "unavailable"} · Company {feature.company ?? "unavailable"} · Spend area {feature.spend_area ?? "unavailable"}</p>
      <h4>Exact activities and known absence</h4>
      <p>Known matches {number.format(feature.activity_measure.lower_bound)} · unknown activity records {number.format(feature.activity_measure.unknown_label_count)}. A lower bound is separate from an exact quantity.</p>
      <div className="bpic19-measures-scroll"><table className="plain-table"><caption>Item {feature.case_id} activity operators</caption><thead><tr><th>Operator</th><th>Value and evidence</th><th>Full-history action</th></tr></thead><tbody>
        {(["count", "presence", "repeat_quantity", "repeated_presence"] as const).map(operator => {
          const measure = feature.activity_measure[operator];
          return <tr key={operator}><th scope="row">{reason(operator)}</th><td><MeasureEvidence measure={measure} /></td><td><button type="button" disabled={disabled} onClick={() => inspect(measure.absence_row_ids?.length ? measure.absence_row_ids : [...measure.row_ids, ...(measure.unknown_row_ids ?? [])])}>Inspect {reason(operator)} evidence</button></td></tr>;
        })}
      </tbody></table></div>
      <h4>Independent endpoint minima</h4>
      <p>All co-minimum records remain witnesses. The representative is a display choice; ties do not establish causal order.</p>
      <div className="bpic19-measures-scroll"><table className="plain-table"><caption>Item {feature.case_id} reviewed interval endpoints</caption><thead><tr><th>Endpoint</th><th>Selected minimum and admission</th><th>Original records</th></tr></thead><tbody>
        <Endpoint label="Source" endpoint={feature.milestones.source} disabled={disabled} inspect={inspect} /><Endpoint label="Target" endpoint={feature.milestones.target} disabled={disabled} inspect={inspect} />
      </tbody></table></div>
      <h4>Every recorded actor</h4>
      <p>{number.format(actors.known_user_event_count)} known user events · {number.format(actors.distinct_normalized_user_count)} distinct normalized users · {number.format(actors.batch_event_count)} batch events · {number.format(actors.unknown_event_count)} unknown of {number.format(actors.event_count)} records. Full effort: {actors.available ? "available" : `unavailable · ${reason(actors.reason)}`}.</p>
      <p>Batch / all records: {display(actors.batch_all_share)} (denominator {number.format(actors.batch_all_denominator)}). Batch / known human events: {display(actors.batch_human_ratio)} (denominator {number.format(actors.batch_human_denominator)}). These have different denominators. User breadth is separate from handoff transitions.</p>
      <div className="bpic19-measures-scroll"><table className="plain-table"><caption>Item {feature.case_id} original actor identities</caption><thead><tr><th>Original record</th><th>Original cell (quoted)</th><th>Normalized identity</th><th>Classification</th><th>Full-history action</th></tr></thead><tbody>
        {feature.actor_records.map(actor => <tr key={actor.row_id}><th scope="row">{actor.row_id}</th><td><code>{raw(actor.raw)}</code></td><td>{actor.normalized === null ? "unavailable" : JSON.stringify(actor.normalized)}</td><td>{actor.classification}</td><td><button type="button" disabled={disabled} onClick={() => inspect([actor.row_id])}>Inspect actor record {actor.row_id}</button></td></tr>)}
      </tbody></table></div>
      <h4>Original amount cells</h4>
      <p>Repeated cumulative values are retained. These reducers do not establish spend, labour cost or savings.</p>
      <div className="bpic19-measures-scroll"><table className="plain-table"><caption>Item {feature.case_id} original amount values</caption><thead><tr><th>Original record</th><th>Original cell (quoted)</th><th>Parsed finite value</th><th>State</th><th>Full-history action</th></tr></thead><tbody>
        {feature.amount_records.map(amount => <tr key={amount.row_id}><th scope="row">{amount.row_id}</th><td><code>{raw(amount.raw)}</code></td><td>{display(amount.value)}</td><td>{reason(amount.state)}</td><td><button type="button" disabled={disabled} onClick={() => inspect([amount.row_id])}>Inspect amount record {amount.row_id}</button></td></tr>)}
      </tbody></table></div>
      <h4>Exact sequence and first-occurrence signature</h4>
      <dl><dt>Exact sequence</dt><dd>{feature.representations.exact_sequence?.join(" → ") ?? `Unavailable: ${reason(feature.representations.reason)}`}</dd>
        <dt>First-occurrence signature</dt><dd>{feature.representations.first_occurrence_signature?.join(" → ") ?? `Unavailable: ${reason(feature.representations.reason)}`}</dd>
        <dt>Retained first occurrences</dt><dd>{rows(feature.representations.signature_retained_row_ids)}</dd><dt>Suppressed later occurrences</dt><dd>{rows(feature.representations.signature_suppressed_row_ids)}</dd></dl>
      <button type="button" disabled={disabled || !feature.representations.signature_suppressed_row_ids.length} onClick={() => inspect(feature.representations.signature_suppressed_row_ids)}>Inspect suppressed occurrences of {feature.case_id}</button>
      <small>Exact identity: {feature.representations.exact_representation_id}</small><small>Signature identity: {feature.representations.signature_representation_id}</small>
      <h4>Raw measures and witness receipt</h4>
      <div className="bpic19-measures-scroll"><table className="plain-table"><caption>Item {feature.case_id} raw values and record witnesses</caption><thead><tr><th>Measure</th><th>Value and availability</th><th>Full-history action</th></tr></thead><tbody>
        {Object.entries({ ...feature.measures, ...feature.historical_measures }).map(([key, measure]) => <tr key={key}><th scope="row">{name(key)}</th><td><MeasureEvidence measure={measure} /></td><td><button type="button" disabled={disabled} onClick={() => inspect([...new Set([...measure.row_ids, ...(measure.invalid_row_ids ?? [])])])}>Inspect {name(key).toLowerCase()}</button>
          {measure.first_candidate_row_id && <button type="button" disabled={disabled} onClick={() => inspect([measure.first_candidate_row_id!])}>Inspect selected first creation of {feature.case_id}</button>}</td></tr>)}
      </tbody></table></div>
    </>}
  </details>;
}

/** The service owns membership, measurement, classification and lineage. Drafts only describe requested definitions. */
export function Bpic19Measures({ workspaceId, identity, revision, roles, columns, query, client = httpBpic19MeasuresClient, onInspect, onKeepCases, onReviewed, onRetain, retainedQueries, onValidityChange }: Bpic19MeasuresProps) {
  const heading = useId();
  const [answer, setAnswer] = useState<Bpic19MeasuresAnswer | null>(null);
  const [draft, setDraft] = useState<MeasureQuery>(() => normalized(query ?? defaults(roles), roles));
  const [bandText, setBandText] = useState(query?.value_band_edges?.join(", ") ?? "");
  const [selectorText, setSelectorText] = useState(() => ({ activity: draft.activity_selector?.join("\n") ?? "", source: draft.interval_source?.join("\n") ?? "", target: draft.interval_target?.join("\n") ?? "" }));
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [cancelled, setCancelled] = useState(false);
  const [retainedDefinition, setRetainedDefinition] = useState("");
  const serial = useRef(0), controller = useRef<AbortController | null>(null), retry = useRef<MeasureQuery | null>(null);
  const callbacks = useRef({ onReviewed, onValidityChange }); callbacks.current = { onReviewed, onValidityChange };
  const identityKey = JSON.stringify(identity), rolesKey = JSON.stringify(roles), queryKey = JSON.stringify(query ?? null);

  async function load(next: MeasureQuery) {
    const token = ++serial.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    retry.current = next; setBusy(true); setProblem(null); setCancelled(false); callbacks.current.onValidityChange?.(false);
    const request = { schema_version: 1 as const, message_type: "bpic19_measures_request" as const, request_id: `bpic19-measures-${revision}-${token}`,
      query_revision: revision, workspace_id: workspaceId, identity, query: next };
    let outcome: Bpic19MeasuresOutcome;
    try { outcome = await client.measures(request, abort.signal); }
    catch { outcome = { ok: false, problem: { kind: "unreachable" } }; }
    if (token !== serial.current || abort.signal.aborted) return;
    setBusy(false);
    if (!outcome.ok) {
      setProblem(outcome.problem.kind === "refusal" ? `${outcome.problem.refusal.message} (${outcome.problem.refusal.code}${outcome.problem.refusal.field ? ` · ${outcome.problem.refusal.field}` : ""})`
        : outcome.problem.kind === "unreachable" ? "The local service could not be reached. Retry the measures." : outcome.problem.detail);
      return;
    }
    if (!answersBpic19Measures(request, outcome.answer)) { setProblem("The reply belongs to a different source, population or reviewed definition."); return; }
    setAnswer(outcome.answer);
    if (outcome.answer.roles_proposed_from_headers) setDraft(current => ({ ...current, roles: outcome.answer.definition.roles }));
    else callbacks.current.onReviewed?.(outcome.answer);
  }
  useEffect(() => {
    const next = normalized(query ?? defaults(roles), roles);
    setAnswer(null); setDraft(next); setBandText(next.value_band_edges?.join(", ") ?? ""); setSelectorText({ activity: next.activity_selector?.join("\n") ?? "", source: next.interval_source?.join("\n") ?? "", target: next.interval_target?.join("\n") ?? "" }); setCancelled(false);
    // A saved wire declaration remains exact; defaults belong to the editing form.
    void load(query ?? next);
    return () => { ++serial.current; controller.current?.abort(); callbacks.current.onValidityChange?.(false); };
    // Every source, population, recipe and revision change fences successes, errors and pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, identityKey, rolesKey, revision, queryKey, client]);

  const bandEdges = bandText.trim() === "" ? [] : bandText.split(",").map(value => value.trim() === "" ? NaN : Number(value));
  const validBands = bandEdges.length <= 100 && bandEdges.every((value, index) => Number.isFinite(value) && (index === 0 || bandEdges[index - 1] < value));
  const validSelectors = [draft.activity_selector, draft.interval_source, draft.interval_target].every(labels => labels && labels.length > 0 && labels.length <= 100);
  const dirty = answer !== null && (meaning(draft, roles) !== meaning(answer.query, roles) || !validBands);
  const paused = busy || !!problem || cancelled || dirty || !!answer?.roles_proposed_from_headers;
  useEffect(() => { callbacks.current.onValidityChange?.(answer !== null && !paused); }, [answer, paused, draft]);
  function edit(update: Partial<MeasureQuery>) {
    ++serial.current; controller.current?.abort(); setBusy(false); setProblem(null); setCancelled(false);
    setDraft(current => ({ ...current, ...update, offset: 0 })); callbacks.current.onValidityChange?.(false);
  }
  function editRole(role: "resource" | "value", value: string) {
    const column = value === "" ? null : Number(value);
    edit({ roles: role === "value" ? { ...draft.roles, value: column, net_worth: column } : { ...draft.roles, resource: column } });
  }
  function editSelector(field: "activity" | "source" | "target", value: string) {
    setSelectorText(current => ({ ...current, [field]: value }));
    edit({ [field === "activity" ? "activity_selector" : field === "source" ? "interval_source" : "interval_target"]: selector(value) });
  }
  function cancel() { ++serial.current; controller.current?.abort(); setBusy(false); setCancelled(true); callbacks.current.onValidityChange?.(false); }
  function restore() {
    if (!answer) return;
    const prior = normalized(answer.query, roles);
    ++serial.current; controller.current?.abort(); setBusy(false); setDraft(prior); setBandText(prior.value_band_edges?.join(", ") ?? ""); setSelectorText({ activity: prior.activity_selector?.join("\n") ?? "", source: prior.interval_source?.join("\n") ?? "", target: prior.interval_target?.join("\n") ?? "" }); setProblem(null); setCancelled(false);
    if (!answer.roles_proposed_from_headers) callbacks.current.onReviewed?.(answer);
  }
  function readRetained() {
    const retained = retainedQueries?.find(item => item.definition_id === retainedDefinition);
    if (!retained) return;
    const next = normalized({ ...retained.query, offset: 0 }, roles);
    setDraft(next); setBandText(next.value_band_edges?.join(", ") ?? "");
    setSelectorText({ activity: next.activity_selector?.join("\n") ?? "", source: next.interval_source?.join("\n") ?? "", target: next.interval_target?.join("\n") ?? "" });
    void load(next);
  }
  const roleField = (role: "resource" | "value", label: string) => <label>{label}{columns?.length ? <select value={draft.roles?.[role] ?? ""} onChange={event => editRole(role, event.target.value)}><option value="">No source field · local result unavailable</option>{columns.map(column => <option key={column.index} value={column.index}>{column.name || `Column ${column.index}`}</option>)}</select>
    : <input type="number" min="0" step="1" value={draft.roles?.[role] ?? ""} onChange={event => editRole(role, event.target.value)} />}</label>;
  const historical = answer?.definition.measure_profile === "historical_v1", cohorts = answer?.activity_cohorts;

  return <section className="bpic19-measures" aria-labelledby={heading} aria-busy={busy}>
    <h2 id={heading}>Inspect the measured item histories</h2>
    <p>Review an activity, interval, actor or amount definition on the current complete PO items. These descriptive measures are available before setting up an expectation.</p>
    <details open className="bpic19-measure-definition"><summary>Review the measurement definitions</summary>
      <p>Activity selectors use exact source labels, one per line. The prepared activity and clock bindings stay attached to this source interpretation. Duplicate selector labels never multiply a record.</p>
      <div className="bpic19-measures-grid">
        <fieldset><legend>Activity presence, count and repetition</legend><label>Exact activity selector<textarea value={selectorText.activity} onChange={event => editSelector("activity", event.target.value)} /></label>
          <label>Activity operator<select value={draft.activity_operator} onChange={event => edit({ activity_operator: event.target.value })}><option value="count">Count original matching events</option><option value="presence">Presence · at least one matching event</option><option value="repeat_quantity">Repeat quantity · count minus one</option><option value="repeated_presence">Repeated presence · at least two matches</option></select></label>
          <p>Known absence is zero. Unknown activity labels retain the known matching lower bound; they may leave exact quantities unavailable.</p></fieldset>
        <fieldset><legend>Recorded milestone interval</legend><label>Source activity selector<textarea value={selectorText.source} onChange={event => editSelector("source", event.target.value)} /></label><label>Target activity selector<textarea value={selectorText.target} onChange={event => editSelector("target", event.target.value)} /></label>
          <label>Endpoint policy<select value={draft.interval_policy} onChange={event => edit({ interval_policy: event.target.value })}><option value="independent_minimum">Independent earliest parsed endpoints</option></select></label>
          <p>Select minima first, then admit 2017 ≤ timestamp &lt; 2020 and nonnegative differences. Ties yield zero days. First-after and first-to-last require a separately admitted policy.</p></fieldset>
        <fieldset><legend>Original actors and amount roles</legend>{roleField("resource", columns?.length ? "Actor source field" : "Actor source column index (zero based)")}{roleField("value", columns?.length ? "Amount source field" : "Amount source column index (zero based)")}
          <label>Item-value reducer<select value={draft.value_reducer} onChange={event => edit({ value_reducer: event.target.value })}><option value="unique_creation_value">Unique finite creation value · equal duplicates admitted</option><option value="unique_creation_event">Unique creation event · repeated creation refused</option><option value="first_creation_source_position">Panel first creation · original source position</option><option value="maximum_absolute_event_value">Corrected maximum absolute event value</option></select></label>
          {draft.value_reducer === "first_creation_source_position" && <p>Panel choice: use the first original Create Purchase Order Item record by source position, including timestamp ties. Keep every candidate; a missing or invalid first amount stays unavailable. Later finite amounts cannot replace it. This is separate from R07 financial matching and does not establish spend or liability.</p>}
          <label>Declared source amount unit<input maxLength={100} value={draft.value_unit ?? "source_units"} onChange={event => edit({ value_unit: event.target.value })} /></label>
          <label>Fixed value-band boundaries (comma separated)<input value={bandText} onChange={event => { setBandText(event.target.value); const parsed = event.target.value.trim() === "" ? [] : event.target.value.split(",").map(value => Number(value.trim())); edit({ value_band_edges: parsed.every(Number.isFinite) ? parsed : [] }); }} /></label>
          <p>Creation selects Create Purchase Order Item. Equal values stay together under [lower, upper) bands. Conflicting values, missing cells and nonfinite values have local states.</p></fieldset>
        <fieldset><legend>Representation and compatibility</legend><label>Sequence representation<select value={draft.representation_policy} onChange={event => edit({ representation_policy: event.target.value })}><option value="exact">Exact baseline · every repetition</option><option value="first_occurrence">Global first-occurrence signature</option></select></label>
          <label>Measurement recipe<select value={draft.measure_profile} onChange={event => edit({ measure_profile: event.target.value === "historical_v1" ? "historical_v1" : "paper_v1" })}><option value="paper_v1">Corrected paper definitions</option><option value="historical_v1">Add separately named historical notebook measures</option></select></label>
          {draft.measure_profile === "historical_v1" && <><p>Historical net-worth uses the same reviewed original amount field; its reducer and missing-to-zero policy stay separate.</p><label>Exposure calibration population<select value={draft.calibration_population} onChange={event => edit({ calibration_population: event.target.value === "selected" ? "selected" : "parent" })}><option value="parent">Frozen parent items</option><option value="selected">Selected items · explicit new calibration</option></select></label></>}
          <p>Signature removes later repeated labels globally and preserves their original rows. Adjacent same-label/time collapse and selected-label omission are unsupported definitions in this release.</p></fieldset>
      </div>
      <div className="bpic19-measures-controls"><button type="button" className="primary" disabled={busy || !validSelectors || !validBands || !draft.value_unit?.trim()} onClick={() => void load({ ...draft, value_band_edges: bandEdges, offset: 0 })}>Review and read measures</button>
        {busy && <button type="button" onClick={cancel}>Cancel measure request</button>}{answer && (dirty || problem || cancelled) && <button type="button" onClick={restore}>Restore reviewed definition</button>}</div>
      {!!retainedQueries?.length && <div className="bpic19-measures-controls"><label>Previously retained measures<select disabled={busy} value={retainedDefinition} onChange={event => setRetainedDefinition(event.target.value)}><option value="">Choose a retained definition</option>{retainedQueries.map(item => <option key={item.definition_id} value={item.definition_id}>{item.label}</option>)}</select></label><button type="button" disabled={busy || !retainedQueries.some(item => item.definition_id === retainedDefinition)} onClick={readRetained}>Read retained measures</button></div>}
      {!validSelectors && <p role="alert">Each activity selector needs 1–100 exact labels before it can be reviewed.</p>}{!validBands && <p role="alert">Use at most 100 band boundaries, as finite numbers in strictly increasing order.</p>}{!draft.value_unit?.trim() && <p role="alert">Declare the source amount unit, or use source_units while the currency meaning remains unconfirmed.</p>}
    </details>
    {busy && <p role="status">Reading the measures… Earlier evidence is shown with its actions paused.</p>}
    {dirty && <p role="status">The definition has unreviewed changes. Review it to update the answer; earlier evidence and save actions are paused.</p>}
    {cancelled && <p role="status">Measure request cancelled. Review the draft or restore the earlier reviewed definition.</p>}
    {problem && <div role="alert"><p>{problem}</p><button type="button" disabled={busy} onClick={() => { if (retry.current) void load(retry.current); }}>Retry measures</button></div>}
    {answer && <div data-stale={paused ? "true" : undefined}>
      {onRetain && <button type="button" disabled={paused} onClick={() => onRetain(answer)}>Retain reviewed measures</button>}
      <p><strong>{number.format(answer.population_case_count)} PO items</strong> · {number.format(answer.population_record_count)} original records · {historical ? "corrected definitions plus separately named historical measures" : "corrected paper definitions"}</p>
      {answer.roles_proposed_from_headers && <p role="alert">The field roles were proposed from headers. Review the actor and amount bindings before using this answer.</p>}
      <p>Reviewed selector: {answer.definition.activity_selector.join(" + ")} · {reason(answer.definition.activity_operator)}. Clock: {reason(answer.definition.clock_kind)} · {answer.definition.clock_policy_id}. Recorded elapsed days are separate from active work, contractual lateness and severity.</p>
      <p>Actor policy: {reason(answer.definition.resource_normalization)}. Every original record is checked; unknown actors pause full effort while known counts remain independently usable. Declared amount unit: {answer.definition.value_unit}. Review the source currency and anonymization meaning before interpreting the proxy.</p>
      {answer.definition.first_creation_policy && <p>Reviewed panel first-creation policy: original source position, with no event deduplication or fallback to later amounts. Timestamp and display order do not select the value. Negative raw values retain their sign; negative creation exposure is unavailable.</p>}
      {answer.definition.calibration && <details open><summary>Frozen historical exposure calibration</summary><p>{number.format(answer.definition.calibration.case_count)} items · raw P95 {display(answer.definition.calibration.quantile)} {answer.definition.calibration.unit} · divisor {display(answer.definition.calibration.denominator)} · {answer.definition.calibration.available ? "available" : "unavailable"}.</p>
        <p>Interpolation: {answer.definition.calibration.interpolation} · position (n−1) × .95 = {display(answer.definition.calibration.position)} · missing policy: {reason(answer.definition.calibration.missing_policy)} · {number.format(answer.definition.calibration.invalid_case_count)} invalid items. Selecting a subgroup keeps this frozen calibration unless a new calibration is explicitly reviewed.</p><p>Finite-value guard: {reason(answer.definition.calibration.finite_guard)}.</p><small>Calibration identity: {answer.definition.calibration.calibration_id}</small><small>Frozen item membership: {rows(answer.definition.calibration.population_case_ids)}</small></details>}
      <div className="bpic19-measures-scroll"><table className="plain-table"><caption>Raw-measure distributions over the complete named population</caption><thead><tr><th>Measure</th><th>Available items</th><th>Known zero items</th><th>Unavailable items</th><th>Minimum</th><th>Median</th><th>Mean</th><th>Maximum</th></tr></thead><tbody>{Object.entries(answer.summaries).map(([key, summary]) => <tr key={key}><th scope="row">{name(key)}{summary.reason && <small>{reason(summary.reason)}</small>}</th><td>{number.format(summary.available_case_count)}</td><td>{number.format(summary.zero_case_count)}</td><td>{number.format(summary.unavailable_case_count)}</td><td>{display(summary.minimum)}</td><td>{display(summary.median)}</td><td>{display(summary.mean)}</td><td>{display(summary.maximum)}</td></tr>)}</tbody></table></div>
      {cohorts && <><h3>Compare measured activity cohorts</h3><p>Presence-positive share: {cohorts.presence_fraction === null ? `unavailable · ${reason(cohorts.reason)}` : percent.format(cohorts.presence_fraction)}. Repetition-positive share: {cohorts.repeated_presence_fraction === null ? "unavailable" : percent.format(cohorts.repeated_presence_fraction)}. Both use the complete parent denominator {number.format(cohorts.denominator)}; unknown support stays visible.</p>
        <table className="plain-table"><caption>Reviewed activity operator cohorts · complete items</caption><thead><tr><th>Cohort</th><th>PO items</th><th>Full-history actions</th></tr></thead><tbody>{[
          { label: "Positive", ids: cohorts.positive_case_ids }, { label: "Known zero", ids: cohorts.zero_case_ids }, { label: "Unavailable", ids: cohorts.unavailable_case_ids },
        ].map(cohort => <tr key={cohort.label}><th scope="row">{cohort.label}</th><td>{number.format(cohort.ids.length)}</td><td>{onKeepCases && <button type="button" disabled={paused || !cohort.ids.length} onClick={() => onKeepCases(cohort.ids, `${reason(answer.definition.activity_operator)}: ${cohort.label.toLowerCase()}`)}>Keep {cohort.label.toLowerCase()} items</button>}{cohort.ids[0] && <button type="button" disabled={paused} onClick={() => onInspect(cohort.ids[0])}>Inspect {cohort.label.toLowerCase()} item</button>}</td></tr>)}</tbody></table>
        {!onKeepCases && <p className="bpic19-measure-note">Complete-item cohort selection is unavailable in this host. Cohort membership and source evidence remain inspectable.</p>}</>}
      {answer.value_bands.length > 0 && <><h3>Fixed value bands</h3><table className="plain-table"><caption>Reviewed fixed value bands · tied values stay together</caption><thead><tr><th>Band</th><th>PO items</th><th>Full-history actions</th></tr></thead><tbody>{answer.value_bands.map(band => <tr key={band.band_index}><th scope="row">[{band.lower_inclusive === null ? "−∞" : display(band.lower_inclusive)}, {band.upper_exclusive === null ? "+∞" : display(band.upper_exclusive)})</th><td>{number.format(band.case_ids.length)}</td><td>{onKeepCases && <button type="button" disabled={paused || !band.case_ids.length} onClick={() => onKeepCases(band.case_ids, `Fixed value band ${band.band_index}`)}>Keep value band {band.band_index}</button>}{band.case_ids[0] && <button type="button" disabled={paused} onClick={() => onInspect(band.case_ids[0])}>Inspect value-band item</button>}</td></tr>)}</tbody></table><p>{number.format(answer.value_band_unavailable_case_ids.length)} items have unavailable values and remain outside finite bands.</p></>}
      <h3>Compare exact variants with the first-occurrence signature</h3>
      <p>The representation changes grouping and preserves all {number.format(answer.population_record_count)} original records. {number.format(answer.representation_unavailable_case_ids.length)} items have unavailable representations. Scored support and penalty mass require a native Method score-run join, which is unavailable in this view.</p>
      <div className="bpic19-measures-grid bpic19-representations">{(["exact", "first_occurrence"] as const).map(representation => <RepresentationSupport key={`${answer.result_id}-${representation}`} representation={representation} groups={answer.representation_groups[representation]} reviewed={representation === answer.definition.representation_policy} disabled={paused} onInspect={onInspect} onKeepCases={onKeepCases} />)}</div>
      {!!answer.representation_unavailable_case_ids.length && <button type="button" disabled={paused} onClick={() => onInspect(answer.representation_unavailable_case_ids[0])}>Inspect unavailable representation</button>}
      <h3>Source witnesses and complete item histories</h3>
      {answer.population_case_count === 0 && <p>No PO items in this population. Distribution values and rates are unavailable where their denominator is empty.</p>}
      {answer.cases.map(feature => <ItemEvidence key={`${answer.result_id}-${feature.case_id}`} feature={feature} disabled={paused} onInspect={onInspect} onKeepCases={onKeepCases} />)}
      <div className="bpic19-measures-controls"><p>Showing {answer.cases.length ? number.format(answer.offset + 1) : "0"}–{number.format(answer.offset + answer.cases.length)} of {number.format(answer.population_case_count)} items.</p>
        <button type="button" disabled={paused || answer.offset === 0} onClick={() => void load({ ...answer.query, offset: Math.max(0, answer.offset - answer.limit) })}>Previous items</button>
        <button type="button" disabled={paused || answer.next_offset === null} onClick={() => { if (answer.next_offset !== null) void load({ ...answer.query, offset: answer.next_offset }); }}>Next items</button>
      </div>
      <details><summary>Measurement recipe and reproducibility receipt</summary><p>Result {answer.result_id}</p><p>Definition {answer.definition_id}</p><p>Source population {answer.identity.population_id}</p><p>Parent population {answer.parent_identity.population_id}</p><pre>{JSON.stringify(answer.definition, null, 2)}</pre></details>
    </div>}
  </section>;
}
