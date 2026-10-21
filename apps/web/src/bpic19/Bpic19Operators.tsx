import { useEffect, useId, useRef, useState } from "react";
import { sameJson } from "../data/coordinator";
import type { AnswerIdentity, Bpic19OperatorAnswer, Bpic19OperatorRequest, CancellationRecipe, FifoRecipe, OperatorCase, OperatorCatalogue, OperatorQuery, OperatorRecipe, OperatorRoles, OrdinalRecipe, RuleRecipe, WaitingRecipe } from "../generated/bpic19-operators";
import { answersBpic19Operators, bpic19OperatorContract, httpBpic19OperatorsClient, type Bpic19OperatorClient, type Bpic19OperatorOutcome } from "./operators-client";
import "./operators.css";

const policy = "bpic19.declared_operators.v1";
const format = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });
const display = (value: number | null) => value === null ? "unavailable" : format.format(value);
const plain = (value: string | null) => value?.replaceAll("_", " ") ?? "none";
const rows = (ids: string[]) => ids.length ? ids.join(", ") : "none";
const kinds = ["ordinal", "fifo", "cancellation", "rule", "waiting"] as const;
const kindLabels = { ordinal: "Ordinal inferred episodes", fifo: "Consuming FIFO inferred episodes", cancellation: "Latest preceding cancellation links", rule: "Quantified recorded-event rules", waiting: "Waiting intervals and occupancy" };
function defaults(kind: OperatorRecipe["kind"]): OperatorRecipe {
  if (kind === "ordinal") return { kind, order: "numeric_event_id", stages: "gr_ir_ci", receipt: "goods", cancellation: "retain", ties: "source_position" };
  if (kind === "fifo") return { kind, order: "source_position", stages: "gr_ir_ci", receipt: "goods", cancellation: "retain", ties: "allow_equal" };
  if (kind === "cancellation") return { kind, target_activities: ["Record Invoice Receipt"], cancellation_activities: ["Cancel Invoice Receipt"], reuse: "consume", ties: "strict_before", ambiguity: "refuse", amount_filter: "ignore", tolerance: 0, max_window_days: null };
  if (kind === "rule") return { kind, left_activities: ["Record Invoice Receipt"], right_activities: ["Clear Invoice"], relation: "response", position: "eventual", quantifier: "every", reuse: "allow", ties: "allow_equal", vacuity: "not_activated", flow_scope: "all" };
  return { kind, activation_activities: ["Record Invoice Receipt"], response_activities: ["Clear Invoice"], endpoints: "first_first", completion: "completed_only", horizon_start: "2018-01-01T00:00:00", horizon_end: "2019-01-01T00:00:00", horizon_provenance: null, horizon_policy: "refuse_outside", calendar: "elapsed_segments" };
}
const roleBindings = (roles: OperatorRoles): OperatorRoles => ({ event_id: roles.event_id ?? null, item_category: roles.item_category ?? null, net_worth: roles.net_worth ?? null });
function initial(roles: OperatorRoles, query?: OperatorQuery): OperatorQuery { return query ?? { policy_id: policy, roles: roleBindings(roles), recipe: defaults("ordinal"), offset: 0, limit: 20 }; }
function meaning(query: OperatorQuery) { return JSON.stringify({ policy_id: query.policy_id, roles: roleBindings(query.roles), recipe: query.recipe === null ? null : Object.fromEntries(Object.entries(query.recipe).sort(([left], [right]) => left.localeCompare(right))) }); }
function recipeLabel(query: OperatorQuery) {
  const recipe = query.recipe; if (!recipe) return "Activity catalogue";
  const policies = recipe.kind === "ordinal" || recipe.kind === "fifo" ? `${plain(recipe.order)} · ${plain(recipe.stages)} · ${plain(recipe.ties)} · ${plain(recipe.receipt)} · ${plain(recipe.cancellation)}`
    : recipe.kind === "rule" ? `${recipe.quantifier} ${recipe.relation} · ${recipe.position} · ${recipe.reuse} · ${recipe.flow_scope} · ${recipe.left_activities.join("+")} → ${recipe.right_activities.join("+")}`
    : recipe.kind === "waiting" ? `${plain(recipe.endpoints)} · ${plain(recipe.completion)} · ${recipe.horizon_start} / ${recipe.horizon_end}`
    : `${recipe.reuse} · ${recipe.ties} · ${recipe.amount_filter} tolerance ${recipe.tolerance} · window ${recipe.max_window_days ?? "unbounded"}`;
  return `${kindLabels[recipe.kind]} · ${policies}`;
}
function downloadJson(value: unknown, filename: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }

function Choice<K extends string>({ label, value, options, names, change }: { label: string; value: K; options: readonly K[]; names?: Partial<Record<K, string>>; change: (value: K) => void }) {
  return <label>{label}<select value={value} onChange={event => { const selected = options.find(option => option === event.target.value); if (selected !== undefined) change(selected); }}>{options.map(option => <option key={option} value={option}>{names?.[option] ?? plain(option)}</option>)}</select></label>;
}
function Labels({ label, value, change }: { label: string; value: string[]; change: (value: string[]) => void }) {
  return <label>{label}<textarea value={value.join("\n")} onChange={event => change(event.target.value.split("\n"))} spellCheck={false} /><small>1–8 distinct exact source labels, one per line. Spelling and case remain literal.</small></label>;
}
function EpisodeControls({ recipe, change }: { recipe: OrdinalRecipe | FifoRecipe; change: (recipe: OperatorRecipe) => void }) {
  return <>
    {recipe.kind === "ordinal" ? <Choice label="Ordinal ordering" value={recipe.order} options={["numeric_event_id", "timestamp_source_position"]} names={{ numeric_event_id: "Numeric original eventID · source-compatible ordinal", timestamp_source_position: "Parsed time, then original source position · distinct recipe" }} change={order => change({ ...recipe, order })} /> : <Choice label="FIFO ordering" value={recipe.order} options={["source_position", "timestamp_source_position", "timestamp_numeric_event_id"]} names={{ source_position: "Strictly later original source positions · R08 reproduction", timestamp_source_position: "Parsed time, then original source position", timestamp_numeric_event_id: "Parsed time, numeric eventID, then original source position · panel convention" }} change={order => change({ ...recipe, order })} />}
    {recipe.kind === "fifo" && recipe.order === "timestamp_numeric_event_id" && <p>Parsed time determines chronology; numeric eventID orders equal-time records. Equal numeric IDs use original source position. Review the original eventID field: every original item record needs a trimmed ASCII integer of 1–64 digits. Missing or malformed IDs leave that item unknown with exact raw witnesses. This declared tie convention does not prove chronology from eventIDs.</p>}
    <Choice label="Episode stage sequence" value={recipe.stages} options={["gr_ir_ci", "ir_gr_ci", "ir_ci", "auto_flow"]} names={{ gr_ir_ci: "Receipt → invoice → clearing", ir_gr_ci: "Invoice → receipt → clearing", ir_ci: "Invoice → clearing", auto_flow: "Invariant flow category and first relevant stage" }} change={stages => change({ ...recipe, stages })} />
    <Choice label="Receipt selector" value={recipe.receipt} options={["goods", "goods_or_service"]} names={{ goods: "Record Goods Receipt", goods_or_service: "Goods receipt or service entry sheet" }} change={receipt => change({ ...recipe, receipt })} />
    <Choice label="Item cancellation policy" value={recipe.cancellation} options={["retain", "exclude_item"]} names={{ retain: "Retain complete items containing cancellations", exclude_item: "Exclude such items from episode evaluation" }} change={cancellation => change({ ...recipe, cancellation })} />
    {recipe.kind === "ordinal" ? <Choice label="Ordinal timestamp tie policy" value={recipe.ties} options={["source_position", "ambiguous"]} change={ties => change({ ...recipe, ties })} /> : <Choice label="FIFO parsed-time eligibility" value={recipe.ties} options={["allow_equal", "strict_time"]} names={{ allow_equal: "Later declared positions; equal parsed time allowed", strict_time: "Require a strictly later parsed time as well" }} change={ties => change({ ...recipe, ties })} />}
    <p>Ordinal pairs kth occurrences independently. FIFO consumes complete eligible tuples once. Each tuple is an inferred episode; the source supplies no native invoice identity. Parsed interval validity remains separate from matching support.</p>
  </>;
}
function CancellationControls({ recipe, change }: { recipe: CancellationRecipe; change: (recipe: OperatorRecipe) => void }) {
  return <><Labels label="Receipt target labels" value={recipe.target_activities} change={target_activities => change({ ...recipe, target_activities })} /><Labels label="Cancellation labels" value={recipe.cancellation_activities} change={cancellation_activities => change({ ...recipe, cancellation_activities })} />
    <Choice label="Cancellation target reuse" value={recipe.reuse} options={["consume", "allow"]} names={{ consume: "Consume each matched target once", allow: "Allow target reuse · separate definition" }} change={reuse => change({ ...recipe, reuse })} />
    <Choice label="Temporal predecessor eligibility" value={recipe.ties} options={["strict_before", "allow_equal_source_before"]} names={{ strict_before: "Strictly earlier parsed time", allow_equal_source_before: "Also allow equal time with an earlier raw source position" }} change={ties => change({ ...recipe, ties })} />
    <Choice label="Equally latest target policy" value={recipe.ambiguity} options={["refuse", "source_position"]} names={{ refuse: "Retain tied candidates as ambiguous; consume none", source_position: "First original source position; retain all candidates" }} change={ambiguity => change({ ...recipe, ambiguity })} />
    <Choice label="Separate amount-dependent filter" value={recipe.amount_filter} options={["ignore", "equal", "opposite"]} names={{ ignore: "Temporal links independent of amount", equal: "Equal signed amount within tolerance", opposite: "Opposite signed amount within tolerance" }} change={amount_filter => change({ ...recipe, amount_filter })} />
    <label>Absolute source-EUR tolerance<input type="number" min="0" step="any" value={recipe.tolerance} onChange={event => change({ ...recipe, tolerance: Number(event.target.value) })} /></label>
    <label>Maximum predecessor interval in days (blank means no window)<input type="number" min="0" step="any" value={recipe.max_window_days ?? ""} onChange={event => change({ ...recipe, max_window_days: event.target.value === "" ? null : Number(event.target.value) })} /></label>
    <p>Latest eligible target is selected within the same PO item. Receipt exclusion is a hypothetical analytical view over immutable histories. Monetary totals remain separate; every clearing record is retained. A clearing-window deletion policy is unavailable until a separate selector, window and tie rule are declared; no financial-breach verdict is inferred.</p></>;
}
function RuleControls({ recipe, change }: { recipe: RuleRecipe; change: (recipe: OperatorRecipe) => void }) {
  return <><Labels label="Left activity labels (A)" value={recipe.left_activities} change={left_activities => change({ ...recipe, left_activities })} /><Labels label="Right activity labels (B)" value={recipe.right_activities} change={right_activities => change({ ...recipe, right_activities })} />
    <Choice label="Recorded-event relation A → B" value={recipe.relation} options={["response", "precedence"]} names={{ response: "Response · activate A, find B later", precedence: "Precedence · activate B, find A earlier" }} change={relation => change({ ...recipe, relation })} />
    <Choice label="Relation position policy" value={recipe.position} options={["eventual", "raw_direct"]} names={{ eventual: "Eventually · nearest eligible timestamp candidates", raw_direct: "Direct · immediate original-record neighbor" }} change={position => change({ ...recipe, position })} />
    <Choice label="Quantifier over activations" value={recipe.quantifier} options={["some", "every"]} change={quantifier => change({ ...recipe, quantifier })} />
    <Choice label="Rule partner reuse" value={recipe.reuse} options={["allow", "consume"]} change={reuse => change({ ...recipe, reuse })} />
    <Choice label="Equal parsed-time policy" value={recipe.ties} options={["allow_equal", "strict"]} change={ties => change({ ...recipe, ties })} />
    <Choice label="Zero activation policy" value={recipe.vacuity} options={["not_activated", "logical"]} names={{ not_activated: "Not activated · no automatic success", logical: "Logical empty quantification · every true / some false" }} change={vacuity => change({ ...recipe, vacuity })} />
    <Choice label="Invariant flow scope" value={recipe.flow_scope} options={["all", "after_gr", "before_gr", "two_way", "consignment"]} change={flow_scope => change({ ...recipe, flow_scope })} />
    <p>Some: any confirmed true dominates unknown. Every: any confirmed false dominates unknown. Missing candidate or activation support can remain unknown. Recorded nonmatches are descriptive and are separate from an obligation or score.</p></>;
}
function WaitingControls({ recipe, change, catalogue }: { recipe: WaitingRecipe; change: (recipe: OperatorRecipe) => void; catalogue: OperatorCatalogue | null }) {
  return <><Labels label="Waiting activation labels" value={recipe.activation_activities} change={activation_activities => change({ ...recipe, activation_activities })} /><Labels label="Waiting response labels" value={recipe.response_activities} change={response_activities => change({ ...recipe, response_activities })} />
    <Choice label="Waiting endpoint definition" value={recipe.endpoints} options={["first_first", "first_last", "first_after"]} names={{ first_first: "First activation / independent first response", first_last: "First activation / last response", first_after: "First activation / first response at or after it" }} change={endpoints => change({ ...recipe, endpoints })} />
    <Choice label="Incomplete recorded intervals" value={recipe.completion} options={["completed_only", "right_censored"]} names={{ completed_only: "Completed intervals only", right_censored: "Right censor known missing responses at trusted horizon" }} change={completion => change({ ...recipe, completion })} />
    <label>Trusted horizon start (ISO timestamp with seconds)<input value={recipe.horizon_start} onChange={event => change({ ...recipe, horizon_start: event.target.value })} /></label>
    <label>Trusted horizon end (ISO timestamp with seconds)<input value={recipe.horizon_end} onChange={event => change({ ...recipe, horizon_end: event.target.value })} /></label>
    <label>Observation-horizon authority (required for right censoring)<input maxLength={1000} value={recipe.horizon_provenance ?? ""} onChange={event => change({ ...recipe, horizon_provenance: event.target.value === "" ? null : event.target.value })} /><small>Name the source metadata or reviewed observation authority for this cutoff. The preparation cutoff alone does not supply that authority.</small></label>
    <Choice label="Intervals outside the explicit horizon" value={recipe.horizon_policy} options={["refuse_outside", "clip"]} names={{ refuse_outside: "Refuse required selected endpoints after the horizon; exclude intervals before its start", clip: "Explicitly project selected intervals into the horizon" }} change={horizon_policy => change({ ...recipe, horizon_policy })} />
    <Choice label="Occupancy calendar" value={recipe.calendar} options={["elapsed_segments", "daily_snapshots"]} names={{ elapsed_segments: "Elapsed-time half-open segments and duration weighting", daily_snapshots: "Add daily snapshots anchored at horizon start" }} change={calendar => change({ ...recipe, calendar })} />
    <p>Half-open [start, end) inventory counts end events before simultaneous starts. Zero durations are valid and add no occupancy. Unknown response times are separate from known missing responses. Prepared clock: {plain(catalogue?.clock_kind ?? null)}; analyst-entered preparation cutoff: {catalogue?.trusted_cutoff ?? "unavailable — review source time preparation"}. Completed-only windows are retrospective; right censoring additionally requires reviewed observation-horizon authority.</p></>;
}

function CaseEvidence({ feature, disabled, inspect, hypothetical = false }: { feature: OperatorCase; disabled: boolean; inspect: (caseId: string, rowIds: string[]) => void; hypothetical?: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="bpic19-operator-item" onToggle={event => setOpen(event.currentTarget.open)}><summary>Item {feature.case_id} · {plain(feature.state)} · {feature.truth ? `rule ${plain(feature.truth)} · ` : ""}{format.format(feature.record_count)} original records</summary>
    {open && <><p>{plain(feature.reason)} · known activations {format.format(feature.known_activation_count)} / total {display(feature.activation_count)}.</p><button type="button" disabled={disabled} onClick={() => inspect(feature.case_id, feature.record_row_ids)}>Inspect complete item {feature.case_id}</button>
      <p>Matched/retained original records: {rows(feature.included_row_ids)}. {hypothetical ? "Hypothetically excluded receipt targets" : "Analytically excluded targets"}: {rows(feature.excluded_row_ids)}. Unmatched: {rows(feature.unmatched_row_ids)}. Unknown: {rows(feature.unknown_row_ids)}.</p>
      <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Item {feature.case_id} inferred observations and original witnesses</caption><thead><tr><th>Observation</th><th>Matching and candidate witnesses</th><th>Raw intervals</th><th>Evidence</th></tr></thead><tbody>{feature.observations.map(obs => <tr key={obs.observation_id}><th scope="row">{obs.ordinal} · {plain(obs.state)}<small>{plain(obs.reason)}{obs.truth && ` · ${obs.truth}`}</small>{obs.stage_row_ids && <small>Stage records: {obs.stage_row_ids.map(value => value ?? "unmatched").join(" → ")}</small>}<small>Inferred observation: {obs.observation_id}</small></th><td>Activation {rows(obs.activation_row_ids)}<small>Partner {rows(obs.response_row_ids)}</small><small>All tied candidates {rows(obs.candidate_row_ids)}</small><small>Unknown support {rows(obs.unknown_row_ids)}</small>{obs.start && <small>[{obs.start}, {obs.end})</small>}</td><td>{Object.entries(obs.intervals).map(([name, measure]) => <p key={name}>{plain(name)}: <strong>{display(measure.value)}</strong> {measure.unit}<small>{measure.available ? "available" : plain(measure.reason)}</small>{measure.recorded_difference_days !== undefined && <small>Signed diagnostic {display(measure.recorded_difference_days)} days</small>}</p>)}{obs.cancellation_value !== undefined && <small>Cancellation {display(obs.cancellation_value)} / target {display(obs.target_value ?? null)} source EUR</small>}</td><td><button type="button" disabled={disabled} onClick={() => inspect(feature.case_id, [...new Set([...obs.activation_row_ids, ...obs.response_row_ids, ...obs.candidate_row_ids, ...obs.unknown_row_ids, ...(obs.selected_row_ids ?? [])])])}>Inspect observation {obs.ordinal} of {feature.case_id}</button></td></tr>)}</tbody></table></div>
      {!!Object.keys(feature.totals).length && <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Item {feature.case_id} raw totals</caption><thead><tr><th>Measure</th><th>Raw value</th><th>Original witnesses</th></tr></thead><tbody>{Object.entries(feature.totals).map(([name, value]) => <tr key={name}><th scope="row">{plain(name)}</th><td>{display(value.value)} {value.unit}<small>{value.available ? "available" : plain(value.reason)}</small></td><td>{rows(value.row_ids)}<button type="button" disabled={disabled} onClick={() => inspect(feature.case_id, value.row_ids)}>Inspect {plain(name)}</button></td></tr>)}</tbody></table></div>}</>}
  </details>;
}

export interface Bpic19OperatorsProps {
  workspaceId: string; identity: AnswerIdentity; revision: number; roles: OperatorRoles; query?: OperatorQuery;
  retainedQueries?: OperatorQuery[]; onRetain?: (answer: Bpic19OperatorAnswer) => void;
  restoredComparison?: Bpic19OperatorComparison;
  onCompared?: (comparison: Bpic19OperatorComparison) => void;
  onComparisonValidityChange?: (current: boolean) => void;
  columns?: { index: number; name: string }[]; client?: Bpic19OperatorClient;
  onInspect: (caseId: string, rowIds?: string[]) => void; onKeepCases?: (caseIds: string[], label: string) => void;
  onReviewed?: (answer: Bpic19OperatorAnswer) => void; onValidityChange?: (current: boolean) => void;
}

export interface Bpic19OperatorComparison {
  policy_id: "bpic19.ordinal_fifo_comparison.v1";
  identity: AnswerIdentity;
  ordinal: { definition_id: string; query: OperatorQuery };
  fifo: { definition_id: string; query: OperatorQuery };
}

export function Bpic19Operators({ workspaceId, identity, revision, roles, query, retainedQueries = [], onRetain, restoredComparison, onCompared, onComparisonValidityChange, columns, client = httpBpic19OperatorsClient, onInspect, onKeepCases, onReviewed, onValidityChange }: Bpic19OperatorsProps) {
  const heading = useId();
  const [draft, setDraft] = useState<OperatorQuery>(() => initial(roles, query));
  const [answer, setAnswer] = useState<Bpic19OperatorAnswer | null>(null), [catalogue, setCatalogue] = useState<OperatorCatalogue | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [cancelled, setCancelled] = useState(false);
  const [retainedAnswers, setRetainedAnswers] = useState<Record<string, Bpic19OperatorAnswer>>({});
  const [retainedSelection, setRetainedSelection] = useState("");
  const [leftChoice, setLeftChoice] = useState(""), [rightChoice, setRightChoice] = useState("");
  const [comparison, setComparison] = useState<[Bpic19OperatorAnswer, Bpic19OperatorAnswer] | null>(null);
  const [compareBusy, setCompareBusy] = useState(false), [compareProblem, setCompareProblem] = useState<string | null>(null);
  const compareController = useRef<AbortController | null>(null), compareSerial = useRef(0);
  const reviewedComparison = useRef<Bpic19OperatorComparison | null>(null);
  const comparisonCallbacks = useRef({ onCompared, onComparisonValidityChange }); comparisonCallbacks.current = { onCompared, onComparisonValidityChange };
  const controller = useRef<AbortController | null>(null), serial = useRef(0), retry = useRef<OperatorQuery | null>(null);
  const callbacks = useRef({ onReviewed, onValidityChange }); callbacks.current = { onReviewed, onValidityChange };
  const methodController = useRef<AbortController | null>(null), methodSerial = useRef(0);
  const [methodState, setMethodState] = useState<{ context: string; kind: "pending" | "unavailable" | "error" | "cancelled"; message: string } | null>(null);
  const identityKey = JSON.stringify(identity), roleKey = JSON.stringify(roleBindings(roles)), queryKey = JSON.stringify(query ?? null);
  const methodContext = JSON.stringify([workspaceId, identityKey, roleKey, revision, queryKey, draft, answer?.definition_id, answer?.result_id]);
  const currentMethodContext = useRef(methodContext); currentMethodContext.current = methodContext;
  function invalidateMethod() { ++methodSerial.current; methodController.current?.abort(); setMethodState(null); }
  useEffect(() => {
    invalidateMethod();
    return () => { ++methodSerial.current; methodController.current?.abort(); };
  }, [methodContext, client]);
  const restoredComparisonKey = JSON.stringify(restoredComparison ?? null);
  const envelope = (next: OperatorQuery, requestId: string): Bpic19OperatorRequest => ({ schema_version: 1, message_type: "bpic19_operator_request", request_id: requestId, query_revision: revision, workspace_id: workspaceId, identity, query: next });
  const choices = new Map<string, OperatorQuery>();
  const restoredChoices = restoredComparison && sameJson(restoredComparison.identity, identity) ? [restoredComparison.ordinal.query, restoredComparison.fifo.query] : [];
  for (const candidate of [...retainedQueries, ...restoredChoices, ...Object.values(retainedAnswers).filter(value => value.workspace_id === workspaceId && sameJson(value.identity, identity) && value.query_revision === revision).map(value => value.query)]) {
    if (candidate.recipe !== null && bpic19OperatorContract.request(envelope(candidate, "retained-admission"))) choices.set(meaning(candidate), candidate);
  }
  const retainedChoices = [...choices.entries()];
  async function load(next: OperatorQuery) {
    invalidateMethod();
    const token = ++serial.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setProblem(null); setCancelled(false); retry.current = next; callbacks.current.onValidityChange?.(false);
    const request: Bpic19OperatorRequest = { schema_version: 1, message_type: "bpic19_operator_request", request_id: `bpic19-operators-${revision}-${token}`, query_revision: revision, workspace_id: workspaceId, identity, query: next };
    let outcome: Bpic19OperatorOutcome;
    try { outcome = await client.operators(request, abort.signal); } catch { outcome = { ok: false, problem: { kind: "unreachable" } }; }
    if (token !== serial.current || abort.signal.aborted) return;
    setBusy(false);
    if (!outcome.ok) { setProblem(outcome.problem.kind === "refusal" ? `${outcome.problem.refusal.message} (${outcome.problem.refusal.code}${outcome.problem.refusal.field ? ` · ${outcome.problem.refusal.field}` : ""})` : outcome.problem.kind === "unreachable" ? "The local service could not be reached. Retry this recipe." : outcome.problem.detail); return; }
    if (!answersBpic19Operators(request, outcome.answer)) { setProblem("The answer belongs to another source, population or recipe."); return; }
    setCatalogue(outcome.answer.catalogue);
    if (next.recipe !== null) { setAnswer(outcome.answer); callbacks.current.onReviewed?.(outcome.answer); }
  }
  useEffect(() => {
    // The workspace publishes a reviewed query back to this panel. That feedback is
    // already answered; only a newly supplied saved/source revision needs replay.
    if (query && answer && answer.workspace_id === workspaceId && answer.query_revision === revision &&
        JSON.stringify(answer.identity) === identityKey && JSON.stringify(answer.query) === queryKey) {
      callbacks.current.onValidityChange?.(!busy && !problem && !cancelled && meaning(draft) === meaning(answer.query));
      return () => { ++serial.current; controller.current?.abort(); callbacks.current.onValidityChange?.(false); };
    }
    const next = initial(roles, query); setDraft(next); setAnswer(null); setCatalogue(null); setCancelled(false);
    // A supplied saved recipe is deterministically replayed; a new journey only reads the catalogue.
    void load(query ? next : { ...next, recipe: null, offset: 0 });
    return () => { ++serial.current; controller.current?.abort(); callbacks.current.onValidityChange?.(false); };
    // Source, frozen population and revision changes invalidate old answers and requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, identityKey, roleKey, revision, queryKey, client]);
  useEffect(() => {
    ++compareSerial.current; compareController.current?.abort(); reviewedComparison.current = null; setRetainedAnswers({}); setRetainedSelection(""); setComparison(null); setCompareBusy(false); setCompareProblem(null); setLeftChoice(""); setRightChoice("");
    return () => { ++compareSerial.current; compareController.current?.abort(); };
  }, [workspaceId, identityKey, revision]);
  useEffect(() => {
    if (!restoredComparison) return;
    if (!sameJson(restoredComparison.identity, identity) || restoredComparison.policy_id !== "bpic19.ordinal_fifo_comparison.v1" ||
        restoredComparison.ordinal.query.recipe?.kind !== "ordinal" || restoredComparison.fifo.query.recipe?.kind !== "fifo" ||
        !restoredComparison.ordinal.definition_id || !restoredComparison.fifo.definition_id ||
        !bpic19OperatorContract.request(envelope(restoredComparison.ordinal.query, "restored-ordinal-admission")) ||
        !bpic19OperatorContract.request(envelope(restoredComparison.fifo.query, "restored-fifo-admission"))) {
      ++compareSerial.current; compareController.current?.abort(); setComparison(null); setCompareBusy(false);
      setCompareProblem("The saved comparison does not declare an admitted ordinal/FIFO pair on this exact source and population. No pair was inferred.");
      comparisonCallbacks.current.onComparisonValidityChange?.(false); return;
    }
    if (sameJson(reviewedComparison.current, restoredComparison)) return;
    reviewedComparison.current = structuredClone(restoredComparison);
    setLeftChoice(meaning(restoredComparison.ordinal.query)); setRightChoice(meaning(restoredComparison.fifo.query));
    void readComparison(restoredComparison.ordinal.query, restoredComparison.fifo.query, restoredComparison);
    return () => { ++compareSerial.current; compareController.current?.abort(); };
    // Only a newly supplied verified pair/source/revision is replayed. Feedback after publication is already answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, identityKey, revision, restoredComparisonKey, client]);
  const recipe = draft.recipe ?? defaults("ordinal");
  const dirty = answer !== null && meaning(draft) !== meaning(answer.query);
  const paused = busy || !!problem || cancelled || dirty;
  useEffect(() => { callbacks.current.onValidityChange?.(answer !== null && !paused); }, [answer, paused, draft]);
  function edit(patch: Partial<OperatorQuery>) { invalidateMethod(); ++serial.current; controller.current?.abort(); ++compareSerial.current; compareController.current?.abort(); setCompareBusy(false); if (reviewedComparison.current) comparisonCallbacks.current.onComparisonValidityChange?.(false); setBusy(false); setProblem(null); setCancelled(false); setDraft(current => ({ ...current, ...patch, offset: 0 })); callbacks.current.onValidityChange?.(false); }
  const change = (recipe: OperatorRecipe) => edit({ recipe });
  function cancel() { invalidateMethod(); ++serial.current; controller.current?.abort(); setBusy(false); setCancelled(true); callbacks.current.onValidityChange?.(false); }
  function restore() { if (!answer) return; invalidateMethod(); ++serial.current; controller.current?.abort(); setDraft(answer.query); setBusy(false); setProblem(null); setCancelled(false); callbacks.current.onReviewed?.(answer); }
  function download() { if (!answer || paused) return; downloadJson(answer, `${answer.operation}-${answer.result_id.split(":").at(-1)?.slice(0, 12)}.json`); }
  function retain() { if (!answer || paused || answer.query.recipe === null) return; const key = meaning(answer.query); if (choices.size >= 32 && !choices.has(key)) return; setRetainedAnswers(current => ({ ...current, [key]: answer })); onRetain?.(answer); }
  function selectRetained(key: string) { const selected = choices.get(key); if (!selected) return; setRetainedSelection(key); setDraft(selected); void load(selected); }
  function changeComparison(side: "left" | "right", value: string) { ++compareSerial.current; compareController.current?.abort(); setCompareBusy(false); setCompareProblem(null); setComparison(null); if (reviewedComparison.current) comparisonCallbacks.current.onComparisonValidityChange?.(false); (side === "left" ? setLeftChoice : setRightChoice)(value); }
  async function compare() {
    const left = choices.get(leftChoice), right = choices.get(rightChoice);
    if (!left || !right || left.recipe?.kind !== "ordinal" || right.recipe?.kind !== "fifo") return;
    await readComparison(left, right);
  }
  function restoreComparison() {
    const pair = reviewedComparison.current; if (!pair || !sameJson(pair.identity, identity)) return;
    setLeftChoice(meaning(pair.ordinal.query)); setRightChoice(meaning(pair.fifo.query));
    void readComparison(pair.ordinal.query, pair.fifo.query, pair);
  }
  async function readComparison(left: OperatorQuery, right: OperatorQuery, expected?: Bpic19OperatorComparison) {
    const token = ++compareSerial.current; compareController.current?.abort(); const abort = new AbortController(); compareController.current = abort; setCompareBusy(true); setCompareProblem(null);
    comparisonCallbacks.current.onComparisonValidityChange?.(false);
    const requests = [left, right].map((value, index) => envelope({ ...value, offset: 0, limit: 20 }, `bpic19-compare-${revision}-${token}-${index}`));
    let outcomes: Bpic19OperatorOutcome[];
    try { outcomes = await Promise.all(requests.map(request => client.operators(request, abort.signal))); }
    catch { outcomes = [{ ok: false, problem: { kind: "unreachable" } }]; }
    if (token !== compareSerial.current || abort.signal.aborted) return;
    setCompareBusy(false);
    const supplied: Bpic19OperatorAnswer[] = [];
    for (const [index, outcome] of outcomes.entries()) {
      if (!outcome.ok) { setCompareProblem(outcome.problem.kind === "refusal" ? `${outcome.problem.refusal.message} (${outcome.problem.refusal.code}${outcome.problem.refusal.field ? ` · ${outcome.problem.refusal.field}` : ""})` : outcome.problem.kind === "unreachable" ? "The retained comparison could not be read. Retry both definitions." : outcome.problem.detail); return; }
      if (!answersBpic19Operators(requests[index], outcome.answer)) { setCompareProblem("A comparison answer differs from its retained source, population or definition."); return; }
      supplied.push(outcome.answer);
    }
    if (supplied.length !== 2 || supplied[0].operation !== "bpic19_ordinal" || supplied[1].operation !== "bpic19_fifo" ||
        supplied[0].population_case_count !== supplied[1].population_case_count || supplied[0].population_record_count !== supplied[1].population_record_count || !sameJson(supplied[0].parent_identity, supplied[1].parent_identity)) {
      setCompareProblem("The comparison does not have two complete ordinal/FIFO answers for the same population."); return;
    }
    if (expected && (supplied[0].definition_id !== expected.ordinal.definition_id || supplied[1].definition_id !== expected.fifo.definition_id)) {
      setCompareProblem("A saved comparison definition differs from its recorded ordinal or FIFO result. No current default or alternative pair was substituted."); return;
    }
    const pair: Bpic19OperatorComparison = { policy_id: "bpic19.ordinal_fifo_comparison.v1", identity,
      ordinal: { definition_id: supplied[0].definition_id, query: requests[0].query }, fifo: { definition_id: supplied[1].definition_id, query: requests[1].query } };
    reviewedComparison.current = structuredClone(pair); setComparison([supplied[0], supplied[1]]);
    comparisonCallbacks.current.onCompared?.(structuredClone(pair)); comparisonCallbacks.current.onComparisonValidityChange?.(true);
  }
  const request: Bpic19OperatorRequest = { schema_version: 1, message_type: "bpic19_operator_request", request_id: "review", query_revision: revision, workspace_id: workspaceId, identity, query: { ...draft, recipe } };
  const needsAuthority = recipe.kind === "waiting" && recipe.completion === "right_censored" && !recipe.horizon_provenance?.trim();
  const needsEventId = (recipe.kind === "ordinal" && recipe.order === "numeric_event_id" || recipe.kind === "fifo" && recipe.order === "timestamp_numeric_event_id") && draft.roles.event_id === null;
  const valid = bpic19OperatorContract.request(request) && !needsAuthority && !needsEventId;
  const methodReady = valid && !paused && answer?.query.recipe?.kind === "rule" && recipe.kind === "rule" &&
    answer.workspace_id === workspaceId && answer.query_revision === revision && sameJson(answer.identity, identity) && meaning(answer.query) === meaning(draft);
  const currentMethodState = methodState?.context === methodContext ? methodState : null;
  async function checkMethod() {
    if (!methodReady || !answer) return;
    const context = methodContext, token = ++methodSerial.current;
    methodController.current?.abort(); const abort = new AbortController(); methodController.current = abort;
    const request: Bpic19OperatorRequest = { ...envelope(answer.query, `bpic19-rule-method-${revision}-${token}`), intent: "normative_admission" };
    setMethodState({ context, kind: "pending", message: "Checking actual Method admission for this reviewed recorded-event rule… Descriptive evidence remains usable." });
    let outcome: Bpic19OperatorOutcome;
    try { outcome = await client.operators(request, abort.signal); } catch { outcome = { ok: false, problem: { kind: "unreachable" } }; }
    if (token !== methodSerial.current || abort.signal.aborted || context !== currentMethodContext.current) return;
    if (!outcome.ok && outcome.problem.kind === "refusal") {
      const refusal = outcome.problem.refusal, supplied = refusal.method_context;
      if (refusal.code === "method_binding_unavailable") {
        if (bpic19OperatorContract.refusal(refusal) && refusal.request_id === request.request_id && refusal.query_revision === revision && refusal.workspace_id === workspaceId &&
            supplied && sameJson(supplied.identity, identity) && sameJson(supplied.query, answer.query) && supplied.definition_id === answer.definition_id) {
          setMethodState({ context, kind: "unavailable", message: `${refusal.message} Descriptive result and complete original histories remain usable; no normative grade was produced. (${refusal.code})` }); return;
        }
        setMethodState({ context, kind: "error", message: "The Method refusal does not identify this reviewed rule. Retry the availability check." }); return;
      }
      setMethodState({ context, kind: "error", message: `${refusal.message} (${refusal.code}) Descriptive evidence remains usable.` }); return;
    }
    setMethodState({ context, kind: "error", message: !outcome.ok && outcome.problem.kind === "unreachable" ? "The local service could not be reached. Retry the Method availability check. Descriptive evidence remains usable." : "The service did not return a supported Method admission refusal. No normative grade was accepted. Descriptive evidence remains usable." });
  }
  function cancelMethod() { ++methodSerial.current; methodController.current?.abort(); setMethodState({ context: methodContext, kind: "cancelled", message: "Method availability check cancelled. Descriptive evidence remains usable." }); }
  const bindings = columns ?? catalogue?.columns ?? [];
  const comparisonCurrent = comparison?.every(value => value.workspace_id === workspaceId && sameJson(value.identity, identity) && value.query_revision === revision);
  const comparisonPaused = paused || compareBusy || !!compareProblem;
  return <section className="bpic19-operators" aria-labelledby={heading} aria-busy={busy}>
    <h2 id={heading}>Review recorded-event matching and waiting</h2>
    <p>Choose a finite descriptive recipe on the current complete PO items, inspect original witnesses, and retain complete histories. Alternative policies receive distinct definition identities.</p>
    <details open><summary>Review the declared operator definition</summary><div className="bpic19-operator-controls">
      <fieldset><legend>Recipe and original fields</legend><Choice label="Recorded-event operator" value={recipe.kind} options={kinds} names={kindLabels} change={kind => change(defaults(kind))} />
        {!!retainedChoices.length && <><label>Retained reviewed operator definition<select aria-label="Retained reviewed operator definition" value={retainedSelection} onChange={event => selectRetained(event.target.value)}><option value="">Choose an exact retained definition</option>{retainedChoices.map(([key, value], index) => <option key={key} value={key}>{index + 1}: {recipeLabel(value)}</option>)}</select><small>These recipes were explicitly retained or restored from the verified saved investigation. Selecting one reads its exact fields and policies.</small></label><details><summary>Retained recipe identities and exact fields</summary>{retainedChoices.map(([key,value],index) => <div key={key}><h4>Retained {index+1}: {kindLabels[value.recipe!.kind]}</h4><small>Meaning key: {key}</small>{retainedAnswers[key] && <small>Definition identity: {retainedAnswers[key].definition_id}</small>}<pre>{JSON.stringify(value,null,2)}</pre></div>)}</details></>}
        {(["event_id", "item_category", "net_worth"] as const).map(role => <label key={role}>{role === "event_id" ? "Original eventID field" : role === "item_category" ? "Invariant item category field" : "Original source-EUR amount field"}<select value={draft.roles[role] ?? ""} onChange={event => edit({ roles: { ...draft.roles, [role]: event.target.value === "" ? null : Number(event.target.value) } })}><option value="">Unmapped · dependent recipe unavailable</option>{bindings.map(column => <option key={column.index} value={column.index}>{column.index}: {column.name || "unnamed column"}</option>)}</select></label>)}
        <details><summary>Exact activity catalogue for this population</summary><ul>{catalogue?.activities.map(activity => <li key={activity}><code>{activity}</code></li>)}</ul></details>
        <p>Mapping a role is an explicit review of original source cells. Timestamp and case bindings use the frozen preparation. Numeric-eventID ordering never falls back to another field.</p>
      </fieldset><fieldset><legend>{kindLabels[recipe.kind]}</legend>
        {(recipe.kind === "ordinal" || recipe.kind === "fifo") && <EpisodeControls recipe={recipe} change={change} />}
        {recipe.kind === "cancellation" && <CancellationControls recipe={recipe} change={change} />}
        {recipe.kind === "rule" && <><RuleControls recipe={recipe} change={change} />
          <div className="bpic19-operator-actions"><button type="button" disabled={!methodReady || currentMethodState?.kind === "pending"} onClick={() => void checkMethod()}>Check normative Method availability</button>{currentMethodState?.kind === "pending" && <button type="button" onClick={cancelMethod}>Cancel Method availability check</button>}</div>
          <small>Optional normative admission for the exact current reviewed rule. Review and run the descriptive rule first.</small>
          {currentMethodState && <p role={currentMethodState.kind === "error" ? "alert" : "status"} aria-label="Normative Method availability">{currentMethodState.message}</p>}
        </>}
        {recipe.kind === "waiting" && <WaitingControls recipe={recipe} change={change} catalogue={catalogue} />}
      </fieldset></div>
      <div className="bpic19-operator-actions"><button className="primary" type="button" disabled={busy || !valid} onClick={() => void load({ ...draft, recipe, offset: 0 })}>Review and run operator</button>{busy && <button type="button" onClick={cancel}>Cancel operator request</button>}{answer && (dirty || cancelled || problem) && <button type="button" onClick={restore}>Restore reviewed operator</button>}</div>
      {needsAuthority ? <p role="alert">Right censoring requires a reviewed source or observation authority for the declared horizon. Enter that provenance before running it.</p> : needsEventId ? <p role="alert">Review and map the original eventID field before running this ordering recipe. Another field or source-position ordering will not be substituted.</p> : !valid && <p role="alert">Review the admitted parameters and 1–8 distinct exact labels before running this recipe.</p>}
    </details>
    {busy && <p role="status">Reading declared matching evidence… Earlier result actions are paused.</p>}{dirty && <p role="status">The definition has unreviewed changes. Run it to replace the earlier answer, or restore the reviewed definition.</p>}{cancelled && <p role="status">Operator request cancelled. The draft and original source remain available.</p>}
    {problem && <div role="alert"><p>{problem}</p><button type="button" disabled={busy} onClick={() => { if (retry.current) void load(retry.current); }}>Retry operator</button></div>}
    {answer && <div data-stale={paused ? "true" : undefined}>
      <p><strong>{format.format(answer.population_case_count)} complete PO items</strong> · {format.format(answer.population_record_count)} original records · {format.format(answer.summary.observation_count)} inferred observations · {kindLabels[answer.definition.recipe?.kind ?? "ordinal"]}.</p>
      <p>Known activation records: {format.format(answer.summary.known_activation_count)} / exact total: {display(answer.summary.activation_count)}. Observation support, distinct item support and original record support have different units.</p>
      <details><summary>Declared recipe, source qualification and frozen identity</summary><pre>{JSON.stringify(answer.definition, null, 2)}</pre><small>Result: {answer.result_id}</small><small>Population: {answer.identity.population_id}</small><small>Preparation: {answer.identity.preparation_id}</small></details>
      <button type="button" disabled={paused} onClick={download}>Download reviewed operator receipt</button>
      <button type="button" disabled={paused || (choices.size >= 32 && !choices.has(meaning(answer.query)))} onClick={retain}>Retain reviewed result for comparison and saving</button>
      <small>{choices.has(meaning(answer.query)) ? `This definition is retained · ${answer.definition_id}` : "This answer is current; it is not automatically appended to the retained comparison."}</small>
      <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Complete-item cohorts · observation groups can overlap</caption><thead><tr><th>Recorded state</th><th>PO items</th><th>Original records</th><th>Complete-history actions</th></tr></thead><tbody>{answer.selection_groups.map(group => <tr key={group.key}><th scope="row">{group.label}</th><td>{format.format(group.case_count)}</td><td>{format.format(group.record_count)}</td><td>{onKeepCases && <button type="button" disabled={paused || !group.case_count} onClick={() => onKeepCases(group.case_ids, `${answer.operation}: ${group.label}`)}>Keep {group.label} items</button>}{group.case_ids[0] && <button type="button" disabled={paused} onClick={() => onInspect(group.case_ids[0])}>Inspect {group.label} member</button>}</td></tr>)}</tbody></table></div>
      <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Interval distributions · episode weighting versus distinct item weighting</caption><thead><tr><th>Interval / support grain</th><th>Available / unavailable</th><th>Mean days</th><th>Median days</th><th>Zero intervals</th></tr></thead><tbody>{Object.entries(answer.summary.interval_distributions).flatMap(([name, groups]) => Object.entries(groups).map(([grain, distribution]) => <tr key={`${name}-${grain}`}><th scope="row">{plain(name)} / {plain(grain)}</th><td>{format.format(distribution.available_count)} / {format.format(distribution.unavailable_count)}</td><td>{display(distribution.mean)}</td><td>{display(distribution.median)}</td><td>{format.format(distribution.zero_count)}</td></tr>))}</tbody></table></div>
      {answer.summary.occupancy && <div><h3>Half-open waiting inventory</h3><p>{format.format(answer.summary.occupancy.available_interval_count)} available intervals · {format.format(answer.summary.occupancy.positive_duration_count)} positive · {format.format(answer.summary.occupancy.zero_duration_count)} zero. Peak {format.format(answer.summary.occupancy.peak)} PO items at [{answer.summary.occupancy.peak_start ?? "no positive interval"}, {answer.summary.occupancy.peak_end ?? "none"}).</p><p>{display(answer.summary.occupancy.item_days)} item-days over {display(answer.summary.occupancy.horizon_days)} horizon days · duration-weighted mean {display(answer.summary.occupancy.duration_weighted_mean)} items · lower median {display(answer.summary.occupancy.duration_weighted_lower_median)} items. Known censored intervals remain separately counted in the cohorts.</p>
        <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Occupancy segments · preview of {format.format(answer.summary.occupancy.segment_count)} segments</caption><thead><tr><th>Start inclusive</th><th>End exclusive</th><th>PO items</th></tr></thead><tbody>{answer.summary.occupancy.segments.map(segment => <tr key={segment.start}><td>{segment.start}</td><td>{segment.end}</td><td>{format.format(segment.occupancy)}</td></tr>)}</tbody></table></div>{!!answer.summary.occupancy.omitted_segment_count && <p>{format.format(answer.summary.occupancy.omitted_segment_count)} later segments omitted from this bounded preview; full-horizon summaries remain supplied.</p>}
        {!!answer.summary.occupancy.daily_snapshots.length && <details><summary>Declared daily snapshots</summary><div className="bpic19-operator-scroll"><table className="plain-table"><thead><tr><th>Snapshot timestamp</th><th>PO items</th></tr></thead><tbody>{answer.summary.occupancy.daily_snapshots.map(snapshot => <tr key={snapshot.timestamp}><td>{snapshot.timestamp}</td><td>{format.format(snapshot.occupancy)}</td></tr>)}</tbody></table></div></details>}
      </div>}
      <h3>Original item evidence</h3>{!answer.cases.length && <p>No items on this page. Empty retained populations remain explicit.</p>}{answer.cases.map(feature => <CaseEvidence key={`${answer.result_id}-${feature.case_id}`} feature={feature} disabled={paused} inspect={onInspect} hypothetical={answer.operation === "bpic19_cancellation"} />)}
      <div className="bpic19-operator-actions"><p>Items {answer.cases.length ? answer.offset + 1 : 0}–{answer.offset + answer.cases.length} of {format.format(answer.population_case_count)}.</p><button type="button" disabled={paused || answer.offset === 0} onClick={() => void load({ ...answer.query, offset: Math.max(0, answer.offset - answer.limit) })}>Previous item page</button><button type="button" disabled={paused || answer.next_offset === null} onClick={() => { if (answer.next_offset !== null) void load({ ...answer.query, offset: answer.next_offset }); }}>Next item page</button></div>
    </div>}
    <details className="bpic19-operator-comparison"><summary>Compare explicitly retained ordinal and FIFO definitions</summary>
      <p>Choose two retained recipes on this same frozen population. Each keeps its matching scope, raw histories, support and interval eligibility. Differences in the matched population are descriptive.</p>
      <div className="bpic19-operator-actions"><label>Retained ordinal definition<select value={leftChoice} onChange={event => changeComparison("left", event.target.value)}><option value="">Choose retained ordinal</option>{retainedChoices.filter(([,value]) => value.recipe?.kind === "ordinal").map(([key,value],index) => <option key={key} value={key}>{index+1}: {recipeLabel(value)}</option>)}</select></label>
        <label>Retained FIFO definition<select value={rightChoice} onChange={event => changeComparison("right", event.target.value)}><option value="">Choose retained FIFO</option>{retainedChoices.filter(([,value]) => value.recipe?.kind === "fifo").map(([key,value],index) => <option key={key} value={key}>{index+1}: {recipeLabel(value)}</option>)}</select></label>
        <button type="button" disabled={busy || compareBusy || !leftChoice || !rightChoice} onClick={() => void compare()}>Read retained ordinal/FIFO comparison</button>
        {reviewedComparison.current && <button type="button" disabled={busy || compareBusy} onClick={restoreComparison}>Restore reviewed ordinal/FIFO comparison</button>}
        {compareBusy && <button type="button" onClick={() => { ++compareSerial.current; compareController.current?.abort(); setCompareBusy(false); comparisonCallbacks.current.onComparisonValidityChange?.(false); setCompareProblem("Comparison request cancelled; retain or select the definitions before retrying."); }}>Cancel comparison request</button>}
      </div>
      {compareBusy && <p role="status">Reading both retained definitions… No partial pair is published.</p>}{compareProblem && <p role="alert">{compareProblem}</p>}
      {comparison && comparisonCurrent && <div data-stale={comparisonPaused ? "true" : undefined}>
        <button type="button" disabled={comparisonPaused} onClick={() => downloadJson({ format: "bpic19.operator-comparison.v1", identity, results: comparison }, "bpic19-ordinal-fifo-comparison.json")}>Download retained comparison receipt</button>
        <div className="bpic19-operator-controls">{comparison.map(result => <article key={result.definition_id}>
          <h3>{result.operation === "bpic19_ordinal" ? "Retained ordinal result" : "Retained FIFO result"}</h3>
          <p>{format.format(result.population_case_count)} complete PO items / {format.format(result.population_record_count)} original records · {format.format(result.summary.observation_count)} inferred observations.</p>
          <small>Definition {result.definition_id}</small><small>Result {result.result_id}</small><details><summary>Exact matching scope and policies</summary><pre>{JSON.stringify(result.definition, null, 2)}</pre></details>
          <div className="bpic19-operator-scroll"><table className="plain-table"><caption>{result.operation} whole-population known matching counts</caption><thead><tr><th>Quantity</th><th>Known event/episode sum</th><th>Available / unavailable item support</th></tr></thead><tbody>{Object.entries(result.summary.total_distributions).filter(([name]) => name === "paired_episode_count" || name === "paired_endpoint_event_count" || name === "unmatched_event_count" || /^stage_[0-9]+_(?:unmatched_)?event_count$/.test(name)).map(([name,value]) => <tr key={name}><th scope="row">{plain(name)}{name === "paired_episode_count" ? " · inferred episodes" : " · original events"}</th><td>{display(value.known_sum)}{value.known_sum_reason && <small>{plain(value.known_sum_reason)}</small>}</td><td>{format.format(value.available_count)} / {format.format(value.unavailable_count)}</td></tr>)}</tbody></table></div>
          <div className="bpic19-operator-scroll"><table className="plain-table"><caption>{result.operation} available interval distributions</caption><thead><tr><th>Interval / weighting</th><th>Available / unavailable</th><th>Mean days</th><th>Median days</th></tr></thead><tbody>{Object.entries(result.summary.interval_distributions).flatMap(([name,groups]) => Object.entries(groups).map(([grain,value]) => <tr key={`${name}-${grain}`}><th scope="row">{plain(name)} / {plain(grain)}</th><td>{format.format(value.available_count)} / {format.format(value.unavailable_count)}</td><td>{display(value.mean)}</td><td>{display(value.median)}</td></tr>))}</tbody></table></div>
          <p>Observation states: {Object.entries(result.summary.observation_state_counts).map(([state,count]) => `${plain(state)} ${format.format(count)}`).join(" · ") || "none"}. Signed reversed diagnostics remain in the original evidence below.</p>
          {result.cases.map(feature => <CaseEvidence key={`${result.result_id}-${feature.case_id}`} feature={feature} disabled={comparisonPaused} inspect={onInspect} />)}
          <small>Evidence preview: first {result.cases.length} items; counts and distributions cover the whole named population. Original endpoint witnesses remain original rows, and inferred episodes have no native invoice identifiers.</small>
        </article>)}</div>
      </div>}
    </details>
  </section>;
}
