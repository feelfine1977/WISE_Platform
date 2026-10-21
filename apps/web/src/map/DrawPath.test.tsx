import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapView } from "./MapView";
import { BUSY_ACTIVITIES, busyGraph, shownWhole } from "./testGraphs";

vi.setConfig({ testTimeout: 20_000 });

class StillObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StillObserver;

const list = () => screen.getByRole("table", { name: "Paths of the kept cases" });

/** The paths the map library lists in the table view of its map: what it draws, without its dashed lines. */
async function drawnByTheMap() {
  const map = await screen.findByLabelText("Process map of the kept cases");
  const paths = await within(map).findByRole("table", { name: "Paths of the process map with their metrics" });
  return within(paths)
    .getAllByRole("row")
    .slice(1)
    .filter((row) => !row.lastElementChild?.textContent?.includes("indirect"))
    .map((row) => Array.from(row.children).slice(0, 2).map((cell) => cell.textContent).join(" → "));
}

describe("#55 a path of the list drawn on the map", () => {
  it("draws a path the detail leaves out, selected, without a step, and draws by the detail again on request", async () => {
    const supplied = busyGraph();
    const onStep = vi.fn();
    const onShowMap = vi.fn();
    const view = (showing: "map" | "paths") => <MapView shown={shownWhole(supplied)} parentGraph={supplied} onStep={onStep} showing={showing} onShowMap={onShowMap} />;
    const { rerender } = render(view("map"));
    const map = await screen.findByLabelText("Process map of the kept cases");
    await waitFor(() => expect(map.querySelectorAll(".react-flow__node-activity").length).toBe(BUSY_ACTIVITIES));
    fireEvent.click(within(screen.getByRole("form", { name: "Detail" })).getByRole("button", { name: "Table view" }));
    const opening = await drawnByTheMap();

    rerender(view("paths"));
    // A path between two activities that the map does not draw at its detail.
    const hidden = within(list()).getAllByRole("row").slice(1).find((row) => row.lastElementChild?.textContent === "Not drawn" && !/^(Start|.* End)$/.test(row.children[0].textContent ?? "")
      && row.children[1].textContent !== "End" && row.children[0].textContent !== "Start")!;
    const name = Array.from(hidden.children).slice(0, 2).map((cell) => cell.textContent).join(" → ");
    fireEvent.click(within(hidden).getAllByRole("button")[0]);
    expect(screen.getByText(/^The detail leaves this path out; drawing it adds it with both its activities\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Draw on the map" }));
    expect(onShowMap).toHaveBeenCalledTimes(1);
    expect(onStep).not.toHaveBeenCalled();
    // In the list, the row is drawn now and stays selected.
    const row = within(list()).getAllByRole("row").find((candidate) => Array.from(candidate.children).slice(0, 2).map((cell) => cell.textContent).join(" → ") === name)!;
    expect(row.lastElementChild?.textContent).toBe("Drawn");
    expect(row.className).toBe("selected");
    expect(screen.getByText(/^1 path drawn on request beyond the detail\./)).toBeTruthy();

    rerender(view("map"));
    const drawn = await drawnByTheMap();
    expect(drawn).toContain(name);
    expect(drawn.filter((path) => !opening.includes(path))).toEqual([name]);
    fireEvent.click(screen.getByRole("button", { name: "Draw by the detail only" }));
    await waitFor(async () => expect((await drawnByTheMap()).sort()).toEqual([...opening].sort()));
  });
});
