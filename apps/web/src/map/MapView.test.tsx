import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import {
  begins,
  bothSteps,
  closed,
  contains,
  containingOpened,
  ends,
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
import { leastPaths, MANY_ACTIVITIES, MANY_PATHS, openingDetail } from "./MapView";

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
async function renderInvestigation(parentGraph: (caseIds: string[]) => SuppliedGraph = suppliedGraph, inPlace = true) {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} mapInPlace={inPlace} onShowData={() => undefined} />);
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

/** The number line the map writes on the card of an activity. */
const numberLine = (map: HTMLElement, label: keyof typeof nodeIds) =>
  Array.from(nodeOf(map, label).querySelectorAll(".wf-copy--plain .wf-activity-counts > span"))
    .map((part) => part.textContent)
    .join(" ");

/** The measure the map's legend names: its first sentence while the legend is one line, the whole sentence in the whole legend. */
const legendMeasure = (map: HTMLElement) => map.querySelector(".wf-legend__measure")?.textContent;

/** The switch between the measures, which the map library offers in its whole legend. */
const measureSwitch = (map: HTMLElement) => within(within(map).getByRole("group", { name: "Measure" })).getAllByRole("button");
const pressed = (buttons: HTMLElement[]) => buttons.map((button) => [button.textContent, button.getAttribute("aria-pressed")]);

function chipTexts() {
  const list = screen.getByRole("list", { name: "Steps of the selection" });
  return within(list)
    .getAllByRole("listitem")
    .map((chip) => [chip.querySelector(".chip-full-wording")?.textContent, ...Array.from(chip.querySelectorAll(".chip-independent > div")).map((pair) => pair.textContent)]);
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
    expect(screen.getByLabelText("Population").textContent).toContain("Kept of the parent1 of 2 incidents2 of 3 records");
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

    // The switch to the map's table stands with the detail controls, above the canvas.
    await app.user.click(screen.getByRole("button", { name: "Table view" }));
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

    await app.user.click(screen.getByText("Details of step 1"));
    await app.user.click(screen.getByRole("button", { name: "Remove the step: Keep incidents that contain “Eröffnet”" }));
    expect(app.selecting.selections[3].request.predicates).toEqual([follows(opened, closed, true)]);
    await app.user.click(screen.getByRole("button", { name: "Undo" }));
    expect(app.selecting.selections[4].request.predicates).toEqual([contains(opened), follows(opened, closed, true)]);
    await app.user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(app.selecting.selections[5].request.predicates).toEqual([]);
  });

  it("arranges the map anew for what is shown unless the activities are asked to keep their places", async () => {
    const app = await renderInvestigation(undefined, false);
    const map = await openMap(app, [closed]);
    // Arranged by the map itself for exactly what it shows: the whole parent's arrangement is not asked for.
    expect(flow.layoutUnion).not.toHaveBeenCalled();
    // The switch stands with the tools in the row above the map; what it does and what it costs is its tooltip and its description.
    const keep = screen.getByRole("button", { name: "Keep activities in place" });
    expect(keep.closest(".map-detail")).not.toBeNull();
    expect(keep.getAttribute("aria-pressed")).toBe("false");
    const explanation =
      "Keep every activity in the place the map of all incidents gives it. Off, the map is arranged anew and compactly for what is shown. " +
      "On, places stay the same from one selection to the next, and hidden paths still shape the picture.";
    expect(keep.getAttribute("title")).toBe(`Keep activities in place\n${explanation}`);
    expect(document.getElementById(keep.getAttribute("aria-describedby")!)?.textContent).toBe(explanation);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(nodeOf(map, closed)).not.toBeNull();

    await app.user.click(keep);
    await waitFor(() => expect(flow.layoutUnion).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Keep activities in place" }).getAttribute("aria-pressed")).toBe("true");
    // Switched off again, the map is arranged for what is shown, and the arrangement of the parent is not asked for anew.
    await app.user.click(screen.getByRole("button", { name: "Keep activities in place" }));
    expect(screen.getByRole("button", { name: "Keep activities in place" }).getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => expect(nodeOf(screen.getByLabelText("Process map of the kept incidents"), closed)).not.toBeNull());
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
  });

  it("says in one line above the map that the arrangement of the parent could not be computed, for as long as it is asked for", async () => {
    const app = await renderInvestigation(undefined, false);
    await openMap(app, [closed]);
    expect(document.querySelector(".map-limit")).toBeNull();

    vi.mocked(flow.layoutUnion).mockRejectedValueOnce(new Error("The arrangement failed."));
    await app.user.click(screen.getByRole("button", { name: "Keep activities in place" }));
    const limit = await screen.findByText("The arrangement of every incident of the parent could not be computed, so activities can move from one selection to the next.");
    // Short enough for one line; what the map does instead is said in full in its tooltip.
    expect(limit.getAttribute("title")).toBe(
      "The arrangement of every incident of the parent could not be computed. " +
        "The map arranges the kept incidents by itself, so activities can move from one selection to the next.",
    );
    // In the row above the map, before the frame the map is drawn in, which the map still has.
    expect(limit.className).toBe("map-limit");
    expect(limit.parentElement?.className).toBe("map-detail");
    expect(limit.closest(".map-main")?.querySelector(".map-frame")).not.toBeNull();
    await waitFor(() => expect(nodeOf(screen.getByLabelText("Process map of the kept incidents"), closed)).not.toBeNull());

    await app.user.click(screen.getByRole("button", { name: "Keep activities in place" }));
    expect(document.querySelector(".map-limit")).toBeNull();
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

  it("takes a step from a flow the map adds from Start or to End, chosen in the map's table view", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened, closed]);
    // The switch to the map's table stands with the detail controls, above the canvas.
    await app.user.click(screen.getByRole("button", { name: "Table view" }));
    const rowOf = (from: string, to: string) =>
      within(map)
        .getAllByRole("row")
        .find((row) => row.textContent?.startsWith(`${from}${to}`))!;

    fireEvent.click(rowOf(closed, "End"));
    expect(screen.getByRole("heading", { name: "Flow from “Geschlossen” to End" })).toBeTruthy();
    expect(screen.getByText("1 incident on the map ends with “Geschlossen”.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep incidents that end with it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep incidents that do not end with it" })).toBeTruthy();

    fireEvent.click(rowOf("Start", opened));
    expect(screen.getByRole("heading", { name: "Flow from Start to “Eröffnet”" })).toBeTruthy();
    expect(screen.getByText("1 incident on the map begins with “Eröffnet”.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep incidents that do not begin with it" })).toBeTruthy();
    await app.user.click(screen.getByRole("button", { name: "Keep incidents that begin with it" }));
    expect(app.selecting.selections[1].request.predicates).toEqual([begins(opened)]);

    // A-1 begins with "Eröffnet"; the order of B-2 is not known, so it belongs to neither side.
    const beginning = { kept: support(["A-1"], 2), removed: support([], 0), unevaluable: support(["B-2"], 1) };
    await answer(app, 1, { population: "a", ...beginning, results: [beginning] });
    expect(chipTexts()).toEqual([["Keep incidents that begin with “Eröffnet”", "Kept1 incident · 2 records", "Removed0 incidents · 0 records", "Not evaluable1 incident · 1 record"]]);
  });

  it("offers the beginning or the end of an activity after its own steps, in its menu and under the map", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened, closed]);
    const own = ["Keep incidents that contain it", "Keep incidents that do not contain it"];

    fireEvent.click(nodeOf(map, opened));
    const offered = () => Array.from(document.querySelectorAll(".map-choices button")).map((button) => button.textContent);
    expect(offered()).toEqual([...own, "Keep incidents that begin with it"]);
    fireEvent.click(nodeOf(map, closed));
    expect(offered()).toEqual([...own, "Keep incidents that end with it"]);

    fireEvent.contextMenu(nodeOf(map, closed));
    const items = screen.getAllByRole("menuitem");
    expect(items.slice(0, 3).map((item) => item.textContent)).toEqual([...own, "Keep incidents that end with it"]);
    expect(items.map((item) => item.textContent)).not.toContain("Keep incidents that begin with it");
    fireEvent.click(items[2]);
    expect(app.selecting.selections[1].request.predicates).toEqual([ends(closed)]);
  });

  it("says the supplied times of a selected activity under the map", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened, closed]);
    const rows = () => Array.from(document.querySelectorAll(".activity-times-rows > div"), (row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`);
    const paths = (title: string) => Array.from(document.querySelectorAll(`[aria-label^="${title}"] .activity-path`), (path) => path.getAttribute("aria-label"));

    fireEvent.click(nodeOf(map, opened));
    expect(rows()).toEqual([
      "From previous: Not available: no labelled record comes before it in an incident whose order is known.",
      "To next: median 26 h · 1 passage of 1 record",
    ]);
    expect(paths("Paths out")).toEqual([`To ${closed}: 1 passages, median lag 26 h. Select this path on the map.`]);
    expect(screen.getByText("No path leads into it.")).toBeTruthy();
    fireEvent.click(nodeOf(map, closed));
    expect(rows()).toEqual([
      "From previous: median 26 h · 1 passage of 1 record",
      "To next: Not available: no labelled record follows it in an incident whose order is known.",
    ]);
    // Choosing a path of the activity selects that path on the map, and the card is the path's.
    fireEvent.click(document.querySelector(".activity-path")!);
    expect(document.querySelector("#map-element-title")?.textContent).toContain(opened);
    expect(document.querySelector(".activity-times")).toBeNull();
    // The order of B-2 is not known, so no path leads into or out of its only activity, and the card says that such incidents are not in its times.
    fireEvent.click(nodeOf(map, "Prüfung"));
    expect(rows().every((row) => row.includes("Not available"))).toBe(true);
    expect(document.querySelector(".activity-times-note")?.textContent).toBe("1 incident whose order of records is not known is not in these times.");
    void app;
  });

  it("opens on the counts and offers the measures in the map's whole legend", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened, closed]);
    expect(legendMeasure(map)).toBe("Frequency: cases.");
    expect(numberLine(map, opened)).toBe("1 · 50 %");
    expect(numberLine(map, closed)).toBe("1 · 50 %");
    // The switch is the map library's own and belongs to its whole legend.
    expect(within(map).queryByRole("group", { name: "Measure" })).toBeNull();
    await app.user.click(within(map).getByRole("button", { name: "Show the whole legend" }));
    expect(pressed(measureSwitch(map))).toEqual([
      ["Frequency", "true"],
      ["Shortfall", "false"],
      ["Performance", "false"],
    ]);
  });

  it("writes the supplied times on the activities once the performance measure is chosen, and the counts again after", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened, closed]);
    const placed = nodeOf(map, opened).style.transform;
    await app.user.click(within(map).getByRole("button", { name: "Show the whole legend" }));
    await app.user.click(within(map).getByRole("button", { name: "Performance" }));

    // The 25.5 supplied hours until the next event, as the map library writes hours.
    await waitFor(() => expect(numberLine(map, opened)).toBe("26 h to next · 50 %"));
    // No time until a next event is supplied for these two: a dash stands in its place, not a count.
    expect(numberLine(map, closed)).toBe("– · 50 %");
    expect(numberLine(map, "Prüfung")).toBe("– · 50 %");
    expect(legendMeasure(map)).toBe("Performance: median wait between activities (h, d). Colour = median lag. Width = cases.");
    expect(pressed(measureSwitch(map))).toEqual([
      ["Frequency", "false"],
      ["Shortfall", "false"],
      ["Performance", "true"],
    ]);
    // Another measure is written on the same picture: nothing is arranged again.
    expect(nodeOf(map, opened).style.transform).toBe(placed);
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);

    // Both times of an activity stay worded under the map, also the one the map does not write on it.
    fireEvent.click(nodeOf(map, closed));
    expect(Array.from(document.querySelectorAll(".activity-times-rows dt"), (name) => name.textContent)).toEqual(["From previous", "To next"]);
    expect(document.querySelector(".activity-times-rows dd")?.textContent).toBe("median 26 h · 1 passage of 1 record");
    expect(screen.getByRole("button", { name: "Keep incidents that end with it" })).toBeTruthy();

    await app.user.click(within(map).getByRole("button", { name: "Frequency" }));
    await waitFor(() => expect(numberLine(map, opened)).toBe("1 · 50 %"));
    expect(numberLine(map, closed)).toBe("1 · 50 %");
    expect(pressed(measureSwitch(map))[0]).toEqual(["Frequency", "true"]);
  });

  it("keeps the chosen measure on the map of another selection", async () => {
    const app = await renderInvestigation();
    const map = await openMap(app, [opened]);
    await app.user.click(within(map).getByRole("button", { name: "Show the whole legend" }));
    await app.user.click(within(map).getByRole("button", { name: "Performance" }));
    await waitFor(() => expect(numberLine(map, opened)).toBe("26 h to next · 50 %"));

    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    const after = screen.getByLabelText("Process map of the kept incidents");
    // The one kept incident is every incident on this map.
    await waitFor(() => expect(numberLine(after, opened)).toBe("26 h to next · 100 %"));
    expect(numberLine(after, closed)).toBe("– · 100 %");
    expect(pressed(measureSwitch(after))[2]).toEqual(["Performance", "true"]);
  });

  it("keeps the chosen measure when the map is arranged another way", async () => {
    const app = await renderInvestigation(undefined, false);
    const map = await openMap(app, [opened]);
    await app.user.click(within(map).getByRole("button", { name: "Show the whole legend" }));
    await app.user.click(within(map).getByRole("button", { name: "Performance" }));
    await waitFor(() => expect(numberLine(map, opened)).toBe("26 h to next · 50 %"));

    // The map is taken away while every incident of the parent is arranged, and drawn again after.
    await app.user.click(screen.getByRole("button", { name: "Keep activities in place" }));
    await waitFor(() => expect(flow.layoutUnion).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const again = screen.getByLabelText("Process map of the kept incidents");
      expect(numberLine(again, opened)).toBe("26 h to next · 50 %");
      expect(legendMeasure(again)).toBe("Performance: median wait between activities (h, d).");
    });
  });

  it("says what its numbers count and that the map library is unreleased, behind the info button of the map", async () => {
    const app = await renderInvestigation();
    await openMap(app);
    // Nothing of it stands under the map: it opens over the map from the row above it.
    expect(document.querySelector(".map-caption")).toBeNull();
    await app.user.click(screen.getByRole("button", { name: "About this map" }));
    const about = screen.getByRole("group", { name: "About this map" });
    const caption = about.querySelector(".map-caption")!;
    expect(caption.textContent).toContain("Activities count labelled records and distinct incidents of the 2 incidents on the map.");
    expect(caption.textContent).toContain("Paths count passages and distinct incidents of the 1 incident whose order of records can be evaluated.");
    expect(caption.textContent).toContain("1 incident with 1 record is not evaluable for paths; 0 records have no activity label.");
    expect(caption.textContent).toContain("Observed labelled starts and ends");
    expect(caption.textContent).toContain("Lag: the median of elapsed hours between the two records of a path.");
    expect(caption.textContent).toContain("Measures: the legend on the map, shown whole, switches what the map writes.");
    expect(caption.textContent).toContain("Shortfall has no values here: no expectation results are supplied to the map.");
    expect(about.querySelector(".map-library")?.textContent).toBe("The map is drawn with an unreleased state of the map library (wise-flow 0.3.5, a local packaging candidate).");
    // Every coverage figure is listed under its heading, without a further click.
    const counts = within(about).getByRole("heading", { name: "What the map counts" }).parentElement!;
    expect(within(counts).getByText("Paths are counted over").nextElementSibling?.textContent).toBe("1 incident");
    expect(counts.querySelectorAll("dt")).toHaveLength(13);
  });

  it("opens a map of many activities on the most frequent ones and shows its detail controls above the canvas", async () => {
    const many = (caseIds: string[]): SuppliedGraph => {
      const graph = suppliedGraph(caseIds);
      const labels = Array.from({ length: 40 }, (_, index) => `Schritt ${String(index).padStart(2, "0")}`);
      const id = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
      return {
        ...graph,
        // Every path below is an hour long: into each activity but the first leads the path before it, out of each but the last the path after it.
        nodes: labels.map((label, index) => ({
          id: id(index),
          kind: "activity",
          label,
          metrics: {
            count: 40 - index,
            events: 40 - index,
            cases: 40 - index,
            starts: 0,
            ends: 0,
            ...(index > 0 ? { medianPreviousHours: 1 } : {}),
            usablePreviousCount: index > 0 ? 40 - index : 0,
            ...(index < 39 ? { medianNextHours: 1 } : {}),
            usableNextCount: 39 - index,
          },
        })),
        edges: labels.slice(1).map((_, index) => ({
          ...graph.edges[0],
          id: `path.v1:sha256:${String(index).padStart(64, "0")}`,
          source: id(index),
          target: id(index + 1),
          metrics: { count: 39 - index, cases: 39 - index, medianLagHours: 1, usableLagCount: 39 - index, totalLagHours: 39 - index, totalLagMicroseconds: String((39 - index) * 3_600_000_000), shareOfTotalLag: (39 - index) / 780 },
          payload: { ...graph.edges[0].payload, source_activity: labels[index], target_activity: labels[index + 1] },
        })),
      };
    };
    expect(openingDetail(MANY_ACTIVITIES)).toBeUndefined();
    // Many activities: the most frequent ones, and of their paths a main flow however many paths there are.
    expect(openingDetail(40)).toEqual({ activityDetail: 0.5, pathDetail: 1 });
    expect(openingDetail(40, 100)).toEqual({ activityDetail: 0.5, pathDetail: 30 / 100 });
    expect(openingDetail(22, 431)).toEqual({ activityDetail: 20 / 22, pathDetail: 30 / 431 });
    expect(openingDetail(22, 25)).toEqual({ activityDetail: 20 / 22, pathDetail: 1 });
    // Few activities with many paths between them: every activity, and the most frequent paths first.
    expect(openingDetail(3, 3)).toBeUndefined();
    expect(openingDetail(8, MANY_PATHS)).toBeUndefined();
    expect(openingDetail(13, 81)).toEqual({ activityDetail: 1, pathDetail: 20 / 81 });
    // The lowest position of the paths detail keeps as many paths as there are activities.
    expect(leastPaths(13, 81)).toBe(13 / 81);
    expect(leastPaths(3, 3)).toBeNull();
    expect(leastPaths(0, 5)).toBeNull();
    const app = await renderInvestigation(many);
    const map = await openMap(app);
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node").length).toBe(20));
    // The detail controls stand above the canvas and leave it to the map: the map holds no panel of its own for them.
    const detail = screen.getByRole("form", { name: "Detail" });
    expect(map.contains(detail)).toBe(false);
    expect(detail.closest(".map-view")).toBe(map.closest(".map-view"));
    expect(within(detail).getByRole("slider", { name: "Activities" }).getAttribute("aria-valuetext")).toBe("20 of 40 · 74.4 % of events");
    expect(within(detail).getByRole("slider", { name: "Paths" }).getAttribute("aria-valuetext")).toBe("19 of 39");
  });
});
