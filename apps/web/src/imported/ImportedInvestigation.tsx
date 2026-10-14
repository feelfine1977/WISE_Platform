import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { InfoPopover } from "../components/InfoPopover";
import type { InspectorLayout } from "../components/Inspector";
import type { CaseId, ImportedCaseSummary, ImportedPopulationAnswer, PreparationId } from "../generated/imports";
import type { SelectionPredicate } from "../generated/selection";
import { ImportProblemNotice } from "../data/ImportProblemNotice";
import type { ImportProblem } from "../data/client";
import { countOf, delimiterName, describeImportProblem, encodingName } from "../data/wording";
import { MapView } from "../map/MapView";
import { SelectionSteps } from "../map/SelectionSteps";
import { supportText } from "../map/wording";
import { ReplacementNotice } from "../replacement/ReplacementNotice";
import "./data-row.css";
import { type AskedQuestion, type ImportedInvestigationCoordinator, type InvestigationView, type ShownSelection, shownSelection } from "./coordinator";
import { ImportedInspector } from "./ImportedInspector";
import { type FocusRequest, IncidentWindow } from "./IncidentWindow";
import type { SavingCoordinator } from "../saved/coordinator";
import { SaveButton, SavedLine, SaveForm } from "../saved/SaveControl";
import { FilterPanel } from "../filters/FilterPanel";
import { IncidentsInTimeOrder, type TimeOrder } from "../time/IncidentsInTimeOrder";
import { TimeColumn } from "../time/TimeColumn";
import { OpenedAs } from "../views/OpenedAs";
import type { VariantId } from "../views/messages";
import { Variants } from "../views/Variants";

interface ImportedInvestigationProps {
  coordinator: ImportedInvestigationCoordinator;
  onShowData: () => void;
  /** Saving the question shown; without it the toolbar offers no "Save". */
  saving?: SavingCoordinator;
  /** The view a question opens in when no saved view is restored: the process map, unless the caller asks for the table. */
  initialView?: InvestigationView;
  /** Whether the map starts with every activity kept in the place the whole parent's map gives it. */
  mapInPlace?: boolean;
}

/** What the centre shows: the map, the incidents, or every path of the map in one list. */
type View = InvestigationView | "paths";
/** What the side panel shows beside the map or the table. */
type Rail = "filters" | "context" | "patterns";

/** The orders of the list of kept incidents, with the words of their buttons. */
const INCIDENT_ORDERS: readonly ["case" | TimeOrder, string][] = [
  ["case", "By number"],
  ["observed_span_hours", "Longest span first"],
  ["maximum_adjacent_raw_gap_hours", "Longest gap first"],
];

/**
 * The investigation of an imported preparation in one screen: its facts and the selection of whole
 * incidents above; a side panel with how the incidents were opened and with their variants; the
 * kept incidents as a process map, as the list of every path of that map or as a table in the
 * centre; and the complete history of one kept incident beside them.
 */
export function ImportedInvestigation({ coordinator, onShowData, saving, initialView = "map", mapInPlace = false }: ImportedInvestigationProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  // A reopened investigation opens in the view it was saved in; any other question opens on its map.
  const [view, setView] = useState<View>(() => coordinator.getState().restoredView ?? initialView);
  // The kept incidents by number, as kept, or the longest first by recorded span or by longest gap, as the local service orders them.
  const [incidentOrder, setIncidentOrder] = useState<"case" | TimeOrder>("case");
  const [saveOpen, setSaveOpen] = useState(false);
  const [rail, setRail] = useState<Rail>("context");
  // Closed until it is asked for: the map and the table open on the whole width.
  const [railOpen, setRailOpen] = useState(false);
  const [layout, setLayout] = useState<InspectorLayout>("side");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [focusInspector, setFocusInspector] = useState(0);
  const [focusIncidents, setFocusIncidents] = useState(0);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const incidentsHeading = useRef<HTMLHeadingElement>(null);
  const waitingReason = useId();
  const { population, inspected, openingContext, variants, chosenVariant, replacement } = state;
  // While another question opens, nothing new is asked of the one shown.
  const waitingFor = replacement?.phase === "running" ? waitingReason : undefined;
  const inspectorOpen = inspected.phase !== "closed";
  const openCaseId = inspected.phase === "closed" ? null : inspected.caseId;

  useEffect(() => {
    if (focusInspector > 0) inspectorHeading.current?.focus();
  }, [focusInspector]);

  // A reopened investigation that replaces the question shown opens in its saved view once it arrives.
  const populationRevision = population.phase === "ready" ? population.revision : null;
  const restoredView = state.restoredView;
  useEffect(() => {
    if (populationRevision !== null && restoredView !== null) setView(restoredView);
  }, [populationRevision, restoredView]);

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
    <main className="workbench explorer" aria-labelledby="imported-title">
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
        {saving && answer && <SaveButton saving={saving} open={saveOpen} onOpen={() => setSaveOpen(true)} waitingFor={waitingFor} />}
        <p role="status" className="visually-hidden">
          {population.phase === "loading" ? "Opening the incidents of this preparation" : population.phase === "ready" ? "Incidents shown" : ""}
        </p>
      </div>
      {(population.phase === "loading" || state.selection.phase === "loading" || waitingFor) && <div className="progress-line" aria-hidden="true" />}
      {replacement && answer && (
        <ReplacementNotice
          replacement={replacement}
          shown={preparationName(answer.source.filename, answer.identity.preparation_id)}
          asked={askedName(replacement.asked)}
          reasonId={waitingReason}
          describe={describeReplacementProblem}
          onRetry={() => coordinator.retryPopulation()}
          onStay={() => coordinator.stay()}
        />
      )}
      {/* A saved investigation opens on its map or on its incidents; the list of paths is the map's and is saved as the map. */}
      {saving && saveOpen && answer && <SaveForm saving={saving} investigation={state} view={view === "paths" ? "map" : view} onClose={() => setSaveOpen(false)} />}
      {state.saved && <SavedLine binding={state.saved} />}
      {answer && (
        <div className="selection-bar">
          <div className="view-switch" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
              Map
            </button>
            <button type="button" aria-pressed={view === "incidents"} onClick={() => setView("incidents")}>
              Incidents
            </button>
            <button type="button" aria-pressed={view === "paths"} onClick={() => setView("paths")}>
              Paths
            </button>
          </div>
          <SelectionSteps
            selection={state.selection}
            onRemove={(step) => coordinator.removeStep(step)}
            onClear={() => coordinator.clearSteps()}
            onUndo={() => coordinator.undo()}
            onRedo={() => coordinator.redo()}
            onRetry={() => coordinator.retrySelection()}
            onStay={() => coordinator.staySelection()}
            waitingFor={waitingFor}
          />
          <button type="button" className="rail-toggle" aria-expanded={railOpen} aria-controls="explorer-rail" onClick={() => setRailOpen((open) => !open)}>
            Filters and views
          </button>
        </div>
      )}
      <div className="workbench-body" data-inspector={inspectorOpen ? layout : "none"}>
        {answer && railOpen && (
          <aside className="explorer-rail" id="explorer-rail" aria-label="Filters and views of the kept incidents">
            <div className="rail-head">
              <div className="view-switch" role="group" aria-label="Side panel">
                <button type="button" aria-pressed={rail === "filters"} onClick={() => setRail("filters")}>Filters</button>
                {/* A view that cannot be shown says so on its button, so that a failure in the view not shown is not missed. */}
                <button
                  type="button"
                  aria-pressed={rail === "context"}
                  data-failed={openingContext.phase === "failed" || undefined}
                  onClick={() => setRail("context")}
                >
                  {openingContext.phase === "failed" ? "Context · not shown" : "Context"}
                </button>
                <button
                  type="button"
                  aria-pressed={rail === "patterns"}
                  data-failed={variants.phase === "failed" || undefined}
                  onClick={() => setRail("patterns")}
                >
                  {variants.phase === "failed" ? "Patterns · not shown" : "Patterns"}
                </button>
              </div>
              <button type="button" aria-label="Hide the side panel" onClick={() => setRailOpen(false)}>
                Hide
              </button>
            </div>
            <div className="rail-body">
              {rail === "filters" && <FilterPanel population={answer} parentIds={state.parentCaseIds}
                parentIdentity={shown?.answer.parent_identity ?? answer.identity} revision={revision}
                opening={openingContext} onStep={addStep} waitingFor={waitingFor} />}
              <div hidden={rail !== "context"}>
                <OpenedAs state={openingContext} onRetry={() => coordinator.retryOpeningContext()} waitingFor={waitingFor} />
              </div>
              <div hidden={rail !== "patterns"}>
                <Variants
                  state={variants}
                  chosen={chosenVariant}
                  onChoose={chooseVariant}
                  onClear={() => clearVariant(false)}
                  onRetry={() => coordinator.retryVariants()}
                  waitingFor={waitingFor}
                />
              </div>
            </div>
          </aside>
        )}
        <div className="main-column">
          {/* The map and the list of its paths are one view of the kept incidents: its detail, its selection and its steps stay from one to the other. */}
          {answer && view !== "incidents" && (
            <section className="map-pane" aria-labelledby="imported-map-title">
              <h3 id="imported-map-title" className="pane-title">
                {view === "map" ? "Map of the kept incidents" : "Paths of the kept incidents"}
              </h3>
              {shown && state.parentGraph ? (
                <MapView
                  shown={shown}
                  parentGraph={state.parentGraph}
                  onStep={addStep}
                  waitingFor={waitingFor}
                  initiallyInPlace={mapInPlace}
                  showing={view}
                  aside={<TimeColumn workspaceId={answer.workspace_id} revision={revision} identity={shown.answer.identity} onStep={addStep} waitingFor={waitingFor} />}
                />
              ) : state.selection.phase === "failed" ? (
                <p className="working-text">{view === "map" ? "The map is shown once the incidents are selected." : "The paths are listed once the incidents are selected."}</p>
              ) : (
                <p className="working-text">{view === "map" ? "Selecting the incidents and drawing their map…" : "Selecting the incidents and listing their paths…"}</p>
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
                {!variantView && shown && (
                  <div className="incident-order" role="group" aria-label="Order of the incidents">
                    {INCIDENT_ORDERS.map(([value, label]) => (
                      <button key={value} type="button" aria-pressed={incidentOrder === value} onClick={() => setIncidentOrder(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {!variantView && shown && incidentOrder !== "case" ? (
                  <IncidentsInTimeOrder
                    workspaceId={answer.workspace_id}
                    revision={revision}
                    identity={shown.answer.identity}
                    kept={kept}
                    order={incidentOrder}
                    openCaseId={openCaseId}
                    onOpen={openCase}
                    focusRequest={focusRequest}
                    labelledBy="imported-incidents-title"
                    describedBy="imported-incidents-hint"
                    waitingFor={waitingFor}
                  />
                ) : (
                  <IncidentWindow
                    key={variantView ? `variant-${chosenVariant}` : "every-incident"}
                    cases={shownCases}
                    openCaseId={openCaseId}
                    onOpen={openCase}
                    focusRequest={focusRequest}
                    labelledBy="imported-incidents-title"
                    describedBy="imported-incidents-hint"
                    waitingFor={waitingFor}
                  />
                )}
              </>
            )}
          </section>
        </div>
        {inspected.phase !== "closed" && answer && (
          <ImportedInspector
            inspected={inspected}
            summary={summary}
            layout={layout}
            onLayout={setLayout}
            onReturn={returnToIncidents}
            onRetry={() => coordinator.retryCase()}
            waitingFor={waitingFor}
            headingRef={inspectorHeading}
          />
        )}
      </div>
    </main>
  );
}

/** Names a preparation by its source file and the start of its identity, for example "Vorgänge.csv, preparation 1a2b3c4d". */
function preparationName(filename: string | undefined, preparationId: PreparationId): string {
  const digest = preparationId.slice(preparationId.lastIndexOf(":") + 1, preparationId.lastIndexOf(":") + 9);
  return `${filename ?? "a source"}, preparation ${digest}`;
}

function askedName({ target, restoration }: AskedQuestion): string {
  return restoration ? `the saved investigation “${restoration.binding.content.name}”` : preparationName(target.sourceName, target.preparationId);
}

function describeReplacementProblem(problem: ImportProblem) {
  const text = describeImportProblem(problem);
  return { message: text.message, remedy: text.remedy, retryable: problem.kind !== "refusal" || problem.refusal.retryable };
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

const whole = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/**
 * The data row in one line: how much of the parent the selection keeps, in incidents and in
 * records; what these numbers leave out, quiet at zero and in the amber of a limit above it; and
 * behind an info button the revision shown and where the data comes from. Each figure has its
 * full name for assistive technology, and a limit has it as its tooltip too.
 */
function Facts({ answer, shown, revision }: { answer: ImportedPopulationAnswer; shown: ShownSelection | null; revision: number }) {
  const parent = shown ? shown.answer.parent : answer.population;
  const kept = shown ? shown.answer.kept : null;
  return (
    <div className="data-facts">
      <dl className="population" aria-label="Population">
        <div className="population-kept">
          <dt className="visually-hidden">Kept of the parent</dt>
          {kept === null ? (
            // Until the selection is answered nothing is known of what it keeps; the parent is said as it is supplied.
            <dd>
              being selected <span className="muted">of {supportText(parent)}</span>
            </dd>
          ) : (
            <>
              <dd>
                <KeptOf kept={kept.case_count} parent={countOf(parent.case_count, "incident")} />
                <KeptShare kept={kept.case_count} parent={parent.case_count} />
              </dd>
              <dd>
                <KeptOf kept={kept.record_count} parent={countOf(parent.record_count, "record")} />
              </dd>
            </>
          )}
        </div>
        <Limit name="Rows outside every incident" count={answer.unassigned_record_count} word="outside" />
        <Limit name="Records without activity label" count={answer.coverage.omitted_activity_record_count} word="unlabelled" />
      </dl>
      <InfoPopover label="About this data">
        <DataDetails answer={answer} revision={revision} />
      </InfoPopover>
    </div>
  );
}

/** A kept number of the parent's, as "803 of 12,063 incidents": the kept number stands out, the rest is quiet. */
function KeptOf({ kept, parent }: { kept: number; parent: string }) {
  return (
    <>
      <strong>{whole.format(kept)}</strong>
      <span className="muted"> of {parent}</span>
    </>
  );
}

/** The kept share of the parent's incidents as a small bar beside its two numbers, which say it; a picture only. */
function KeptShare({ kept, parent }: { kept: number; parent: number }) {
  return (
    <svg className="kept-share" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect className="kept-share-track" width="100" height="4" />
      <rect className="kept-share-bar" width={parent > 0 ? (100 * kept) / parent : 0} height="4" />
    </svg>
  );
}

/** What the numbers of the data row leave out, as a count with one word: quiet at zero, marked as a limit above it. */
function Limit({ name, count, word }: { name: string; count: number; word: string }) {
  return (
    <div className="population-limit" data-some={count > 0 || undefined}>
      <dt className="visually-hidden">{name}</dt>
      <dd title={name}>
        {whole.format(count)} {word}
      </dd>
    </div>
  );
}

/** What "About this data" says: the revision shown, then how the source was read and the identities of what was made of it. */
function DataDetails({ answer, revision }: { answer: ImportedPopulationAnswer; revision: number }) {
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
    <section className="popover-section data-details">
      <h4>Data details</h4>
      <dl className="pairs">
        <div>
          <dt>Revision</dt>
          <dd>{revision}</dd>
        </div>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
