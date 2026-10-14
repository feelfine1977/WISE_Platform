import { useEffect, useId, useRef, useState } from "react";
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
function meaning(query: OperatorQuery) { const { offset: _offset, limit: _limit, ...definition } = query; return JSON.stringify(definition); }

function Choice<K extends string>({ label, value, options, names, change }: { label: string; value: K; options: readonly K[]; names?: Partial<Record<K, string>>; change: (value: K) => void }) {
  return <label>{label}<select value={value} onChange={event => { const selected = options.find(option => option === event.target.value); if (selected !== undefined) change(selected); }}>{options.map(option => <option key={option} value={option}>{names?.[option] ?? plain(option)}</option>)}</select></label>;
}
function Labels({ label, value, change }: { label: string; value: string[]; change: (value: string[]) => void }) {
  return <label>{label}<textarea value={value.join("\n")} onChange={event => change(event.target.value.split("\n"))} spellCheck={false} /><small>1–8 distinct exact source labels, one per line. Spelling and case remain literal.</small></label>;
}
function EpisodeControls({ recipe, change }: { recipe: OrdinalRecipe | FifoRecipe; change: (recipe: OperatorRecipe) => void }) {
  return <>
    {recipe.kind === "ordinal" ? <Choice label="Ordinal ordering" value={recipe.order} options={["numeric_event_id", "timestamp_source_position"]} names={{ numeric_event_id: "Numeric original eventID · source-compatible ordinal", timestamp_source_position: "Parsed time, then original source position · distinct recipe" }} change={order => change({ ...recipe, order })} /> : <Choice label="FIFO ordering" value={recipe.order} options={["source_position", "timestamp_source_position"]} names={{ source_position: "Strictly later original source positions", timestamp_source_position: "Parsed time, then original source position" }} change={order => change({ ...recipe, order })} />}
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
    <p>Latest eligible target is selected within the same PO item. Matched target exclusion is an analytical view over immutable histories. Monetary totals remain separate; clearing records are retained.</p></>;
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
    <Choice label="Intervals outside the explicit horizon" value={recipe.horizon_policy} options={["refuse_outside", "clip"]} change={horizon_policy => change({ ...recipe, horizon_policy })} />
    <Choice label="Occupancy calendar" value={recipe.calendar} options={["elapsed_segments", "daily_snapshots"]} names={{ elapsed_segments: "Elapsed-time half-open segments and duration weighting", daily_snapshots: "Add daily snapshots anchored at horizon start" }} change={calendar => change({ ...recipe, calendar })} />
    <p>Half-open [start, end) inventory counts end events before simultaneous starts. Zero durations are valid and add no occupancy. Unknown response times are separate from known missing responses. Prepared clock: {plain(catalogue?.clock_kind ?? null)}; analyst-entered preparation cutoff: {catalogue?.trusted_cutoff ?? "unavailable — review source time preparation"}. Completed-only windows are retrospective; right censoring additionally requires reviewed observation-horizon authority.</p></>;
}

function CaseEvidence({ feature, disabled, inspect }: { feature: OperatorCase; disabled: boolean; inspect: (caseId: string, rowIds: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return <details className="bpic19-operator-item" onToggle={event => setOpen(event.currentTarget.open)}><summary>Item {feature.case_id} · {plain(feature.state)} · {feature.truth ? `rule ${plain(feature.truth)} · ` : ""}{format.format(feature.record_count)} original records</summary>
    {open && <><p>{plain(feature.reason)} · known activations {format.format(feature.known_activation_count)} / total {display(feature.activation_count)}.</p><button type="button" disabled={disabled} onClick={() => inspect(feature.case_id, feature.record_row_ids)}>Inspect complete item {feature.case_id}</button>
      <p>Matched/retained original records: {rows(feature.included_row_ids)}. Analytically excluded targets: {rows(feature.excluded_row_ids)}. Unmatched: {rows(feature.unmatched_row_ids)}. Unknown: {rows(feature.unknown_row_ids)}.</p>
      <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Item {feature.case_id} inferred observations and original witnesses</caption><thead><tr><th>Observation</th><th>Matching and candidate witnesses</th><th>Raw intervals</th><th>Evidence</th></tr></thead><tbody>{feature.observations.map(obs => <tr key={obs.observation_id}><th scope="row">{obs.ordinal} · {plain(obs.state)}<small>{plain(obs.reason)}{obs.truth && ` · ${obs.truth}`}</small>{obs.stage_row_ids && <small>Stage records: {obs.stage_row_ids.map(value => value ?? "unmatched").join(" → ")}</small>}<small>Inferred observation: {obs.observation_id}</small></th><td>Activation {rows(obs.activation_row_ids)}<small>Partner {rows(obs.response_row_ids)}</small><small>All tied candidates {rows(obs.candidate_row_ids)}</small><small>Unknown support {rows(obs.unknown_row_ids)}</small>{obs.start && <small>[{obs.start}, {obs.end})</small>}</td><td>{Object.entries(obs.intervals).map(([name, measure]) => <p key={name}>{plain(name)}: <strong>{display(measure.value)}</strong> {measure.unit}<small>{measure.available ? "available" : plain(measure.reason)}</small>{measure.recorded_difference_days !== undefined && <small>Signed diagnostic {display(measure.recorded_difference_days)} days</small>}</p>)}{obs.cancellation_value !== undefined && <small>Cancellation {display(obs.cancellation_value)} / target {display(obs.target_value ?? null)} source EUR</small>}</td><td><button type="button" disabled={disabled} onClick={() => inspect(feature.case_id, [...new Set([...obs.activation_row_ids, ...obs.response_row_ids, ...obs.candidate_row_ids, ...obs.unknown_row_ids, ...(obs.selected_row_ids ?? [])])])}>Inspect observation {obs.ordinal} of {feature.case_id}</button></td></tr>)}</tbody></table></div>
      {!!Object.keys(feature.totals).length && <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Item {feature.case_id} raw totals</caption><thead><tr><th>Measure</th><th>Raw value</th><th>Original witnesses</th></tr></thead><tbody>{Object.entries(feature.totals).map(([name, value]) => <tr key={name}><th scope="row">{plain(name)}</th><td>{display(value.value)} {value.unit}<small>{value.available ? "available" : plain(value.reason)}</small></td><td>{rows(value.row_ids)}<button type="button" disabled={disabled} onClick={() => inspect(feature.case_id, value.row_ids)}>Inspect {plain(name)}</button></td></tr>)}</tbody></table></div>}</>}
  </details>;
}

export interface Bpic19OperatorsProps {
  workspaceId: string; identity: AnswerIdentity; revision: number; roles: OperatorRoles; query?: OperatorQuery;
  columns?: { index: number; name: string }[]; client?: Bpic19OperatorClient;
  onInspect: (caseId: string, rowIds?: string[]) => void; onKeepCases?: (caseIds: string[], label: string) => void;
  onReviewed?: (answer: Bpic19OperatorAnswer) => void; onValidityChange?: (current: boolean) => void;
}

export function Bpic19Operators({ workspaceId, identity, revision, roles, query, columns, client = httpBpic19OperatorsClient, onInspect, onKeepCases, onReviewed, onValidityChange }: Bpic19OperatorsProps) {
  const heading = useId();
  const [draft, setDraft] = useState<OperatorQuery>(() => initial(roles, query));
  const [answer, setAnswer] = useState<Bpic19OperatorAnswer | null>(null), [catalogue, setCatalogue] = useState<OperatorCatalogue | null>(null);
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [cancelled, setCancelled] = useState(false);
  const controller = useRef<AbortController | null>(null), serial = useRef(0), retry = useRef<OperatorQuery | null>(null);
  const callbacks = useRef({ onReviewed, onValidityChange }); callbacks.current = { onReviewed, onValidityChange };
  const identityKey = JSON.stringify(identity), roleKey = JSON.stringify(roleBindings(roles)), queryKey = JSON.stringify(query ?? null);
  async function load(next: OperatorQuery) {
    const token = ++serial.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setProblem(null); setCancelled(false); retry.current = next; callbacks.current.onValidityChange?.(false);
    const request: Bpic19OperatorRequest = { schema_version: 1, message_type: "bpic19_operator_request", request_id: `bpic19-operators-${revision}-${token}`, query_revision: revision, workspace_id: workspaceId, identity, query: next };
    let outcome: Bpic19OperatorOutcome;
    try { outcome = await client.operators(request, abort.signal); } catch { outcome = { ok: false, problem: { kind: "unreachable" } }; }
    if (token !== serial.current || abort.signal.aborted) return;
    setBusy(false);
    if (!outcome.ok) { setProblem(outcome.problem.kind === "refusal" ? `${outcome.problem.refusal.message} (${outcome.problem.refusal.code})` : outcome.problem.kind === "unreachable" ? "The local service could not be reached. Retry this recipe." : outcome.problem.detail); return; }
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
  const recipe = draft.recipe ?? defaults("ordinal");
  const dirty = answer !== null && meaning(draft) !== meaning(answer.query);
  const paused = busy || !!problem || cancelled || dirty;
  useEffect(() => { callbacks.current.onValidityChange?.(answer !== null && !paused); }, [answer, paused, draft]);
  function edit(patch: Partial<OperatorQuery>) { ++serial.current; controller.current?.abort(); setBusy(false); setProblem(null); setCancelled(false); setDraft(current => ({ ...current, ...patch, offset: 0 })); callbacks.current.onValidityChange?.(false); }
  const change = (recipe: OperatorRecipe) => edit({ recipe });
  function cancel() { ++serial.current; controller.current?.abort(); setBusy(false); setCancelled(true); callbacks.current.onValidityChange?.(false); }
  function restore() { if (!answer) return; ++serial.current; controller.current?.abort(); setDraft(answer.query); setBusy(false); setProblem(null); setCancelled(false); callbacks.current.onReviewed?.(answer); }
  function download() { if (!answer || paused) return; const url = URL.createObjectURL(new Blob([JSON.stringify(answer, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${answer.operation}-${answer.result_id.split(":").at(-1)?.slice(0, 12)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
  const request: Bpic19OperatorRequest = { schema_version: 1, message_type: "bpic19_operator_request", request_id: "review", query_revision: revision, workspace_id: workspaceId, identity, query: { ...draft, recipe } };
  const needsAuthority = recipe.kind === "waiting" && recipe.completion === "right_censored" && !recipe.horizon_provenance?.trim();
  const valid = bpic19OperatorContract.request(request) && !needsAuthority;
  const bindings = columns ?? catalogue?.columns ?? [];
  return <section className="bpic19-operators" aria-labelledby={heading} aria-busy={busy}>
    <h2 id={heading}>Review recorded-event matching and waiting</h2>
    <p>Choose a finite descriptive recipe on the current complete PO items, inspect original witnesses, and retain complete histories. Alternative policies receive distinct definition identities.</p>
    <details open><summary>Review the declared operator definition</summary><div className="bpic19-operator-controls">
      <fieldset><legend>Recipe and original fields</legend><Choice label="Recorded-event operator" value={recipe.kind} options={kinds} names={kindLabels} change={kind => change(defaults(kind))} />
        {(["event_id", "item_category", "net_worth"] as const).map(role => <label key={role}>{role === "event_id" ? "Original eventID field" : role === "item_category" ? "Invariant item category field" : "Original source-EUR amount field"}<select value={draft.roles[role] ?? ""} onChange={event => edit({ roles: { ...draft.roles, [role]: event.target.value === "" ? null : Number(event.target.value) } })}><option value="">Unmapped · dependent recipe unavailable</option>{bindings.map(column => <option key={column.index} value={column.index}>{column.index}: {column.name || "unnamed column"}</option>)}</select></label>)}
        <details><summary>Exact activity catalogue for this population</summary><ul>{catalogue?.activities.map(activity => <li key={activity}><code>{activity}</code></li>)}</ul></details>
        <p>Mapping a role is an explicit review of original source cells. Timestamp and case bindings use the frozen preparation. Numeric-eventID ordering never falls back to another field.</p>
      </fieldset><fieldset><legend>{kindLabels[recipe.kind]}</legend>
        {(recipe.kind === "ordinal" || recipe.kind === "fifo") && <EpisodeControls recipe={recipe} change={change} />}
        {recipe.kind === "cancellation" && <CancellationControls recipe={recipe} change={change} />}
        {recipe.kind === "rule" && <RuleControls recipe={recipe} change={change} />}
        {recipe.kind === "waiting" && <WaitingControls recipe={recipe} change={change} catalogue={catalogue} />}
      </fieldset></div>
      <div className="bpic19-operator-actions"><button className="primary" type="button" disabled={busy || !valid} onClick={() => void load({ ...draft, recipe, offset: 0 })}>Review and run operator</button>{busy && <button type="button" onClick={cancel}>Cancel operator request</button>}{answer && (dirty || cancelled || problem) && <button type="button" onClick={restore}>Restore reviewed operator</button>}</div>
      {needsAuthority ? <p role="alert">Right censoring requires a reviewed source or observation authority for the declared horizon. Enter that provenance before running it.</p> : !valid && <p role="alert">Review the admitted parameters and 1–8 distinct exact labels before running this recipe.</p>}
    </details>
    {busy && <p role="status">Reading declared matching evidence… Earlier result actions are paused.</p>}{dirty && <p role="status">The definition has unreviewed changes. Run it to replace the earlier answer, or restore the reviewed definition.</p>}{cancelled && <p role="status">Operator request cancelled. The draft and original source remain available.</p>}
    {problem && <div role="alert"><p>{problem}</p><button type="button" disabled={busy} onClick={() => { if (retry.current) void load(retry.current); }}>Retry operator</button></div>}
    {answer && <div data-stale={paused ? "true" : undefined}>
      <p><strong>{format.format(answer.population_case_count)} complete PO items</strong> · {format.format(answer.population_record_count)} original records · {format.format(answer.summary.observation_count)} inferred observations · {kindLabels[answer.definition.recipe?.kind ?? "ordinal"]}.</p>
      <p>Known activation records: {format.format(answer.summary.known_activation_count)} / exact total: {display(answer.summary.activation_count)}. Observation support, distinct item support and original record support have different units.</p>
      <details><summary>Declared recipe, source qualification and frozen identity</summary><pre>{JSON.stringify(answer.definition, null, 2)}</pre><small>Result: {answer.result_id}</small><small>Population: {answer.identity.population_id}</small><small>Preparation: {answer.identity.preparation_id}</small></details>
      <button type="button" disabled={paused} onClick={download}>Download reviewed operator receipt</button>
      <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Complete-item cohorts · observation groups can overlap</caption><thead><tr><th>Recorded state</th><th>PO items</th><th>Original records</th><th>Complete-history actions</th></tr></thead><tbody>{answer.selection_groups.map(group => <tr key={group.key}><th scope="row">{group.label}</th><td>{format.format(group.case_count)}</td><td>{format.format(group.record_count)}</td><td>{onKeepCases && <button type="button" disabled={paused || !group.case_count} onClick={() => onKeepCases(group.case_ids, `${answer.operation}: ${group.label}`)}>Keep {group.label} items</button>}{group.case_ids[0] && <button type="button" disabled={paused} onClick={() => onInspect(group.case_ids[0])}>Inspect {group.label} member</button>}</td></tr>)}</tbody></table></div>
      <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Interval distributions · episode weighting versus distinct item weighting</caption><thead><tr><th>Interval / support grain</th><th>Available / unavailable</th><th>Mean days</th><th>Median days</th><th>Zero intervals</th></tr></thead><tbody>{Object.entries(answer.summary.interval_distributions).flatMap(([name, groups]) => Object.entries(groups).map(([grain, distribution]) => <tr key={`${name}-${grain}`}><th scope="row">{plain(name)} / {plain(grain)}</th><td>{format.format(distribution.available_count)} / {format.format(distribution.unavailable_count)}</td><td>{display(distribution.mean)}</td><td>{display(distribution.median)}</td><td>{format.format(distribution.zero_count)}</td></tr>))}</tbody></table></div>
      {answer.summary.occupancy && <div><h3>Half-open waiting inventory</h3><p>{format.format(answer.summary.occupancy.available_interval_count)} available intervals · {format.format(answer.summary.occupancy.positive_duration_count)} positive · {format.format(answer.summary.occupancy.zero_duration_count)} zero. Peak {format.format(answer.summary.occupancy.peak)} PO items at [{answer.summary.occupancy.peak_start ?? "no positive interval"}, {answer.summary.occupancy.peak_end ?? "none"}).</p><p>{display(answer.summary.occupancy.item_days)} item-days over {display(answer.summary.occupancy.horizon_days)} horizon days · duration-weighted mean {display(answer.summary.occupancy.duration_weighted_mean)} items · lower median {display(answer.summary.occupancy.duration_weighted_lower_median)} items. Known censored intervals remain separately counted in the cohorts.</p>
        <div className="bpic19-operator-scroll"><table className="plain-table"><caption>Occupancy segments · preview of {format.format(answer.summary.occupancy.segment_count)} segments</caption><thead><tr><th>Start inclusive</th><th>End exclusive</th><th>PO items</th></tr></thead><tbody>{answer.summary.occupancy.segments.map(segment => <tr key={segment.start}><td>{segment.start}</td><td>{segment.end}</td><td>{format.format(segment.occupancy)}</td></tr>)}</tbody></table></div>{!!answer.summary.occupancy.omitted_segment_count && <p>{format.format(answer.summary.occupancy.omitted_segment_count)} later segments omitted from this bounded preview; full-horizon summaries remain supplied.</p>}
        {!!answer.summary.occupancy.daily_snapshots.length && <details><summary>Declared daily snapshots</summary><div className="bpic19-operator-scroll"><table className="plain-table"><thead><tr><th>Snapshot timestamp</th><th>PO items</th></tr></thead><tbody>{answer.summary.occupancy.daily_snapshots.map(snapshot => <tr key={snapshot.timestamp}><td>{snapshot.timestamp}</td><td>{format.format(snapshot.occupancy)}</td></tr>)}</tbody></table></div></details>}
      </div>}
      <h3>Original item evidence</h3>{!answer.cases.length && <p>No items on this page. Empty retained populations remain explicit.</p>}{answer.cases.map(feature => <CaseEvidence key={`${answer.result_id}-${feature.case_id}`} feature={feature} disabled={paused} inspect={onInspect} />)}
      <div className="bpic19-operator-actions"><p>Items {answer.cases.length ? answer.offset + 1 : 0}–{answer.offset + answer.cases.length} of {format.format(answer.population_case_count)}.</p><button type="button" disabled={paused || answer.offset === 0} onClick={() => void load({ ...answer.query, offset: Math.max(0, answer.offset - answer.limit) })}>Previous item page</button><button type="button" disabled={paused || answer.next_offset === null} onClick={() => { if (answer.next_offset !== null) void load({ ...answer.query, offset: answer.next_offset }); }}>Next item page</button></div>
    </div>}
  </section>;
}
