import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ImportedInvestigationCoordinator } from "../imported/coordinator";
import { ImportedInvestigation } from "../imported/ImportedInvestigation";
import { populationAnswer, preparationId, scriptedImportClient, workspaceId } from "../test/imports";
import { begins, closed, containingOpened, everyIncident, type Figures, follows, graphAnswer, opened, scriptedSelectionClient, selectionAnswer } from "../test/selections";
import { MapView } from "./MapView";
import { BUSY_ACTIVITIES, busyGraph, shownWhole, stepName } from "./testGraphs";

// These tests draw the whole investigation with the real arrangement of the map; on a slow or busy machine one of them
// takes longer than the default five seconds, which says nothing about what it asserts.
vi.setConfig({ testTimeout: 20_000 });

// The map measures its container; the test page has no layout, so nothing is ever resized.
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

async function deliver(action: () => void) {
  await act(async () => {
    action();
  });
}

/** The investigation of the two incidents A-1 and B-2 with every incident selected, as it opens: on its map. */
async function renderInvestigation() {
  const imports = scriptedImportClient();
  const selecting = scriptedSelectionClient();
  const coordinator = new ImportedInvestigationCoordinator(imports.client, selecting.client);
  const user = userEvent.setup();
  render(<ImportedInvestigation coordinator={coordinator} onShowData={() => undefined} />);
  act(() => coordinator.open({ workspaceId, preparationId }));
  await deliver(() => imports.populations[0].reply({ ok: true, answer: populationAnswer(imports.populations[0].request) }));
  const app = { selecting, user };
  await answer(app, 0, everyIncident);
  return app;
}

async function answer(app: { selecting: ReturnType<typeof scriptedSelectionClient> }, place: number, figures: Figures) {
  const selection = app.selecting.selections[place];
  await deliver(() => selection.reply({ ok: true, answer: selectionAnswer(selection.request, figures) }));
  const graph = app.selecting.graphs.find((call) => call.request.query_revision === selection.request.query_revision)!;
  await deliver(() => graph.reply({ ok: true, answer: graphAnswer(graph.request, figures.kept.case_ids) }));
}

const list = () => screen.getByRole("table", { name: "Paths of the kept incidents" });
/** The rows of the list as they read: every cell of each. */
const listed = () =>
  within(list())
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.children, (cell) => cell.textContent));
const viewButton = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => viewButton(name).getAttribute("aria-pressed");
const offered = () => Array.from(document.querySelectorAll(".map-choices button"), (button) => button.textContent);

describe("the list of every path in the investigation", () => {
  it("is a view of the centre beside the map, lists the supplied paths and flows, and takes the steps the map takes", async () => {
    const app = await renderInvestigation();
    // The variants of this harness are not answered: their button says so, as a view that cannot be shown does.
    expect(within(screen.getByRole("group", { name: "View" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["Map", "Incidents", "Variants · not shown", "Paths", "Matrix"]);

    await app.user.click(viewButton("Paths"));
    expect([pressed("Map"), pressed("Incidents"), pressed("Paths"), pressed("Matrix")]).toEqual(["false", "false", "true", "false"]);
    expect(screen.getByRole("heading", { name: "Paths of the kept incidents" })).toBeTruthy();
    expect(screen.queryByLabelText("Process map of the kept incidents")).toBeNull();
    expect(within(list()).getAllByRole("columnheader").map((heading) => heading.textContent)).toEqual(["From", "To", "Incidents", "Passages", "Median lag of the passages (h)", "Total time (days, all passages)▼", "On the map"]);
    // The heading that sorts by the incidents is not taken for the view of that name.
    expect(within(list()).getByRole("button", { name: "Incidents: sort the list" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Incidents" })).toHaveLength(1);
    // A-1 begins with "Eröffnet", goes on to "Geschlossen" 25.5 hours later and ends there; B-2 has no known order.
    // A flow has incidents only: where a path has its passages and its lag, a flow has a dash.
    // The list opens on the time spent on each path, the largest first (#88): 25.5 hours are 1.1 days; flows have none.
    expect(listed()).toEqual([
      [opened, closed, "1", "1", "25.5", "1.1", "Drawn"],
      ["Start", opened, "1", "–", "–", "–", "Drawn"],
      [closed, "End", "1", "–", "–", "–", "Drawn"],
    ]);

    // A row is selected as its path is on the map, and offers the same steps in the same place.
    await app.user.click(within(list()).getByRole("button", { name: "Path from “Eröffnet” to “Geschlossen”" }));
    expect(within(list()).getByRole("button", { name: "Path from “Eröffnet” to “Geschlossen”" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "Path from “Eröffnet” to “Geschlossen”" })).toBeTruthy();
    expect(offered()).toEqual(["Keep incidents where “Geschlossen” directly follows “Eröffnet”", "Keep incidents where it never does"]);

    // The selection is the map's: the map shows the same path selected, and the list still does after.
    await app.user.click(viewButton("Map"));
    expect(screen.getByRole("heading", { name: "Map of the kept incidents" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Path from “Eröffnet” to “Geschlossen”" })).toBeTruthy();
    await app.user.click(viewButton("Paths"));
    expect(within(list()).getByRole("button", { name: "Path from “Eröffnet” to “Geschlossen”" }).getAttribute("aria-pressed")).toBe("true");

    await app.user.click(within(list()).getByRole("button", { name: "Flow from Start to “Eröffnet”" }));
    expect(screen.getByRole("heading", { name: "Flow from Start to “Eröffnet”" })).toBeTruthy();
    expect(screen.getByText("1 incident on the map begins with “Eröffnet”.")).toBeTruthy();
    expect(offered()).toEqual(["Keep incidents that begin with it", "Keep incidents that do not begin with it"]);
    // The row itself selects too, and the same row once more selects nothing.
    fireEvent.click(within(list()).getAllByRole("row")[3]);
    expect(screen.getByRole("heading", { name: "Flow from “Geschlossen” to End" })).toBeTruthy();
    expect(offered()).toEqual(["Keep incidents that end with it", "Keep incidents that do not end with it"]);
    fireEvent.click(within(list()).getAllByRole("row")[3]);
    expect(screen.getByText("Select a row of the list to keep or remove the incidents through it.")).toBeTruthy();
    expect(offered()).toEqual([]);

    await app.user.click(within(list()).getByRole("button", { name: "Path from “Eröffnet” to “Geschlossen”" }));
    await app.user.click(screen.getByRole("button", { name: "Keep incidents where “Geschlossen” directly follows “Eröffnet”" }));
    expect(app.selecting.selections[1].request.predicates).toEqual([follows(opened, closed)]);
    // The list stays while the incidents are selected again, and then lists the paths of those kept.
    expect(listed()).toHaveLength(3);
    await answer(app, 1, containingOpened);
    expect(pressed("Paths")).toBe("true");
    expect(listed().map((row) => row.slice(0, 2))).toEqual([
      [opened, closed],
      ["Start", opened],
      [closed, "End"],
    ]);
    // What was selected on the list of other incidents is not carried over.
    expect(offered()).toEqual([]);
    await app.user.click(within(list()).getByRole("button", { name: "Flow from Start to “Eröffnet”" }));
    await app.user.click(screen.getByRole("button", { name: "Keep incidents that begin with it" }));
    expect(app.selecting.selections[2].request.predicates).toEqual([follows(opened, closed), begins(opened)]);
  });
});

describe("the list of every path beside the map", () => {
  const supplied = busyGraph();
  const view = (showing: "map" | "paths") => <MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} showing={showing} />;
  const detail = () => screen.getByRole("form", { name: "Detail" });
  const drawnRows = () =>
    listed()
      .filter((row) => row[6] === "Drawn")
      .map((row) => row.slice(0, 2).join(" → "))
      .sort();

  /** The paths the map library lists in the table view of its map: what it draws, without its dashed lines, which are no recorded paths. */
  async function drawnByTheMap() {
    const map = await screen.findByLabelText("Process map of the kept incidents");
    const paths = await within(map).findByRole("table", { name: "Paths of the process map with their metrics" });
    return within(paths)
      .getAllByRole("row")
      .slice(1)
      .filter((row) => !row.lastElementChild?.textContent?.includes("indirect"))
      .map((row) => Array.from(row.children).slice(0, 2).map((cell) => cell.textContent).join(" → "))
      .sort();
  }

  it("says of each row whether the map draws it, at the detail the map opens on and at any other", async () => {
    const { rerender } = render(view("map"));
    const map = await screen.findByLabelText("Process map of the kept incidents");
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(BUSY_ACTIVITIES));
    fireEvent.click(within(detail()).getByRole("button", { name: "Table view" }));
    const opening = await drawnByTheMap();
    // The map opens on 36 of its 47 paths and flows.
    expect(opening).toHaveLength(36);

    rerender(view("paths"));
    expect(listed()).toHaveLength(49);
    expect(drawnRows()).toEqual(opening);
    expect(listed().filter((row) => row[6] === "Not drawn")).toHaveLength(13);

    // The detail controls stand above the list as above the map, without the switch to the map's own table.
    expect(within(detail()).queryByRole("button")).toBeNull();
    expect(within(detail()).getByRole("slider", { name: "Paths" }).getAttribute("aria-valuetext")).toBe("36 of 47 · 13 kept · strongest not shown: 14");
    fireEvent.change(within(detail()).getByRole("slider", { name: "Activities" }), { target: { value: "6" } });
    fireEvent.change(within(detail()).getByRole("slider", { name: "Paths" }), { target: { value: "12" } });
    const fewer = drawnRows();
    expect(fewer).toHaveLength(15);
    expect(within(detail()).getByRole("slider", { name: "Paths" }).getAttribute("aria-valuetext")).toBe("15 of 45 · 6 kept · strongest not shown: 55");

    // The map draws exactly those at that detail, which it kept while the list stood in its place.
    rerender(view("map"));
    expect(await drawnByTheMap()).toEqual(fewer);
  });

  it("sorts by the column whose heading is chosen, and the other way when it is chosen again", async () => {
    render(view("paths"));
    const heading = (name: string) => within(list()).getByRole("columnheader", { name });
    const sort = (name: string) => fireEvent.click(within(heading(name)).getByRole("button"));
    const first = () => listed()[0].slice(0, 3);
    // The list opens on the time spent on the paths (#88); without supplied totals the rows stand by their incidents.
    expect(heading("Total time (days, all passages)").getAttribute("aria-sort")).toBe("descending");
    expect(first()).toEqual([stepName(0), stepName(1), "105"]);

    sort("Incidents");
    expect(heading("Incidents").getAttribute("aria-sort")).toBe("descending");
    expect(first()).toEqual([stepName(0), stepName(1), "105"]);
    sort("Incidents");
    expect(heading("Incidents").getAttribute("aria-sort")).toBe("ascending");
    expect(heading("Incidents").textContent).toBe("Incidents▲");
    // Two paths carry one incident; of equals the one supplied first.
    expect(first()).toEqual([stepName(11), stepName(10), "1"]);

    sort("From");
    expect(heading("Incidents").getAttribute("aria-sort")).toBeNull();
    expect(heading("From").getAttribute("aria-sort")).toBe("ascending");
    expect(first()).toEqual([stepName(0), stepName(1), "105"]);
    sort("From");
    expect(first()).toEqual(["Start", stepName(0), "100"]);

    sort("To");
    expect(first()).toEqual([stepName(11), "End", "70"]);
    sort("Passages");
    expect(listed()[0].slice(0, 4)).toEqual([stepName(0), stepName(1), "105", "105"]);
    sort("Median lag of the passages (h)");
    // The last path of the graph, the fourth activity to itself, takes the longest: 84 hours.
    expect(listed()[0]).toEqual([stepName(3), stepName(3), "15", "17", "84.0", "–", "Drawn"]);
    sort("On the map");
    expect(listed()[0][6]).toBe("Drawn");
    sort("On the map");
    expect(listed()[0][6]).toBe("Not drawn");
    expect(heading("On the map").getAttribute("aria-sort")).toBe("ascending");
  });

  it("prints no help: what it is and how the keyboard moves in it describes it for assistive technology, and its headings say the rest as tooltips", () => {
    render(view("paths"));
    const description = document.getElementById(list().getAttribute("aria-describedby")!)!;
    expect(description.className).toBe("visually-hidden");
    expect(description.textContent).toBe(
      "Every path between two activities of the kept incidents and every flow from Start and to End, with its supplied numbers; a flow has incidents only. " +
        "“On the map” says whether the map draws it at the detail above. Select a row to keep or remove the incidents through it. " +
        "Tab enters the list; the arrow keys, Page Up, Page Down, Home and End move.",
    );
    // Nothing else is printed above the rows.
    expect(Array.from(list().parentElement!.children, (part) => part.tagName)).toEqual(["P", "TABLE"]);
    expect(within(list()).getAllByRole("columnheader").map((heading) => [heading.getAttribute("aria-label"), heading.getAttribute("title")])).toEqual([
      ["From", null],
      ["To", null],
      ["Incidents", null],
      ["Passages", "A flow has incidents only"],
      ["Median lag of the passages (h)", "A flow has incidents only"],
      ["Total time (days, all passages)", "The sum of the lags of all the path's passages: the time spent on it. A flow has incidents only"],
      ["On the map", "Drawn at the current detail"],
    ]);
  });

  it("says whether the map draws a row as a filled or a hollow dot, with the words as tooltip and for assistive technology, and a number a row does not have as a quiet dash", () => {
    render(view("paths"));
    const rows = within(list()).getAllByRole("row").slice(1);
    /** The last cell of a row as it is drawn, as it is hovered and as it is read. */
    const onTheMap = (row: HTMLElement) => {
      const cell = row.lastElementChild!;
      const dot = cell.querySelector(".path-drawn")!;
      return [dot.getAttribute("data-drawn"), dot.getAttribute("aria-hidden"), dot.textContent, cell.getAttribute("title"), cell.querySelector(".visually-hidden")?.textContent];
    };
    expect(onTheMap(rows.find((row) => row.lastElementChild?.textContent === "Drawn")!)).toEqual(["true", "true", "", "Drawn", "Drawn"]);
    expect(onTheMap(rows.find((row) => row.lastElementChild?.textContent === "Not drawn")!)).toEqual(["false", "true", "", "Not drawn", "Not drawn"]);
    // Every row says one of the two, in the words alone.
    expect(new Set(rows.map((row) => row.lastElementChild?.textContent))).toEqual(new Set(["Drawn", "Not drawn"]));

    // The flow from Start to the first activity has incidents, and neither passages nor a lag.
    const flow = within(list()).getByRole("button", { name: `Flow from Start to “${stepName(0)}”` }).closest("tr")!;
    const [, , incidents, passages, lag] = Array.from(flow.children);
    expect(incidents.textContent).toBe("100");
    for (const cell of [passages, lag]) {
      expect(cell.textContent).toBe("–");
      expect(cell.firstElementChild?.className).toBe("muted");
      expect(cell.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    }
    // A path has both, and no dash.
    const path = within(list()).getByRole("button", { name: `Path from “${stepName(0)}” to “${stepName(1)}”` }).closest("tr")!;
    expect(Array.from(path.children, (cell) => cell.textContent).slice(2, 5)).toEqual(["105", "105", "2.0"]);
  });

  it("has one row as its tab stop and moves between rows with the keyboard", async () => {
    const user = userEvent.setup();
    render(view("paths"));
    const rowButtons = () => within(list()).getAllByRole("button", { pressed: false }).filter((button) => button.classList.contains("path-row"));
    const focused = () => document.activeElement?.getAttribute("aria-label");
    expect(rowButtons().filter((button) => button.tabIndex === 0)).toHaveLength(1);

    rowButtons()[0].focus();
    expect(focused()).toBe(`Path from “${stepName(0)}” to “${stepName(1)}”`);
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe(`Flow from Start to “${stepName(0)}”`);
    await user.keyboard("{End}");
    expect(focused()).toBe(`Path from “${stepName(8)}” to “${stepName(11)}”`);
    await user.keyboard("{PageUp}");
    expect(document.activeElement).toBe(rowButtons()[38]);
    await user.keyboard("{Home}");
    await user.keyboard("{ArrowUp}");
    expect(focused()).toBe(`Path from “${stepName(0)}” to “${stepName(1)}”`);
    // The row the keyboard is on stays the only tab stop, also once the list is sorted another way.
    await user.keyboard("{ArrowDown}");
    fireEvent.click(within(list()).getByRole("button", { name: "To: sort the list" }));
    expect(rowButtons().filter((button) => button.tabIndex === 0).map((button) => button.getAttribute("aria-label"))).toEqual([`Flow from Start to “${stepName(0)}”`]);

    // Enter selects the row the keyboard is on.
    rowButtons().find((button) => button.tabIndex === 0)!.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: `Flow from Start to “${stepName(0)}”` })).toBeTruthy();
    expect(offered()).toEqual(["Keep incidents that begin with it", "Keep incidents that do not begin with it"]);
  });
});
