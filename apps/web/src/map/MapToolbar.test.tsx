import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { NOT_DRAWN, underNotDrawn } from "./AboutMap";
import { MapView } from "./MapView";
import { BUSY_ACTIVITIES, busyGraph, busyIds, shownWhole, stepName } from "./testGraphs";

// The map measures its container; the test page has no layout, so nothing is ever resized.
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

beforeEach(() => window.localStorage.clear());

/** The map of the busy graph of ./testGraphs.ts, which opens on 36 of its 47 paths and flows; or the list of every path in its place. */
async function renderMap(showing: "map" | "paths" = "map") {
  const supplied = busyGraph();
  const user = userEvent.setup();
  const view = render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} showing={showing} />);
  const again = (next: "map" | "paths") => view.rerender(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} showing={next} />);
  if (showing === "paths") return { user, again, map: null as unknown as HTMLElement };
  const map = await screen.findByLabelText("Process map of the kept incidents");
  await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(BUSY_ACTIVITIES));
  return { user, again, map };
}

const tools = () => screen.getByRole("group", { name: "Map tools" });
const tool = (name: string) => within(tools()).getByRole("button", { name });
const toolNames = () => within(tools()).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
const view = () => document.querySelector<HTMLElement>(".map-view")!;
/** The parts of the map view in the page, each by its classes. */
const parts = () => Array.from(view().children, (part) => part.className);
const about = () => screen.getByRole("group", { name: "About this map" });
const offered = () => Array.from(document.querySelectorAll(".map-choices button"), (button) => button.textContent);

describe("the tools of the map", () => {
  it("are one row of icon buttons after the detail controls, and nothing stands under the map", async () => {
    await renderMap();
    // In the row of the detail controls, after them, and no part of their form.
    expect(tools().parentElement?.className).toBe("map-detail");
    expect(tools().previousElementSibling).toBe(screen.getByRole("form", { name: "Detail" }));
    expect(toolNames()).toEqual(["Keep activities in place", "Overview of the whole map", "Edit stages", "About this map"]);
    for (const button of within(tools()).getAllByRole("button")) {
      expect(button.className).toBe("icon-button");
      expect(button.getAttribute("title")).toContain(button.getAttribute("aria-label"));
      // It shows its icon and no words: what it holds besides is its mark or kept for assistive technology.
      expect(Array.from(button.childNodes).every((part) => part instanceof Element && part.matches("svg.icon, .icon-button-mark, .visually-hidden"))).toBe(true);
    }
    // A short line parts what changes the picture from the stages and from what there is to know.
    const separator = tools().querySelector(".icon-toolbar-separator")!;
    expect(separator.getAttribute("aria-hidden")).toBe("true");
    expect(separator.previousElementSibling).toBe(tool("Overview of the whole map"));
    expect(separator.nextElementSibling).toBe(tool("Edit stages"));

    // The map view is the row with the frame, and beside them in the page only what a selection offers.
    expect(parts()).toEqual(["map-main", "map-element visually-hidden"]);
    expect(Array.from(view().querySelector(".map-main")!.children, (part) => part.className)).toEqual(["map-detail", "map-frame"]);
    expect(view().querySelector("details:not(.map-frame *)")).toBeNull();
    expect(view().querySelector('input[type="checkbox"]:not(.map-frame *)')).toBeNull();
  });

  it("keep what a selection offers as a description for assistive technology only", async () => {
    const { again } = await renderMap();
    const hint = screen.getByText("Select an activity or a path on the map, or a row of its table view, to keep or remove the incidents through it.");
    expect(hint.closest(".visually-hidden")).toBe(view().querySelector(".map-element"));
    expect(screen.getByRole("heading", { name: "Keep or remove incidents" }).closest(".visually-hidden")).not.toBeNull();
    again("paths");
    expect(screen.getByText("Select a row of the list to keep or remove the incidents through it.").closest(".visually-hidden")).not.toBeNull();
  });

  it("leave the switches of the picture out over the list of every path, which is no picture", async () => {
    const { again } = await renderMap("paths");
    expect(toolNames()).toEqual(["Edit stages", "About this map"]);
    expect(tools().querySelector(".icon-toolbar-separator")).toBeNull();
    expect(tools().parentElement?.className).toBe("map-detail");
    expect(Array.from(view().querySelector(".map-main")!.children, (part) => part.className)).toEqual(["map-detail", "path-list"]);
    again("map");
    await screen.findByLabelText("Process map of the kept incidents");
    expect(toolNames()).toEqual(["Keep activities in place", "Overview of the whole map", "Edit stages", "About this map"]);
  });

  it("show the overview of the whole map only when it is asked for", async () => {
    const { user, map } = await renderMap();
    expect(tool("Overview of the whole map").getAttribute("aria-pressed")).toBe("false");
    expect(map.querySelector(".react-flow__minimap")).toBeNull();
    // The zoom control and the legend stay where they are, with or without it.
    const kept = () => [within(map).getByRole("button", { name: "Show the whole legend" }), map.querySelector(".react-flow__panel.bottom.left")].map((panel) => panel !== null);
    expect(kept()).toEqual([true, true]);

    await user.click(tool("Overview of the whole map"));
    expect(tool("Overview of the whole map").getAttribute("aria-pressed")).toBe("true");
    expect(map.querySelector(".react-flow__minimap")).not.toBeNull();
    expect(kept()).toEqual([true, true]);
    // Nothing is arranged again for it: the activities are those drawn before.
    expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(BUSY_ACTIVITIES);

    await user.click(tool("Overview of the whole map"));
    expect(tool("Overview of the whole map").getAttribute("aria-pressed")).toBe("false");
    expect(map.querySelector(".react-flow__minimap")).toBeNull();
  });
});

describe("the editor of the stages beside the map", () => {
  it("opens beside the map with the keyboard on its title, and closes from its switch or from itself, which gives the keyboard back to the switch", async () => {
    const { user, map } = await renderMap();
    expect(tool("Edit stages").getAttribute("aria-pressed")).toBe("false");
    expect(view().getAttribute("data-beside")).toBe("none");

    await user.click(tool("Edit stages"));
    expect(tool("Edit stages").getAttribute("aria-pressed")).toBe("true");
    expect(view().getAttribute("data-beside")).toBe("stages");
    // After the row and the frame of the map, which stay as they are: the map is not taken away or pushed down.
    expect(parts()).toEqual(["map-main", "map-stages-panel", "map-element visually-hidden"]);
    expect(screen.getByLabelText("Process map of the kept incidents")).toBe(map);
    const panel = view().querySelector<HTMLElement>(".map-stages-panel")!;
    expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: "Stages of this log" }));
    expect(within(panel).getByRole("region", { name: "Stages of this log" })).toBeTruthy();
    expect(within(panel).getByText("Stages are yours and stay in this browser")).toBeTruthy();
    expect(within(panel).getByRole("table", { name: "Activities and their stage" })).toBeTruthy();

    await user.click(within(panel).getByRole("button", { name: "Close the editor of the stages" }));
    expect(view().querySelector(".map-stages-panel")).toBeNull();
    expect(tool("Edit stages").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(tool("Edit stages"));
    expect(view().getAttribute("data-beside")).toBe("none");

    // The switch opens and closes it from the keyboard too.
    await user.keyboard("{Enter}");
    expect(view().querySelector(".map-stages-panel")).not.toBeNull();
    await user.click(tool("Edit stages"));
    expect(view().querySelector(".map-stages-panel")).toBeNull();
  });

  it("takes the place of the steps of a selected element, which stays selected and has its steps back when the editor is closed", async () => {
    const { user, map } = await renderMap();
    const second = map.querySelector<HTMLElement>(`[data-id="${busyIds.activity(1)}"]`)!;
    const own = ["Keep incidents that contain it", "Keep incidents that do not contain it", "Keep incidents that begin with it"];
    fireEvent.click(second);
    expect(screen.getByRole("heading", { name: `Activity “${stepName(1)}”` })).toBeTruthy();
    expect(offered()).toEqual(own);
    expect(view().getAttribute("data-beside")).toBe("element");
    expect(view().getAttribute("data-element")).toBe("selected");

    await user.click(tool("Edit stages"));
    expect(view().getAttribute("data-beside")).toBe("stages");
    // Both are wanted: the editor is shown, and the steps wait behind it.
    expect(view().querySelector<HTMLElement>(".map-element")!.hidden).toBe(true);
    expect(screen.queryByRole("heading", { name: `Activity “${stepName(1)}”` })).toBeNull();
    expect(screen.queryByRole("button", { name: own[0] })).toBeNull();
    expect(screen.getByRole("region", { name: "Stages of this log" })).toBeTruthy();
    // The activity is still the one selected on the map.
    expect(view().getAttribute("data-element")).toBe("selected");

    // An element selected while the editor is open waits behind it too.
    fireEvent.click(map.querySelector<HTMLElement>(`[data-id="${busyIds.activity(11)}"]`)!);
    await user.click(screen.getByRole("button", { name: "Close the editor of the stages" }));
    expect(view().querySelector<HTMLElement>(".map-element")!.hidden).toBe(false);
    expect(screen.getByRole("heading", { name: `Activity “${stepName(11)}”` })).toBeTruthy();
    expect(offered()).toEqual([own[0], own[1], "Keep incidents that end with it"]);
    expect(view().getAttribute("data-beside")).toBe("element");
  });

  it("draws on the map what is defined in it while both are in view", async () => {
    const { user, map } = await renderMap();
    await user.click(tool("Edit stages"));
    await user.click(screen.getByRole("textbox", { name: "New stage" }));
    await user.keyboard("Intake{Enter}");
    await user.selectOptions(screen.getByRole("combobox", { name: `Stage of “${stepName(0)}”` }), "Intake");
    await waitFor(() => expect(Array.from(map.querySelectorAll('[data-wf-part="group"][data-wf-kind="stage"] [data-wf-part="group-label"]'), (label) => label.textContent)).toEqual(["Intake"]));
    // The detail controls offer the stage as one node from then on, as before.
    expect(screen.getByRole("button", { name: "Show stages" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Stages of this log" })).toBeTruthy();
  });
});

describe("what there is to know about the map", () => {
  /** The statement beside a slider of the detail controls, in full: the title of its short form. */
  const inFull = (name: "activities" | "paths") => document.querySelector(`.map-detail .wf-controls__statement--${name}`)?.getAttribute("title");
  const mark = () => tool("About this map").querySelector(".icon-button-mark");

  it("opens over the map from its info button: what is not drawn, what the map counts, the definitions and the state of the library, in that order", async () => {
    const { user, map } = await renderMap();
    expect(tool("About this map").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "About this map" })).toBeNull();

    await user.click(tool("About this map"));
    expect(tool("About this map").getAttribute("aria-expanded")).toBe("true");
    // It hangs from its button in the row above the map and is no part of the map view's layout.
    expect(about().parentElement).toBe(tool("About this map").parentElement);
    expect(parts()).toEqual(["map-main", "map-element visually-hidden"]);
    expect(screen.getByLabelText("Process map of the kept incidents")).toBe(map);
    expect(Array.from(about().children, (part) => part.className)).toEqual(["popover-section map-not-drawn", "popover-section map-coverage", "map-caption", "map-library"]);
    expect(within(about()).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Not drawn at this detail", "What the map counts"]);

    // First what the map leaves out: the two statements of the detail controls in full, then the flows from Start and to End.
    expect(Array.from(about().querySelectorAll(".map-not-drawn p"), (line) => line.textContent)).toEqual([
      "12 of 12 activities shown, carrying 100.0 % of the events.",
      "36 of 47 paths: 23 by frequency, 13 kept so that every activity lies on a way from start to end. Strongest path not shown: 14.",
      "2 of the 7 flows from Start and to End, each with fewer than 15 incidents. The Paths slider draws more.",
    ]);
    expect(Array.from(about().querySelectorAll(".map-not-drawn p"), (line) => line.textContent).slice(0, 2)).toEqual([inFull("activities"), inFull("paths")]);

    // Then every coverage figure, and the sentences that define the numbers and the measures.
    const counts = Array.from(about().querySelectorAll(".map-coverage dl > div"), (row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]);
    expect(counts).toHaveLength(13);
    expect(counts[0]).toEqual(["Incidents on the map", "2 incidents"]);
    expect(counts.map(([name]) => name)).toContain("Records without activity label");
    const caption = Array.from(about().querySelectorAll(".map-caption p"), (line) => line.textContent ?? "");
    expect(caption).toHaveLength(7);
    expect(caption[0]).toBe("Activities count labelled records and distinct incidents of the 2 incidents on the map.");
    expect(caption[5]).toMatch(/^Lag: /);
    expect(caption[6]).toMatch(/^Measures: the legend on the map, shown whole, switches what the map writes\./);
    expect(about().lastElementChild?.textContent).toBe("The map is drawn with an unreleased state of the map library (wise-flow 0.3.5, a local packaging candidate).");
  });

  it("closes with Escape or a click outside it, and the keyboard is back on its button", async () => {
    const { user, map } = await renderMap();
    tool("About this map").focus();
    await user.keyboard("{Enter}");
    expect(about()).toBeTruthy();
    // The panel can be long: it takes the keyboard after its button and is scrolled from there.
    await user.tab();
    expect(document.activeElement).toBe(about());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "About this map" })).toBeNull();
    expect(document.activeElement).toBe(tool("About this map"));
    expect(tool("About this map").getAttribute("aria-expanded")).toBe("false");

    await user.click(tool("About this map"));
    expect(about()).toBeTruthy();
    // A click on the row beside the tools takes no keyboard: the panel closes and the button has it again.
    await user.click(view().querySelector<HTMLElement>(".map-detail h3")!);
    expect(screen.queryByRole("group", { name: "About this map" })).toBeNull();
    expect(document.activeElement).toBe(tool("About this map"));

    // Another tool closes it as any click outside it does, and is carried out.
    await user.click(tool("About this map"));
    await user.click(tool("Overview of the whole map"));
    expect(screen.queryByRole("group", { name: "About this map" })).toBeNull();
    expect(map.querySelector(".react-flow__minimap")).not.toBeNull();
  });

  it("carries a mark on its button for as long as flows from Start or to End are not drawn, and says which of them while it is open", async () => {
    const { user } = await renderMap();
    const paths = () => within(screen.getByRole("form", { name: "Detail" })).getByRole("slider", { name: "Paths" });
    expect(mark()).not.toBeNull();
    expect(document.getElementById(tool("About this map").getAttribute("aria-describedby")!)?.textContent).toBe("Some flows from Start and to End are not drawn at this detail");
    expect(tool("About this map").getAttribute("title")).toBe("About this map\nSome flows from Start and to End are not drawn at this detail");

    await user.click(tool("About this map"));
    expect(about().querySelector(".map-flows")?.textContent).toBe("2 of the 7 flows from Start and to End, each with fewer than 15 incidents. The Paths slider draws more.");

    // Every path drawn, every flow is drawn: nothing is left to say, and the statements follow the sliders while the panel is open.
    fireEvent.change(paths(), { target: { value: paths().getAttribute("max") } });
    expect(mark()).toBeNull();
    expect(tool("About this map").hasAttribute("aria-describedby")).toBe(false);
    expect(Array.from(about().querySelectorAll(".map-not-drawn p"), (line) => line.textContent)).toEqual([inFull("activities"), inFull("paths")]);
    expect(inFull("paths")).toBe("49 of 49 paths: 49 by frequency.");
    expect(about().querySelector(".map-flows")).toBeNull();
  });

  it("says the flows line under its heading without the words of the heading", () => {
    expect(NOT_DRAWN).toBe("Not drawn at this detail");
    expect(underNotDrawn("Not drawn at this detail: 26 of the 44 flows from Start and to End: 4 of activities that are not shown, 22 with fewer than 373 incidents. The sliders draw more.")).toBe(
      "26 of the 44 flows from Start and to End: 4 of activities that are not shown, 22 with fewer than 373 incidents. The sliders draw more.",
    );
    // A line that begins otherwise is said as it is.
    expect(underNotDrawn("3 flows are not drawn.")).toBe("3 flows are not drawn.");
  });
});
