import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fittedView, follow, type Seen, sameView } from "./FitToFrame";
import { MapView } from "./MapView";
import { BUSY_ACTIVITIES, busyGraph, busyIds, shownWhole } from "./testGraphs";

// The map is arranged by its layout engine, which a slow machine takes seconds for: the tests wait for it that long.
const LAYOUT_WITHIN = 15_000;
vi.setConfig({ testTimeout: 20_000 });

// The map of these tests runs from left to right: it is wider than its frame, and what is said below about its fit is said of such a map.
vi.mock("./arrange", async (original) => {
  const arrange = await original<typeof import("./arrange")>();
  return { ...arrange, OPENING_DIRECTION: arrange.LEFT_TO_RIGHT };
});

/*
 * The test page has no layout, so the frame's size is said here: the map reads it as the size of
 * the element it draws in, and reads it again when the window says it was resized. Two panels of
 * the map have a place in the frame, as on screen: the zoom control in the lower left corner and
 * the legend in the lower right one, each 8 px from the edges. The fit keeps clear of both.
 */
const frame = { width: 1200, height: 400 };
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
  if (this.matches(".react-flow__panel.bottom.right:not(.react-flow__minimap, .react-flow__attribution)")) return box(frame.width - 308, frame.height - 48, 300, 40);
  return box(0, 0, 0, 0);
};
// The frame is resized by saying so; nothing observes it by itself.
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;
// The library moves the view to its fit at once where reduced motion is asked for, so the fitted view can be read without waiting for a movement.
window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

function resizeFrame(width: number, height: number) {
  frame.width = width;
  frame.height = height;
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

beforeEach(() => {
  frame.width = 1200;
  frame.height = 400;
});

/** The view of the map: where its picture is moved to and at which zoom. */
function viewOf(map: HTMLElement) {
  const [x, y, zoom] = (map.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  return { x, y, zoom };
}

/** Where the map has placed its activities, which only an arrangement changes. */
const placesOf = (map: HTMLElement) => Array.from(map.querySelectorAll<HTMLElement>(".react-flow__node"), (node) => `${node.dataset.id} ${node.style.transform}`);

async function renderFittedMap() {
  const supplied = busyGraph();
  render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} />);
  const map = await screen.findByLabelText("Process map of the kept incidents");
  await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(BUSY_ACTIVITIES));
  await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"), { timeout: LAYOUT_WITHIN });
  // The library fits the arranged map twice, the second time 400 ms after the arrangement.
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
  const button = (name: string) => within(map).getByRole("button", { name });
  return { map, button };
}

describe("the map in a frame that changes its size", () => {
  it("is fitted again as the map library fits it, and nothing is arranged again", async () => {
    const { map, button } = await renderFittedMap();
    const wide = viewOf(map);
    const places = placesOf(map);
    // The map says on its element while it is arranging; from here on it must not say so again.
    const arranging: (string | null)[] = [];
    const watch = new MutationObserver(() => arranging.push(map.getAttribute("data-layout-status")));
    watch.observe(map, { attributes: true, attributeFilter: ["data-layout-status"] });
    // The map is wider than the frame is: it is fitted to the frame's width.
    expect(wide.zoom).toBeGreaterThan(0.05);
    expect(wide.zoom).toBeLessThan(1);

    // A side panel opens: the frame is narrower.
    resizeFrame(900, 400);
    const narrow = viewOf(map);
    expect(narrow.zoom).toBeCloseTo((wide.zoom * 900) / 1200, 6);
    // The library's own "Fit the map" finds the view where it would put it.
    fireEvent.click(button("Fit the map"));
    expect(viewOf(map)).toEqual(narrow);

    // The window is made lower, then the side panel closes.
    resizeFrame(900, 300);
    const low = viewOf(map);
    expect(low.zoom).toBe(narrow.zoom);
    expect(low.y).toBeCloseTo(narrow.y - 50, 6);
    fireEvent.click(button("Fit the map"));
    expect(viewOf(map)).toEqual(low);
    resizeFrame(1200, 400);
    expect(viewOf(map)).toEqual(wide);

    expect(placesOf(map)).toEqual(places);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    watch.disconnect();
    expect(arranging).toEqual([]);
    expect(map.getAttribute("data-layout-status")).toBe("ready");
  });

  it("keeps a view the analyst zoomed or moved, until the map is fitted again", async () => {
    const { map, button } = await renderFittedMap();
    const fitted = viewOf(map);

    fireEvent.click(button("Zoom in"));
    const zoomed = viewOf(map);
    expect(zoomed.zoom).toBeGreaterThan(fitted.zoom);
    resizeFrame(900, 400);
    expect(viewOf(map)).toEqual(zoomed);
    resizeFrame(1200, 400);
    expect(viewOf(map)).toEqual(zoomed);

    // Fitted again by the analyst, the view follows the frame again.
    fireEvent.click(button("Fit the map"));
    expect(viewOf(map)).toEqual(fitted);
    resizeFrame(900, 400);
    expect(viewOf(map).zoom).toBeCloseTo((fitted.zoom * 900) / 1200, 6);

    // The wheel moves the view along the map.
    const narrow = viewOf(map);
    fireEvent.wheel(map.querySelector(".react-flow__pane")!, { deltaY: 120 });
    const moved = viewOf(map);
    expect(moved).not.toEqual(narrow);
    resizeFrame(1200, 400);
    expect(viewOf(map)).toEqual(moved);
  });

  it("is fitted again when the panel of a selected activity takes room from the frame", async () => {
    const { map } = await renderFittedMap();
    const fitted = viewOf(map);
    fireEvent.click(map.querySelector<HTMLElement>(`[data-id="${busyIds.activity(2)}"]`)!);
    expect(document.querySelector(".map-view")?.getAttribute("data-element")).toBe("selected");
    // The panel stands beside the map and is 300 px wide, with a gap of 12 px.
    resizeFrame(1200 - 312, 400);
    expect(viewOf(map).zoom).toBeCloseTo((fitted.zoom * (1200 - 312)) / 1200, 6);
  });
});

describe("the fitted view", () => {
  const wideMap = { x: 0, y: 0, width: 1000, height: 200 };
  const area = { width: 1200, height: 400 };

  it("shows the whole map in the middle of the frame with 4 % of its size around it", () => {
    const view = fittedView(wideMap, area, area, []);
    // 1,000 px and twice 4 % of it in 1,200 px.
    expect(view.zoom).toBeCloseTo(1200 / 1080, 10);
    expect(view.x).toBeCloseTo(600 - 500 * (1200 / 1080), 10);
    expect(view.y).toBeCloseTo(200 - 100 * (1200 / 1080), 10);
  });

  it("keeps clear of a panel over the map on the side that costs the least zoom, with a gap of 8 px", () => {
    const zoomControl = { x: 8, y: 352, width: 100, height: 40 };
    // The wide map loses nothing to room kept clear at the bottom: 48 px of panel and 8 px of gap.
    const wide = fittedView(wideMap, area, area, [zoomControl]);
    expect(wide.zoom).toBeCloseTo(1200 / 1080, 10);
    expect(wide.y).toBeCloseTo((400 - 56) / 2 - 100 * (1200 / 1080), 10);
    // A tall map loses nothing to room kept clear at the left: 108 px of panel and 8 px of gap.
    const tall = fittedView({ x: 0, y: 0, width: 300, height: 600 }, area, area, [zoomControl]);
    expect(tall.zoom).toBeCloseTo(400 / 648, 10);
    expect(tall.x).toBeCloseTo(116 + (1200 - 116) / 2 - 150 * (400 / 648), 10);
  });

  it("stays within the zoom of the map: no closer than 3, no farther than 0.05", () => {
    expect(fittedView({ x: 0, y: 0, width: 10, height: 10 }, area, area, []).zoom).toBe(3);
    expect(fittedView({ x: 0, y: 0, width: 100000, height: 10 }, area, area, []).zoom).toBe(0.05);
  });

  it("is the same view within rounding, and another one beyond it", () => {
    const view = { x: 44.4, y: 88.9, zoom: 1.1111 };
    expect(sameView(view, { x: 44.8, y: 88.5, zoom: 1.1119 })).toBe(true);
    expect(sameView(view, { x: 45, y: 88.9, zoom: 1.1111 })).toBe(false);
    expect(sameView(view, { x: 44.4, y: 88.9, zoom: 1.113 })).toBe(false);
    expect(sameView(view, { x: Number.NaN, y: 88.9, zoom: 1.1111 })).toBe(false);
  });
});

describe("following the frame", () => {
  const forWide = { x: 44, y: 89, zoom: 1.1 };
  const forNarrow = { x: 33, y: 100, zoom: 0.8 };
  const chosen = { x: -200, y: 40, zoom: 2 };
  const wide = { width: 1200, height: 400 };
  const narrow = { width: 900, height: 400 };
  const looks = (...steps: Parameters<typeof follow>[1][]) => {
    let seen: Seen | null = null;
    return steps.map((step) => {
      const next = follow(seen, step);
      seen = next.seen;
      return next.moveTo ?? (next.seen.wasFitted ? "fitted" : "kept");
    });
  };

  it("moves a fitted view to the fit of the new frame, and leaves a chosen view where it is", () => {
    expect(looks({ ...wide, view: forWide, fitted: forWide }, { ...narrow, view: forWide, fitted: forNarrow }, { ...narrow, view: forNarrow, fitted: forNarrow })).toEqual(["fitted", forNarrow, "fitted"]);
    expect(looks({ ...wide, view: chosen, fitted: forWide }, { ...narrow, view: chosen, fitted: forNarrow }, { ...wide, view: chosen, fitted: forWide })).toEqual(["kept", "kept", "kept"]);
  });

  it("takes a view for fitted from where its last move ended, not from what has changed around it since", () => {
    // The legend grew after the fit: the fitted view is another one now, but the view was not moved away from its fit.
    const withLargerLegend = { x: 44, y: 60, zoom: 1.1 };
    expect(looks({ ...wide, view: forWide, fitted: forWide }, { ...narrow, view: forWide, fitted: forNarrow })).toEqual(["fitted", forNarrow]);
    let seen = follow(null, { ...wide, view: forWide, fitted: forWide }).seen;
    seen = { ...seen, fitted: withLargerLegend };
    expect(follow(seen, { ...narrow, view: forWide, fitted: forNarrow }).moveTo).toEqual(forNarrow);
  });

  it("fits to the new frame a view that a fit of the library was still moving when the frame changed", () => {
    const onTheWay = { x: 20, y: 95, zoom: 1.4 };
    const nearer = { x: 40, y: 90, zoom: 1.15 };
    expect(
      looks(
        // The library's fit for the wide frame is moving the view.
        { ...wide, view: onTheWay, fitted: forWide },
        // The frame gets narrower meanwhile: the view is not the fitted one and stays.
        { ...narrow, view: onTheWay, fitted: forNarrow },
        { ...narrow, view: nearer, fitted: forNarrow },
        // It ends on the fit for the wide frame, and is fitted to the frame it ended in.
        { ...narrow, view: forWide, fitted: forNarrow },
        { ...narrow, view: forNarrow, fitted: forNarrow },
      ),
    ).toEqual(["kept", "kept", "kept", forNarrow, "fitted"]);
    // A view the analyst moves meanwhile ends elsewhere and is kept.
    expect(looks({ ...wide, view: onTheWay, fitted: forWide }, { ...narrow, view: onTheWay, fitted: forNarrow }, { ...narrow, view: chosen, fitted: forNarrow }, { ...wide, view: chosen, fitted: forWide })).toEqual(["kept", "kept", "kept", "kept"]);
  });

  it("moves nothing while nothing is drawn", () => {
    expect(looks({ ...wide, view: { x: 0, y: 0, zoom: 1 }, fitted: undefined }, { ...narrow, view: { x: 0, y: 0, zoom: 1 }, fitted: undefined })).toEqual(["kept", "kept"]);
  });
});
