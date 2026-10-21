import { useEffect, useMemo, useRef, useState } from "react";
import { sameJson } from "../data/coordinator";
import type { AnswerIdentity, Bpic19PipelineAction } from "../generated/saving";
import { Bpic19Scoring } from "./Bpic19Scoring";
import { bpic19Contract, localBpic19Client, type Bpic19Client, type Bpic19Outcome } from "./scoring-client";
import type { Bpic19ReadRequest, Bpic19ScoreAnswer, Roles } from "./scoring-types";

export interface Bpic19RetainedAssessmentsProps {
  workspaceId: string;
  baseIdentity: AnswerIdentity;
  currentIdentity: AnswerIdentity;
  actions: readonly Bpic19PipelineAction[];
  revision: number;
  labels?: Readonly<Record<string, string>>;
  client?: Bpic19Client;
  onInspect: (identity: AnswerIdentity, caseId: string, rowIds: string[], reason: string) => void;
}

const roleKeys = ["item_category", "item_type", "goods_receipt", "gr_based_iv", "purchasing_document", "item",
  "source_case", "company", "spend_area", "resource", "net_worth", "value"] as const;
function roleKey(value: string): value is keyof Roles { return roleKeys.some(key => key === value); }
function frozenRoles(value: unknown): Roles | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const roles: Roles = {};
  for (const [key, index] of Object.entries(value)) {
    if (!roleKey(key) || (index !== null && (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0))) return null;
    roles[key] = index;
  }
  return roles;
}
function sameSource(identity: AnswerIdentity, base: AnswerIdentity): boolean {
  return sameJson({ ...identity, population_id: base.population_id }, base);
}
function supportedSettings(answer: Bpic19ScoreAnswer): boolean {
  const settings = answer.report.settings;
  const paperProfiles = {
    completion: "bpic19.paper.2026-10-12.v1.completion",
    completion_timing: "bpic19.paper.2026-10-12.v1.completion_timing",
    completion_rework_effort: "bpic19.paper.2026-10-12.v1.completion_rework_effort",
    full: "bpic19.paper.2026-10-12.v1",
  };
  const paper = answer.report.profile_id === paperProfiles[settings.criteria_family];
  const historical = ["bpic19.notebook.1.0-paper-aligned.v1", "bpic19.notebook.1.0-paper-aligned.partial.v1"].includes(answer.report.profile_id);
  return (paper || historical && settings.criteria_family === "full" && settings.mode === "layer_balanced") &&
    (paper ? ["Balanced", "Completion", "Operations"] : ["Finance", "Logistics", "Compliance", "Automation"]).includes(settings.view) &&
    ["flat", "layer_balanced"].includes(settings.mode) && Number.isFinite(settings.gamma) && settings.gamma >= 0 &&
    settings.group_by.length > 0 && new Set(settings.group_by).size === settings.group_by.length &&
    settings.group_by.every(key => ["company", "spend_area", "flow", "document", "item_type"].includes(key)) &&
    ["cases", "exposure"].includes(settings.volume) && Number.isSafeInteger(settings.min_cases) && settings.min_cases >= 1 &&
    Number.isSafeInteger(settings.association_min_support ?? 1) && (settings.association_min_support ?? 1) >= 1;
}
type Viewed = { scope: string; selected: string; action: Bpic19PipelineAction; answer: Bpic19ScoreAnswer; roles: Roles };
function verify(answer: Bpic19ScoreAnswer, request: Bpic19ReadRequest, action: Bpic19PipelineAction,
  base: AnswerIdentity): string | null {
  if (!bpic19Contract.answer(answer)) return "The retained answer does not satisfy the native assessment contract.";
  if (answer.request_id !== request.request_id || answer.query_revision !== request.query_revision || answer.workspace_id !== request.workspace_id)
    return "The service answered another retained assessment request.";
  if (answer.run_id !== request.run_id || answer.definition_id !== action.definition_id || answer.definition_version_id !== action.definition_id)
    return "The stored run or definition differs from the retained assessment declaration.";
  if (!sameJson(answer.base_identity, base) || !sameJson(answer.named_population.identity, action.identity))
    return "The stored assessment belongs to another source or frozen population. No current-selection substitute was used.";
  if (frozenRoles(answer.definition?.roles) === null)
    return "The stored assessment has a missing or unsupported frozen source-role recipe. Current source mappings cannot replace it.";
  if (!supportedSettings(answer)) return "The stored assessment has an unsupported profile or settings. Its frozen view cannot use presentation defaults.";
  return null;
}

/** Read an explicitly chosen immutable native run without rebasing or reviewing it as the current selection. */
export function Bpic19RetainedAssessments({ workspaceId, baseIdentity, currentIdentity, actions, revision,
  labels, client = localBpic19Client, onInspect }: Bpic19RetainedAssessmentsProps) {
  const declared = actions.filter(action => action.operation === "bpic19_score");
  const scope = JSON.stringify([workspaceId, baseIdentity, currentIdentity, revision, declared]);
  const activeScope = useRef(scope); activeScope.current = scope;
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState("");
  const [viewed, setViewed] = useState<Viewed | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resultScope, setResultScope] = useState(scope);
  const chosen = declared.find((_, index) => selected === String(index));
  useEffect(() => {
    ++generation.current; controller.current?.abort();
    setSelected(""); setViewed(null); setBusy(false); setProblem(null); setResultScope(scope);
    return () => { ++generation.current; controller.current?.abort(); };
  }, [scope, client]);

  function cancel() {
    ++generation.current; controller.current?.abort();
    setSelected(""); setViewed(null); setBusy(false); setProblem(null); setResultScope(scope);
  }
  async function load(index: string) {
    ++generation.current; controller.current?.abort(); setSelected(index); setViewed(null); setProblem(null); setResultScope(scope);
    const original = declared.find((_, position) => index === String(position));
    if (!original) { setBusy(false); return; }
    const action = structuredClone(original), runId = action.query.run_id;
    if (typeof runId !== "string" || !runId.trim() || !action.definition_id || !sameSource(action.identity, baseIdentity)) {
      setBusy(false); setProblem("The retained declaration is missing its stored run or refers to another source preparation."); return;
    }
    const abort = new AbortController(); controller.current = abort;
    const mine = generation.current; setBusy(true);
    const request: Bpic19ReadRequest = { schema_version: 1, message_type: "bpic19_read_request", request_id: crypto.randomUUID(),
      query_revision: revision, workspace_id: workspaceId, run_id: runId, case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50 };
    let outcome: Bpic19Outcome;
    try { outcome = await client.read(request, abort.signal); }
    catch { outcome = { ok: false, message: "The retained assessment could not be read. Retry when the service is available." }; }
    if (mine !== generation.current || abort.signal.aborted || activeScope.current !== scope) return;
    setBusy(false);
    if (!outcome.ok) { setProblem(outcome.message); return; }
    const refusal = verify(outcome.answer, request, action, baseIdentity);
    if (refusal) { setProblem(refusal); return; }
    const roles = frozenRoles(outcome.answer.definition?.roles);
    if (roles === null) return;
    setViewed({ scope, selected: index, action, answer: outcome.answer, roles });
  }

  const current = viewed && viewed.scope === scope && viewed.selected === selected ? viewed : null;
  const readOnlyClient = useMemo<Bpic19Client | null>(() => {
    if (!current) return null;
    const saved = current;
    return {
      score: async () => ({ ok: false, message: "A retained assessment is read-only." }),
      read: async (request, signal) => {
        if (activeScope.current !== saved.scope || request.run_id !== saved.answer.run_id || request.workspace_id !== workspaceId || request.query_revision !== revision)
          return { ok: false, message: "Read the selected frozen assessment without changing its run or revision." };
        let outcome: Bpic19Outcome;
        try { outcome = await client.read(request, signal); }
        catch { return { ok: false, message: "The retained assessment members could not be read. Retry when the service is available." }; }
        if (activeScope.current !== saved.scope || signal.aborted) return { ok: false, message: "The retained assessment request was cancelled." };
        if (!outcome.ok) return outcome;
        const refusal = verify(outcome.answer, request, saved.action, baseIdentity);
        if (refusal) return { ok: false, message: refusal };
        if (!sameJson(frozenRoles(outcome.answer.definition?.roles), saved.roles))
          return { ok: false, message: "The stored source-role recipe changed during the retained member read." };
        if (!sameJson(outcome.answer.report.settings, saved.answer.report.settings) || outcome.answer.report.profile_id !== saved.answer.report.profile_id ||
          outcome.answer.report.norm_fingerprint !== saved.answer.report.norm_fingerprint || outcome.answer.report.assessment_log_fingerprint !== saved.answer.report.assessment_log_fingerprint)
          return { ok: false, message: "The stored native assessment definition changed during the retained member read." };
        return outcome;
      },
      ...(client.export ? { export: async (request, signal) => {
        if (activeScope.current !== saved.scope || request.run_id !== saved.answer.run_id || request.workspace_id !== workspaceId || request.query_revision !== revision)
          return { ok: false as const, message: "Export the selected frozen run without substituting another assessment." };
        try {
          const result = await client.export!(request, signal);
          return activeScope.current === saved.scope && !signal.aborted ? result :
            { ok: false as const, message: "The retained assessment export was cancelled." };
        } catch { return { ok: false as const, message: "The retained native artifact could not be exported. Retry when it is available." }; }
      } } : {}),
    };
  }, [current, client, workspaceId, baseIdentity, revision]);

  if (!declared.length) return null;
  return <details className="bpic19-scoring"><summary>Retained native assessments ({declared.length})</summary>
    <p>Choose a stored assessment to read its original population, source mappings and evidence. The current complete-item selection stays fixed.</p>
    <label>Retained assessment<select value={selected} onChange={event => void load(event.target.value)}>
      <option value="">Choose a retained assessment</option>
      {declared.map((action, index) => <option key={index} value={String(index)}>{typeof action.query.run_id === "string" && labels?.[action.query.run_id] || `Retained assessment ${index + 1}`}</option>)}
    </select></label>
    {resultScope === scope && busy && <p role="status">Reading the selected stored native run…</p>}
    {selected !== "" && <button type="button" onClick={cancel}>Close retained assessment</button>}
    {resultScope === scope && problem && <p role="alert">{problem}{chosen && <button type="button" disabled={busy} onClick={() => void load(selected)}>Retry retained assessment</button>}</p>}
    {current && readOnlyClient && <>
      <p>{sameJson(current.action.identity, currentIdentity) ? "This assessment names the current selection." : "This assessment names a retained parent population, distinct from the current selection."}</p>
      <p>Frozen population: {current.action.identity.population_id}. Stored run: {current.answer.run_id}. Definition: {current.action.definition_id}.</p>
      <details><summary>Frozen source column roles</summary><pre>{JSON.stringify(current.roles, null, 2)}</pre></details>
      <Bpic19Scoring key={JSON.stringify([scope, selected, current.answer.run_id])} readOnly initialRun={current.answer} client={readOnlyClient}
        revision={revision} subject={{ workspace_id: workspaceId, base_identity: baseIdentity,
          named_population: current.answer.named_population, roles: current.roles }}
        onInspect={(caseId, rowIds) => { if (activeScope.current === current.scope) onInspect(structuredClone(current.action.identity), caseId, rowIds ?? [],
          `Retained native assessment ${current.answer.run_id} · definition ${current.action.definition_id}`); }} />
    </>}
  </details>;
}
