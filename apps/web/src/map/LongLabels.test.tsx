import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SuppliedGraph } from "../generated/selection";
import { closed, suppliedGraph } from "../test/selections";
import { MapView } from "./MapView";
import { shownWhole } from "./testGraphs";

vi.setConfig({ testTimeout: 20_000 });

class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

const LONG = `Closed after the second-line review confirmed the workaround with the reporter ${"and the change board ".repeat(4).trim()}`;

/** The graph of A-1 with the activity it ends at named by a long label everywhere the label is supplied. */
function longGraph(): SuppliedGraph {
  const graph = suppliedGraph(["A-1", "B-2"]);
  const rename = (label: string) => (label === closed ? LONG : label);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, label: rename(node.label) })),
    edges: graph.edges.map((edge) => ({ ...edge, payload: { ...edge.payload, source_activity: rename(edge.payload.source_activity), target_activity: rename(edge.payload.target_activity) } })),
  };
}

describe("#56 a long activity label in the parent's places", () => {
  it("is named in full on the map and in the list of every path, and its path is reached and selected by keyboard there", async () => {
    const supplied = longGraph();
    const view = (showing: "map" | "paths") => <MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={() => undefined} showing={showing} initiallyInPlace />;
    const { rerender } = render(view("map"));
    const map = await screen.findByLabelText("Process map of the kept incidents");
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(supplied.nodes.length));
    // The map names the activity in full for assistive technology, whatever its card shows.
    expect([...map.querySelectorAll("[aria-label]")].some((element) => element.getAttribute("aria-label")?.includes(LONG))).toBe(true);

    rerender(view("paths"));
    const list = screen.getByRole("table", { name: "Paths of the kept incidents" });
    const row = within(list).getAllByRole("row").find((candidate) => candidate.textContent?.includes(LONG) && !candidate.textContent.includes("End"))!;
    const control = within(row).getAllByRole("button")[0];
    control.focus();
    fireEvent.keyDown(control, { key: "Enter" });
    fireEvent.click(control);
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: new RegExp(LONG.slice(0, 40)) }).textContent).toContain(LONG);
  });
});
