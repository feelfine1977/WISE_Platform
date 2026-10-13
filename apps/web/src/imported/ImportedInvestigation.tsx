import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { InspectorLayout } from "../components/Inspector";
import type { CaseId, ImportedCaseSummary, ImportedPopulationAnswer } from "../generated/imports";
import type { SelectionPredicate } from "../generated/selection";
import { ImportProblemNotice } from "../data/ImportProblemNotice";
import { countOf, delimiterName, encodingName } from "../data/wording";
import { MapView } from "../map/MapView";
import { SelectionSteps } from "../map/SelectionSteps";
import { supportText } from "../map/wording";
import { type ImportedInvestigationCoordinator, type InvestigationView, type ShownSelection, shownSelection } from "./coordinator";
import { ImportedInspector } from "./ImportedInspector";
import { type FocusRequest, IncidentWindow } from "./IncidentWindow";
import type { SavingCoordinator } from "../saved/coordinator";
import { SaveButton, SavedLine, SaveForm } from "../saved/SaveControl";
import { OpenedAs } from "../views/OpenedAs";
import type { VariantId } from "../views/messages";
import { Variants } from "../views/Variants";

interface ImportedInvestigationProps {
  coordinator: ImportedInvestigationCoordinator;
  onShowData: () => void;
  /** Saving the question shown; without it the toolbar offers no "Save". */
  saving?: SavingCoordinator;
}

type View = InvestigationView;

/**
 * The investigation of an imported preparation: its facts, the selection of whole incidents, the
 * kept incidents as a table or as a process map, and the complete history of one kept incident.
 */
export function ImportedInvestigation({ coordinator, onShowData, saving }: ImportedInvestigationProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  // A reopened investigation opens in the view it was saved in.
  const [view, setView] = useState<View>(() => coordinator.getState().restoredView ?? "incidents");
  const [saveOpen, setSaveOpen] = useState(false);
  const [layout, setLayout] = useState<InspectorLayout>("side");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [focusInspector, setFocusInspector] = useState(0);
  const [focusIncidents, setFocusIncidents] = useState(0);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const incidentsHeading = useRef<HTMLHeadingElement>(null);
  const { population, inspected, openingContext, variants, chosenVariant } = state;
  const inspectorOpen = inspected.phase !== "closed";
  const openCaseId = inspected.phase === "closed" ? null : inspected.caseId;

  useEffect(() => {
    if (focusInspector > 0) inspectorHeading.current?.focus();
  }, [focusInspector]);

  // Runs after the table of the new view has mounted, so the heading keeps the focus.
  useEffect(() => {
    if (focusIncidents > 0) incidentsHeading.current?.focus();
  }, [focusIncidents]);

  /**
   * The table is rendered anew for each view; a focus request for the earlier table is not repeated.
   * Listing a variant shows its incidents, so the table comes forward also when the map was shown.
   */
  const chooseVariant = useCallback(
    (variantId: VariantId) => {
      setFocusRequest(null);
      coordinator.chooseVariant(variantId);
      setView("incidents");
    },
    [coordinator],
  );

  const clearVariant = useCallback(
    (focusTable: boolean) => {
      setFocusRequest(null);
      coordinator.clearVariant();
      if (focusTable) setFocusIncidents((count) => count + 1);
    },
    [coordinator],
  );

  const openCase = useCallback(
    (caseId: CaseId) => {
      coordinator.openCase(caseId);
      setLayout((current) => (current === "collapsed" ? "side" : current));
      setFocusInspector((count) => count + 1);
    },
    [coordinator],
  );

  const returnToIncidents = useCallback(() => {
    const current = coordinator.getState().inspected;
    if (current.phase === "closed") return;
    coordinator.closeCase();
    setFocusRequest((previous) => ({ caseId: current.caseId, token: (previous?.token ?? 0) + 1 }));
  }, [coordinator]);

  useEffect(() => {
    if (!inspectorOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      returnToIncidents();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen, returnToIncidents]);

  const addStep = useCallback((step: SelectionPredicate) => coordinator.addStep(step), [coordinator]);
  const answer = population.phase === "ready" ? population.answer : null;
  const shown = shownSelection(state.selection);
  const kept = useMemo(() => keptCases(answer, shown), [answer, shown]);
  const summary = answer?.cases.find((item) => item.case_id === openCaseId);
  const revision = shown ? shown.revision : population.phase === "ready" ? population.revision : 0;
  const variantView = useMemo(() => {
    if (chosenVariant === null || variants.phase !== "ready" || !answer) return null;
    const ranked = variants.answer.variants.variants;
    const rank = ranked.findIndex((variant) => variant.id === chosenVariant);
    if (rank < 0) return null;
    const members = new Set(ranked[rank].case_ids);
    return { rank: rank + 1, caseCount: ranked[rank].case_count, cases: kept.filter((item) => members.has(item.case_id)) };
  }, [chosenVariant, variants, answer, kept]);
  const shownCases = variantView ? variantView.cases : kept;
  return (
    <main className="workbench" aria-labelledby="imported-title">
      <div className="toolbar">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="link-button" onClick={onShowData}>
            Data
          </button>
          <span aria-hidden="true"> / </span>
          <h2 id="imported-title" className="breadcrumb-current">
            {answer ? answer.source.filename : "Imported source"}
          </h2>
        </nav>
        {answer && <Facts answer={answer} shown={shown} revision={revision} />}
        {saving && answer && <SaveButton saving={saving} open={saveOpen} onOpen={() => setSaveOpen(true)} />}
        <p role="status" className="visually-hidden">
          {population.phase === "loading" ? "Opening the incidents of this preparation" : population.phase === "ready" ? "Incidents shown" : ""}
        </p>
      </div>
      {(population.phase === "loading" || state.selection.phase === "loading") && <div className="progress-line" aria-hidden="true" />}
      {saving && saveOpen && answer && <SaveForm saving={saving} investigation={state} view={view} onClose={() => setSaveOpen(false)} />}
      {state.saved && <SavedLine binding={state.saved} />}
      {answer && (
        <div className="selection-bar">
          <div className="view-switch" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "incidents"} onClick={() => setView("incidents")}>
              Incidents
            </button>
            <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
              Map
            </button>
          </div>
          <SelectionSteps
            selection={state.selection}
            onRemove={(step) => coordinator.removeStep(step)}
            onClear={() => coordinator.clearSteps()}
            onUndo={() => coordinator.undo()}
            onRedo={() => coordinator.redo()}
            onRetry={() => coordinator.retrySelection()}
          />
        </div>
      )}
      <div className="workbench-body" data-inspector={inspectorOpen ? layout : "none"}>
        <div className="main-column">
          {answer && view === "map" && (
            <section className="map-pane" aria-labelledby="imported-map-title">
              <h3 id="imported-map-title" className="pane-title">
                Map of the kept incidents
              </h3>
              {shown && state.parentGraph ? (
                <MapView shown={shown} parentGraph={state.parentGraph} onStep={addStep} />
              ) : state.selection.phase === "failed" ? (
                <p className="working-text">The map is shown once the incidents are selected.</p>
              ) : (
                <p className="working-text">Selecting the incidents and drawing their map…</p>
              )}
            </section>
          )}
          <section className="table-pane" aria-labelledby="imported-incidents-title" hidden={answer !== null && view !== "incidents"}>
            <h3 id="imported-incidents-title" className="pane-title" tabIndex={-1} ref={incidentsHeading}>
              {variantView ? `Kept incidents of variant ${variantView.rank}` : "Kept incidents"}
            </h3>
            <p role="status" className="visually-hidden">
              {variantView ? `The table lists the ${countOf(variantView.caseCount, "incident")} of variant ${variantView.rank}.` : ""}
            </p>
            {variantView && (
              <div className="view-note">
                <p>
                  The table lists the {countOf(variantView.caseCount, "incident")} of variant {variantView.rank}. This is a view: the selection and
                  every count stay as they are.
                </p>
                <button type="button" onClick={() => clearVariant(true)}>
                  Show every incident
                </button>
              </div>
            )}
            {population.phase === "loading" && <p className="working-text">Opening the incidents of this preparation…</p>}
            {population.phase === "failed" && (
              <ImportProblemNotice title="The incidents could not be opened" problem={population.problem} onRetry={() => coordinator.retryPopulation()} />
            )}
            {answer && answer.cases.length === 0 && (
              <p className="working-text">This preparation has no incident with an incident id, so there is no incident to open.</p>
            )}
            {answer && answer.cases.length > 0 && kept.length === 0 && (
              <p className="working-text">The selection keeps no incident. Remove a step or undo it to keep incidents again.</p>
            )}
            {answer && kept.length > 0 && (
              <>
                <p className="muted pane-hint" id="imported-incidents-hint">
                  {variantView ? `The kept incidents that follow variant ${variantView.rank}.` : "The incidents the selection keeps; with no step, every incident with an incident id."}{" "}
                  Tab enters the table; the arrow keys, Page Up, Page Down, Home and End move; Enter opens every record of an incident.
                </p>
                <IncidentWindow
                  key={variantView ? `variant-${chosenVariant}` : "every-incident"}
                  cases={shownCases}
                  openCaseId={openCaseId}
                  onOpen={openCase}
                  focusRequest={focusRequest}
                  labelledBy="imported-incidents-title"
                  describedBy="imported-incidents-hint"
                />
                <PreparationDetails answer={answer} />
              </>
            )}
          </section>
          {answer && (
            <div className="views">
              <OpenedAs state={openingContext} onRetry={() => coordinator.retryOpeningContext()} />
              <Variants
                state={variants}
                chosen={chosenVariant}
                onChoose={chooseVariant}
                onClear={() => clearVariant(false)}
                onRetry={() => coordinator.retryVariants()}
              />
            </div>
          )}
        </div>
        {inspected.phase !== "closed" && answer && (
          <ImportedInspector
            inspected={inspected}
            summary={summary}
            layout={layout}
            onLayout={setLayout}
            onReturn={returnToIncidents}
            onRetry={() => coordinator.retryCase()}
            headingRef={inspectorHeading}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The incidents of the population that the selection shown keeps, in the order the local service
 * listed them; before a selection is answered, every incident of the population.
 */
function keptCases(answer: ImportedPopulationAnswer | null, shown: ShownSelection | null): readonly ImportedCaseSummary[] {
  if (answer === null) return [];
  if (shown === null) return answer.cases;
  const summaries = new Map(answer.cases.map((summary) => [summary.case_id, summary]));
  return shown.answer.kept.case_ids.flatMap((caseId) => summaries.get(caseId) ?? []);
}

function Facts({ answer, shown, revision }: { answer: ImportedPopulationAnswer; shown: ShownSelection | null; revision: number }) {
  const parent = shown ? shown.answer.parent : answer.population;
  const facts: [string, string][] = [
    ["Parent", supportText(parent)],
    ["Kept", shown ? supportText(shown.answer.kept) : "being selected"],
    ["Rows outside every incident", countOf(answer.unassigned_record_count, "row")],
    ["Records without activity label", countOf(answer.coverage.omitted_activity_record_count, "record")],
    ["Revision", String(revision)],
  ];
  return (
    <dl className="facts" aria-label="Population">
      {facts.map(([label, value]) => (
        <div key={label} className="fact">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PreparationDetails({ answer }: { answer: ImportedPopulationAnswer }) {
  const { identity, preparation } = answer;
  const mapping = preparation.mapping;
  const rows: [string, string][] = [
    ["Source file", answer.source.filename],
    ["Encoding", encodingName(preparation.dialect.encoding)],
    ["Delimiter", delimiterName(preparation.dialect.delimiter)],
    ["Incident column", `column ${mapping.case_column}`],
    ["Activity column", `column ${mapping.activity_column}`],
    ["Time column", `column ${mapping.timestamp_column}`],
    ["Sequence column", mapping.sequence_column === null ? "none" : `column ${mapping.sequence_column}`],
    ["Context columns", mapping.context_columns.length === 0 ? "none" : mapping.context_columns.map((index) => `column ${index}`).join(", ")],
    ["Time policy", preparation.policies.time.id],
    ["Row rule", preparation.policies.rows.id],
    ["Source", identity.source_id],
    ["Preparation", identity.preparation_id],
    ["Representation", identity.representation_id],
    ["Case dictionary", identity.case_dictionary_id],
    ["Population", identity.population_id],
    ["Implementation version", identity.implementation_version],
    ["Request", answer.request_id],
  ];
  return (
    <details className="preparation-details">
      <summary>Data details</summary>
      <dl className="pairs">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
