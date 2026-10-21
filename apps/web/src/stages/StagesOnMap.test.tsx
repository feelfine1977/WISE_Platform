import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as flow from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { END_ID, START_ID } from "../map/graph";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import {
  checked,
  closed,
  contains,
  containingOpened,
  everyIncident,
  type Figures,
  graphAnswer,
  nodeIds,
  opened,
  scriptedSelectionClient,
  selectionAnswer,
  suppliedGraph,
} from "../test/selections";
import { moved, noStages, type StageDefinitions, withActivity, withStage } from "./definitions";
import { browserStages, type StagedReading } from "./store";

// These tests draw the whole investigation with the real arrangement of the map; on a slow or busy machine one of them
// takes longer than the default five seconds, which says nothing about what it asserts.
vi.setConfig({ testTimeout: 20_000 });

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

/*
 * The population of ../test/selections.ts: "Eröffnet" and then "Geschlossen" in incident A-1,
 * "Prüfung" alone in B-2. Where a test starts with stages, they are "Intake" with "Eröffnet" and
 * "Closure" with "Geschlossen"; "Prüfung" is in no stage.
 */
const reading: StagedReading = { workspaceId, preparationId };
const named = ["Intake", "Closure"].reduce(withStage, noStages);
const [intake, closure] = named.stages.map((stage) => stage.id);
const twoStages = withActivity(withActivity(named, opened, intake), closed, closure);

/** The stages of the reading as the browser holds them before the investigation is opened. */
function define(definitions: StageDefinitions) {
  browserStages.change(reading, () => definitions);
}

beforeEach(() => {
  vi.mocked(flow.layoutUnion).mockClear();
  window.localStorage.clear();
  define(noStages);
});

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The investigation with every incident selected and its map shown: the map of ../test/selections.ts, or the one given. */
async function openMap(inPlace = false, supplied?: SuppliedGraph) {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} mapInPlace={inPlace} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const app = { selecting, coordinator, user };
  await answer(app, 0, everyIncident, supplied);
  const map = await screen.findByLabelText("Process map of the kept cases");
  await waitFor(() => expect(nodeOf(map, (supplied ?? suppliedGraph(["A-1"])).nodes[0].id)).not.toBeNull());
  return { ...app, map };
}

async function answer(app: { selecting: ReturnType<typeof scriptedSelectionClient> }, place: number, figures: Figures, supplied?: SuppliedGraph) {
  const selection = app.selecting.selections[place];
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision)!;
  const answered = graphAnswer(graph.request, figures.kept.case_ids);
  await deliver(() => graph.reply({ ok: true, answer: supplied ? { ...answered, graph: supplied } : answered }));
}

const nodeOf = (map: HTMLElement, id: string) => map.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
/** The stage boxes the map draws, by the name written on each. */
const stageBoxes = (map: HTMLElement) => Array.from(map.querySelectorAll('[data-wf-part="group"][data-wf-kind="stage"] [data-wf-part="group-label"]')).map((label) => label.textContent);
/** How far from the top edge of the map the box of a stage begins: the map runs from top to bottom. */
const topOf = (map: HTMLElement, stageId: string) => Number(/translate\(-?[\d.]+px,\s*(-?[\d.]+)px/.exec(nodeOf(map, `group:${stageId}`)?.style.transform ?? "")?.[1]);
/** The editor of the stages, opened beside the map with its switch in the row above the map. */
async function openStages(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit stages" }));
  return document.querySelector<HTMLElement>(".map-stages-panel")!;
}
const offered = () => Array.from(document.querySelectorAll(".map-choices button")).map((button) => button.textContent);

describe("the stages of a log on its map", () => {
  it("draws the map as before while no stage is defined, and holds the editor of the stages beside it", async () => {
    const { map, user } = await openMap();
    expect(map.querySelector('[data-wf-part="group"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Show stages" })).toBeNull();
    // Without a stage an activity carries the neutral band of the map library, without a pattern.
    expect(nodeOf(map, nodeIds[opened])?.querySelector('[data-wf-part="node-band"] svg')).toBeNull();

    // The editor is closed until it is asked for; its switch stands with the tools in the row above the map.
    const stagesSwitch = screen.getByRole("button", { name: "Edit stages" });
    expect(stagesSwitch.closest(".map-detail")).not.toBeNull();
    expect(stagesSwitch.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("region", { name: "Stages of this log" })).toBeNull();
    // Nothing stands under the map: beside it stand the column of time and what a selection offers, kept for assistive technology.
    expect(Array.from(map.closest(".map-view")!.children, (part) => part.className)).toEqual(["map-main", "map-aside", "map-element visually-hidden"]);

    const panel = await openStages(user);
    expect(stagesSwitch.getAttribute("aria-pressed")).toBe("true");
    // Beside the map, where the steps of a selected element stand, and not under it: the map stays in view.
    expect(panel.parentElement?.className).toBe("map-view");
    expect(panel.parentElement?.getAttribute("data-beside")).toBe("stages");
    expect(panel.previousElementSibling?.className).toBe("map-main");
    expect(screen.getByLabelText("Process map of the kept cases")).toBe(map);
    expect(within(panel).getByRole("heading", { name: "Stages of this log" })).toBeTruthy();
    expect(within(panel).getByRole("region", { name: "Stages of this log" }).textContent).toContain("Stages stay in this browser for this reading and are saved with the investigation");
    expect(within(panel).getByText("No stage is defined for this log yet, so the map is drawn without stages.")).toBeTruthy();
  });

  it("draws a stage once the analyst has defined it beside the map and put an activity into it", async () => {
    const { map, user } = await openMap();
    const editor = within(await openStages(user));
    await user.click(editor.getByRole("textbox", { name: "New stage" }));
    await user.keyboard("Intake{Enter}");
    // A stage without an activity changes nothing on the map.
    expect(browserStages.stateOf(reading).definitions.stages.map((stage) => stage.name)).toEqual(["Intake"]);
    expect(map.querySelector('[data-wf-part="group"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Show stages" })).toBeNull();

    await user.selectOptions(editor.getByRole("combobox", { name: `Stage of “${opened}”` }), "Intake");
    await waitFor(() => expect(stageBoxes(map)).toEqual(["Intake"]));
    expect(nodeOf(map, nodeIds[opened])?.getAttribute("aria-label")).toContain("(Intake)");
    expect(screen.getByRole("button", { name: "Show stages" })).toBeTruthy();

    // Out of its stage again, the activity is drawn as before.
    await user.selectOptions(editor.getByRole("combobox", { name: `Stage of “${opened}”` }), "No stage");
    await waitFor(() => expect(stageBoxes(map)).toEqual([]));
    expect(screen.queryByRole("button", { name: "Show stages" })).toBeNull();
  });

  it("draws the stages as boxes in their order with their activities in them, Start and End outside, and names them in the legend", async () => {
    define(twoStages);
    const { map, user } = await openMap();
    await waitFor(() => expect(stageBoxes(map)).toEqual(["Intake", "Closure"]));
    // The layout engine takes seconds on a slow machine; the test already has 20 seconds.
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"), { timeout: 15_000 });

    // The map library says the stage of an activity with it and marks the activity with the pattern of its stage.
    expect(nodeOf(map, nodeIds[opened])?.getAttribute("aria-label")).toContain("(Intake)");
    expect(nodeOf(map, nodeIds[closed])?.getAttribute("aria-label")).toContain("(Closure)");
    expect(nodeOf(map, nodeIds[opened])?.querySelector('[data-wf-part="node-band"] svg')).not.toBeNull();
    expect(nodeOf(map, nodeIds[checked])?.getAttribute("aria-label")).not.toMatch(/\((Intake|Closure)\)/);
    expect(nodeOf(map, nodeIds[checked])?.querySelector('[data-wf-part="node-band"] svg')).toBeNull();
    // Start and End are on the map as before, and the first stage lies before the second.
    expect(nodeOf(map, START_ID)).not.toBeNull();
    expect(nodeOf(map, END_ID)).not.toBeNull();
    expect(topOf(map, intake)).toBeLessThan(topOf(map, closure));
    expect(screen.getByRole("button", { name: "Show stages" })).toBeTruthy();

    // The legend under the map names the stages beside the colours the library gave them, the colours the map draws them in.
    const legend = document.querySelector<HTMLElement>(".map-legend")!;
    await user.click(within(legend).getByRole("button", { name: "Show the whole legend" }));
    expect(Array.from(legend.querySelectorAll(".wf-legend__cat")).map((entry) => entry.textContent)).toEqual(["Intake", "Closure"]);
    // The editor beside the map shows the same stages.
    expect(within(await openStages(user)).getByRole("combobox", { name: `Stage of “${closed}”` })).toHaveProperty("value", closure);
  });

  it("lays the stages out in the order the analyst gives them, whatever the flow of the log is", async () => {
    define(twoStages);
    const { map, user } = await openMap();
    await waitFor(() => expect(topOf(map, intake)).toBeLessThan(topOf(map, closure)));
    await user.click(within(await openStages(user)).getByRole("button", { name: "Move “Closure” earlier" }));
    expect(browserStages.stateOf(reading).definitions).toEqual(moved(twoStages, closure, "earlier"));
    await waitFor(() => expect(topOf(map, closure)).toBeLessThan(topOf(map, intake)));
  });

  it("shows each stage as one node when asked, takes no step from a stage, and shows the activities again", async () => {
    define(twoStages);
    const { map, user, selecting } = await openMap();
    await waitFor(() => expect(stageBoxes(map)).toEqual(["Intake", "Closure"]));

    await user.click(screen.getByRole("button", { name: "Show stages" }));
    await waitFor(() => expect(nodeOf(map, intake)).not.toBeNull());
    expect(nodeOf(map, intake)?.getAttribute("aria-label")).toContain("Intake, stage.");
    expect(nodeOf(map, closure)).not.toBeNull();
    // The activities of the stages are in their stages; what has no stage stays as it is.
    expect(nodeOf(map, nodeIds[opened])).toBeNull();
    expect(nodeOf(map, nodeIds[closed])).toBeNull();
    expect(nodeOf(map, nodeIds[checked])).not.toBeNull();
    expect(nodeOf(map, START_ID)).not.toBeNull();
    expect(nodeOf(map, END_ID)).not.toBeNull();

    fireEvent.click(nodeOf(map, intake)!);
    expect(screen.getByText(/^The stage “Intake” stands for its activities\. No step is taken from a stage/)).toBeTruthy();
    expect(screen.queryByText(/This line stands for activities the map does not show/)).toBeNull();
    expect(offered()).toEqual([]);
    // An activity outside the stages offers its steps as ever.
    fireEvent.click(nodeOf(map, nodeIds[checked])!);
    expect(offered()).toEqual(["Keep cases that contain it", "Keep cases that do not contain it"]);

    await user.click(screen.getByRole("button", { name: "Show activities" }));
    await waitFor(() => expect(nodeOf(map, nodeIds[opened])).not.toBeNull());
    expect(nodeOf(map, intake)).toBeNull();
    expect(stageBoxes(map)).toEqual(["Intake", "Closure"]);

    // A step from an activity in a stage is the step it always was.
    fireEvent.click(nodeOf(map, nodeIds[opened])!);
    expect(screen.getByRole("heading", { name: "Activity “Eröffnet”" })).toBeTruthy();
    expect(offered()).toEqual(["Keep cases that contain it", "Keep cases that do not contain it", "Keep cases that begin with it"]);
    await user.click(screen.getByRole("button", { name: "Keep cases that contain it" }));
    expect(selecting.selections[1].request.predicates).toEqual([contains(opened)]);

    // The selection keeps A-1 alone: its map has both stages still and no activity outside them.
    await answer({ selecting }, 1, containingOpened);
    const after = screen.getByLabelText("Process map of the kept cases");
    await waitFor(() => expect(nodeOf(after, nodeIds[checked])).toBeNull());
    expect(stageBoxes(after)).toEqual(["Intake", "Closure"]);
  });

  it("keeps the activities and the stage boxes of a selection where the map of the whole parent has them, and arranges the parent anew for other stages", async () => {
    define(twoStages);
    const app = await openMap(true);
    await waitFor(() => expect(stageBoxes(app.map)).toEqual(["Intake", "Closure"]));
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);
    // The arrangement is that of the parent in its stages.
    expect(vi.mocked(flow.layoutUnion).mock.calls[0][0][0].groups?.map((group) => group.label)).toEqual(["Intake", "Closure"]);
    const placed = [nodeOf(app.map, nodeIds[opened])!.style.transform, nodeOf(app.map, `group:${intake}`)!.style.transform];
    expect(placed[0]).toMatch(/translate/);

    app.coordinator.addStep(contains(opened));
    await answer(app, 1, containingOpened);
    const after = screen.getByLabelText("Process map of the kept cases");
    await waitFor(() => expect(nodeOf(after, nodeIds[checked])).toBeNull());
    expect([nodeOf(after, nodeIds[opened])!.style.transform, nodeOf(after, `group:${intake}`)!.style.transform]).toEqual(placed);
    expect(flow.layoutUnion).toHaveBeenCalledTimes(1);

    // Other stages are another arrangement of the parent, computed once more.
    await deliver(() => browserStages.change(reading, (definitions) => moved(definitions, closure, "earlier")));
    await waitFor(() => expect(flow.layoutUnion).toHaveBeenCalledTimes(2));
    expect(vi.mocked(flow.layoutUnion).mock.calls[1][0][0].groups?.map((group) => group.label)).toEqual(["Closure", "Intake"]);
    const again = await screen.findByLabelText("Process map of the kept cases");
    await waitFor(() => expect(topOf(again, closure)).toBeLessThan(topOf(again, intake)));
  });

  it("draws every flow from Start and to End while stages are shown as nodes, so that the flow of a stage adds up those of its activities", async () => {
    // Four activities that all begin or end incidents; the first two in "Intake", the third in "Closure", the fourth in no stage.
    const base = suppliedGraph(["A-1", "B-2"]);
    const id = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
    const [starts, ends, pathIncidents] = [[900, 40, 7, 0], [5, 300, 60, 2], [500, 80, 50, 6]];
    const log: SuppliedGraph = {
      ...base,
      nodes: starts.map((count, index) => ({ ...base.nodes[0], id: id(index), label: `Activity ${index}`, metrics: { ...base.nodes[0].metrics, cases: 1000 - index, starts: count, ends: ends[index] } })),
      edges: pathIncidents.map((cases, index) => ({ ...base.edges[0], id: `path.v1:sha256:${String(index).padStart(64, "0")}`, source: id(index), target: id((index + 1) % 4), metrics: { ...base.edges[0].metrics, cases } })),
    };
    define(["Activity 0", "Activity 1"].reduce((definitions, activity) => withActivity(definitions, activity, intake), withActivity(named, "Activity 2", closure)));
    const { map, user } = await openMap(false, log);
    /** The flows from Start and to End as the table view of the map lists them: from, to and the passages. */
    const flows = () =>
      within(map)
        .getAllByRole("row")
        .map((row) => Array.from(row.querySelectorAll("th, td")).map((cell) => cell.textContent))
        .filter((cells) => cells[2] === "sequence flow")
        .map((cells) => cells.slice(0, 2).concat(cells[3]).join(" "));

    // At half of the paths the flows that carry fewer incidents than the weakest path drawn are left out, and the map says so.
    fireEvent.change(screen.getAllByRole("slider")[1], { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Table view" }));
    expect(flows()).toEqual(["Start Activity 0 900", "Activity 1 End 300"]);
    // The info button of the map carries a mark while flows are left out, and its panel says which.
    const about = screen.getByRole("button", { name: "About this map" });
    expect(about.querySelector(".icon-button-mark")).not.toBeNull();
    expect(document.getElementById(about.getAttribute("aria-describedby")!)?.textContent).toBe("Some flows from Start and to End are not drawn at this detail");
    await user.click(about);
    expect(document.querySelector(".map-not-drawn h4")?.textContent).toBe("Not drawn at this detail");
    expect(document.querySelector(".map-not-drawn .map-flows")?.textContent).toMatch(/^5 of the 7 flows/);
    await user.keyboard("{Escape}");

    // Shown as nodes, the stages carry every flow of their activities: 900 and 40 begin in "Intake", 5 and 300 end in it.
    await user.click(screen.getByRole("button", { name: "Show stages" }));
    expect(flows()).toEqual(["Start Intake 940", "Start Closure 7", "Intake End 305", "Closure End 60", "Activity 3 End 2"]);
    expect(about.querySelector(".icon-button-mark")).toBeNull();
    expect(about.hasAttribute("aria-describedby")).toBe(false);
    await user.click(about);
    expect(document.querySelector(".map-not-drawn")).not.toBeNull();
    expect(document.querySelector(".map-flows")).toBeNull();
    await user.keyboard("{Escape}");

    // With the activities shown again, the flows follow the paths as before.
    await user.click(screen.getByRole("button", { name: "Show activities" }));
    expect(flows()).toEqual(["Start Activity 0 900", "Activity 1 End 300"]);
  });
});
