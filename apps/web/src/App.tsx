import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchHealth } from "./api";
import { IncidentTable } from "./components/IncidentTable";
import { Inspector, type InspectorLayout } from "./components/Inspector";
import { PopulationStrip } from "./components/PopulationStrip";
import { ProblemNotice } from "./components/ProblemNotice";
import { ServiceStatus } from "./components/ServiceStatus";
import type { HealthResponse } from "./generated/health";
import type { CaseId } from "./generated/investigation";
import { httpInvestigationClient, type InvestigationClient } from "./investigation/client";
import { InvestigationCoordinator, type PopulationState } from "./investigation/coordinator";
import { countOf } from "./investigation/wording";

interface AppProps {
  client?: InvestigationClient;
  checkHealth?: (signal: AbortSignal) => Promise<HealthResponse>;
}

type FocusTarget = { to: "inspector" } | { to: "row"; caseId: CaseId };

export default function App({ client = httpInvestigationClient, checkHealth = fetchHealth }: AppProps) {
  const [coordinator] = useState(() => new InvestigationCoordinator(client));
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  const [layout, setLayout] = useState<InspectorLayout>("side");
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const rowControls = useRef(new Map<CaseId, HTMLButtonElement>()).current;
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const incidentsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    coordinator.start();
    return () => coordinator.stop();
  }, [coordinator]);

  useEffect(() => {
    if (focusTarget === null) return;
    if (focusTarget.to === "inspector") inspectorHeading.current?.focus();
    else (rowControls.get(focusTarget.caseId) ?? incidentsHeading.current)?.focus();
    setFocusTarget(null);
  }, [focusTarget, rowControls]);

  const { population, inspected } = state;
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
    if (!inspectorOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.target instanceof HTMLSelectElement) return;
      event.preventDefault();
      returnToIncidents();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen, returnToIncidents]);

  const summary = population.phase === "ready" ? population.answer.cases.find((item) => item.case_id === openCaseId) : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">W</span>
          <span className="brand-name">WISE Platform</span>
        </div>
        <h1>Incident investigation</h1>
        <ServiceStatus checkHealth={checkHealth} />
      </header>
      <main className="investigation">
        <PopulationStrip population={population} onChooseExample={(exampleId) => coordinator.openExample(exampleId)} />
        <div className="work" data-inspector={inspectorOpen ? layout : "none"}>
          <section className="incidents" aria-labelledby="incidents-title">
            <h2 id="incidents-title" className="section-title" tabIndex={-1} ref={incidentsHeading}>
              Incidents in the parent population
            </h2>
            <IncidentArea
              population={population}
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

interface IncidentAreaProps {
  population: PopulationState;
  openCaseId: CaseId | null;
  onOpen: (caseId: CaseId) => void;
  onRetry: () => void;
  rowControls: Map<CaseId, HTMLButtonElement>;
}

/** The incident table of the current answer, or what stands in its place while there is none. */
function IncidentArea({ population, openCaseId, onOpen, onRetry, rowControls }: IncidentAreaProps) {
  switch (population.phase) {
    case "idle":
    case "loading":
      return <p className="pending">Opening the synthetic example and its population…</p>;
    case "failed":
      return <ProblemNotice title="The population could not be opened" problem={population.problem} onRetry={onRetry} />;
    case "ready":
      if (population.answer.cases.length === 0) {
        return (
          <p className="pending">
            The local service answered with {countOf(population.answer.populations.parent.case_count, "incident")} in the parent
            population, so there is no incident to open.
          </p>
        );
      }
      return <IncidentTable answer={population.answer} openCaseId={openCaseId} onOpen={onOpen} rowControls={rowControls} />;
  }
}
