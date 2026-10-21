import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SuppliedGraph } from "../generated/selection";
import { closed, nodeIds, opened, suppliedGraph } from "../test/selections";
import { activityNotes, duration, pathsOf } from "./activityTimes";
import { ActivityTimesCard, PATHS_SHOWN } from "./ActivityTimesCard";

/** The graph of A-1 with seven more paths out of "Eröffnet", to activities named T0 to T6, the later the stronger. */
function withPathsOut(): SuppliedGraph {
  const graph = suppliedGraph(["A-1"]);
  const [path] = graph.edges;
  const nodes = [...graph.nodes, ...Array.from({ length: 7 }, (_, place) => ({ ...graph.nodes[0], id: `t${place}`, label: `T${place}` }))];
  const edges = [
    ...graph.edges,
    ...Array.from({ length: 7 }, (_, place) => ({
      ...path,
      id: `out-${place}`,
      target: `t${place}`,
      metrics: { ...path.metrics, count: place + 2, medianLagHours: place, usableLagCount: place === 0 ? 0 : 1 },
      payload: { ...path.payload, bridged_passage_count: place === 6 ? 2 : 0 },
    })),
  ];
  return { ...graph, nodes, edges };
}

describe("the times of a selected activity", () => {
  it("are written in the map library's format, and a time above zero that rounds to none is said to be there", () => {
    expect(duration(2.71)).toBe("2.7 h");
    expect(duration(80)).toBe("3.3 d");
    expect(duration(0)).toBe("0 min");
    expect(duration(0.004)).toBe("< 1 min");
  });

  it("list the paths into and out of the activity, the strongest first, with no lag where none is usable", () => {
    const { into, out } = pathsOf(withPathsOut(), nodeIds[opened]);
    expect(into).toEqual([]);
    expect(out.map((path) => path.other)).toEqual(["T6", "T5", "T4", "T3", "T2", "T1", "T0", closed]);
    expect(out.find((path) => path.other === "T0")?.lag).toBeNull();
  });

  it("show five paths each, then the rest on request, and select a path on the map when it is chosen", async () => {
    const onSelectPath = vi.fn();
    const user = userEvent.setup();
    render(<ActivityTimesCard graph={withPathsOut()} nodeId={nodeIds[opened]} onSelectPath={onSelectPath} />);
    const out = () => screen.getByRole("region", { name: `Paths out of ${opened}` });
    expect(out().querySelectorAll(".activity-path")).toHaveLength(PATHS_SHOWN);
    await user.click(screen.getByRole("button", { name: "3 more" }));
    expect(out().querySelectorAll(".activity-path")).toHaveLength(8);
    await user.click(screen.getByRole("button", { name: /^To T6:/ }));
    expect(onSelectPath).toHaveBeenCalledWith("out-6");
  });

  it("say only the notes that apply: the wall clock, bridged records, repeats and cases left out", () => {
    const plain = suppliedGraph(["A-1"]);
    expect(activityNotes(plain, nodeIds[opened])).toEqual([]);
    const bridged = withPathsOut();
    expect(activityNotes(bridged, nodeIds[opened])).toEqual(["2 passages of these paths pass over records without activity label; they join the labelled records around them."]);
    const node = plain.nodes.find((item) => item.id === nodeIds[opened])!;
    const busy: SuppliedGraph = {
      ...plain,
      nodes: plain.nodes.map((item) => (item === node ? { ...item, metrics: { ...item.metrics, count: 3, cases: 1 } } : item)),
      meta: { ...plain.meta, timestamp_kind: "wall_clock", lag_clock: "recorded_wall_clock_hours", clock_limitation: "Local times without a zone.", sequence_unevaluable_case_count: 2 },
    };
    expect(activityNotes(busy, nodeIds[opened])).toEqual([
      "Hours of the recorded wall clock. Local times without a zone.",
      "Some cases have this activity more than once (3 records in 1 case); each record counts.",
      "2 cases whose order of records is not known are not in these times.",
    ]);
  });
});

describe("the mean beside each median (#74)", () => {
  it("writes the supplied mean of both times and of each path's lag, over the same passages as the median", () => {
    const graph = suppliedGraph(["A-1"]);
    render(<ActivityTimesCard graph={graph} nodeId={nodeIds[opened]} onSelectPath={vi.fn()} />);
    expect(Array.from(document.querySelectorAll(".activity-times-rows > div"), (row) => row.textContent)).toEqual([
      "From previousNot available: no labelled record comes before it in a case whose order is known.",
      "To nextmedian 26 h · mean 26 h · 1 passage of 1 record",
    ]);
    expect(screen.getByRole("button", { name: /^To Geschlossen: 1 passages, median lag 26 h, mean lag 26 h\./ })).toBeTruthy();
  });

  it("still reads a graph without means, and says the mean is not available", () => {
    const graph = suppliedGraph(["A-1"]);
    const withoutMeans: SuppliedGraph = {
      ...graph,
      nodes: graph.nodes.map(({ metrics: { meanPreviousHours: _previous, meanNextHours: _next, ...metrics }, ...node }) => ({ ...node, metrics })),
      edges: graph.edges.map(({ metrics: { meanLagHours: _lag, ...metrics }, ...edge }) => ({ ...edge, metrics })),
    };
    render(<ActivityTimesCard graph={withoutMeans} nodeId={nodeIds[opened]} onSelectPath={vi.fn()} />);
    expect(document.querySelectorAll(".activity-times-rows > div")[1].textContent).toBe("To nextmedian 26 h · mean not available from this service · 1 passage of 1 record");
    expect(screen.getByRole("button", { name: /mean lag not available\./ })).toBeTruthy();
    expect(pathsOf(withoutMeans, nodeIds[opened]).out[0].meanLag).toBeNull();
  });
});
