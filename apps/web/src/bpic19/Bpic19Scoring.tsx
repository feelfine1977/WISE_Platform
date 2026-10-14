import { useEffect, useRef, useState } from "react";
import { localBpic19Client, type Bpic19Client } from "./scoring-client";
import type { AnswerIdentity, Bpic19ReadRequest, Bpic19ScoreAnswer, Bpic19ScoreRequest, CaseAssessment, NativeRow, NamedPopulation, Roles, Settings } from "./scoring-types";
import "./scoring.css";
import reference from "./scoring-reference.json";
import { Bpic19Associations } from "./Bpic19Associations";
import { Bpic19Review } from "./Bpic19Review";

interface PreviewNorm {
  name: string;
  constraints: { id: string; layer: string; description: string; weight?: number;
    params: { attribute: string; threshold: number; width: number; direction: string }; applicability: { flow?: string[] } }[];
  views: { name: string; constraint_weights?: Record<string, number>; layer_weights?: Record<string, number> }[];
  metadata?: Record<string, unknown>;
}

export interface Bpic19ScoringSubject {
  workspace_id: string;
  base_identity: AnswerIdentity;
  named_population: NamedPopulation;
  roles: Roles;
}
export interface Bpic19ScoringProps {
  subject: Bpic19ScoringSubject;
  client?: Bpic19Client;
  initialRun?: Bpic19ScoreAnswer;
  onRun?: (answer: Bpic19ScoreAnswer) => void;
  onInspect?: (caseId: string, rowIds?: string[]) => void;
  onInspectDocument?: (document: string) => void;
  revision?: number;
  onReviewed?: (answer: Bpic19ScoreAnswer) => void;
  onValidityChange?: (current: boolean) => void;
  onKeepCases?: (caseIds: string[], label: string) => void;
}
const defaults: Settings = { profile: "paper", criteria_family: "full", view: "Balanced", mode: "flat", gamma: 0,
  group_by: ["company", "spend_area"], min_cases: 1, volume: "cases", exposure_policy: "max_absolute_p95", association_min_support:1 };
const paperViews = ["Balanced", "Completion", "Operations"] as const;
const historicalViews = ["Finance", "Logistics", "Compliance", "Automation"] as const;
function restoredSettings(answer?: Bpic19ScoreAnswer): Settings {
  if (!answer) return defaults;
  const stored = answer.report.settings;
  const profile = answer.report.profile_id.startsWith("bpic19.notebook") ? "historical" : "paper";
  const views: readonly string[] = profile === "historical" ? historicalViews : paperViews;
  return { profile, criteria_family: stored.criteria_family, view: (views.includes(stored.view) ? stored.view : views[0]) as Settings["view"],
    mode: stored.mode === "layer_balanced" ? "layer_balanced" : "flat", gamma: stored.gamma,
    group_by: stored.group_by as Settings["group_by"], min_cases: stored.min_cases,
    association_min_support: stored.association_min_support ?? 1,
    volume: stored.volume === "exposure" ? "exposure" : "cases",
    exposure_policy: (["creation_value", "creation_unique_event", "creation_unique_value"].includes(String(answer.report.exposure_calibration?.policy)) ?
      answer.report.exposure_calibration?.policy : "max_absolute_p95") as Settings["exposure_policy"] };
}
function number(value: unknown): string {
  if (value === null || value === undefined) return "Unavailable";
  return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(value);
}
function sameIdentity(a: AnswerIdentity, b: AnswerIdentity): boolean {
  return (Object.keys(a) as (keyof AnswerIdentity)[]).every(key => a[key] === b[key]);
}
function sameRoles(a: unknown, b: Roles): boolean {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const roles = a as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(roles), ...Object.keys(b)])];
  return keys.every(key => roles[key] === b[key as keyof Roles]);
}
function recipeText(norm: PreviewNorm, criterionId: string): string {
  const catalogue = norm.metadata?.raw_binding_recipe ?? norm.metadata?.source_operators;
  if (!catalogue || typeof catalogue !== "object" || Array.isArray(catalogue)) return "";
  const recipe = (catalogue as Record<string, unknown>)[criterionId];
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return "";
  const values = recipe as Record<string, unknown>;
  const entries = values.params && typeof values.params === "object" && !Array.isArray(values.params) ? values.params as Record<string, unknown> : values;
  return Object.entries(entries).map(([key,value]) => `${key.replaceAll("_"," ")}: ${Array.isArray(value) ? value.join(" or ") : typeof value === "object" ? JSON.stringify(value) : key === "operator" || key === "normalization" ? String(value).replaceAll("_"," ") : String(value)}`).join("; ");
}
function Cases({ cases, onInspect }: { cases: CaseAssessment[]; onInspect?: Bpic19ScoringProps["onInspect"] }) {
  const [open, setOpen] = useState<string | null>(null);
  return <div className="bpic19-table-wrap"><table><caption>Scored item evidence</caption><thead><tr>
    <th>PO item</th><th>Flow</th><th>Score</th><th>Evidence coverage</th><th>Document</th><th>Evidence</th>
  </tr></thead><tbody>{cases.map(item => <CaseRows key={item.case_id} item={item} open={open === item.case_id}
    toggle={() => setOpen(open === item.case_id ? null : item.case_id)} onInspect={onInspect} />)}</tbody></table></div>;
}
function CaseRows({ item, open, toggle, onInspect }: { item: CaseAssessment; open: boolean; toggle: () => void; onInspect?: Bpic19ScoringProps["onInspect"] }) {
  return <><tr><td><button type="button" className="bpic19-text-button" aria-expanded={open} onClick={toggle}>{item.case_id}</button></td>
    <td>{item.flow ?? "Unknown"}</td><td>{number(item.score)}</td><td>{number(item.coverage)} ({number(item.evaluated_raw_weight)} / {number(item.in_scope_raw_weight)} raw weight)</td>
    <td>{item.document ?? "Missing"}</td><td>{onInspect && <button type="button" onClick={() => onInspect(item.case_id)}>Inspect records</button>}</td></tr>
    {open && <tr><td colSpan={6}><p>{item.scope_unknown_count} criteria have unknown scope. Unavailable criteria retain their own reasons.</p>
      <table><caption>Criterion verdicts for {item.case_id}</caption><thead><tr><th>Criterion</th><th>Layer</th><th>Measurement</th><th>State</th><th>Deviation</th><th>Raw weight</th><th>Effective weight</th><th>Penalty</th><th>Witness</th></tr></thead>
        <tbody>{item.criteria.map(c => <tr key={c.criterion_id}><td>{c.criterion_id}</td><td>{c.layer}</td><td>{number(c.measurement)}</td>
          <td>{c.reason}{c.measurement_reason ? ` · ${c.measurement_reason}` : ""}</td><td>{number(c.deviation)}</td><td>{number(c.raw_weight)}</td><td>{number(c.effective_weight)}</td><td>{number(c.penalty)}</td>
          <td>{onInspect && c.row_ids.length > 0 ? <button type="button" onClick={() => onInspect(item.case_id, [...new Set([...c.row_ids,
            ...(Array.isArray(c.measurement_evidence?.unknown_row_ids) ? c.measurement_evidence.unknown_row_ids.filter((v):v is string => typeof v === "string") : [])])])}>{c.row_ids.length} source records</button> : `${c.row_ids.length} source records`}
            {c.measurement_evidence?.known_matching_lower_bound !== undefined && <small>Known matching lower bound {number(c.measurement_evidence.known_matching_lower_bound)}; exact count unavailable; unknown label records remain in the witness.</small>}
            {onInspect && c.row_ids.length === 0 && Array.isArray(c.measurement_evidence?.unknown_row_ids) && <button type="button" onClick={() => onInspect(item.case_id,c.measurement_evidence!.unknown_row_ids as string[])}>Inspect unknown labels</button>}
            {onInspect && Array.isArray(c.measurement_evidence?.absence_row_ids) && c.measurement_evidence.absence_row_ids.length > 0 && <button type="button" onClick={() => onInspect(item.case_id,c.measurement_evidence!.absence_row_ids as string[])}>Inspect complete-label absence evidence</button>}</td></tr>)}</tbody></table>
      {item.historical_artifacts && <details><summary>Historical quarter, paths and replication proxy</summary><p>Quarter {String(item.historical_artifacts.start_quarter ?? "Unavailable")}. Original events divided by distinct parsed timestamps is a replication proxy, not a verified duplicate count. Historical timestamps retain their source range policy.</p><pre>{JSON.stringify(item.historical_artifacts,null,2)}</pre></details>}
      </td></tr>}</>;
}
function NativeTable({ caption, rows, columns, onDocument, onMembers }: { caption: string; rows: NativeRow[]; columns: string[]; onDocument?: Bpic19ScoringProps["onInspectDocument"]; onMembers?: (row: NativeRow) => void }) {
  return <div className="bpic19-table-wrap"><table><caption>{caption}</caption><thead><tr>{columns.map(c => <th key={c}>{c.replaceAll("_", " ")}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{columns.map(c => <td key={c}>{c === "document" && typeof row[c] === "string" && onDocument ?
      <button className="bpic19-text-button" type="button" onClick={() => onDocument(row[c] as string)}>{row[c]}</button> : number(row[c])}</td>)}</tr>)}</tbody></table>
    {onMembers && rows.map((row, i) => <button type="button" key={i} onClick={() => onMembers(row)}>Inspect members of {columns.filter(c => typeof row[c] === "string").map(c => row[c]).join(" · ") || `group ${i+1}`}</button>)}
    {rows.length === 0 && <p>No eligible groups for these settings.</p>}</div>;
}
export function Bpic19Scoring({ subject, client = localBpic19Client, initialRun, onRun, onInspect, onInspectDocument, revision,
  onReviewed, onValidityChange, onKeepCases }: Bpic19ScoringProps) {
  const [settings, setSettings] = useState<Settings>(() => restoredSettings(initialRun));
  const [answer, setAnswer] = useState<Bpic19ScoreAnswer | null>(initialRun ?? null);
  const [resultSettings, setResultSettings] = useState<string | null>(initialRun ? JSON.stringify(restoredSettings(initialRun)) : null);
  const [resultSubject, setResultSubject] = useState<string | null>(initialRun &&
    (!initialRun.definition || sameRoles(initialRun.definition.roles, subject.roles)) ? JSON.stringify({subject, revision}) : null);
  const [caseFilter, setCaseFilter] = useState<Bpic19ReadRequest["case_filter"] | undefined>();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onReviewed, onValidityChange }); callbacks.current = { onReviewed, onValidityChange };
  const subjectKey = JSON.stringify({subject, revision});
  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    setPending(false); setProblem(null);
    setAnswer(previous => previous && sameIdentity(previous.base_identity, subject.base_identity) &&
      sameIdentity(previous.named_population.identity, subject.named_population.identity) ? previous : null);
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [subjectKey, settingsKey]);
  useEffect(() => { callbacks.current.onValidityChange?.(Boolean(answer && resultSettings === settingsKey && resultSubject === subjectKey && !pending));
    return () => callbacks.current.onValidityChange?.(false);
  }, [answer, resultSettings, settingsKey, resultSubject, subjectKey, pending]);
  const update = (patch: Partial<Settings>) => setSettings(current => ({ ...current, ...patch }));
  const run = async (offset: number | null = null, filter: Bpic19ReadRequest["case_filter"] | null = caseFilter, groupOffset?: number) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const mine = ++generation.current;
    setPending(true); setProblem(null);
    const envelope = { schema_version: 1 as const, request_id: crypto.randomUUID(), query_revision: revision ?? mine,
      workspace_id: subject.workspace_id, case_offset: offset ?? 0, case_limit: 50, group_offset: groupOffset ?? answer?.report.group_page.offset ?? 0, group_limit: 50 };
    const paging = offset !== null && answer && resultSettings === settingsKey;
    const outcome = paging ? await client.read({ ...envelope, message_type: "bpic19_read_request", run_id: answer.run_id, ...(filter ? {case_filter: filter} : {}) }, abort.signal) :
      await client.score({ ...envelope, message_type: "bpic19_score_request", base_identity: subject.base_identity,
        named_population: subject.named_population, roles: subject.roles, settings } satisfies Bpic19ScoreRequest, abort.signal);
    if (mine !== generation.current || abort.signal.aborted) return;
    setPending(false);
    if (!outcome.ok) { setProblem(outcome.message); return; }
    const next = outcome.answer;
    if (next.request_id !== envelope.request_id || next.query_revision !== envelope.query_revision || next.workspace_id !== subject.workspace_id ||
      !sameIdentity(next.base_identity, subject.base_identity) || !sameIdentity(next.named_population.identity, subject.named_population.identity)) {
      setProblem("The answer belongs to another source or population. Retry this analysis."); return;
    }
    setAnswer(next); setResultSettings(settingsKey); setResultSubject(subjectKey); setCaseFilter(paging ? filter ?? undefined : undefined);
    onRun?.(next); callbacks.current.onReviewed?.(next);
  };
  const current = answer && resultSettings === settingsKey && resultSubject === subjectKey && sameIdentity(answer.base_identity, subject.base_identity) &&
    sameIdentity(answer.named_population.identity, subject.named_population.identity);
  const report = current ? answer.report : null;
  const preview: PreviewNorm = settings.profile === "paper" ? reference.paper[settings.criteria_family] : reference.historical;
  const previewView = preview.views.find(view => view.name === settings.view);
  const exportRun = async () => {
    if (!answer || !current || !client.export) return;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const mine = ++generation.current; setPending(true); setProblem(null);
    const outcome = await client.export({ schema_version: 1, message_type: "bpic19_export_request", request_id: crypto.randomUUID(),
      query_revision: revision ?? mine, workspace_id: subject.workspace_id, run_id: answer.run_id, case_offset: 0, case_limit: 50 }, abort.signal);
    if (mine !== generation.current || abort.signal.aborted) return;
    setPending(false);
    if (!outcome.ok) { setProblem(outcome.message); return; }
    const url = URL.createObjectURL(outcome.blob), link = document.createElement("a"); link.href = url;
    link.download = "bpic19-native-run.zip"; link.click(); setTimeout(() => URL.revokeObjectURL(url),0);
  };
  return <section className="bpic19-scoring" aria-label="BPIC19 criterion analysis">
    <h2>Criteria and priorities</h2><p>Assess {subject.named_population.name} at PO item grain, then inspect business groups and purchasing documents.</p>
    <form className="bpic19-controls" onSubmit={event => { event.preventDefault(); void run(); }}>
      <label>Reference profile<select value={settings.profile} onChange={e => update(e.target.value === "paper" ? { profile: "paper", criteria_family: "full", view: "Balanced", mode: "flat", gamma: 0 } : { profile: "historical", criteria_family: "full", view: "Finance", mode: "layer_balanced", gamma: 20 })}>
        <option value="paper">WISE paper · 10 criteria</option><option value="historical">Historical notebook · 29 criteria</option></select></label>
      {settings.profile === "paper" && <label>Criterion assembly<select value={settings.criteria_family} onChange={e => update({ criteria_family: e.target.value as Settings["criteria_family"] })}>
        <option value="completion">Completion · C01–C03</option><option value="completion_timing">Completion and timing · C01–C05</option>
        <option value="completion_rework_effort">Completion, rework and effort · 8 criteria</option><option value="full">Full paper · C01–C10</option></select></label>}
      <label>Stakeholder view<select value={settings.view} onChange={e => update({ view: e.target.value as Settings["view"] })}>{(settings.profile === "paper" ? paperViews : historicalViews).map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Scoring mode<select value={settings.mode} disabled={settings.profile === "historical"} onChange={e => update({ mode: e.target.value as Settings["mode"] })}><option value="flat">Flat criterion weights</option><option value="layer_balanced">Layer balanced</option></select></label>
      <label>Group by<select value={settings.group_by.join(",")} onChange={e => update({ group_by: e.target.value.split(",") as Settings["group_by"] })}>
        <option value="company,spend_area">Company × spend area</option><option value="flow">Purchasing flow</option><option value="flow,item_type">Flow × item type</option><option value="document">Purchasing document</option></select></label>
      <label>Gamma<input type="number" min="0" step="any" value={settings.gamma} onChange={e => update({ gamma: Number(e.target.value) })} /></label>
      <label>Minimum scored items<input type="number" min="1" step="1" value={settings.min_cases} onChange={e => update({ min_cases: Number(e.target.value) })} /></label>
      <label>Association minimum support<input type="number" min="1" step="1" value={settings.association_min_support ?? 1} onChange={e => update({association_min_support:Number(e.target.value)})} /></label>
      <label>Priority multiplier<select value={settings.volume} onChange={e => update({ volume: e.target.value as Settings["volume"] })}><option value="cases">Scored item count</option><option value="exposure">Reviewed exposure</option></select></label>
      {settings.volume === "exposure" && <label>Exposure recipe<select value={settings.exposure_policy} onChange={e => update({ exposure_policy: e.target.value as Settings["exposure_policy"] })}><option value="max_absolute_p95">Maximum absolute value · frozen parent 95th percentile</option><option value="creation_unique_event">Unique creation event value</option><option value="creation_unique_value">Unique finite creation value</option></select></label>}
      <button type="submit" disabled={pending || !Number.isFinite(settings.gamma) || settings.gamma < 0 || !Number.isInteger(settings.min_cases) || settings.min_cases < 1 || !Number.isInteger(settings.association_min_support ?? 1) || (settings.association_min_support ?? 1) < 1}>{pending ? "Analysing…" : "Run analysis"}</button>
      {pending && <button type="button" onClick={() => { generation.current += 1; controller.current?.abort(); setPending(false); setResultSettings(null); }}>Cancel</button>}
    </form>
    <details className="bpic19-definition-preview"><summary>Review criterion definitions and stakeholder weights before running</summary>
      <p>{settings.profile === "paper" ? "WISE_12_10_2026.pdf · Table B2, PDF page 35; weights Table B3, PDF page 36." : "Historical notebook norm bpic19_norm_v1.json · version 1.0-paper-aligned, 7 March 2026."}
        {` ${preview.constraints.length} criteria compiled for ${settings.view}. Thresholds are researcher screening choices.`}</p>
      <div className="bpic19-table-wrap"><table><caption>Selected native definitions</caption><thead><tr><th>Criterion</th><th>Meaning</th><th>Raw measurement</th><th>Scope</th><th>Direction</th><th>Threshold</th><th>Width</th><th>Raw weight</th><th>Supplied mandatory control</th></tr></thead>
        <tbody>{preview.constraints.map(c => <tr key={c.id}><td>{c.id}</td><td>{c.description}</td><td>{c.params.attribute}<small>{recipeText(preview,c.id)}</small></td><td>{c.applicability.flow?.join(", ") ?? "All flows"}</td>
          <td>{c.params.direction}</td><td>{c.params.threshold}</td><td>{c.params.width}</td><td>{previewView?.constraint_weights ? number(previewView.constraint_weights[c.id]) : `${number(c.weight)} within layer; ${number(previewView?.layer_weights?.[c.layer])} layer weight`}</td><td>{answer?.report.analysis_review?.mandatory_controls.find(control=>control.criterion_id===c.id)?.mandatory === undefined ? "No flag supplied" : answer.report.analysis_review.mandatory_controls.find(control=>control.criterion_id===c.id)?.mandatory ? "Mandatory" : "Not mandatory"}</td></tr>)}</tbody></table></div>
      <p>Paper timing selects independent parsed minima in 2017–2019. Paper resource measures require every record to match a user or batch identity. Historical recipes retain their separate invoice union, timestamp, attribution and frozen exposure rules.</p>
    </details>
    <p className="bpic19-muted">Gamma changes ranking stability. Priorities use the arithmetic mean of scored items; exposure changes the multiplier. Associations and effort measures describe proxies.</p>
    {problem && <p role="alert">{problem}</p>}
    {answer && !current && <p role="status">Settings changed. Run the analysis to produce a result for these settings.</p>}
    {report && <>
      <p role="status">{number(report.scored_case_count)} of {number(report.population_case_count)} items scored · mean score {number(report.mean_score)} · mean evidence coverage {number(report.mean_coverage)} · {report.settings.view}, {report.settings.mode}, gamma {number(report.settings.gamma)}.</p>
      {!report.profile_complete && <p role="alert">Partial profile: {report.admitted_criterion_count} of {report.requested_criterion_count} criteria admitted. Full numeric parity is unavailable.</p>}
      <NativeTable caption={`Business group priorities · ${report.groups.length} shown of ${report.group_page.total}`} rows={report.groups} columns={[...report.settings.group_by, "n_cases", "mean_score", "volume", "PI", "stable_PI", "global_mean"]}
        onMembers={row => void run(0, {group_values: Object.fromEntries(report.settings.group_by.map(k => [k, typeof row[k] === "string" ? row[k] : null]))})} />
      <NativeTable caption="Signed layer drivers · native penalty deltas and raw/adjusted priority terms, negative offsets retained" rows={report.layer_drivers} columns={[...report.settings.group_by, ...Object.keys(report.layer_drivers[0] ?? {}).filter(c => c.endsWith("__delta") || c.endsWith("__signed_PI") || c.endsWith("__signed_stable_PI"))]} />
      <NativeTable caption="All stakeholder views · same frozen evidence" rows={report.view_summaries} columns={[...new Set(report.view_summaries.flatMap(row => Object.keys(row)))]} />
      {report.ranking_comparisons && <details><summary>Compare native document shortlists and group ranking policies</summary>
        <p>{report.ranking_comparisons.interpretation}. Document shortlists contain at most twenty positive-priority documents. Empty unions have unavailable overlap.</p>
        <NativeTable caption="Positive-priority document shortlist overlap" rows={report.ranking_comparisons.document_overlaps} columns={["left","right","left_count","right_count","intersection_count","union_count","jaccard","reason"]} />
        {Object.entries(report.ranking_comparisons.views).map(([view,comparison]) => <div key={view}><NativeTable caption={`${view} native document shortlist · ${comparison.state}`} rows={comparison.documents} columns={["document","n_cases","mean_score","global_mean","PI","stable_PI"]}
          onMembers={row => void run(0,{group_values:{document:typeof row.document === "string" ? row.document : null}})} />
          <details><summary>{view} frozen reference</summary><pre>{JSON.stringify(comparison.document_reference,null,2)}</pre></details></div>)}
        {Object.entries(report.ranking_comparisons.group_policies).map(([policy,groups]) => <NativeTable key={policy} caption={`${report.settings.view} group ranking · ${policy.replaceAll("_"," ")}`} rows={groups}
          columns={[...report.settings.group_by,"n_cases","mean_penalty","penalty_mass","mean_score","global_mean","PI","stable_PI"]} />)}
      </details>}
      <NativeTable caption={`Purchasing document priorities · ${report.documents.length} shown of ${report.group_page.document_total} · scored items per document`} rows={report.documents} columns={["document", "n_cases", "member_count", "unscored_member_count", "mean_score", "volume", "PI", "stable_PI", "positive_PI_share"]} onDocument={onInspectDocument}
        onMembers={row => void run(0, {group_values: {document: typeof row.document === "string" ? row.document : null}})} />
      <div className="bpic19-pagination"><button type="button" disabled={pending || report.group_page.offset === 0} onClick={() => void run(0, caseFilter, Math.max(0,report.group_page.offset-report.group_page.limit))}>Previous ranked groups</button>
        <button type="button" disabled={pending || report.group_page.offset+report.group_page.limit >= Math.max(report.group_page.total,report.group_page.document_total)} onClick={() => void run(0,caseFilter,report.group_page.offset+report.group_page.limit)}>Next ranked groups</button></div>
      <NativeTable caption="Criterion evidence denominators and severity" rows={report.criterion_statistics ?? []} columns={["criterion_id", "total_case_count", "eligible_case_count", "positive_case_count", "unavailable_case_count", "eligible_firing_rate", "total_case_positive_fraction", "eligible_mean_severity", "conditional_positive_severity", "native_penalty_sum"]}
        onMembers={row => void run(0, {criterion_id: String(row.criterion_id),criterion_state:"positive"})} />
      <NativeTable caption="Criterion co-occurrence · jointly evaluated items, descriptive associations" rows={report.associations} columns={["left", "right", "eligible_case_count", "left_positive", "right_positive", "support", "jaccard", "lift","dependency"]}
        onMembers={row => void run(0,{criterion_id:String(row.left),right_criterion_id:String(row.right),criterion_state:"positive"})} />
      {!!report.suppressed_associations?.length && <details><summary>Suppressed pairs and zero-support statistics</summary><NativeTable caption="Pairs below reviewed minimum support" rows={report.suppressed_associations} columns={["left","right","eligible_case_count","support","suppression_reason","jaccard","jaccard_reason","lift","lift_reason"]}
        onMembers={row => void run(0,{criterion_id:String(row.left),right_criterion_id:String(row.right),criterion_state:"positive"})} /></details>}
      {client.associate && answer && <Bpic19Associations key={answer.run_id} answer={answer} client={client} revision={revision}
        onReviewed={next=>{setAnswer(next);setResultSettings(settingsKey);setResultSubject(subjectKey);onRun?.(next);callbacks.current.onReviewed?.(next);}}
        onValidityChange={valid=>callbacks.current.onValidityChange?.(valid)} onMembers={filter=>void run(0,filter)} />}
      {client.review && answer && <Bpic19Review key={answer.run_id+":review"} answer={answer} client={client} revision={revision}
        onReviewed={next=>{setAnswer(next);setResultSettings(settingsKey);setResultSubject(subjectKey);onRun?.(next);callbacks.current.onReviewed?.(next);}}
        onValidityChange={valid=>callbacks.current.onValidityChange?.(valid)} />}
      {report.representation_scores && <div><h3>Scored paths and signatures</h3><p>These joins use this frozen run. Exact paths retain repetitions; first-occurrence signatures keep only the first occurrence of each activity. {number(report.representation_page?.unavailable_case_count)} items have unavailable sequence evidence.</p>
        {(["exact","signature"] as const).map(kind => <div key={kind} className="bpic19-table-wrap"><table><caption>{kind === "exact" ? "Exact path baseline" : "First-occurrence signature comparison"}</caption>
          <thead><tr><th>Recorded path</th><th>All items</th><th>Scored items</th><th>Unscored items</th><th>Native mean score</th><th>Native mean penalty</th><th>Native summed penalty mass</th><th>Native priority</th><th>State</th><th>Evidence</th></tr></thead>
          <tbody>{report.representation_scores![kind].map(group => <tr key={group.group_id}><td>{group.sequence.join(" → ")}</td><td>{number(group.member_count)}</td><td>{number(group.scored_case_count)}</td><td>{number(group.unscored_case_count)}</td><td>{number(group.mean_score)}</td><td>{number(group.mean_penalty)}</td><td>{number(group.summed_penalty_mass)}</td><td>{number(group.PI)}</td><td>{group.state}</td>
            <td><button type="button" disabled={pending} onClick={() => void run(0,{representation_group:{kind,group_id:group.group_id}})}>Inspect stored path members</button><details><summary>Native penalty mass</summary><pre>{JSON.stringify(group.native_penalty_mass,null,2)}</pre></details></td></tr>)}</tbody></table></div>)}
      </div>}
      {!!report.exemplars?.length && <div><h3>Timing exemplars</h3>{report.exemplars.map((entry,i) => <p key={i}>{String(entry.case_id)} · all-evaluable median {number(entry.reference_median_days)} days · evaluated support {number(entry.evaluated_support)} · positive candidates {number(entry.positive_support)}.
        {onInspect && typeof entry.case_id === "string" && <button type="button" onClick={() => onInspect(entry.case_id as string, Array.isArray(entry.row_ids) ? entry.row_ids.filter((v): v is string => typeof v === "string") : [])}>Inspect timing exemplar</button>}</p>)}</div>}
      {report.selector_warnings?.map((warning,i) => <p key={i} role="status">{String(warning.message)}</p>)}
      {caseFilter && <p>Inspecting stored members; the parent scores and reference are unchanged. <button type="button" disabled={pending} onClick={() => void run(0,null)}>Show all assessed items</button></p>}
      <Cases cases={report.case_page.cases} onInspect={onInspect} />
      {onKeepCases && <button type="button" disabled={pending || !report.case_page.cases.length} onClick={() => onKeepCases(report.case_page.cases.map(c => c.case_id), "Stored native result · current evidence page")}>Keep these complete items</button>}
      <div className="bpic19-pagination"><span>Items {report.case_page.offset + 1}–{report.case_page.offset + report.case_page.cases.length} of {report.case_page.total}</span>
        <button type="button" disabled={pending || report.case_page.offset === 0} onClick={() => void run(Math.max(0, report.case_page.offset - report.case_page.limit))}>Previous items</button>
        <button type="button" disabled={pending || report.case_page.offset + report.case_page.cases.length >= report.case_page.total} onClick={() => void run(report.case_page.offset + report.case_page.limit)}>Next items</button></div>
      <details><summary>Definition, source and run receipt</summary><p>Profile {report.profile_id}. {report.admitted_criterion_count} criteria admitted. Method {report.method_artifact.version}, {report.method_artifact.qualification}. Run {answer?.run_id}.</p>
        <p>Norm fingerprint: {report.norm_fingerprint}</p><pre>{JSON.stringify({ norm: report.norm, settings: report.settings, exposure: report.exposure_calibration, omissions: report.omissions }, null, 2)}</pre></details>
      {client.export && <button type="button" disabled={pending} onClick={() => void exportRun()}>Export complete native run</button>}
    </>}
  </section>;
}
