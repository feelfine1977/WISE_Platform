import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import {
  bothSteps,
  closed,
  contains,
  containingOpened,
  everyIncident,
  type Figures,
  follows,
  graphAnswer,
  nodeIds,
  opened,
  scriptedSelectionClient,
  selectionAnswer,
  support,
  suppliedGraph,
} from "../test/selections";
import { MANY_ACTIVITIES, MANY_PATHS, openingDetail } from "./MapView";

vi.mock("wise-flow", async (original) => {
  const library = await original<typeof import("wise-flow")>();
  return { ...library, layoutUnion: vi.fn(library.layoutUnion) };
});

// The map measures its container; the test page has no layout, so nothing is ever resized.
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

beforeEach(() => {
  vi.mocked(flow.layoutUnion).mockClear();
});

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The investigation with its population and every incident selected, its map not yet shown. */
async function renderInvestigation(parentGraph: (caseIds: string[]) => SuppliedGraph = suppliedGraph) {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const app = { imports, selecting, coordinator, user, parentGraph };
  await answer(app, 0, everyIncident);
  return app;
}

type App = Awaited<ReturnType<typeof renderInvestigation>>;

async function answer(app: App, place: number, figures: Figures) {
  const selection = app.selecting.selections[place];
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision)!;
  const supplied = { ...graphAnswer(graph.request, figures.kept.case_ids), graph: app.parentGraph(figures.kept.case_ids) };
  await deliver(() => graph.reply({ ok: true, answer: supplied }));
}

async function openMap(app: App, activities: (keyof typeof nodeIds)[] = []) {
  await app.user.click(screen.getByRole("button", { name: "Map" }));
  const map = await screen.findByLabelText("Process map of the kept incidents");
  // The container precedes the rendered scene; each interaction needs its particular activities.
  await waitFor(() => {
    for (const activity of activities) expect(nodeOf(map, activity)).not.toBeNull();
  });
  return map;
}

const nodeOf = (map: HTMLElement, label: keyof typeof nodeIds) => map.querySelector<HTMLElement>(`[data-id="${nodeIds[label]}"]`)!;

function chipTexts() {
  const list = screen.getByRole("list", { name: "Steps of the selection" });
  return within(list)
    .getAllByRole("listitem")
    .map((chip) => [chip.querySelector(".chip-wording")?.textContent, ...Array.from(chip.querySelectorAll(".chip-counts > div")).map((pair) => pair.textContent)]);
}

describe("the map of the kept incidents", () => {
  it("takes a step from an activity, shows it as a chip with its supplied counts, and keeps the activities in place", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened]);
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
    const placed = nodeOf(map, opened).style.transform;
    expect(placed).toMatch(/translate/);

    fireEvent.click(nodeOf(map, opened));
    expect(screen.getByRole("heading", { name: "Activity “Eröffnet”" })).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Keep incidents that contain it" }));
    expect(app.selecting.selections[1].request.predicates).toEqual([contains(opened)]);
    expect(document.querySelector(".selection-status")?.textContent).toBe("Selecting the incidents and drawing their map…");

    await answer(app, 1, containingOpened);
    expect(chipTexts()).toEqual([["Keep incidents that contain “Eröffnet”", "Kept1 incident · 2 records", "Removed1 incident · 1 record", "Not evaluable0 incidents · 0 records"]]);
    expect(screen.getByLabelText("Population").textContent).toContain("Parent2 incidents · 3 recordsKept1 incident · 2 records");
    const after = screen.getByLabelText("Process map of the kept incidents");
    await waitFor(() => {
      expect(nodeOf(after, opened).style.transform).toBe(placed);
      expect(after.querySelector(`[data-id="${nodeIds["Prüfung"]}"]`)).toBeNull();
    });
    // One arrangement of the whole parent serves every selection.
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);

    await app.user.click(screen.getByRole("button", { name: "Incidents" }));
    const table = screen.getByRole("table", { name: "Kept incidents" });
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["A-1"]);
  });

  it("takes a step from a path in the map's table view and says that the removals of the steps overlap", async () => {
    const app = await renderInvestigation();
    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    const map = await openMap(app, [opened, closed]);

    await app.user.click(within(map).getByRole("button", { name: "Table view" }));
    const pathRow = within(map)
      .getAllByRole("row")
      .find((row) => row.textContent?.startsWith(`${opened}${closed}`))!;
    fireEvent.click(pathRow);
    expect(screen.getByRole("heading", { name: "Path from “Eröffnet” to “Geschlossen”" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep incidents where “Geschlossen” directly follows “Eröffnet”" })).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Keep incidents where it never does" }));
    expect(app.selecting.selections[2].request.predicates).toEqual([contains(opened), follows(opened, closed, true)]);

    // Both steps remove B-2: one because it does not contain the activity, the other although its order is unknown.
    await answer(app, 2, {
      population: "9",
      kept: support(["A-1"], 2),
      removed: support(["B-2"], 1),
      unevaluable: support([], 0),
      results: [containingOpened.results[0], { kept: support([], 0), removed: support(["A-1"], 2), unevaluable: support(["B-2"], 1) }],
    });
    expect(chipTexts()[1]).toEqual([
      "Keep incidents where “Geschlossen” never directly follows “Eröffnet”",
      "Kept0 incidents · 0 records",
      "Removed1 incident · 2 records",
      "Not evaluable1 incident · 1 record",
    ]);
    expect(screen.getByText(/the removals overlap and do not add up/).textContent).toBe(
      "Each step is counted on its own over all 2 incidents of the parent. " +
        "An incident that several steps remove is counted by each of them, so the removals overlap and do not add up.",
    );

    await app.user.click(screen.getByRole("button", { name: "Remove the step: Keep incidents that contain “Eröffnet”" }));
    expect(app.selecting.selections[3].request.predicates).toEqual([follows(opened, closed, true)]);
    await app.user.click(screen.getByRole("button", { name: "Undo" }));
    expect(app.selecting.selections[4].request.predicates).toEqual([contains(opened), follows(opened, closed, true)]);
    await app.user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(app.selecting.selections[5].request.predicates).toEqual([]);
  });

  it("offers the steps of an activity in the map's actions menu", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [closed]);
    fireEvent.contextMenu(nodeOf(map, closed));
    const items = screen.getAllByRole("menuitem");
    // The application's steps come first; after them what the map library does on the picture by itself.
    expect(items.slice(0, 2).map((item) => item.textContent)).toEqual(["Keep incidents that contain it", "Keep incidents that do not contain it"]);
    expect(items.length).toBeGreaterThan(2);
    // The library's own filters would look like a second selection and are not offered.
    expect(items.map((item) => item.textContent).filter((text) => /^(Filter|Exclude)/.test(text ?? ""))).toEqual([]);
    fireEvent.click(items[1]);
    expect(app.selecting.selections[1].request.predicates).toEqual([contains(closed, true)]);
  });

  it("says what its numbers count and that the map library is unreleased", async () => {
    const app = await renderInvestigation();
    await openMap(app);
    const caption = document.querySelector(".map-caption")!;
    expect(caption.textContent).toContain("Activities count labelled records and distinct incidents of the 2 incidents on the map.");
    expect(caption.textContent).toContain("Paths count passages and distinct incidents of the 1 incident whose order of records can be evaluated.");
    expect(caption.textContent).toContain("1 incident with 1 record is not evaluable for paths; 0 records have no activity label.");
    expect(caption.textContent).toContain("Observed labelled starts and ends");
    expect(caption.textContent).toContain("Lag: the median of elapsed hours between the two records of a path.");
    expect(caption.textContent).toContain("The map is drawn with an unreleased state of the map library (wise-flow 0.3.5, a local packaging candidate).");
    await app.user.click(screen.getByText("What the map counts"));
    expect(within(caption as HTMLElement).getByText("Paths are counted over").nextElementSibling?.textContent).toBe("1 incident");
    void app;
  });

  it("opens a map of many activities on the most frequent ones and shows its detail control", async () => {
    const many = (caseIds: string[]): SuppliedGraph => {
      const graph = suppliedGraph(caseIds);
      const labels = Array.from({ length: 40 }, (_, index) => `Schritt ${String(index).padStart(2, "0")}`);
      const id = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
      return {
        ...graph,
        nodes: labels.map((label, index) => ({ id: id(index), kind: "activity", label, metrics: { count: 40 - index, events: 40 - index, cases: 40 - index, starts: 0, ends: 0 } })),
        edges: labels.slice(1).map((_, index) => ({
          ...graph.edges[0],
          id: `path.v1:sha256:${String(index).padStart(64, "0")}`,
          source: id(index),
          target: id(index + 1),
          metrics: { count: 39 - index, cases: 39 - index, medianLagHours: 1, usableLagCount: 39 - index },
          payload: { ...graph.edges[0].payload, source_activity: labels[index], target_activity: labels[index + 1] },
        })),
      };
    };
    expect(openingDetail(MANY_ACTIVITIES)).toBeUndefined();
    expect(openingDetail(40)).toEqual({ activityDetail: 0.5, pathDetail: 0.5 });
    // Few activities with many paths between them: every activity, and the most frequent paths first.
    expect(openingDetail(3, 3)).toBeUndefined();
    expect(openingDetail(8, MANY_PATHS)).toBeUndefined();
    expect(openingDetail(13, 81)).toEqual({ activityDetail: 1, pathDetail: 20 / 81 });
    const app = await renderInvestigation(many);
    const map = await openMap(app);
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node").length).toBe(20));
    expect(within(map).getByRole("form", { name: "Detail" })).toBeTruthy();
  });
});
