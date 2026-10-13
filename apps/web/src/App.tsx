import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { fetchHealth } from "./api";
import { httpComparisonClient, type ComparisonClient } from "./compare/client";
import { CompareCoordinator } from "./compare/coordinator";
import { CompareView } from "./compare/CompareView";
import { IncidentTable } from "./components/IncidentTable";
import { Inspector, type InspectorLayout } from "./components/Inspector";
import { PopulationStrip } from "./components/PopulationStrip";
import { ProblemNotice } from "./components/ProblemNotice";
import { ServiceStatus } from "./components/ServiceStatus";
import { httpImportClient, type ImportClient } from "./data/client";
import { DataCoordinator } from "./data/coordinator";
import { DataArea } from "./data/DataArea";
import { ImportedInvestigationCoordinator, type PreparationTarget } from "./imported/coordinator";
import { ImportedInvestigation } from "./imported/ImportedInvestigation";
import type { HealthResponse } from "./generated/health";
import type { CaseId } from "./generated/investigation";
import { httpInvestigationClient, type InvestigationClient } from "./investigation/client";
import { InvestigationCoordinator, type InvestigationState, type PopulationState } from "./investigation/coordinator";
import { defaultExampleId } from "./investigation/policies";
import { httpSelectionClient, type SelectionClient } from "./map/client";
import { httpSavingClient, type SavingClient } from "./saved/client";
import { SavingCoordinator } from "./saved/coordinator";
import { SavedInvestigations } from "./saved/SavedInvestigations";
import { httpPopulationViewClient, type PopulationViewClient } from "./views/client";
import { httpScoringClient, type ScoringClient } from "./expectation/client";
import { ExpectationView } from "./expectation/ExpectationView";
import { countOf, describeProblem, utcInstant } from "./investigation/wording";
import type { Problem } from "./investigation/client";
import { ReplacementNotice } from "./replacement/ReplacementNotice";

interface AppProps {
  client?: InvestigationClient;
  importClient?: ImportClient;
  selectionClient?: SelectionClient;
  viewClient?: PopulationViewClient;
  comparisonClient?: ComparisonClient;
  scoringClient?: ScoringClient;
  savingClient?: SavingClient;
  checkHealth?: (signal: AbortSignal) => Promise<HealthResponse>;
}

/** The area shown: the Data area, the investigation of the example or of an imported preparation, Compare, the Expectation view, or the saved investigations. */
type Area = "data" | "example" | "imported" | "compare" | "expectation" | "saved";

type FocusTarget = { to: "inspector" } | { to: "row"; caseId: CaseId };

export default function App({
  client = httpInvestigationClient,
  importClient = httpImportClient,
  selectionClient = httpSelectionClient,
  viewClient = httpPopulationViewClient,
  comparisonClient = httpComparisonClient,
  scoringClient = httpScoringClient,
  savingClient = httpSavingClient,
  checkHealth = fetchHealth,
}: AppProps) {
  const [coordinator] = useState(() => new InvestigationCoordinator(client));
  const [dataCoordinator] = useState(() => new DataCoordinator(importClient));
  const [importedCoordinator] = useState(() => new ImportedInvestigationCoordinator(importClient, selectionClient, viewClient));
  const [compareCoordinator] = useState(() => new CompareCoordinator(comparisonClient));
  const [savingCoordinator] = useState(() => new SavingCoordinator(savingClient, importedCoordinator));
  const [area, setArea] = useState<Area>("example");
  const [importedOpen, setImportedOpen] = useState(false);
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  const [layout, setLayout] = useState<InspectorLayout>("side");
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const rowControls = useRef(new Map<CaseId, HTMLButtonElement>()).current;
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const incidentsHeading = useRef<HTMLHeadingElement>(null);
  const waitingReason = useId();

  useEffect(() => {
    coordinator.start();
    return () => coordinator.stop();
  }, [coordinator]);

  useEffect(() => {
    return () => {
      dataCoordinator.stop();
      importedCoordinator.stop();
      savingCoordinator.stop();
    };
  }, [dataCoordinator, importedCoordinator, savingCoordinator]);

  useEffect(() => () => compareCoordinator.stop(), [compareCoordinator]);

  const openIncidents = useCallback(
    (target: PreparationTarget) => {
      importedCoordinator.open(target);
      setImportedOpen(true);
      setArea("imported");
    },
    [importedCoordinator],
  );

  useEffect(() => {
    if (focusTarget === null) return;
    if (focusTarget.to === "inspector") inspectorHeading.current?.focus();
    else (rowControls.get(focusTarget.caseId) ?? incidentsHeading.current)?.focus();
    setFocusTarget(null);
  }, [focusTarget, rowControls]);

  const { population, inspected, replacement } = state;
  const inspectorOpen = inspected.phase !== "closed";
  const openCaseId = inspected.phase === "closed" ? null : inspected.caseId;

  const openCase = useCallback(
    (caseId: CaseId) => {
      coordinator.openCase(caseId);
      setLayout((current) => (current === "collapsed" ? "side" : current));
      setFocusTarget({ to: "inspector" });
    },
    [coordinator],
  );

  const returnToIncidents = useCallback(() => {
    const current = coordinator.getState().inspected;
    if (current.phase === "closed") return;
    coordinator.closeCase();
    setFocusTarget({ to: "row", caseId: current.caseId });
  }, [coordinator]);

  useEffect(() => {
    if (!inspectorOpen || area !== "example") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      returnToIncidents();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen, area, returnToIncidents]);

  const summary = population.phase === "ready" ? population.answer.cases.find((item) => item.case_id === openCaseId) : undefined;

  return (
    <div className="app">
      <header className="app-bar">
        <span className="app-name">WISE Platform</span>
        {area === "example" ? <SourceLine population={population} /> : <span className="app-source" />}
        <nav className="areas" aria-label="Areas">
          <button type="button" aria-current={area === "data" ? "page" : undefined} onClick={() => setArea("data")}>
            Data
          </button>
          <button
            type="button"
            aria-current={area === "example" || area === "imported" ? "page" : undefined}
            onClick={() => setArea(importedOpen ? "imported" : "example")}
          >
            Investigations
          </button>
          <button type="button" aria-current={area === "compare" ? "page" : undefined} onClick={() => setArea("compare")}>
            Compare
          </button>
          <button type="button" aria-current={area === "expectation" ? "page" : undefined} onClick={() => setArea("expectation")}>
            Expectation
          </button>
          <button type="button" aria-current={area === "saved" ? "page" : undefined} onClick={() => setArea("saved")}>
            Saved
          </button>
        </nav>
        <ServiceStatus checkHealth={checkHealth} />
      </header>
      {area === "data" && (
        <DataArea coordinator={dataCoordinator} onOpenIncidents={openIncidents} onOpenExample={() => {
          setImportedOpen(false);
          setArea("example");
        }} />
      )}
      {area === "imported" && <ImportedInvestigation coordinator={importedCoordinator} saving={savingCoordinator} onShowData={() => setArea("data")} />}
      {area === "compare" && (
        <CompareView
          coordinator={compareCoordinator}
          investigation={importedCoordinator}
          onShowData={() => setArea("data")}
          onShowInvestigation={() => setArea(importedOpen ? "imported" : "example")}
        />
      )}
      {area === "expectation" && <ExpectationView investigation={importedCoordinator} client={scoringClient} />}
      {area === "saved" && (
        <SavedInvestigations
          saving={savingCoordinator}
          data={dataCoordinator}
          onReopened={() => {
            setImportedOpen(true);
            setArea("imported");
          }}
          onShowData={() => setArea("data")}
        />
      )}
      <main className="investigation" hidden={area !== "example"}>
        <PopulationStrip
          population={population}
          replacement={replacement}
          pending={population.phase === "loading" || inspected.phase === "loading" || replacement?.phase === "running"}
          onChooseExample={(exampleId) => coordinator.openExample(exampleId)}
        />
        <div className="work" data-inspector={inspectorOpen ? layout : "none"}>
          <section className="incidents" aria-labelledby="incidents-title">
            <h2 id="incidents-title" className="pane-title" tabIndex={-1} ref={incidentsHeading}>
              Incidents in the parent population
            </h2>
            <IncidentArea
              population={population}
              replacement={replacement}
              waitingReason={waitingReason}
              onStay={() => coordinator.stay()}
              openCaseId={openCaseId}
              onOpen={openCase}
              onRetry={() => coordinator.retryPopulation()}
              rowControls={rowControls}
            />
          </section>
          {inspected.phase !== "closed" && population.phase === "ready" && (
            <Inspector
              inspected={inspected}
              summary={summary}
              policies={population.answer.policies}
              layout={layout}
              onLayout={setLayout}
              onReturn={returnToIncidents}
              onRetry={() => coordinator.retryCase()}
              headingRef={inspectorHeading}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/** The source of the current question as quiet text in the app bar. */
function SourceLine({ population }: { population: PopulationState }) {
  if (population.phase !== "ready") {
    const exampleId = population.phase === "idle" ? defaultExampleId : population.exampleId;
    return <p className="app-source">Synthetic example {exampleId}</p>;
  }
  const { label, snapshot_cutoff_utc } = population.answer.source;
  const cutoff = `snapshot cutoff ${utcInstant(snapshot_cutoff_utc)}`;
  return (
    <p className="app-source" title={`${label} · ${cutoff}`}>
      <span>{label}</span> · {cutoff}
    </p>
  );
}

interface IncidentAreaProps {
  population: PopulationState;
  replacement: InvestigationState["replacement"];
  /** The id given to the text saying why incidents cannot be opened while another example is opening. */
  waitingReason: string;
  onStay: () => void;
  openCaseId: CaseId | null;
  onOpen: (caseId: CaseId) => void;
  onRetry: () => void;
  rowControls: Map<CaseId, HTMLButtonElement>;
}

/**
 * The incident table of the answer shown, or what stands in its place while there is none. While
 * another example is asked for, the table stays with the request beside it.
 */
function IncidentArea({ population, replacement, waitingReason, onStay, openCaseId, onOpen, onRetry, rowControls }: IncidentAreaProps) {
  if (replacement && population.phase === "ready") {
    return (
      <>
        <ReplacementNotice
          replacement={replacement}
          shown={`synthetic example ${population.answer.source.example_id}`}
          asked={`synthetic example ${replacement.asked}`}
          reasonId={waitingReason}
          describe={describeExampleProblem}
          onRetry={onRetry}
          onStay={onStay}
        />
        <IncidentTables
          population={population}
          openCaseId={openCaseId}
          onOpen={onOpen}
          waitingFor={replacement.phase === "running" ? waitingReason : undefined}
          rowControls={rowControls}
        />
      </>
    );
  }
  switch (population.phase) {
    case "idle":
    case "loading":
      return <p className="pane-note">Opening the synthetic example and its population…</p>;
    case "failed":
      return <ProblemNotice title="The population could not be opened" problem={population.problem} onRetry={onRetry} />;
    case "ready":
      return <IncidentTables population={population} openCaseId={openCaseId} onOpen={onOpen} rowControls={rowControls} />;
  }
}

interface IncidentTablesProps {
  population: Extract<PopulationState, { phase: "ready" }>;
  openCaseId: CaseId | null;
  onOpen: (caseId: CaseId) => void;
  waitingFor?: string;
  rowControls: Map<CaseId, HTMLButtonElement>;
}

function IncidentTables({ population, openCaseId, onOpen, waitingFor, rowControls }: IncidentTablesProps) {
  if (population.answer.cases.length === 0) {
    return (
      <p className="pane-note">
        The local service answered with {countOf(population.answer.populations.parent.case_count, "incident")} in the parent population,
        so there is no incident to open.
      </p>
    );
  }
  return <IncidentTable answer={population.answer} openCaseId={openCaseId} onOpen={onOpen} waitingFor={waitingFor} rowControls={rowControls} />;
}

function describeExampleProblem(problem: Problem) {
  const text = describeProblem(problem);
  return { message: text.message, remedy: text.reason, retryable: problem.kind !== "refusal" || problem.refusal.retryable };
}
