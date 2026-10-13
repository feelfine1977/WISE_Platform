import type { FlowEdge, FlowGraph, FlowNode } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";

/** The id of the event every incident's flow begins at on the map. */
export const START_ID = "event:start";
/** The id of the event every incident's flow ends at on the map. */
export const END_ID = "event:end";

const START_FLOW = "flow:start:";
const END_FLOW = "flow:end:";

/** The id of the flow the map adds from Start to the activity with this node id. */
export const startFlowId = (activityId: string) => `${START_FLOW}${activityId}`;
/** The id of the flow the map adds from the activity with this node id to End. */
export const endFlowId = (activityId: string) => `${END_FLOW}${activityId}`;

/** The side and the activity node id an id of an added flow names; null for any other id. */
export function flowOf(id: string): { side: "start" | "end"; activityId: string } | null {
  if (id.startsWith(START_FLOW)) return { side: "start", activityId: id.slice(START_FLOW.length) };
  if (id.startsWith(END_FLOW)) return { side: "end", activityId: id.slice(END_FLOW.length) };
  return null;
}

/**
 * The supplied graph as the map library's graph, between a start and an end.
 *
 * Every node, path and coverage field of the contract's graph is passed on unchanged; each element
 * is spread into a plain object because the library reads its metrics and meta as open records,
 * which the contract's closed interfaces are not assignable to as they are.
 *
 * Two events are added, Start and End, with one flow from Start to every activity incidents begin
 * with and one from every activity incidents end with to End. Their counts are the supplied counts
 * of starts and ends of those activities; nothing is counted here. The map library always shows
 * events and their flows, whatever its detail is set to, places Start first and End last, and keeps
 * every shown activity on a way from one to the other.
 */
export function toFlowGraph(graph: SuppliedGraph): FlowGraph {
  const activities: FlowNode[] = graph.nodes.map((node) => ({ ...node, metrics: { ...node.metrics } }));
  const paths: FlowEdge[] = graph.edges.map((edge) => ({ ...edge, metrics: { ...edge.metrics } }));
  const begun = graph.nodes.filter((node) => node.metrics.starts > 0);
  const ended = graph.nodes.filter((node) => node.metrics.ends > 0);
  if (begun.length === 0 && ended.length === 0) return { nodes: activities, edges: paths, meta: { ...graph.meta } };
  const starts = begun.reduce((sum, node) => sum + node.metrics.starts, 0);
  const ends = ended.reduce((sum, node) => sum + node.metrics.ends, 0);
  return {
    nodes: [
      { id: START_ID, kind: "event", label: "Start", tags: ["start"], metrics: { cases: starts, count: starts } },
      ...activities,
      { id: END_ID, kind: "event", label: "End", tags: ["end"], metrics: { cases: ends, count: ends } },
    ],
    edges: [
      ...begun.map(
        (node): FlowEdge => ({ id: startFlowId(node.id), kind: "flow", source: START_ID, target: node.id, metrics: { count: node.metrics.starts, cases: node.metrics.starts } }),
      ),
      ...paths,
      ...ended.map(
        (node): FlowEdge => ({ id: endFlowId(node.id), kind: "flow", source: node.id, target: END_ID, metrics: { count: node.metrics.ends, cases: node.metrics.ends } }),
      ),
    ],
    meta: { ...graph.meta },
  };
}
