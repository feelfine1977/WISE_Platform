import { describe, expect, it } from "vitest";
import type { FlowGraph } from "wise-flow";
import { normalizeGraph, validateGraph } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { checked, closed, opened, suppliedGraph } from "../test/selections";
import { END_ID, START_ID, toFlowGraph } from "./graph";

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

  it("is needed: the contract's closed metrics are not the library's open records as they are", () => {
    const supplied = suppliedGraph(["A-1"]);
    // @ts-expect-error The generated node metrics are an interface without an index signature.
    const direct: FlowGraph = supplied;
    expect(direct).toBe(supplied);
  });
});
