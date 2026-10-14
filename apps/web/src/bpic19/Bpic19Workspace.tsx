import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { sameJson } from "../data/coordinator";
import type { Bpic19ProfileAnswer, Bpic19ProfileQuery } from "../generated/bpic19-profile";
import type { Bpic19MeasuresAnswer, MeasureQuery, MeasureRoles } from "../generated/bpic19-measures";
import type { CompareCoordinator } from "../compare/coordinator";
import { type ImportedInvestigationCoordinator, shownSelection } from "../imported/coordinator";
import { ImportedInspector } from "../imported/ImportedInspector";
import { SelectionSteps } from "../map/SelectionSteps";
import { SaveButton, SaveForm } from "../saved/SaveControl";
import type { SavingCoordinator } from "../saved/coordinator";
import { Bpic19Profile } from "./Bpic19Profile";
import { Bpic19Measures } from "./Bpic19Measures";
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
  const heading = useRef<HTMLHeadingElement>(null);
  const activated = useRef("");
  const queries = useRef<{ preparation: string; revision: string | undefined; profile?: Bpic19ProfileQuery; measures?: MeasureQuery }>({ preparation: "", revision: undefined });
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
    const actions = state.saved?.content.bpic19_pipeline?.actions ?? [];
    queries.current = { preparation, revision: savedRevision,
      profile: actions.find(action => action.operation === "bpic19_profile")?.query as Bpic19ProfileQuery | undefined,
      measures: actions.find(action => action.operation === "bpic19_measures")?.query as MeasureQuery | undefined };
  }

  useLayoutEffect(() => {
    setProfile(null); setRows([]);
    if (population && identity) session.basis(population.workspace_id, identity);
  }, [key, session]);

  const reviewedProfile = useCallback((answer: Bpic19ProfileAnswer) => {
    setProfile(answer);
    queries.current.profile = answer.query;
    if (answer.profile) session.reviewed({ operation: "bpic19_profile", identity: answer.identity,
      query: { ...answer.query }, definition_id: answer.profile.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const reviewedMeasures = useCallback((answer: Bpic19MeasuresAnswer) => {
    queries.current.measures = answer.query;
    session.reviewed({ operation: "bpic19_measures", identity: answer.identity, query: { ...answer.query }, definition_id: answer.definition_id });
    refresh(value => value + 1);
  }, [session]);
  const profileValid = useCallback((current: boolean) => { session.valid("bpic19_profile", current, key); refresh(value => value + 1); }, [session, key]);
  const measuresValid = useCallback((current: boolean) => { session.valid("bpic19_measures", current, key); refresh(value => value + 1); }, [session, key]);
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
        <Bpic19Profile key={key} workspaceId={population.workspace_id} identity={identity} revision={revision} query={profileQuery} onReviewed={reviewedProfile} onValidityChange={profileValid} onInspect={inspect}
          onKeep={predicate => investigation.addStep(predicate)}
          onCompare={(target, comparator) => {
            comparison.useBasis({ workspaceId: population.workspace_id, identity: population.identity,
              clock: population.preparation.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant", contextColumns: population.preparation.mapping.context_columns });
            comparison.takeIds("target", target.caseIds); comparison.rename("target", target.name);
            comparison.takeIds("reference", comparator.caseIds); comparison.rename("reference", comparator.name);
            onShowComparison();
          }} />
        {currentProfile?.profile && <Bpic19Measures workspaceId={population.workspace_id} identity={identity} revision={revision} roles={roles} columns={currentProfile.columns} query={measuresQuery} onReviewed={reviewedMeasures} onValidityChange={measuresValid} onInspect={inspect}
          onKeepCases={(caseIds) => { if (caseIds.length) investigation.addStep({ kind: "case_id_in", case_ids: [caseIds[0], ...caseIds.slice(1)], negate: false }); }} />}
      </div>
      {state.inspected.phase !== "closed" && <ImportedInspector inspected={state.inspected} summary={undefined} layout={layout} onLayout={setLayout} onReturn={() => investigation.closeCase()} onRetry={() => investigation.retryCase()} headingRef={heading} highlightedRowIds={rows} />}
    </div>
  </main>;
}
