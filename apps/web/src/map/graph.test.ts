import { describe, expect, it } from "vitest";
import type { FlowGraph } from "wise-flow";
import { normalizeGraph, validateGraph } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { checked, closed, opened, suppliedGraph } from "../test/selections";
import { END_ID, endFlowId, flowCoverage, leastFlowIncidents, START_ID, startFlowId, toFlowGraph } from "./graph";

describe("the supplied graph as the map library's graph", () => {
  it("passes every node, path and coverage field on unchanged, between a start and an end", () => {
    const supplied: SuppliedGraph = suppliedGraph(["A-1", "B-2"]);
    const before = JSON.stringify(supplied);
    // Typed as the library's graph without a cast: the type checker accepts the adapter's result as it is.
    const flow: FlowGraph = toFlowGraph(supplied);
    const plain = JSON.parse(JSON.stringify(flow)) as FlowGraph;

    // What was supplied is all there, unchanged and in its order.
    expect(plain.nodes.filter((node) => node.kind === "activity")).toEqual(JSON.parse(before).nodes);
    expect(plain.edges.filter((edge) => edge.kind === "follows")).toEqual(JSON.parse(before).edges);
    expect(plain.meta).toEqual(JSON.parse(before).meta);
    expect(JSON.stringify(supplied)).toBe(before);
    expect(flow.meta?.cases).toBe(2);
    expect(validateGraph(flow)).toEqual([]);
    expect(normalizeGraph(flow).edges.filter((edge) => edge.kind === "follows").map((edge) => edge.id)).toEqual(supplied.edges.map((edge) => edge.id));

    // Added: Start first and End last, and one flow for every activity incidents begin or end with, with the supplied counts.
    expect(flow.nodes[0]).toMatchObject({ id: START_ID, kind: "event", label: "Start", tags: ["start"] });
    expect(flow.nodes[flow.nodes.length - 1]).toMatchObject({ id: END_ID, kind: "event", label: "End", tags: ["end"] });
    const begun = supplied.nodes.filter((node) => node.metrics.starts > 0);
    const ended = supplied.nodes.filter((node) => node.metrics.ends > 0);
    expect(begun.length).toBeGreaterThan(0);
    expect(ended.length).toBeGreaterThan(0);
    expect(flow.edges.filter((edge) => edge.source === START_ID).map((edge) => [edge.kind, edge.target, edge.metrics?.cases])).toEqual(
      begun.map((node) => ["flow", node.id, node.metrics.starts]),
    );
    expect(flow.edges.filter((edge) => edge.target === END_ID).map((edge) => [edge.kind, edge.source, edge.metrics?.cases])).toEqual(
      ended.map((node) => ["flow", node.id, node.metrics.ends]),
    );
    expect(flow.nodes[0].metrics?.cases).toBe(begun.reduce((sum, node) => sum + node.metrics.starts, 0));
  });

  it("passes the times of an activity on as they are supplied, and gives Start and End none", () => {
    const supplied = suppliedGraph(["A-1", "B-2"]);
    const flow = toFlowGraph(supplied);
    const metricsOf = (label: string) => flow.nodes.find((node) => node.label === label)?.metrics;
    expect(metricsOf(opened)).toStrictEqual({ count: 1, events: 1, cases: 1, starts: 1, ends: 0, usablePreviousCount: 0, medianNextHours: 25.5, usableNextCount: 1 });
    expect(metricsOf(closed)).toStrictEqual({ count: 1, events: 1, cases: 1, starts: 0, ends: 1, medianPreviousHours: 25.5, usablePreviousCount: 1, usableNextCount: 0 });
    // A time that is not supplied stays left out, so the map library reads it as not given rather than as a number.
    expect(metricsOf(checked)).toStrictEqual({ count: 1, events: 1, cases: 1, starts: 0, ends: 0, usablePreviousCount: 0, usableNextCount: 0 });
    expect(metricsOf("Start")).toStrictEqual({ cases: 1, count: 1 });
    expect(metricsOf("End")).toStrictEqual({ cases: 1, count: 1 });
  });

  /** A graph of activities that all begin and end incidents, with paths of the given numbers of incidents between neighbours. */
  const busy = (starts: number[], ends: number[], pathCases: number[]): SuppliedGraph => {
    const base = suppliedGraph(["A-1", "B-2"]);
    const id = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
    return {
      ...base,
      nodes: starts.map((count, index) => ({
        ...base.nodes[0],
        id: id(index),
        label: `Activity ${index}`,
        metrics: { ...base.nodes[0].metrics, starts: count, ends: ends[index] },
      })),
      edges: pathCases.map((cases, index) => ({
        ...base.edges[0],
        id: `path.v1:sha256:${String(index).padStart(64, "0")}`,
        source: id(index % starts.length),
        target: id((index + 1) % starts.length),
        // More passages than incidents on the first path: the flows follow the incidents, not the passages.
        metrics: { ...base.edges[0].metrics, count: index === 0 ? cases * 50 : cases, cases },
      })),
    };
  };

  it("draws the flows from Start and to End that carry at least as many incidents as the paths the detail asks for", () => {
    const supplied = busy([900, 40, 7, 0], [5, 300, 60, 2], [500, 80, 50, 6]);
    const flowsOf = (least: number) =>
      toFlowGraph(supplied, least)
        .edges.filter((edge) => edge.kind === "flow")
        .map((edge) => edge.id);
    const [a, b, c, d] = supplied.nodes.map((node) => node.id);

    // Every path shown, or no detail set: every flow.
    expect(leastFlowIncidents(supplied, undefined)).toBe(0);
    expect(leastFlowIncidents(supplied, 1)).toBe(0);
    expect(flowsOf(0)).toEqual([startFlowId(a), startFlowId(b), startFlowId(c), endFlowId(a), endFlowId(b), endFlowId(c), endFlowId(d)]);
    expect(flowCoverage(supplied, 0)).toEqual({ flows: 7, drawn: 7 });

    // Half of the four paths: the second place by incidents carries 80, whatever its passages are.
    expect(leastFlowIncidents(supplied, 0.5)).toBe(80);
    expect(flowsOf(80)).toEqual([startFlowId(a), endFlowId(b)]);
    expect(flowCoverage(supplied, 80)).toEqual({ flows: 7, drawn: 2 });
    // Three of four: 50 incidents.
    expect(leastFlowIncidents(supplied, 0.75)).toBe(50);
    expect(flowsOf(50)).toEqual([startFlowId(a), endFlowId(b), endFlowId(c)]);
    // No path asked for: Start and End keep their strongest flow.
    expect(leastFlowIncidents(supplied, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(flowsOf(Number.POSITIVE_INFINITY)).toEqual([startFlowId(a), endFlowId(b)]);
    expect(leastFlowIncidents({ ...supplied, edges: [] }, 0.2)).toBe(0);

    // Start and End say every start and end, whichever flows are drawn, and what is supplied is not changed.
    const before = JSON.stringify(supplied);
    const thinned = toFlowGraph(supplied, 80);
    expect(thinned.nodes[0].metrics).toStrictEqual({ cases: 947, count: 947 });
    expect(thinned.nodes[thinned.nodes.length - 1].metrics).toStrictEqual({ cases: 367, count: 367 });
    expect(thinned.nodes.filter((node) => node.kind === "activity")).toHaveLength(4);
    expect(thinned.edges.filter((edge) => edge.kind === "follows")).toHaveLength(4);
    expect(JSON.stringify(supplied)).toBe(before);
  });

  it("is needed: the contract's closed metrics are not the library's open records as they are", () => {
    const supplied = suppliedGraph(["A-1"]);
    // @ts-expect-error The generated node metrics are an interface without an index signature.
    const direct: FlowGraph = supplied;
    expect(direct).toBe(supplied);
  });
});
