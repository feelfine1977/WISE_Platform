import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Measure } from "wise-flow";
import { MapLegend } from "./MapLegend";
import { MapView } from "./MapView";
import { MAP_THEME } from "./look";
import { askedFor, OPENING_MEASURE } from "./measures";
import { LARGE_ACTIVITIES, largeGraph, largeIds, largeName, shownWhole, stagedGraph } from "./testGraphs";

/*
 * #65: a map larger than its frame opens readable near Start, never zooms below the readable floor the map library derives
 * from its cards, says how much of it is in view, brings an element into view from the list of every path, the table view
 * and the legend, returns to the opening, tells activities shortened alike apart, and through all of it keeps every
 * incident, count, step and place of an activity.
 */

// The map is arranged by its layout engine, which a slow machine takes seconds for: the tests wait for it that long.
const LAYOUT_WITHIN = 20_000;
vi.setConfig({ testTimeout: 30_000 });

/*
 * The test page has no layout, so the frame's size is said here, as the fit tests say it: 940 × 349, the frame the map has at
 * 1280 × 720 beside the Time column. The zoom control stands in the lower left corner, 8 px from the edges.
 */
const frame = { width: 940, height: 349 };
const ofTheFrame = ".react-flow, .react-flow__renderer, .wf-process-map__main";
for (const [property, side] of [
  ["offsetWidth", "width"],
  ["clientWidth", "width"],
  ["offsetHeight", "height"],
  ["clientHeight", "height"],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches(ofTheFrame) ? frame[side] : 0;
    },
  });
}
const box = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
Element.prototype.getBoundingClientRect = function (this: Element) {
  if (this.matches(ofTheFrame)) return box(0, 0, frame.width, frame.height);
  if (this.matches(".react-flow__panel.bottom.left")) return box(8, frame.height - 48, 140, 40);
  if (this.matches(".wf-overview")) {
    const style = (this as HTMLElement).style;
    return box(parseFloat(style.left) || 0, parseFloat(style.top) || 0, parseFloat(style.width) || 0, parseFloat(style.height) || 0);
  }
  return box(0, 0, 0, 0);
};
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;
// The library moves the view at once where reduced motion is asked for, so a view can be read without waiting for a movement.
window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

beforeEach(() => window.localStorage.clear());

/** The view of the map: where its picture is moved to and at which zoom. */
function viewOf(map: HTMLElement) {
  const [x, y, zoom] = (map.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  return { x, y, zoom };
}

/** Where the map has placed its activities, which only an arrangement changes. */
const placesOf = (map: HTMLElement) => Object.fromEntries(Array.from(map.querySelectorAll<HTMLElement>(".react-flow__node-activity"), (node) => [node.dataset.id, node.style.transform]));

/** The place of a node in the map's units, from where the map drew it. */
function placeOf(map: HTMLElement, id: string) {
  const node = map.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  const [x, y] = (node.style.transform.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  return { x, y, width: parseFloat(node.style.width) || 0, height: parseFloat(node.style.height) || 0 };
}

/** Whether a node lies inside the frame at the map's view. */
function inFrame(map: HTMLElement, id: string) {
  const { x, y, zoom } = viewOf(map);
  const place = placeOf(map, id);
  const left = place.x * zoom + x;
  const top = place.y * zoom + y;
  return left + place.width * zoom > 0 && left < frame.width && top + place.height * zoom > 0 && top < frame.height;
}

const settle = (ms = 700) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const detailNote = () => document.querySelector(".map-detail [data-testid='wf-in-view']")?.textContent ?? null;
const overview = () => screen.queryByRole("application", { name: "Overview of the map" });
const parseNote = (text: string | null) => {
  const m = text?.match(/^([\d,]+) of ([\d,]+) activities and ([\d,]+) of ([\d,]+) paths in view$/);
  return m ? m.slice(1).map((part) => Number(part.replace(/,/g, ""))) : null;
};

async function renderLargeMap(showing: "map" | "paths" = "map") {
  const supplied = largeGraph();
  const onStep = vi.fn();
  const user = userEvent.setup();
  const element = (next: "map" | "paths") => <MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={onStep} showing={next} onShowMap={() => again("map")} initiallyInPlace />;
  const view = render(element(showing));
  const again = (next: "map" | "paths") => view.rerender(element(next));
  const mapShown = async () => {
    const map = await screen.findByLabelText("Process map of the kept incidents");
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("given"), { timeout: LAYOUT_WITHIN });
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBeGreaterThan(0));
    // The map opens 50 and 400 ms after its nodes are drawn, and says what is in view 200 ms after the view rests.
    await settle(900);
    return map;
  };
  const map = showing === "map" ? await mapShown() : (null as unknown as HTMLElement);
  const button = (name: string | RegExp) => screen.getByRole("button", { name });
  const inMap = (name: string) => within(map).getByRole("button", { name });
  return { supplied, onStep, user, map, again, mapShown, button, inMap };
}

describe("#65 the map of a large parent", () => {
  it("opens readable near Start with the overview, says how much is in view, and never zooms below the readable floor", async () => {
    const { map, inMap } = await renderLargeMap();
    // The parent's 45 activities and its paths: the map opens on the 20 most frequent and a main flow; the strip says so and what is in view.
    expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(20);
    const opened = viewOf(map);
    expect(opened.zoom).toBeGreaterThanOrEqual(0.75);
    expect(inFrame(map, "event:start")).toBe(true);
    expect(overview()).not.toBeNull();
    const note = parseNote(detailNote());
    expect(note).not.toBeNull();
    const [nodes, ofNodes, edges, ofEdges] = note!;
    expect(ofNodes).toBe(20);
    expect(nodes).toBeGreaterThan(0);
    expect(nodes).toBeLessThan(ofNodes);
    expect(edges).toBeLessThanOrEqual(ofEdges);
    // The overview says the same to assistive technology.
    expect(within(overview()!).getByTestId("wf-overview-in-view").textContent).toBe(detailNote());

    // Zoomed out twelve times, the map stops at the floor, well above the library's own 0.05, and still names its activities.
    for (let i = 0; i < 12; i++) fireEvent.click(inMap("Zoom out"));
    await settle(400);
    const floor = viewOf(map).zoom;
    expect(floor).toBeGreaterThan(0.2);
    expect(floor).toBeLessThan(opened.zoom);
    expect(map.className).not.toContain("wf-text--box");
    fireEvent.click(inMap("Zoom out"));
    await settle(300);
    expect(viewOf(map).zoom).toBeCloseTo(floor, 9);
  });

  it("is fitted no further than the floor: from Start, with the overview, where the whole does not fit readably", async () => {
    const { map, inMap } = await renderLargeMap();
    for (let i = 0; i < 12; i++) fireEvent.click(inMap("Zoom out"));
    await settle(400);
    const floor = viewOf(map).zoom;
    fireEvent.click(inMap("Zoom in"));
    await settle(300);
    fireEvent.click(inMap("Fit the map"));
    await settle(700);
    const fitted = viewOf(map);
    expect(fitted.zoom).toBeGreaterThanOrEqual(floor - 1e-9);
    if (detailNote() !== null) {
      // Part of the map stays out of view: the fit is the floor, from Start.
      expect(fitted.zoom).toBeCloseTo(floor, 6);
      expect(inFrame(map, "event:start")).toBe(true);
      expect(overview()).not.toBeNull();
    }
  });

  it("brings a path of the list into view when it is drawn on the map, and the opening comes back on request", async () => {
    const { map, again, mapShown, button, inMap } = await renderLargeMap();
    const opened = viewOf(map);
    const places = placesOf(map);
    // A rare path the detail leaves out: from the first activity to a far one.
    const far = largeIds.path(0, 12);
    again("paths");
    const list = screen.getByRole("table", { name: "Paths of the kept incidents" });
    const row = within(list).getByRole("button", { name: `Path from “${largeName(0)}” to “${largeName(12)}”` });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.click(row);
    fireEvent.click(button("Draw on the map"));
    const shown = await mapShown();
    // Drawn beyond the detail (the page without layout draws no path element, so the strip says it), selected, at the keyboard
    // position and brought to the centre of the view: the midpoint between its two activities, which keep their places.
    await settle(500);
    expect(document.querySelector(".map-limit")?.textContent).toContain("1 path drawn on request beyond the detail");
    expect(shown.getAttribute("aria-activedescendant")).toBe(`wf-edge-${far}`);
    expect(screen.getByRole("heading", { name: `Path from “${largeName(0)}” to “${largeName(12)}”` })).toBeTruthy();
    const moved = viewOf(shown);
    expect(moved.zoom).toBeGreaterThanOrEqual(0.75 - 1e-9);
    const [from, to] = [placeOf(shown, largeIds.activity(0)), placeOf(shown, largeIds.activity(12))];
    const centre = { x: (frame.width / 2 - moved.x) / moved.zoom, y: (frame.height / 2 - moved.y) / moved.zoom };
    expect(centre.x).toBeCloseTo((from.x + from.width / 2 + to.x + to.width / 2) / 2, 3);
    expect(centre.y).toBeCloseTo((from.y + from.height / 2 + to.y + to.height / 2) / 2, 3);
    for (const [id, transform] of Object.entries(places)) expect(placesOf(shown)[id], id).toBe(transform);

    // Back to the opening, by pointer and by keyboard.
    fireEvent.click(inMap("Zoom in"));
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Back to the opening" }));
    await settle(900);
    expect(viewOf(shown).zoom).toBeCloseTo(opened.zoom, 6);
    expect(inFrame(shown, "event:start")).toBe(true);
    fireEvent.click(inMap("Zoom in"));
    await settle(300);
    const back = screen.getByRole("button", { name: "Back to the opening" });
    back.focus();
    fireEvent.click(back);
    await settle(900);
    expect(viewOf(shown).zoom).toBeCloseTo(opened.zoom, 6);
  });

  it("brings a row chosen in the table view into view when the map is shown again, and a stage from the legend", async () => {
    const { map, user, inMap } = await renderLargeMap();
    await user.click(screen.getByRole("button", { name: "Table view" }));
    const table = await screen.findByRole("table", { name: /activit/i });
    const target = largeIds.activity(19);
    const row = within(table).getByText(largeName(19)).closest("tr")!;
    await user.click(row);
    await user.click(screen.getByRole("button", { name: "Map view" }));
    const shown = await screen.findByLabelText("Process map of the kept incidents");
    await settle(900);
    expect(shown.getAttribute("aria-activedescendant")).toBe(`wf-node-${target}`);
    expect(inFrame(shown, target)).toBe(true);
    expect(inMap("Zoom in")).toBeTruthy();
    void map;
  });

  it("keeps the view through a change of the detail, and tells activities shortened alike apart", async () => {
    const { map, onStep } = await renderLargeMap();
    fireEvent.click(within(map).getByRole("button", { name: "Zoom in" }));
    await settle(300);
    const zoomed = viewOf(map);
    const activities = screen.getByRole("slider", { name: "Activities" }) as HTMLInputElement;
    fireEvent.change(activities, { target: { value: activities.max } });
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(LARGE_ACTIVITIES), { timeout: LAYOUT_WITHIN });
    await settle(900);
    // Another detail keeps the view the analyst zoomed to; no step is taken by any of it.
    expect(viewOf(map).zoom).toBe(zoomed.zoom);
    expect(onStep).not.toHaveBeenCalled();
    // The three warehouses are shortened alike on their cards' lines: each is told apart, and the whole name stays for assistive technology.
    const level = [...map.classList].find((name) => name.startsWith("wf-text--"))?.slice(9) ?? "plain";
    const shownName = (index: number) => Array.from(map.querySelectorAll(`[data-id="${largeIds.activity(index)}"] .wf-copy--${level} [data-wf-part="node-label"] > span`), (span) => span.textContent).join("\n");
    const [central, regional, site] = [0, 1, 2].map(shownName);
    expect(central).not.toBe("");
    expect(new Set([central, regional, site]).size).toBe(3);
    const named = Array.from(map.querySelectorAll("[aria-label]"), (element) => element.getAttribute("aria-label") ?? "");
    for (const index of [0, 1, 2]) expect(named.some((label) => label.includes(largeName(index))), largeName(index)).toBe(true);
  });
});

describe("the legend of a map with stages", () => {
  it("offers each stage as a button that brings it into view", async () => {
    const onStage = vi.fn();
    const asked = askedFor(OPENING_MEASURE);
    render(<MapLegend graph={stagedGraph()} measure={asked.measure as Measure} over={asked.style} theme={MAP_THEME} onMeasure={() => undefined} stages={[{ id: "first", name: "First stage" }, { id: "second", name: "Second stage" }]} onStage={onStage} />);
    const group = screen.getByRole("group", { name: "Bring a stage into view" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Show the stage “First stage” on the map", "Show the stage “Second stage” on the map"]);
    buttons[1].focus();
    fireEvent.click(buttons[1]);
    expect(onStage).toHaveBeenCalledWith("second");
  });
});
