import { abstract, type AbstractOptions, type FlowEdge, type FlowGraph, type FlowNode, type ShownMeta } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import type { StageDefinitions } from "../stages/definitions";

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

/** The drawing library accepts numeric metrics; exact coordinates remain in the supplied graph. */
function drawnPath(edge: SuppliedGraph["edges"][number]): FlowEdge {
  const { totalLagMicroseconds: _exact, shareOfTotalLag, ...numeric } = edge.metrics;
  return { ...edge, metrics: { ...numeric, ...(shareOfTotalLag === null ? {} : { shareOfTotalLag }) } };
}

/**
 * The activities whose flow on this side is handed to the map: at least `least` incidents, always
 * the strongest of all, and always the strongest among the activities the detail shows (the first
 * of equals each time). The map library drops a flow whose activity it does not show; the strongest
 * of all is handed over all the same, because the library follows it to keep the shown activities
 * on a way from Start to End.
 */
function drawnFlows(nodes: SuppliedNode[], side: Side, least: number, shown?: ReadonlySet<string>): SuppliedNode[] {
  const strongestOf = (among: SuppliedNode[]) =>
    among.reduce<SuppliedNode | null>((best, node) => (best === null || node.metrics[side] > best.metrics[side] ? node : best), null);
  const strongest = strongestOf(nodes);
  const strongestShown = shown ? strongestOf(nodes.filter((node) => shown.has(node.id))) : strongest;
  return nodes.filter((node) => node === strongest || node === strongestShown || node.metrics[side] >= least);
}

/** The supplied activities and paths as the map library's graph, without Start, End and their flows. */
function observed(graph: SuppliedGraph): FlowGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, metrics: { ...node.metrics } })),
    edges: graph.edges.map(drawnPath),
    meta: { ...graph.meta },
  };
}

/** What the map ranks its paths by when its detail reduces them: the incidents on a path, the number it also writes on it. */
export const PATH_RANK = "cases";

/** The detail as the map library is given it: the paths ranked by their incidents instead of by their passages. */
export function rankedDetail(detail: AbstractOptions | undefined): AbstractOptions | undefined {
  return detail === undefined ? undefined : { ...detail, edgeMetric: PATH_RANK };
}

/**
 * The incidents a flow from Start or to End has to carry to be drawn at this detail: as many as the
 * weakest path the map library draws by frequency. The number is the library's own, taken from the
 * same reduction of the same paths with the same rank, so the flows and the paths cannot disagree.
 * Zero, so that every flow is drawn, when every path is shown or there is none; without any path
 * drawn by frequency only the strongest flow of each side is left.
 */
export function leastFlowIncidents(graph: SuppliedGraph, detail: AbstractOptions | undefined): number {
  if (detail === undefined || (detail.pathDetail ?? 1) >= 1 || graph.edges.length === 0) return 0;
  const shown = abstract(observed(graph), rankedDetail(detail)).meta?.shown as ShownMeta | undefined;
  return shown?.weakestByFrequency ?? Number.POSITIVE_INFINITY;
}

/**
 * The activities the map library shows at this detail, by the library's own reduction of the same
 * graph; undefined while it shows every activity. A flow of an activity that is not shown is not on
 * the map, whatever it carries.
 */
export function shownActivities(graph: SuppliedGraph, detail: AbstractOptions | undefined): ReadonlySet<string> | undefined {
  if (detail === undefined || (detail.activityDetail ?? 1) >= 1) return undefined;
  return new Set(abstract(observed(graph), rankedDetail(detail)).nodes.map((node) => node.id));
}

/** The flows from Start and to End of a supplied graph: all of them, those the map draws, and those of activities it does not show. */
export interface FlowCoverage {
  flows: number;
  drawn: number;
  /** Of the flows not drawn, those whose activity the detail does not show; the others carry too few incidents. */
  unshown: number;
}

/**
 * How many flows from Start and to End the supplied graph has, how many of them the map draws at
 * this least number of incidents and with these activities shown, and how many it does not draw
 * because their activity is not shown.
 */
export function flowCoverage(graph: SuppliedGraph, least: number, shown?: ReadonlySet<string>): FlowCoverage {
  const begun = graph.nodes.filter((node) => node.metrics.starts > 0);
  const ended = graph.nodes.filter((node) => node.metrics.ends > 0);
  const visible = (nodes: SuppliedNode[]) => nodes.filter((node) => shown === undefined || shown.has(node.id));
  return {
    flows: begun.length + ended.length,
    drawn: visible(drawnFlows(begun, "starts", least, shown)).length + visible(drawnFlows(ended, "ends", least, shown)).length,
    unshown: begun.length - visible(begun).length + ended.length - visible(ended).length,
  };
}

/**
 * The supplied graph as the map library's graph, between a start and an end.
 *
 * Nodes, path identity/support and coverage are passed on unchanged. Drawing metrics carry
 * numbers only: exact integer-string coordinates and undefined shares stay in the supplied
 * graph for its list consumer. Closed contract objects become the library's open records.
 *
 * Two events are added, Start and End, with a flow from Start to an activity incidents begin with
 * and from an activity incidents end with to End. Their counts are the supplied counts of starts
 * and ends of those activities; nothing is counted here. Start and End say the supplied totals of
 * every start and end, whichever flows are drawn.
 *
 * The map library always shows events and every flow it is given, whatever its detail is set to,
 * places Start first and End last, and keeps every shown activity on a way from one to the other.
 * So which flows are drawn is decided here: those that carry at least `least` incidents, and on
 * each side always the strongest one, of all activities and of those the detail shows (`shown`;
 * left out, every activity is shown). With the defaults every flow is drawn.
 *
 * Given the stages of the log, the activities are put into them (see `inStages`).
 */
export function toFlowGraph(graph: SuppliedGraph, least = 0, shown?: ReadonlySet<string>, stages?: StageDefinitions): FlowGraph {
  const activities: FlowNode[] = graph.nodes.map((node) => ({ ...node, metrics: { ...node.metrics } }));
  const paths: FlowEdge[] = graph.edges.map(drawnPath);
  const everyBegun = graph.nodes.filter((node) => node.metrics.starts > 0);
  const everyEnded = graph.nodes.filter((node) => node.metrics.ends > 0);
  if (everyBegun.length === 0 && everyEnded.length === 0) return inStages({ nodes: activities, edges: paths, meta: { ...graph.meta } }, stages);
  const starts = everyBegun.reduce((sum, node) => sum + node.metrics.starts, 0);
  const ends = everyEnded.reduce((sum, node) => sum + node.metrics.ends, 0);
  const begun = drawnFlows(everyBegun, "starts", least, shown);
  const ended = drawnFlows(everyEnded, "ends", least, shown);
  return inStages({
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
  }, stages);
}

/**
 * A graph of the map with its activities in the stages defined for the log, declared as the map
 * library reads them: a group of the kind "stage" for every stage that has an activity here, in
 * the order of the stages, and on each such activity the id of its group. The library then draws
 * a box around the activities of a stage, lays the stages out one after the other in their order,
 * marks every activity with the colour it gives its stage, and offers to show a stage as one node.
 *
 * Only activities are put into stages, by their names: Start and End stay outside every stage. A
 * stage without an activity here is left out, since the library would draw it as an empty node
 * once the stages are shown as nodes. Without a stage that has an activity here the graph is
 * given back as it is.
 *
 * Where the stages come from is not asked here: they are the analyst's own for now, and stages
 * supplied with a log would be put on the map the same way.
 */
export function inStages(flow: FlowGraph, stages: StageDefinitions | undefined): FlowGraph {
  if (stages === undefined || stages.stages.length === 0) return flow;
  const defined = new Set(stages.stages.map((stage) => stage.id));
  const used = new Set<string>();
  const nodes = flow.nodes.map((node) => {
    const stage = node.kind === "activity" ? stages.assigned.get(node.label) : undefined;
    if (stage === undefined || !defined.has(stage)) return node;
    used.add(stage);
    return { ...node, group: stage };
  });
  if (used.size === 0) return flow;
  const groups = stages.stages.filter((stage) => used.has(stage.id)).map((stage) => ({ id: stage.id, kind: "stage" as const, label: stage.name }));
  return { ...flow, nodes, groups };
}

/**
 * Whether the detail has the map library show a stage as one node. Such a node takes over the
 * flows of its activities and adds up their counts, so no flow of them may be left out then.
 */
export function showsStageNodes(detail: AbstractOptions | undefined): boolean {
  const shown = detail?.collapse;
  return shown === "all" || (Array.isArray(shown) && shown.length > 0);
}

/**
 * The ids of every stage of the log in their order. The map library colours the stages by this
 * list, so that a stage keeps its colour whichever stages have an activity on a map.
 */
export function stageOrder(stages: StageDefinitions): string[] {
  return stages.stages.map((stage) => stage.id);
}
