import type { FlowGraph } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";

/**
 * The supplied graph as the map library's graph. The contract's graph is the library's format:
 * every node, path and coverage field is passed on unchanged, and nothing is added, dropped or
 * computed. Each element is spread into a plain object because the library reads its metrics and
 * meta as open records, which the contract's closed interfaces are not assignable to as they are.
 */
export function toFlowGraph(graph: SuppliedGraph): FlowGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, metrics: { ...node.metrics } })),
    edges: graph.edges.map((edge) => ({ ...edge, metrics: { ...edge.metrics } })),
    meta: { ...graph.meta },
  };
}
