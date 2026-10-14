import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SuppliedGraph } from "../generated/selection";
import { emptySelection } from "wise-flow/react";
import { describe, expect, it } from "vitest";
import { suppliedGraph } from "../test/selections";
import { toFlowGraph } from "./graph";
import { PathsTable } from "./PathsTable";

/** The graph of A-1, its one path with a supplied total lag of two days, and the supplied totals of all paths. */
function withTotals(): SuppliedGraph {
  const graph = suppliedGraph(["A-1"]);
  const [path] = graph.edges;
  const totals: SuppliedGraph["meta"]["path_lag_totals"] = {
    total_hours: 48,
    total_microseconds: "172800000000",
    usable_passage_count: 1,
    usable_path_count: 1,
    top_five_path_ids: [path.id],
    top_five_total_hours: 48,
    top_five_total_microseconds: "172800000000",
    top_five_share: 1,
  };
  return {
    ...graph,
    meta: { ...graph.meta, path_lag_totals: totals },
    edges: [{ ...path, metrics: { ...path.metrics, totalLagHours: 48, totalLagMicroseconds: "172800000000", shareOfTotalLag: 1 } }],
  };
}

describe("the total lag in the list of paths", () => {
  it("shows the supplied total in days with its share, and says what the first paths carry only in the order by total", () => {
    const graph = withTotals();
    render(<PathsTable graph={graph} drawn={toFlowGraph(graph)} selection={emptySelection} onSelect={() => undefined} />);
    const line = "The first path carries 100% of the total lag of all paths (2.0 of 2.0 days).";
    expect(screen.getByText(line)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Paths of the kept incidents" });
    const pathRow = within(table).getAllByRole("row").find((row) => row.textContent?.includes("2.0"))!;
    expect(pathRow.textContent).toContain("2.0 100%");
    // In another order the first rows are not the largest totals: the line is not said.
    fireEvent.click(within(table).getByRole("button", { name: "Incidents: sort the list" }));
    expect(screen.queryByText(line)).toBeNull();
  });
});
