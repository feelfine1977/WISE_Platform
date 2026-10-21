import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ComponentProps, useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AbstractOptions } from "wise-flow";
import { type InView, ProcessMap } from "wise-flow/react";
import { mapDetail } from "./detail";
import { DetailStrip } from "./DetailStrip";
import { leastFlowIncidents, rankedDetail, toFlowGraph } from "./graph";
import { MapView, openingDetail } from "./MapView";
import { BUSY_ACTIVITIES, busyGraph, busyIds, shownWhole, stagedGraph, stepName } from "./testGraphs";

/*
 * The map library's own detail panel is switched on inside the map, whatever the map view asks
 * for, so that it can be read beside the strip above the canvas. The panel says what the library
 * computes inside its map from the state it holds there; the strip says what `mapDetail` computes
 * outside it. Every test below reads both and expects the same.
 */
vi.mock("wise-flow/react", async (original) => {
  const library = await original<typeof import("wise-flow/react")>();
  const Drawn = library.ProcessMap;
  return { ...library, ProcessMap: (props: ComponentProps<typeof Drawn>) => <Drawn {...props} controls /> };
});

// The map measures its container; the test page has no layout, so nothing is ever resized.
class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

/** Everything a detail panel says: where each slider can stand and stands, its statement short and in full, further lines, and its switches. */
function said(panel: HTMLElement) {
  return {
    sliders: Array.from(panel.querySelectorAll<HTMLInputElement>('input[type="range"]')).map((slider) => ({
      name: panel.querySelector(`label[for="${slider.id}"]`)?.textContent,
      from: slider.min,
      to: slider.max,
      at: slider.value,
      disabled: slider.disabled,
      says: slider.getAttribute("aria-valuetext"),
      inFull: document.getElementById(slider.getAttribute("aria-describedby") ?? "")?.textContent,
    })),
    statements: Array.from(panel.querySelectorAll(".wf-controls__statement")).map((line) => [line.textContent, line.getAttribute("title")]),
    furtherLines: Array.from(panel.querySelectorAll(".wf-controls__note")).map((line) => line.textContent),
    switches: Array.from(panel.querySelectorAll(".wf-controls__row button")).map((button) => [button.textContent, button.getAttribute("aria-pressed")]),
  };
}

const above = () => document.querySelector<HTMLElement>(".map-detail form")!;
const slider = (panel: HTMLElement, name: "Activities" | "Paths") => within(panel).getByRole("slider", { name }) as HTMLInputElement;
const move = (panel: HTMLElement, name: "Activities" | "Paths", to: number) => fireEvent.change(slider(panel, name), { target: { value: String(to) } });
/** The statement beside a slider as the strip shows it: its parts, without the full form kept for assistive technology. */
const shortStatement = (name: "activities" | "paths") =>
  Array.from(above().querySelectorAll(`.wf-controls__statement--${name} > span:not(.wf-sr-only)`))
    .map((part) => part.textContent)
    .join("");

describe("the detail controls above the canvas of the map", () => {
  async function renderBusyMap() {
    const supplied = busyGraph();
    render(<MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} />);
    const map = await screen.findByLabelText("Process map of the kept incidents");
    const inside = () => within(map).getByRole("form", { name: "Detail" });
    /** How many activities the map draws. */
    const nodesDrawn = () => map.querySelectorAll(".react-flow__node-activity").length;
    await waitFor(() => expect(nodesDrawn()).toBe(BUSY_ACTIVITIES));
    return { supplied, map, inside, nodesDrawn };
  }

  it("say what the map library's own panel says, at the detail the map opens on and wherever a slider is moved", async () => {
    const { map, inside, nodesDrawn } = await renderBusyMap();
    // Outside the canvas: the strip is no part of the map.
    expect(map.contains(above())).toBe(false);

    // The map opens on its 18 paths with the most incidents; the library keeps 13 more so that every activity lies on a way.
    expect(shortStatement("activities")).toBe("12 of 12 · 100.0 % of events");
    expect(shortStatement("paths")).toBe("36 of 47 · 13 kept · strongest not shown: 14");
    expect(slider(above(), "Paths").value).toBe("18");
    expect(said(above())).toEqual(said(inside()));

    // The Activities slider stands on ranks: the fifth and the sixth activity are a tie and enter together.
    move(above(), "Activities", 5);
    await waitFor(() => expect(nodesDrawn()).toBe(6));
    expect(slider(above(), "Activities").value).toBe("6");
    expect(shortStatement("activities")).toBe("6 of 12 · 73.9 % of events");
    expect(said(above())).toEqual(said(inside()));

    move(above(), "Paths", 30);
    await waitFor(() => expect(slider(inside(), "Paths").value).toBe("30"));
    expect(said(above())).toEqual(said(inside()));

    // The paths share has a floor, as many paths as the map has activities: both panels stand on it.
    move(above(), "Paths", 3);
    await waitFor(() => expect(slider(inside(), "Paths").value).toBe("12"));
    expect(slider(above(), "Paths").value).toBe("12");
    expect(said(above())).toEqual(said(inside()));

    // A slider of the library's own panel moves the same detail.
    move(inside(), "Activities", 12);
    await waitFor(() => expect(nodesDrawn()).toBe(BUSY_ACTIVITIES));
    move(inside(), "Paths", 42);
    await waitFor(() => expect(shortStatement("paths")).toBe("49 of 49"));
    expect(said(above())).toEqual(said(inside()));
  });

  it("say the same with an activity selected, with its paths in and out focused, and in the table view", async () => {
    const { map, inside } = await renderBusyMap();
    const opening = said(above());
    const third = map.querySelector<HTMLElement>(`[data-id="${busyIds.activity(2)}"]`)!;

    fireEvent.click(third);
    expect(screen.getByRole("heading", { name: `Activity “${stepName(2)}”` })).toBeTruthy();
    expect(said(above())).toEqual(said(inside()));
    expect(said(above())).toEqual(opening);

    fireEvent.contextMenu(third);
    // The entry of the library's menu, named with its key.
    fireEvent.click(screen.getByRole("menuitem", { name: /^Paths in and out/ }));
    await waitFor(() => expect(map.getAttribute("data-focus")).toBe(busyIds.activity(2)));
    expect(said(above())).toEqual(said(inside()));
    expect(said(above())).toEqual(opening);

    // The switch of the strip shows the map library's table; its own panel stands above the table there.
    fireEvent.click(within(above()).getByRole("button", { name: "Table view" }));
    await waitFor(() => expect(map.getAttribute("data-renderer")).toBe("table"));
    expect(said(above()).switches).toEqual([["Map view", "true"]]);
    expect(said(above())).toEqual(said(inside()));
    // The table lists the whole graph: the line saying how much of the map is in view is the map's alone.
    expect({ ...said(above()), switches: opening.switches }).toEqual({ ...opening, furtherLines: opening.furtherLines.filter((line) => !line.endsWith(" in view")) });

    move(above(), "Activities", 3);
    await waitFor(() => expect(slider(inside(), "Activities").value).toBe("3"));
    expect(said(above())).toEqual(said(inside()));

    fireEvent.click(within(above()).getByRole("button", { name: "Map view" }));
    await waitFor(() => expect(map.getAttribute("data-renderer")).toBe("svg"));
    expect(said(above())).toEqual(said(inside()));
  });

  it("count the activities and the paths the map draws, and its table view lists those paths", async () => {
    const { supplied, map, nodesDrawn } = await renderBusyMap();
    const described = () => document.getElementById(map.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
    const counts = (name: "activities" | "paths") => shortStatement(name).split(" · ")[0];

    // What the map library says of the graph it draws, to assistive technology.
    expect(described()).toContain(`Detail: ${counts("activities")} activities and ${counts("paths")} paths shown.`);
    move(above(), "Activities", 5);
    await waitFor(() => expect(nodesDrawn()).toBe(6));
    expect(counts("activities")).toBe("6 of 12");
    expect(described()).toContain(`Detail: ${counts("activities")} activities and ${counts("paths")} paths shown.`);

    // The graph `mapDetail` gives for this detail has the paths the library's table of the map lists, one row each.
    const detail = { ...openingDetail(supplied.nodes.length, supplied.edges.length), activityDetail: 6 / 12 };
    const reckoned = mapDetail(toFlowGraph(supplied, leastFlowIncidents(supplied, detail)), rankedDetail(detail)!).drawn;
    const names = new Map(reckoned.nodes.map((node) => [node.id, node.label]));
    fireEvent.click(within(above()).getByRole("button", { name: "Table view" }));
    const paths = await within(map).findByRole("table", { name: "Paths of the process map with their metrics" });
    const listed = within(paths)
      .getAllByRole("row")
      .slice(1)
      .map((row) => Array.from(row.children).slice(0, 2).map((cell) => cell.textContent));
    expect(listed).toEqual(reckoned.edges.map((edge) => [names.get(edge.source), names.get(edge.target)]));
    expect(reckoned.nodes.filter((node) => node.kind === "activity")).toHaveLength(6);
    // One of them is no recorded path: the library's dashed line for a way through activities it does not draw.
    expect(listed.length).toBe(Number(counts("paths").split(" of ")[0]) + 1);
    expect(above().querySelector(".wf-controls__statement--paths")?.getAttribute("title")).toContain("1 dashed path stands for a way through activities not shown.");
  });

  it("show the kept paths' part as text, where the library's panel has a button that marks them on its own map", async () => {
    const { inside } = await renderBusyMap();
    expect(within(inside()).getByRole("button", { name: "13 kept" })).toBeTruthy();
    expect(within(above()).queryByRole("button", { name: "13 kept" })).toBeNull();
    expect(within(above()).getAllByRole("button").map((button) => button.textContent)).toEqual(["Table view"]);
  });

  it("say the same for a graph with stages, shown as activities and collapsed", async () => {
    function Staged() {
      const graph = useMemo(stagedGraph, []);
      const [detail, setDetail] = useState<AbstractOptions>({});
      const [view, setView] = useState<"map" | "table">("map");
      // What the map's view shows of it, as the map view passes it from the map to the strip.
      const [inView, setInView] = useState<InView>();
      return (
        <>
          <DetailStrip detail={detail} shown={mapDetail(graph, detail)} onChange={setDetail} view={view} onViewChange={setView} inView={view === "table" ? undefined : inView} />
          <ProcessMap graph={graph} abstraction={detail} onAbstractionChange={setDetail} view={view} onViewChange={setView} onInView={setInView} locale="en" ariaLabel="Staged map" />
        </>
      );
    }
    render(<Staged />);
    const map = await screen.findByLabelText("Staged map");
    const inside = () => within(map).getByRole("form", { name: "Detail" });
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(4));
    expect(said(above()).switches).toEqual([
      ["Show stages", "false"],
      ["Table view", "false"],
    ]);
    expect(said(above())).toEqual(said(inside()));

    fireEvent.click(within(above()).getByRole("button", { name: "Show stages" }));
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-stage").length).toBe(2));
    expect(shortStatement("activities")).toBe("2 of 2 · 100.0 % of events");
    expect(said(above()).switches[0]).toEqual(["Show activities", "true"]);
    expect(said(above())).toEqual(said(inside()));

    // One stage collapsed and the other shown as its activities, each slider below its end.
    fireEvent.click(within(inside()).getByRole("button", { name: "Show activities" }));
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(4));
    fireEvent.contextMenu(map.querySelector<HTMLElement>(".react-flow__node-wfGroup")!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Collapse the stage/ }));
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-stage").length).toBe(1));
    expect(shortStatement("activities")).toBe("3 of 3 · 100.0 % of events");
    expect(said(above())).toEqual(said(inside()));
    move(above(), "Paths", 1);
    await waitFor(() => expect(slider(inside(), "Paths").value).toBe("1"));
    expect(said(above())).toEqual(said(inside()));
    move(above(), "Activities", 1);
    await waitFor(() => expect(slider(inside(), "Activities").value).toBe("1"));
    expect(said(above())).toEqual(said(inside()));
  });
});
