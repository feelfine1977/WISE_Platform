import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { fetchHealth } from "./api";
import { httpComparisonClient, type ComparisonClient } from "./compare/client";
import { CompareCoordinator } from "./compare/coordinator";
import { CompareView } from "./compare/CompareView";
import { AreaTabs, type AreaTab } from "./components/AreaTabs";
import { ServiceStatus } from "./components/ServiceStatus";
import { httpImportClient, type ImportClient } from "./data/client";
import { DataCoordinator } from "./data/coordinator";
import { DataArea } from "./data/DataArea";
import { ImportedInvestigationCoordinator, type PreparationTarget, shownSelection } from "./imported/coordinator";
import { ImportedInvestigation } from "./imported/ImportedInvestigation";
import type { HealthResponse } from "./generated/health";
import { httpSelectionClient, type SelectionClient } from "./map/client";
import { nameContextColumns } from "./map/wording";
import { httpSavingClient, type SavingClient } from "./saved/client";
import { SavingCoordinator } from "./saved/coordinator";
import { SavedInvestigations } from "./saved/SavedInvestigations";
import { browserReadingMemory, FirstOpen, type ReadingMemory } from "./start/firstOpen";
import { StartNotice } from "./start/StartNotice";
import { httpPopulationViewClient, type PopulationViewClient } from "./views/client";
import { httpScoringClient, type ScoringClient } from "./expectation/client";
import { ExpectationCoordinator } from "./expectation/coordinator";
import { ExpectationView } from "./expectation/ExpectationView";

interface AppProps {
  importClient?: ImportClient;
  selectionClient?: SelectionClient;
  viewClient?: PopulationViewClient;
  comparisonClient?: ComparisonClient;
  scoringClient?: ScoringClient;
  savingClient?: SavingClient;
  checkHealth?: (signal: AbortSignal) => Promise<HealthResponse>;
  /** Which reading of a workspace was opened last on this computer. */
  readingMemory?: ReadingMemory;
}

/** The areas of the application, in the order of the work. */
type Area = "data" | "investigations" | "compare" | "expectation" | "saved";

/** Every area can be entered at any time; an area that needs incidents says so and offers the step. */
const areaTabs: AreaTab<Area>[] = [
  { id: "data", label: "Data", unavailable: null },
  { id: "investigations", label: "Investigations", unavailable: null },
  { id: "compare", label: "Compare", unavailable: null },
  { id: "expectation", label: "Expectation", unavailable: null },
  { id: "saved", label: "Saved", unavailable: null },
];

export default function App({
  importClient = httpImportClient,
  selectionClient = httpSelectionClient,
  viewClient = httpPopulationViewClient,
  comparisonClient = httpComparisonClient,
  scoringClient = httpScoringClient,
  savingClient = httpSavingClient,
  checkHealth = fetchHealth,
  readingMemory = browserReadingMemory,
}: AppProps) {
  const [dataCoordinator] = useState(() => new DataCoordinator(importClient));
  const [importedCoordinator] = useState(() => new ImportedInvestigationCoordinator(importClient, selectionClient, viewClient));
  const [compareCoordinator] = useState(() => new CompareCoordinator(comparisonClient));
  // Lives above the areas, so that the expectation, its check and its run stay while another area is shown.
  const [expectationCoordinator] = useState(() => new ExpectationCoordinator(scoringClient, importedCoordinator));
  const [savingCoordinator] = useState(
    () => new SavingCoordinator(savingClient, importedCoordinator, compareCoordinator, expectationCoordinator),
  );
  // The start opens a reading by itself and leaves the area the analyst is in as it is.
  const [firstOpen] = useState(
    () =>
      new FirstOpen(
        dataCoordinator,
        (target, steps) => {
          readingMemory.remember(target, steps);
          importedCoordinator.open(target, steps);
        },
        readingMemory,
      ),
  );
  const [area, setArea] = useState<Area>("investigations");
  const incidentsOpen = useSyncExternalStore(importedCoordinator.subscribe, () => importedCoordinator.getState().population.phase !== "idle");

  useEffect(() => {
    firstOpen.start();
    return () => firstOpen.stop();
  }, [firstOpen]);

  // The steps the incidents shown were selected by are kept with the reading, so that a refresh and a
  // restart show the same selection. A saved investigation on a parent of its own is not kept this way.
  useEffect(() => {
    let kept = "";
    return importedCoordinator.subscribe(() => {
      const { population, selection, parentCaseIds } = importedCoordinator.getState();
      const shown = shownSelection(selection);
      if (population.phase !== "ready" || shown === null || parentCaseIds !== null) return;
      const key = JSON.stringify([population.target.workspaceId, population.target.preparationId, shown.steps]);
      if (key === kept) return;
      kept = key;
      readingMemory.remember(population.target, shown.steps);
    });
  }, [importedCoordinator, readingMemory]);

  useEffect(() => {
    return () => {
      dataCoordinator.stop();
      importedCoordinator.stop();
      savingCoordinator.stop();
    };
  }, [dataCoordinator, importedCoordinator, savingCoordinator]);

  // A step that names a context column says its name; the names are those of the reading shown.
  useEffect(() => {
    let named: unknown = null;
    return importedCoordinator.subscribe(() => {
      const { openingContext } = importedCoordinator.getState();
      const columns = openingContext.phase === "ready" ? openingContext.answer.opening_context.columns : null;
      if (columns === named) return;
      named = columns;
      nameContextColumns(new Map((columns ?? []).map((column) => [column.column_index, column.column_name])));
    });
  }, [importedCoordinator]);

  useEffect(() => () => compareCoordinator.stop(), [compareCoordinator]);
  useEffect(() => {
    expectationCoordinator.start();
    return () => expectationCoordinator.stop();
  }, [expectationCoordinator]);

  const openIncidents = useCallback(
    (target: PreparationTarget) => {
      readingMemory.remember(target);
      importedCoordinator.open(target);
      setArea("investigations");
    },
    [importedCoordinator, readingMemory],
  );
  const showData = useCallback(() => setArea("data"), []);
  const showInvestigations = useCallback(() => setArea("investigations"), []);

  return (
    <div className="app">
      <header className="app-bar">
        <span className="app-name">WISE Platform</span>
        <AreaTabs tabs={areaTabs} current={area} onChoose={setArea} />
        <span className="app-source" />
        <ServiceStatus checkHealth={checkHealth} />
      </header>
      {area === "data" && <DataArea coordinator={dataCoordinator} onOpenIncidents={openIncidents} />}
      {area === "investigations" &&
        (incidentsOpen ? (
          <ImportedInvestigation coordinator={importedCoordinator} saving={savingCoordinator} onShowData={showData} />
        ) : (
          <StartNotice start={firstOpen} onShowData={showData} />
        ))}
      {area === "compare" && (
        <CompareView coordinator={compareCoordinator} investigation={importedCoordinator} onShowData={showData} onShowInvestigation={showInvestigations} />
      )}
      {area === "expectation" && <ExpectationView investigation={importedCoordinator} coordinator={expectationCoordinator} />}
      {area === "saved" && (
        <SavedInvestigations saving={savingCoordinator} data={dataCoordinator} onReopened={showInvestigations} onShowData={showData} />
      )}
    </div>
  );
}
