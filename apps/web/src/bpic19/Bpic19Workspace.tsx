import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { sameJson } from "../data/coordinator";
import type { Bpic19ProfileAnswer, Bpic19ProfileQuery } from "../generated/bpic19-profile";
import type { Bpic19MeasuresAnswer, MeasureQuery, MeasureRoles } from "../generated/bpic19-measures";
import type { Bpic19CohortsAnswer, CohortQuery } from "../generated/bpic19-cohorts";
import type { Bpic19OperatorAnswer, OperatorQuery } from "../generated/bpic19-operators";
import type { CompareCoordinator } from "../compare/coordinator";
import { type ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { ImportedInspector } from "../imported/ImportedInspector";
import { SelectionSteps } from "../map/SelectionSteps";
import { SaveButton, SaveForm } from "../saved/SaveControl";
import type { SavingCoordinator } from "../saved/coordinator";
import { Bpic19Profile } from "./Bpic19Profile";
import { Bpic19Measures } from "./Bpic19Measures";
import { Bpic19Cohorts } from "./Bpic19Cohorts";
import { Bpic19SavedScore } from "./Bpic19SavedScore";
import type { Bpic19ScoreAnswer } from "./scoring-types";
import { Bpic19Operators } from "./Bpic19Operators";
import type { Bpic19Session } from "./session";
import "./workspace.css";

interface Props {
  investigation: ImportedInvestigationCoordinator;
  comparison: CompareCoordinator;
  saving: SavingCoordinator;
  session: Bpic19Session;
  active: boolean;
  onShowData: () => void;
  onShowComparison: () => void;
}

function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "purchasing-investigation.json";
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The purchasing entry point uses the same population, evidence and saved revisions as the map. */
export function Bpic19Workspace({ investigation, comparison, saving, session, active, onShowData, onShowComparison }: Props) {
  const state = useSyncExternalStore(investigation.subscribe, investigation.getState);
  const savingState = useSyncExternalStore(saving.subscribe, saving.getState);
  const [profile, setProfile] = useState<Bpic19ProfileAnswer | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rows, setRows] = useState<string[]>([]);
  const [layout, setLayout] = useState<"side" | "full" | "collapsed">("side");
  const [cohortEnabled, setCohortEnabled] = useState(false);
  const [scoreEnabled, setScoreEnabled] = useState(false);
  const [operatorsEnabled, setOperatorsEnabled] = useState(false);
  const operatorName = useRef<"bpic19_ordinal" | "bpic19_fifo" | "bpic19_cancellation" | "bpic19_rule" | "bpic19_waiting">("bpic19_ordinal");
  const heading = useRef<HTMLHeadingElement>(null);
  const activated = useRef("");
  const restoredRevision = useRef<string | undefined>(undefined);
  const queries = useRef<{ preparation: string; revision: string | undefined; profile?: Bpic19ProfileQuery; measures?: MeasureQuery; cohorts?: CohortQuery; operators?: OperatorQuery; scoreRunId?: string; scorePopulationId?: string }>({ preparation: "", revision: undefined });
  const [, refresh] = useState(0);
  const shown = shownSelection(state.selection);
  const population = state.population.phase === "ready" ? state.population.answer : null;
  const identity = shown?.answer.identity ?? population?.identity;
  const revision = shown?.revision ?? (state.population.phase === "ready" ? state.population.revision : 0);
  const key = JSON.stringify([population?.workspace_id, identity]);
  const preparation = JSON.stringify([population?.workspace_id, identity?.preparation_id]);
  if (active) activated.current = preparation;
  const engaged = active || activated.current === preparation;
  const savedRevision = state.saved?.revisionId;
  if (queries.current.preparation !== preparation || queries.current.revision !== savedRevision) {
    const allActions = state.saved?.content.bpic19_pipeline?.actions ?? [];
    const actions = allActions.filter(action => sameJson(action.identity, identity));
    const scoredAction = actions.find(action => action.operation === "bpic19_score");
    queries.current = { preparation, revision: savedRevision,
      profile: actions.find(action => action.operation === "bpic19_profile")?.query as Bpic19ProfileQuery | undefined,
      measures: actions.find(action => action.operation === "bpic19_measures")?.query as MeasureQuery | undefined,
      cohorts: actions.find(action => action.operation === "bpic19_cohorts")?.query as unknown as CohortQuery | undefined,
      operators: actions.filter(action => ["bpic19_ordinal", "bpic19_fifo", "bpic19_cancellation", "bpic19_rule", "bpic19_waiting"].includes(action.operation)).at(-1)?.query as unknown as OperatorQuery | undefined,
      scoreRunId: typeof scoredAction?.query.run_id === "string" ? scoredAction.query.run_id : undefined,
      scorePopulationId: scoredAction?.identity.population_id };
  }

  useLayoutEffect(() => {
    setProfile(null); setRows([]);
    if (population && identity) session.basis(population.workspace_id, identity, shown?.steps ?? [], population.identity);
  }, [key, session]);

  useLayoutEffect(() => {
    if (!population || !identity || !state.saved || restoredRevision.current === savedRevision ||
        !sameJson(state.saved.content.selection_identity, identity)) return;
    session.restore(population.workspace_id, identity, shown?.steps ?? [],
      state.saved.content.bpic19_pipeline?.actions ?? [], population.identity);
    restoredRevision.current = savedRevision;
    refresh(value => value + 1);
  }, [key, savedRevision, session]);

  const reviewedProfile = useCallback((answer: Bpic19ProfileAnswer) => {
    setProfile(answer);
    queries.current.profile = answer.query;
    if (answer.profile) session.reviewed({ operation: "bpic19_profile", identity: answer.identity,
      query: { ...answer.query }, definition_id: answer.profile.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const availableColumns = useCallback((answer: Bpic19ProfileAnswer) => { setProfile(answer); }, []);
  const reviewedMeasures = useCallback((answer: Bpic19MeasuresAnswer) => {
    queries.current.measures = answer.query;
    session.reviewed({ operation: "bpic19_measures", identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const profileValid = useCallback((current: boolean) => {
    // Counts can be reviewed before a purchasing partition is declared.
    // An accepted partition still fences its later edits and replacement.
    if (!current && queries.current.profile?.roles == null) return;
    session.valid("bpic19_profile", current, key); refresh(value => value + 1);
  }, [session, key]);
  const measuresValid = useCallback((current: boolean) => { session.valid("bpic19_measures", current, key); refresh(value => value + 1); }, [session, key]);
  const cohortsValid = useCallback((current: boolean) => { session.valid("bpic19_cohorts", current, key); refresh(value => value + 1); }, [session, key]);
  const reviewedCohorts = useCallback((answer: Bpic19CohortsAnswer) => {
    queries.current.cohorts = answer.query;
    session.reviewed({ operation: "bpic19_cohorts", identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const scoreValid = useCallback((current: boolean) => { session.valid("bpic19_score", current, key); refresh(value => value + 1); }, [session, key]);
  const reviewedScore = useCallback((answer: Bpic19ScoreAnswer) => {
    if (typeof answer.definition_id !== "string") {
      session.valid("bpic19_score", false);
      refresh(value => value + 1);
      return;
    }
    session.reviewed({ operation: "bpic19_score", identity: answer.named_population.identity,
      query: { run_id: answer.run_id, case_offset: 0, case_limit: 50, group_offset: 0, group_limit: 50 }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const operatorsValid = useCallback((current: boolean) => { session.valid(operatorName.current, current, key); refresh(value => value + 1); }, [session, key]);
  const reviewedOperators = useCallback((answer: Bpic19OperatorAnswer) => {
    if (answer.operation === "bpic19_catalogue") return;
    if (operatorName.current !== answer.operation) session.valid(operatorName.current, true, key);
    operatorName.current = answer.operation;
    queries.current.operators = answer.query;
    session.reviewed({ operation: answer.operation, identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session, key]);
  const inspect = useCallback((caseId: string, rowIds: string[] = []) => {
    setRows(rowIds); setLayout("side"); investigation.openCase(caseId);
    setTimeout(() => heading.current?.focus(), 0);
  }, [investigation]);

  if (!engaged) return null;
  if (!population || !identity) return <main className="bpic19-workspace"><h1>Purchasing analysis</h1><p>Open a reviewed source to inspect its purchasing flows and recorded measures.</p><button onClick={onShowData}>Open Data</button></main>;
  const profileQuery = queries.current.profile;
  const measuresQuery = queries.current.measures;
  const currentProfile = profile && JSON.stringify(profile.identity) === JSON.stringify(identity) ? profile : null;
  const roles: MeasureRoles = { ...currentProfile?.query.roles };
  const headers: Record<string, string> = { company: "case Company", spend_area: "case Spend area text", resource: "event org:resource", value: "event Cumulative net worth (EUR)", net_worth: "event Cumulative net worth (EUR)" };
  for (const [role, name] of Object.entries(headers)) {
    const matches = currentProfile?.columns.filter(column => column.name === name || column.name === "source__" + name) ?? [];
    roles[role as keyof MeasureRoles] = matches.length === 1 ? matches[0].index : null;
  }
  const paused = state.selection.phase !== "ready" || state.replacement !== null;
  const saved = savingState.save.phase === "saved" ? savingState.save.answer : null;
  return <main className="bpic19-workspace">
    <div className="bpic19-toolbar"><h1>Purchasing analysis</h1><button onClick={onShowData}>Review source in Data</button><SaveButton saving={saving} open={saveOpen} onOpen={() => setSaveOpen(true)} waitingFor={paused || !session.readyForSave() ? "bpic19-save-wait" : undefined} /></div>
    <p>Source: {population.source.filename}. Selections keep complete PO-item histories across purchasing analysis, the process map and comparisons.</p>
    {(paused || !session.readyForSave()) && <p id="bpic19-save-wait" role="status">Review the current definitions and wait for the current population before saving or exporting.</p>}
    {shown && <SelectionSteps selection={state.selection} onRemove={step => investigation.removeStep(step)} onClear={() => investigation.clearSteps()} onUndo={() => investigation.undo()} onRedo={() => investigation.redo()} onRetry={() => investigation.retrySelection()} onStay={() => investigation.staySelection()} waitingFor={state.replacement ? "bpic19-save-wait" : undefined} />}
    {saveOpen && <SaveForm saving={saving} investigation={state} view="incidents" onClose={() => setSaveOpen(false)} />}
    {saved?.bpic19_outputs && !paused && session.readyForSave() && saved.revision.saved_revision_id === state.saved?.revisionId && sameJson(session.savedPipeline(), saved.revision.content.bpic19_pipeline) && <button onClick={() => download({ format: "wise-purchasing-investigation", format_version: 1, revision: saved.revision, source: population.source, preparation: population.preparation, manifest: saved.bpic19_outputs })}>Export saved definitions, results and witnesses</button>}
    <div className="bpic19-content">
      <div inert={paused || undefined}>
        <Bpic19Profile key={key} workspaceId={population.workspace_id} identity={identity} revision={revision} query={profileQuery} onReviewed={reviewedProfile} onColumns={availableColumns} onValidityChange={profileValid} onInspect={inspect}
          onKeep={predicate => investigation.addStep(predicate)}
          onCompare={(target, comparator) => {
            comparison.useBasis({ workspaceId: population.workspace_id, identity: population.identity,
              clock: population.preparation.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant", contextColumns: population.preparation.mapping.context_columns });
            comparison.takeIds("target", target.caseIds); comparison.rename("target", target.name);
            comparison.takeIds("reference", comparator.caseIds); comparison.rename("reference", comparator.name);
            onShowComparison();
          }} />
        {currentProfile && <Bpic19Measures workspaceId={population.workspace_id} identity={identity} revision={revision} roles={roles} columns={currentProfile.columns} query={measuresQuery} onReviewed={reviewedMeasures} onValidityChange={measuresValid} onInspect={inspect}
          onKeepCases={(caseIds) => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        {currentProfile?.profile && <>
          {!cohortEnabled && !queries.current.cohorts && <button onClick={() => setCohortEnabled(true)}>Review completion and inclusion cohorts</button>}
          {(cohortEnabled || queries.current.cohorts) && <Bpic19Cohorts key={key} workspaceId={population.workspace_id} identity={identity} revision={revision}
            roles={{ item_category: currentProfile.profile.definition.roles.item_category,
              purchasing_document: currentProfile.profile.definition.roles.purchasing_document }}
            timestampKind={population.preparation.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant"}
            query={queries.current.cohorts} onReviewed={reviewedCohorts} onValidityChange={cohortsValid} onInspect={inspect}
            onKeepCases={caseIds => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        </>}
        {currentProfile?.profile && <>
          {!operatorsEnabled && !queries.current.operators && <button onClick={() => setOperatorsEnabled(true)}>Review invoice matches, recorded rules and waiting intervals</button>}
          {(operatorsEnabled || queries.current.operators) && <Bpic19Operators key={key} workspaceId={population.workspace_id} identity={identity} revision={revision}
            roles={{ event_id: currentProfile.columns.filter(column => column.name === "eventID" || column.name === "source__eventID").length === 1
                ? currentProfile.columns.find(column => column.name === "eventID" || column.name === "source__eventID")!.index : null,
              item_category: currentProfile.profile.definition.roles.item_category, net_worth: roles.net_worth ?? null }}
            query={queries.current.operators} columns={currentProfile.columns} onReviewed={reviewedOperators} onValidityChange={operatorsValid} onInspect={inspect}
            onKeepCases={caseIds => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        </>}
        {currentProfile?.profile && <>
          {!scoreEnabled && !queries.current.scoreRunId && <button onClick={() => setScoreEnabled(true)}>Evaluate purchasing criteria and priorities</button>}
          {(scoreEnabled || queries.current.scoreRunId) && <Bpic19SavedScore key={key} revision={revision} savedRunId={queries.current.scorePopulationId === identity.population_id ? queries.current.scoreRunId : undefined}
            subject={{ workspace_id: population.workspace_id, base_identity: population.identity,
              named_population: { name: "Current reviewed PO items", identity }, roles }}
            onReviewed={reviewedScore} onValidityChange={scoreValid} onInspect={inspect}
            onKeepCases={caseIds => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
        </>}
      </div>
      {state.inspected.phase !== "closed" && <ImportedInspector inspected={state.inspected} summary={undefined} layout={layout} onLayout={setLayout} onReturn={() => investigation.closeCase()} onRetry={() => investigation.retryCase()} headingRef={heading} highlightedRowIds={rows} />}
    </div>
  </main>;
}
