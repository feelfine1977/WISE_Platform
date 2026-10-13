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

type Side = "starts" | "ends";
type SuppliedNode = SuppliedGraph["nodes"][number];

/** The activities whose flow on this side is drawn: at least `least` incidents, and always the strongest (the first of equals). */
function drawnFlows(nodes: SuppliedNode[], side: Side, least: number): SuppliedNode[] {
  const strongest = nodes.reduce<SuppliedNode | null>((best, node) => (best === null || node.metrics[side] > best.metrics[side] ? node : best), null);
  return nodes.filter((node) => node === strongest || node.metrics[side] >= least);
}

/**
 * The incidents a flow from Start or to End has to carry to be drawn while the map shows this share
 * of its paths: as many as the path in the last place that share reaches, with the paths ranked by
 * their incidents. Zero, so that every flow is drawn, when every path is shown or there is none.
 * The flows follow the paths this way: fewer paths, fewer flows, and never a flow weaker than every
 * path beside it.
 */
export function leastFlowIncidents(graph: SuppliedGraph, pathDetail: number | undefined): number {
  if (pathDetail === undefined || pathDetail >= 1 || graph.edges.length === 0) return 0;
  const places = Math.ceil(Math.max(0, pathDetail) * graph.edges.length - 1e-9);
  if (places < 1) return Number.POSITIVE_INFINITY;
  return graph.edges.map((edge) => edge.metrics.cases).sort((a, b) => b - a)[places - 1];
}

/** How many flows from Start and to End the supplied graph has, and how many of them are drawn at this least number of incidents. */
export function flowCoverage(graph: SuppliedGraph, least: number): { flows: number; drawn: number } {
  const begun = graph.nodes.filter((node) => node.metrics.starts > 0);
  const ended = graph.nodes.filter((node) => node.metrics.ends > 0);
  return { flows: begun.length + ended.length, drawn: drawnFlows(begun, "starts", least).length + drawnFlows(ended, "ends", least).length };
}

/**
 * The supplied graph as the map library's graph, between a start and an end.
 *
 * Every node, path and coverage field of the contract's graph is passed on unchanged; each element
 * is spread into a plain object because the library reads its metrics and meta as open records,
 * which the contract's closed interfaces are not assignable to as they are.
 *
 * Two events are added, Start and End, with a flow from Start to an activity incidents begin with
 * and from an activity incidents end with to End. Their counts are the supplied counts of starts
 * and ends of those activities; nothing is counted here. Start and End say the supplied totals of
 * every start and end, whichever flows are drawn.
 *
 * The map library always shows events and every flow it is given, whatever its detail is set to,
 * places Start first and End last, and keeps every shown activity on a way from one to the other.
 * So which flows are drawn is decided here: those that carry at least `least` incidents, and on
 * each side always the strongest one. With the default every flow is drawn.
 */
export function toFlowGraph(graph: SuppliedGraph, least = 0): FlowGraph {
  const activities: FlowNode[] = graph.nodes.map((node) => ({ ...node, metrics: { ...node.metrics } }));
  const paths: FlowEdge[] = graph.edges.map((edge) => ({ ...edge, metrics: { ...edge.metrics } }));
  const everyBegun = graph.nodes.filter((node) => node.metrics.starts > 0);
  const everyEnded = graph.nodes.filter((node) => node.metrics.ends > 0);
  if (everyBegun.length === 0 && everyEnded.length === 0) return { nodes: activities, edges: paths, meta: { ...graph.meta } };
  const starts = everyBegun.reduce((sum, node) => sum + node.metrics.starts, 0);
  const ends = everyEnded.reduce((sum, node) => sum + node.metrics.ends, 0);
  const begun = drawnFlows(everyBegun, "starts", least);
  const ended = drawnFlows(everyEnded, "ends", least);
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
