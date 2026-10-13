import { describe, expect, it } from "vitest";
import type { FlowGraph } from "wise-flow";
import { normalizeGraph, validateGraph } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { suppliedGraph } from "../test/selections";
import { toFlowGraph } from "./graph";

describe("the supplied graph as the map library's graph", () => {
  it("passes every node, path and coverage field on unchanged", () => {
    const supplied: SuppliedGraph = suppliedGraph(["A-1", "B-2"]);
    const before = JSON.stringify(supplied);
    // Typed as the library's graph without a cast: the type checker accepts the adapter's result as it is.
    const flow: FlowGraph = toFlowGraph(supplied);

    expect(JSON.parse(JSON.stringify(flow))).toEqual(JSON.parse(before));
    expect(JSON.stringify(supplied)).toBe(before);
    expect(flow.nodes[0].metrics).not.toBe(supplied.nodes[0].metrics);
    expect(flow.meta?.cases).toBe(2);
    expect(validateGraph(flow)).toEqual([]);
    expect(normalizeGraph(flow).edges.map((edge) => edge.id)).toEqual(supplied.edges.map((edge) => edge.id));
  });

  it("is needed: the contract's closed metrics are not the library's open records as they are", () => {
    const supplied = suppliedGraph(["A-1"]);
    // @ts-expect-error The generated node metrics are an interface without an index signature.
    const direct: FlowGraph = supplied;
    expect(direct).toBe(supplied);
  });
});
