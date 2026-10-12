import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { InspectorLayout } from "../components/Inspector";
import type { CaseId, ImportedPopulationAnswer } from "../generated/imports";
import { ImportProblemNotice } from "../data/ImportProblemNotice";
import { countOf, delimiterName, encodingName } from "../data/wording";
import type { ImportedInvestigationCoordinator } from "./coordinator";
import { ImportedInspector } from "./ImportedInspector";
import { type FocusRequest, IncidentWindow } from "./IncidentWindow";

interface ImportedInvestigationProps {
  coordinator: ImportedInvestigationCoordinator;
  onShowData: () => void;
}

/** The investigation of an imported preparation: its facts, every incident and one complete history. */
export function ImportedInvestigation({ coordinator, onShowData }: ImportedInvestigationProps) {
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getState);
  const [layout, setLayout] = useState<InspectorLayout>("side");
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [focusInspector, setFocusInspector] = useState(0);
  const inspectorHeading = useRef<HTMLHeadingElement>(null);
  const { population, inspected } = state;
  const inspectorOpen = inspected.phase !== "closed";
  const openCaseId = inspected.phase === "closed" ? null : inspected.caseId;

  useEffect(() => {
    if (focusInspector > 0) inspectorHeading.current?.focus();
  }, [focusInspector]);

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

  const answer = population.phase === "ready" ? population.answer : null;
  const summary = answer?.cases.find((item) => item.case_id === openCaseId);
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
        {answer && <Facts answer={answer} revision={population.phase === "ready" ? population.revision : 0} />}
        <p role="status" className="visually-hidden">
          {population.phase === "loading" ? "Opening the incidents of this preparation" : population.phase === "ready" ? "Incidents shown" : ""}
        </p>
      </div>
      {population.phase === "loading" && <div className="progress-line" aria-hidden="true" />}
      <div className="workbench-body" data-inspector={inspectorOpen ? layout : "none"}>
        <section className="table-pane" aria-labelledby="imported-incidents-title">
          <h3 id="imported-incidents-title" className="pane-title">
            Incidents of this preparation
          </h3>
          {population.phase === "loading" && <p className="working-text">Opening the incidents of this preparation…</p>}
          {population.phase === "failed" && (
            <ImportProblemNotice title="The incidents could not be opened" problem={population.problem} onRetry={() => coordinator.retryPopulation()} />
          )}
          {answer && answer.cases.length === 0 && (
            <p className="working-text">This preparation has no incident with an incident id, so there is no incident to open.</p>
          )}
          {answer && answer.cases.length > 0 && (
            <>
              <p className="muted pane-hint" id="imported-incidents-hint">
                Every incident with an incident id. Tab enters the table; the arrow keys, Page Up, Page Down, Home and End move; Enter opens every
                record of an incident.
              </p>
              <IncidentWindow
                cases={answer.cases}
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

function Facts({ answer, revision }: { answer: ImportedPopulationAnswer; revision: number }) {
  const facts: [string, string][] = [
    ["Incidents", countOf(answer.population.case_count, "incident")],
    ["Records of these incidents", countOf(answer.population.record_count, "record")],
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
