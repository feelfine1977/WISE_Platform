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
import { type Observation, ImportedInspector } from "./ImportedInspector";
import { type FocusRequest, IncidentWindow } from "./IncidentWindow";
import type { SavingCoordinator } from "../saved/coordinator";
import { RefreshReview, SaveButton, SavedLine, SaveForm } from "../saved/SaveControl";
import { IncidentsInTimeOrder, type TimeOrder } from "../time/IncidentsInTimeOrder";
import { TimeColumn } from "../time/TimeColumn";
import { GroupsPanel } from "../groups/GroupsPanel";
import { IntervalPanel } from "../intervals/IntervalPanel";
import { OpenedAs } from "../views/OpenedAs";
import type { VariantId } from "../views/messages";
import { Variants } from "../views/Variants";
import { PairedHistories } from "../pinned/PairedHistories";
import { TransitionMatrix } from "../matrix/TransitionMatrix";
import { PinControl } from "../pinned/PinControl";
import { PinnedIndex } from "../pinned/PinnedIndex";
import { GapPairs } from "../gaps/GapPairs";
import { KeysGuide } from "./KeysGuide";
import { AddStep } from "../filters/AddStep";
import { httpGapsClient } from "../gaps/client";

interface ImportedInvestigationProps {
  coordinator: ImportedInvestigationCoordinator;
  onShowData: () => void;
  /** Saving the question shown; without it the toolbar offers no "Save". */
  saving?: SavingCoordinator;
  /** The view a question opens in when no saved view is restored: the process map, unless the caller asks for the table. */
  initialView?: InvestigationView;
  /** Whether the map starts with every activity in the place the parent's arrangement gives it, as it does unless told otherwise. */
  mapInPlace?: boolean;
}

/** What the centre shows: the map, the incidents, their variants, every path of the map in one list, or the matrix of its paths. */
type View = InvestigationView | "variants" | "paths" | "matrix";
/** What the side panel shows beside the map or the table. */
type Rail = "context" | "patterns" | "interval" | "gaps" | "pinned";

/** The orders of the list of kept incidents, with the words of their buttons. */
const INCIDENT_ORDERS: readonly ["case" | TimeOrder, string][] = [
  ["case", "By number"],
  ["observed_span_hours", "Longest span first"],
  ["maximum_adjacent_raw_gap_hours", "Longest gap first"],
  ["record_count", "Most records first"],
  ["first_recorded_time", "Earliest first record"],
];

/**
 * The investigation of an imported preparation in one screen: its facts and the selection of whole
 * incidents above; a side panel with how the incidents were opened and with their variants; the
 * kept incidents as a process map, as the list of every path of that map or as a table in the
 * centre; and the complete history of one kept incident beside them.
 */
export function ImportedInvestigation({ coordinator, onShowData, saving, initialView = "map", mapInPlace = true }: ImportedInvestigationProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  // A reopened investigation opens in the view it was saved in; any other question opens on its map.
  const [view, setView] = useState<View>(() => coordinator.getState().restoredView ?? initialView);
  // The kept incidents by number, as kept, or the longest first by recorded span or by longest gap, as the local service orders them.
  const [incidentOrder, setIncidentOrder] = useState<"case" | TimeOrder>("case");
  // The groups of the kept incidents beside their table, and the group whose incidents the table shows.
  const [groupsOpen, setGroupsOpen] = useState(false);
  // A group of the groups panel, or the order a pair of the longest gaps gives the table: `ordered` keeps the order given, `note` says what it is.
  const [chosenGroup, setChosenGroup] = useState<{ id: string; label: string; caseIds: readonly string[]; ordered?: true; note?: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rail, setRail] = useState<Rail>("context");
  // Where the line of guidance leads: the map or the chart of starts beside it gets the focus once shown, and "+ Add step" opens.
  const [guideFocus, setGuideFocus] = useState<"map" | "starts" | null>(null);
  const [addStepRequest, setAddStepRequest] = useState(0);
  useEffect(() => {
    if (guideFocus === null || view !== "map") return;
    let tries = 0;
    // The map and its column of time are drawn after the view switches: the focus waits for them.
    const timer = window.setInterval(() => {
      const target = guideFocus === "map"
        ? document.querySelector<HTMLElement>('[aria-label="Process map of the kept incidents"]')
        : document.querySelector<HTMLElement>('[aria-label^="Incident starts per"][tabindex]');
      tries += 1;
      if (target || tries > 40) {
        window.clearInterval(timer);
        if (target) {
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
          target.focus();
        }
        setGuideFocus(null);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [guideFocus, view]);
  // Closed until it is asked for: the map and the table open on the whole width.
  const [railOpen, setRailOpen] = useState(false);
  const [layout, setLayout] = useState<InspectorLayout>("side");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [focusInspector, setFocusInspector] = useState(0);
  const [focusIncidents, setFocusIncidents] = useState(0);
  // The incidents the table lists while a step is taken: those the selection keeps, or those it removes, read in its parent.
  const [listed, setListed] = useState<"kept" | "removed">("kept");
  // Two pins read beside each other in place of the map and the table, and the button that asked for it.
  const [pair, setPair] = useState<[number, number] | null>(null);
  // The rows of a passage opened from the matrix, marked in the incident's history while it is open.
  const [marked, setMarked] = useState<{ caseId: string; rowIds: string[] } | null>(null);
  const pairOpener = useRef<HTMLElement | null>(null);
  // What had the keyboard when the history of an incident was opened, so that closing it gives the keyboard back there.
  const historyOpener = useRef<HTMLElement | null>(null);
  const noteOpener = useCallback(() => {
    const active = document.activeElement;
    // An opener inside the history itself (another incident opened from there) keeps the first one.
    if (active instanceof HTMLElement && active !== document.body && !active.closest(".imported-inspector")) historyOpener.current = active;
  }, []);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const incidentsHeading = useRef<HTMLHeadingElement>(null);
  const waitingReason = useId();
  const { population, inspected, openingContext, variants, chosenVariant, replacement } = state;
  // While another question opens, nothing new is asked of the one shown.
  const waitingFor = replacement?.phase === "running" ? waitingReason : undefined;
  const inspectorOpen = inspected.phase !== "closed";
  const openCaseId = inspected.phase === "closed" || inspected.side === "pinned" ? null : inspected.caseId;
  const openPinId = inspected.phase === "closed" || inspected.side !== "pinned" ? null : inspected.pinId ?? null;

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
      noteOpener();
      coordinator.openCase(caseId);
      setLayout((current) => (current === "collapsed" ? "side" : current));
      setFocusInspector((count) => count + 1);
    },
    [coordinator, noteOpener],
  );
  const openRemoved = useCallback(
    (caseId: CaseId) => {
      noteOpener();
      coordinator.openCase(caseId, "removed");
      setLayout((current) => (current === "collapsed" ? "side" : current));
      setFocusInspector((count) => count + 1);
    },
    [coordinator, noteOpener],
  );
  const openPin = useCallback(
    (pinId: number) => {
      noteOpener();
      coordinator.openPin(pinId);
      setLayout((current) => (current === "collapsed" ? "side" : current));
      setFocusInspector((count) => count + 1);
    },
    [coordinator, noteOpener],
  );
  const openWitness = useCallback(
    (caseId: CaseId, rowIds: string[]) => {
      noteOpener();
      setMarked({ caseId, rowIds });
      coordinator.openCase(caseId);
      setLayout((current) => (current === "collapsed" ? "side" : current));
      setFocusInspector((count) => count + 1);
    },
    [coordinator, noteOpener],
  );
  const openPair = useCallback((pinIds: [number, number]) => {
    pairOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPair(pinIds);
  }, []);
  const closePair = useCallback(() => {
    setPair(null);
    const opener = pairOpener.current;
    pairOpener.current = null;
    requestAnimationFrame(() => opener?.focus());
  }, []);
  const pairEvidence = useCallback((pinId: number, signal: AbortSignal) => coordinator.pinEvidence(pinId, signal), [coordinator]);

  const returnToIncidents = useCallback(() => {
    const current = coordinator.getState().inspected;
    if (current.phase === "closed") return;
    coordinator.closeCase();
    const opener = historyOpener.current;
    historyOpener.current = null;
    // Opened from the table, the keyboard goes back to the incident's row, which the table brings into view. Opened from
    // anywhere else (the map's matrix, a list in the side panel, a pin), it goes back to what opened it, once the history
    // has made room for it again; the selection and the view stay as they are.
    if (current.side !== "pinned" && (opener === null || opener.closest(".incident-table") !== null)) {
      setFocusRequest((previous) => ({ caseId: current.caseId, token: (previous?.token ?? 0) + 1 }));
    } else if (opener !== null) {
      requestAnimationFrame(() => opener.isConnected && opener.focus());
    }
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
  const shownRevision = state.selection.phase === "ready" ? state.selection.revision : null;
  // A new previewer for each selection shown, so that every preview counts from the selection on screen.
  const previewStep = useCallback(
    (step: SelectionPredicate, signal: AbortSignal) => coordinator.previewStep(step, signal),
    [coordinator, shownRevision], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  const groupView = useMemo(() => {
    if (chosenGroup === null || variantView) return null;
    if (chosenGroup.ordered) {
      const byId = new Map(kept.map((item) => [item.case_id, item]));
      return { ...chosenGroup, cases: chosenGroup.caseIds.flatMap((caseId) => byId.get(caseId) ?? []) };
    }
    const members = new Set(chosenGroup.caseIds);
    return { ...chosenGroup, cases: kept.filter((item) => members.has(item.case_id)) };
  }, [chosenGroup, variantView, kept]);
  // A group is chosen among the incidents kept when it was chosen: another selection lets it go.
  const keptPopulation = shown?.answer.identity.population_id;
  useEffect(() => setChosenGroup(null), [keptPopulation]);
  const contextColumns = useMemo(() => {
    const names = openingContext.phase === "ready" ? openingContext.answer.opening_context.columns : [];
    return (answer?.preparation.mapping.context_columns ?? []).map((index) => ({
      index,
      name: names.find((column) => column.column_index === index)?.column_name || `column ${index}`,
    }));
  }, [answer, openingContext]);
  // The activities of the parent's map, the most frequent first, for the rule that groups the incidents with and without one.
  const parentActivities = useMemo(
    () => (state.parentGraph ? [...state.parentGraph.nodes].sort((one, other) => other.metrics.cases - one.metrics.cases).map((node) => node.label) : []),
    [state.parentGraph],
  );
  // The incidents the selection removes, while a step is taken; they are opened in the selection's parent.
  const removedCases = useMemo(() => {
    if (!answer || !shown) return [];
    const summaries = new Map(answer.cases.map((item) => [item.case_id, item]));
    return shown.answer.removed.case_ids.flatMap((caseId) => summaries.get(caseId) ?? []);
  }, [answer, shown]);
  const steps = shown?.answer.predicate_results.length ?? 0;
  const listingRemoved = listed === "removed" && steps > 0 && !variantView && !groupView;
  useEffect(() => {
    if (steps === 0) setListed("kept");
  }, [steps]);
  const pairPins = pair ? pair.map((id) => state.pins.find((pin) => pin.id === id)) : null;
  const shownPair = pairPins && pairPins[0] && pairPins[1] ? ([pairPins[0], pairPins[1]] as const) : null;
  useEffect(() => {
    if (pair && !shownPair) setPair(null);
  }, [pair, shownPair]);
  const shownCases = listingRemoved ? removedCases : variantView ? variantView.cases : groupView ? groupView.cases : kept;
  /** Keeps or removes the incidents of the chosen group as a step; the table shows every kept incident again. */
  const stepFromGroup = (negate: boolean) => {
    if (groupView === null || groupView.caseIds.length === 0) return;
    const [first, ...rest] = groupView.caseIds;
    addStep({ kind: "case_id_in", case_ids: [first, ...rest], negate });
    setChosenGroup(null);
  };
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
        {answer && <KeysGuide serviceVersion={answer.identity.implementation_version} />}
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
      {/* A saved investigation opens on its map or on its incidents; the list of paths and the matrix are of the map and are saved as the map, the variants as the incidents. */}
      {saving && saveOpen && answer && <SaveForm saving={saving} investigation={state} view={view === "paths" || view === "matrix" ? "map" : view === "variants" ? "incidents" : view} onClose={() => setSaveOpen(false)} />}
      {state.saved && <SavedLine binding={state.saved} />}
      {saving && state.saved && <RefreshReview saving={saving} revisionId={state.saved.revisionId} />}
      {answer && answer.cases.length > 0 && answer.cases.every((summary) => !summary.sequence_evaluable) && (
        <div className="state-line state-confirm" role="note">
          <p>
            The order of no incident is known: every incident has a record without a usable time. So this reading has no paths, no variants and no
            durations; the incidents and all their records stay as recorded. The times may be written in another format than the one chosen.
          </p>
          <button type="button" onClick={onShowData}>
            Change how the times are read, in the Data area
          </button>
        </div>
      )}
      {answer && (
        <div className="selection-bar">
          <div className="view-switch" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
              Map
            </button>
            <button type="button" aria-pressed={view === "incidents"} onClick={() => setView("incidents")}>
              Incidents
            </button>
            {/* A view that cannot be shown says so on its button, so that a failure in a view not shown is not missed. */}
            <button type="button" aria-pressed={view === "variants"} data-failed={variants.phase === "failed" || undefined} onClick={() => setView("variants")}>
              {variants.phase === "failed" ? "Variants · not shown" : "Variants"}
            </button>
            <button type="button" aria-pressed={view === "paths"} onClick={() => setView("paths")}>
              Paths
            </button>
            <button type="button" aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>
              Matrix
            </button>
          </div>
          <SelectionSteps
            selection={state.selection}
            onRemove={(step) => coordinator.removeStep(step)}
            onClear={() => coordinator.clearSteps()}
            onUndo={() => coordinator.undo()}
            onRedo={() => coordinator.redo()}
            onShowAfter={(count) => coordinator.showAfter(count)}
            guide={{
              onShowMap: () => { setView("map"); setGuideFocus("map"); },
              onShowStarts: () => { setView("map"); setGuideFocus("starts"); },
              onAddStep: () => setAddStepRequest((count) => count + 1),
            }}
            onRetry={() => coordinator.retrySelection()}
            onStay={() => coordinator.staySelection()}
            waitingFor={waitingFor}
          />
          {answer && (
            <AddStep openRequest={addStepRequest} population={answer} parentIds={state.parentCaseIds} parentIdentity={shown?.answer.parent_identity ?? answer.identity}
              keptIdentity={shown?.answer.identity ?? answer.identity} revision={revision} opening={openingContext} onStep={addStep} waitingFor={waitingFor} />
          )}
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
                {/* A view that cannot be shown says so on its button, so that a failure in the view not shown is not missed. */}
                <button
                  type="button"
                  aria-pressed={rail === "context"}
                  data-failed={openingContext.phase === "failed" || undefined}
                  onClick={() => setRail("context")}
                >
                  {openingContext.phase === "failed" ? "Context · not shown" : "Context"}
                </button>
                {/* The variants beside the table too, so that one variant after another can be listed in it. */}
                <button
                  type="button"
                  aria-pressed={rail === "patterns"}
                  data-failed={variants.phase === "failed" || undefined}
                  onClick={() => setRail("patterns")}
                >
                  {variants.phase === "failed" ? "Variants · not shown" : "Variants"}
                </button>
                <button type="button" aria-pressed={rail === "interval"} onClick={() => setRail("interval")}>Interval</button>
                <button type="button" aria-pressed={rail === "gaps"} onClick={() => setRail("gaps")}>Gaps</button>
                <button type="button" aria-pressed={rail === "pinned"} onClick={() => setRail("pinned")}>Pinned</button>
              </div>
              <button type="button" aria-label="Hide the side panel" onClick={() => setRailOpen(false)}>
                Hide
              </button>
            </div>
            <div className="rail-body">

              <div hidden={rail !== "context"}>
                <OpenedAs state={openingContext} onRetry={() => coordinator.retryOpeningContext()} waitingFor={waitingFor} onStep={addStep} previewStep={previewStep} onOpenCase={openCase} openCaseId={openCaseId} />
              </div>
              {rail === "interval" && (
                <IntervalPanel
                  workspaceId={answer.workspace_id}
                  revision={revision}
                  identity={shown?.answer.identity ?? answer.identity}
                  activities={[...new Set((state.parentGraph?.nodes ?? []).map((node) => node.label))].sort()}
                  onStep={addStep}
                  previewStep={previewStep}
                  onOpenCase={openCase}
                  openCaseId={openCaseId}
                  waitingFor={waitingFor}
                />
              )}
              {rail === "gaps" && (
                <GapPairs
                  workspaceId={answer.workspace_id}
                  revision={revision}
                  identity={shown?.answer.identity ?? answer.identity}
                  ordered={chosenGroup?.ordered ? chosenGroup.id : null}
                  onOrder={(order) => {
                    setChosenGroup(order);
                    // The order is read in the table of the incidents.
                    if (order !== null) setView("incidents");
                  }}
                />
              )}
              {rail === "pinned" && (
                <PinnedIndex
                  pins={state.pins}
                  currentPopulationId={shown?.answer.identity.population_id ?? null}
                  onOpen={openPin}
                  onUnpin={(pinId) => coordinator.unpin(pinId)}
                  onPair={openPair}
                  openPinId={openPinId}
                />
              )}
              {/* Not beside its own view: the variants in the centre are the same list. */}
              <div hidden={rail !== "patterns"}>
                {view === "variants" ? (
                  <p className="muted">The variants are shown in the centre.</p>
                ) : (
                  <Variants
                    state={variants}
                    chosen={chosenVariant}
                    onChoose={chooseVariant}
                    onClear={() => clearVariant(false)}
                    onRetry={() => coordinator.retryVariants()}
                    waitingFor={waitingFor}
                    onStep={addStep}
                    previewStep={previewStep}
                  />
                )}
              </div>
            </div>
          </aside>
        )}
        <div className="main-column">
          {shownPair && (
            <PairedHistories pins={[shownPair[0], shownPair[1]]} evidence={pairEvidence} currentPopulationId={shown?.answer.identity.population_id ?? null} onReturn={closePair} />
          )}
          {/* The map and the list of its paths are one view of the kept incidents: its detail, its selection and its steps stay from one to the other. */}
          {answer && view === "matrix" && (
            <div hidden={shownPair !== null}>
              {shown ? (
                <TransitionMatrix workspaceId={answer.workspace_id} revision={revision} identity={shown.answer.identity} onStep={addStep}
                  previewStep={previewStep} waitingFor={waitingFor} onOpenCase={openWitness} openCaseId={openCaseId} />
              ) : (
                // The matrix is of the incidents a selection keeps: until one is answered it is not shown, and says so.
                <p className="working-text">
                  {state.selection.phase === "failed" ? "The matrix is shown once the incidents are selected." : "Selecting the incidents for the matrix of their paths…"}
                </p>
              )}
            </div>
          )}
          {/* The variants of the kept incidents in the centre: a variant listed shows its incidents in the table, and a step from one keeps or removes them. */}
          {answer && view === "variants" && (
            <section className="variants-pane" aria-labelledby="imported-variants-title" hidden={shownPair !== null}>
              <h3 id="imported-variants-title" className="pane-title">
                Variants of the kept incidents
              </h3>
              <Variants
                state={variants}
                chosen={chosenVariant}
                onChoose={chooseVariant}
                onClear={() => clearVariant(false)}
                onRetry={() => coordinator.retryVariants()}
                waitingFor={waitingFor}
                onStep={addStep}
                previewStep={previewStep}
              />
            </section>
          )}
          {answer && (view === "map" || view === "paths") && (
            <section className="map-pane" aria-labelledby="imported-map-title" hidden={shownPair !== null}>
              <h3 id="imported-map-title" className="pane-title">
                {view === "map" ? "Map of the kept incidents" : "Paths of the kept incidents"}
              </h3>
              {shown && state.parentGraph ? (
                <MapView
                  shown={shown}
                  gaps={httpGapsClient}
                  parentGraph={state.parentGraph}
                  onStep={addStep}
                  previewStep={previewStep}
                  waitingFor={waitingFor}
                  initiallyInPlace={mapInPlace}
                  showing={view === "paths" ? "paths" : "map"}
                  onShowMap={() => setView("map")}
                  contextColumns={contextColumns}
                  aside={<TimeColumn workspaceId={answer.workspace_id} revision={revision} identity={shown.answer.identity} onStep={addStep} previewStep={previewStep} waitingFor={waitingFor} />}
                />
              ) : state.selection.phase === "failed" ? (
                <p className="working-text">{view === "map" ? "The map is shown once the incidents are selected." : "The paths are listed once the incidents are selected."}</p>
              ) : (
                <p className="working-text">{view === "map" ? "Selecting the incidents and drawing their map…" : "Selecting the incidents and listing their paths…"}</p>
              )}
            </section>
          )}
          <section className="table-pane" aria-labelledby="imported-incidents-title" hidden={shownPair !== null || (answer !== null && view !== "incidents")}>
            <h3 id="imported-incidents-title" className="pane-title" tabIndex={-1} ref={incidentsHeading}>
              {variantView ? `Kept incidents of variant ${variantView.rank}` : listingRemoved ? "Removed incidents" : "Kept incidents"}
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
            {groupView && (
              <div className="view-note">
                <p>
                  {groupView.note ?? (
                    <>
                      The table lists the {countOf(groupView.cases.length, "incident")} of the group “{groupView.label}”. This is a view until a step is taken.
                    </>
                  )}
                </p>
                <button type="button" onClick={() => stepFromGroup(false)} disabled={waitingFor !== undefined || groupView.caseIds.length === 0} aria-describedby={waitingFor}>
                  Keep these incidents
                </button>
                <button type="button" onClick={() => stepFromGroup(true)} disabled={waitingFor !== undefined || groupView.caseIds.length === 0} aria-describedby={waitingFor}>
                  Remove these incidents
                </button>
                <button type="button" onClick={() => setChosenGroup(null)}>
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
            {answer && answer.cases.length > 0 && kept.length === 0 && !listingRemoved && (
              <p className="working-text">The selection keeps no incident. Remove a step or undo it to keep incidents again.</p>
            )}
            {answer && (kept.length > 0 || listingRemoved) && (
              <div className="incident-area" data-groups={groupsOpen && shown && !variantView && !listingRemoved ? "open" : "closed"}>
                {groupsOpen && shown && !variantView && !listingRemoved && (
                  <GroupsPanel
                    workspaceId={answer.workspace_id}
                    revision={revision}
                    identity={shown.answer.identity}
                    contextColumns={contextColumns}
                    activities={parentActivities}
                    onOpen={openCase}
                    chosen={chosenGroup?.id ?? null}
                    onChoose={setChosenGroup}
                  />
                )}
                <div className="incident-table">
                  <p className="muted pane-hint" id="imported-incidents-hint">
                    {variantView
                      ? `The kept incidents that follow variant ${variantView.rank}.`
                      : listingRemoved
                        ? "The incidents the selection removes; each opens in the selection's parent, and opening one changes no step."
                        : "The incidents the selection keeps; with no step, every incident with an incident id."}{" "}
                    Tab enters the table; the arrow keys, Page Up, Page Down, Home and End move; Enter opens every record of an incident.
                  </p>
                  {!variantView && !groupView && steps > 0 && (
                    <div className="incident-listed" role="group" aria-label="Incidents listed">
                      <button type="button" aria-pressed={!listingRemoved} onClick={() => setListed("kept")}>
                        Kept ({kept.length.toLocaleString("en")})
                      </button>
                      <button type="button" aria-pressed={listingRemoved} onClick={() => setListed("removed")}>
                        Removed ({removedCases.length.toLocaleString("en")})
                      </button>
                    </div>
                  )}
                  {!variantView && shown && !listingRemoved && (
                    <div className="incident-tools">
                      <button
                        type="button"
                        aria-pressed={groupsOpen}
                        onClick={() => {
                          setGroupsOpen(!groupsOpen);
                          setChosenGroup(null);
                        }}
                      >
                        Groups
                      </button>
                      {!groupView && (
                        <div className="incident-order" role="group" aria-label="Order of the incidents">
                          {INCIDENT_ORDERS.map(([value, label]) => (
                            <button key={value} type="button" aria-pressed={incidentOrder === value} onClick={() => setIncidentOrder(value)}>
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {!variantView && !groupView && !listingRemoved && shown && incidentOrder !== "case" ? (
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
                      onShowRecords={openWitness}
                      onOrder={setIncidentOrder}
                    />
                  ) : (
                    <IncidentWindow
                      key={listingRemoved ? "removed" : variantView ? `variant-${chosenVariant}` : groupView ? `group-${groupView.id}` : "every-incident"}
                      cases={shownCases}
                      openCaseId={openCaseId}
                      onOpen={listingRemoved ? openRemoved : openCase}
                      focusRequest={focusRequest}
                      labelledBy="imported-incidents-title"
                      describedBy="imported-incidents-hint"
                      waitingFor={waitingFor}
                      // The kept incidents by number: the head of Records orders them by the local service instead.
                      sorting={!variantView && !groupView && !listingRemoved && shown ? { column: null, descending: false, onSort: setIncidentOrder } : undefined}
                    />
                  )}
                </div>
              </div>
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
            observation={observationOf(answer)}
            highlightedRowIds={marked !== null && marked.caseId === inspected.caseId && inspected.side === undefined ? marked.rowIds : undefined}
            selection={shown ? { kept: shown.answer.kept.case_count, parent: shown.answer.parent.case_count, steps: shown.answer.predicate_results.length,
              removed: shown.answer.removed.case_count } : undefined}
            actions={inspected.phase === "ready" && inspected.side !== "pinned" && shown ? (
              <PinControl key={`${inspected.caseId}-${inspected.side ?? "kept"}`} caseId={inspected.caseId}
                pinned={state.pins.filter((pin) => pin.caseId === inspected.caseId && pin.side === (inspected.side === "removed" ? "removed" : "kept"))}
                onPin={(role, words) => coordinator.pin(role, words)} onUnpin={(pinId) => coordinator.unpin(pinId)} />
            ) : undefined}
            waitingFor={waitingFor}
            headingRef={inspectorHeading}
            documents={answer.preparation.mapping.document_reference_column != null
              ? { workspaceId: answer.workspace_id, identity: answer.identity, column: answer.preparation.mapping.document_reference_column }
              : undefined}
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
        <p className="about-lead">The figures above count incidents and their records: those the selection keeps, of the parent's, and the records outside every incident.</p>
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
    ["Document reference", mapping.document_reference_column == null ? "none" : `column ${mapping.document_reference_column}`],
    ["Read as numbers", mapping.numeric_context_columns == null ? "none"
      : mapping.numeric_context_columns.map((item) => `column ${item.column_index}${item.unit === null ? "" : ` (${item.unit})`}`).join(", ")],
    ["Time policy", preparation.policies.time.id],
    ["Export taken at", exportTakenAt(answer)],
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

/** The export's cutoff of the population shown, on its clock, for the evidence of an incident. */
function observationOf(answer: ImportedPopulationAnswer | null): Observation | undefined {
  if (!answer) return undefined;
  const time = answer.preparation.policies.time;
  return time.id === "incident.time.wall_clock_as_recorded.v1"
    ? { timestamp_kind: "wall_clock", cutoff: time.parameters.snapshot_cutoff_local }
    : { timestamp_kind: "utc_instant", cutoff: time.parameters.snapshot_cutoff_utc };
}

/** The cutoff of the reading in words, on its clock: no record after it was in the export. */
function exportTakenAt(answer: ImportedPopulationAnswer): string {
  const observation = observationOf(answer)!;
  return observation.timestamp_kind === "wall_clock" ? `${observation.cutoff.replace("T", " ")}, as recorded` : observation.cutoff.replace("T", " ").replace("Z", " UTC");
}
