import type { FlowGraph } from "wise-flow";
import type { GraphCoverage, PathMetrics, SuppliedGraph } from "../generated/selection";
import { flowTitle, pathTitle } from "./elementTitle";
import { endFlowId, startFlowId } from "./graph";

/**
 * One row of the list of every path: a supplied path between two activities, or a flow the map
 * adds from Start to an activity incidents begin with or from an activity they end with to End.
 * Every number is a supplied one; a flow has incidents only.
 */
export interface PathRow {
  /** The id the map knows the path or the flow by. */
  id: string;
  kind: "path" | "start" | "end";
  /** Where it leaves: the supplied label of an activity, or Start. */
  from: string;
  /** Where it arrives: the supplied label of an activity, or End. */
  to: string;
  /** Its name, as the heading over its steps says it. */
  title: string;
  incidents: number;
  passages?: number;
  medianLagHours?: number;
  /**
   * The supplied total lag of its usable passages: exact microseconds, by which the list orders, and
   * hours for display; absent where no passage is usable, and on a flow from Start or to End.
   */
  totalLag?: { exact: bigint; hours: number };
  /** Its supplied share of the total lag of all paths; null where the service has none. */
  shareOfTotalLag?: number | null;
  /** Whether the map draws it at its detail. */
  drawn: boolean;
}

/**
 * Every path of the supplied graph and every flow from Start and to End, in the order supplied:
 * the flows from Start, the paths, the flows to End. `drawn` is the graph the map draws at its
 * detail (`mapDetail`): a row is drawn when that graph holds its path or flow.
 */
/** The total lag the local service supplies on a path (#88); a reply without it is still read. */
type WithTotalLag = PathMetrics & { totalLagHours?: number; totalLagMicroseconds?: string; shareOfTotalLag?: number | null };

/** The supplied total lag of all paths and of the five with the largest, for the line over the list. */
export interface PathLagTotals {
  total_hours: number;
  total_microseconds: string;
  usable_passage_count: number;
  usable_path_count: number;
  top_five_path_ids: string[];
  top_five_total_hours: number;
  top_five_total_microseconds: string;
  top_five_share: number | null;
}

/** The supplied totals of a graph's paths, or nothing where the reply has none. */
export function lagTotalsOf(graph: SuppliedGraph): PathLagTotals | undefined {
  return (graph.meta as GraphCoverage & { path_lag_totals?: PathLagTotals }).path_lag_totals;
}

export function pathRows(graph: SuppliedGraph, drawn: FlowGraph): PathRow[] {
  const onTheMap = new Set(drawn.edges.map((edge) => edge.id));
  const flows = (side: "start" | "end"): PathRow[] =>
    graph.nodes.flatMap((node) => {
      const incidents = side === "start" ? node.metrics.starts : node.metrics.ends;
      if (!(incidents > 0)) return [];
      const id = side === "start" ? startFlowId(node.id) : endFlowId(node.id);
      const ends = side === "start" ? { from: "Start", to: node.label } : { from: node.label, to: "End" };
      return [{ id, kind: side, ...ends, title: flowTitle(side, node.label), incidents, drawn: onTheMap.has(id) }];
    });
  const paths = graph.edges.map((edge): PathRow => {
    const metrics: WithTotalLag = edge.metrics;
    return {
      id: edge.id,
      kind: "path",
      from: edge.payload.source_activity,
      to: edge.payload.target_activity,
      title: pathTitle(edge.payload.source_activity, edge.payload.target_activity),
      incidents: edge.metrics.cases,
      passages: edge.metrics.count,
      medianLagHours: edge.metrics.medianLagHours,
      ...(metrics.totalLagMicroseconds !== undefined && metrics.totalLagHours !== undefined
        ? { totalLag: { exact: BigInt(metrics.totalLagMicroseconds), hours: metrics.totalLagHours } }
        : {}),
      ...(metrics.shareOfTotalLag !== undefined ? { shareOfTotalLag: metrics.shareOfTotalLag } : {}),
      drawn: onTheMap.has(edge.id),
    };
  });
  return [...flows("start"), ...paths, ...flows("end")];
}

export type PathColumn = "from" | "to" | "incidents" | "passages" | "total" | "lag" | "drawn";

/** The column the list is sorted by, and in which direction. */
export interface PathOrder {
  column: PathColumn;
  descending: boolean;
}

/**
 * The list opens on the paths where most time goes: the largest supplied total lag first (the
 * owner's decision of 14 October). Where the service supplies no totals, every row is equal there
 * and the list stands in the order of the most incidents.
 */
export const OPENING_ORDER: PathOrder = { column: "total", descending: true };

/**
 * The order after a column is chosen: the other direction when the list is sorted by it already,
 * otherwise names from A on, numbers from the largest on, and what the map draws before what it
 * does not.
 */
export function orderBy(current: PathOrder, column: PathColumn): PathOrder {
  if (current.column === column) return { column, descending: !current.descending };
  return { column, descending: column !== "from" && column !== "to" };
}

/** Names in the order of the application's language, a number inside a name by its value. */
const names = new Intl.Collator("en", { numeric: true });

function valueOf(row: PathRow, column: PathColumn): string | number | bigint | undefined {
  switch (column) {
    case "from":
      return row.from;
    case "to":
      return row.to;
    case "incidents":
      return row.incidents;
    case "passages":
      return row.passages;
    case "total":
      return row.totalLag?.exact;
    case "lag":
      return row.medianLagHours;
    case "drawn":
      return row.drawn ? 1 : 0;
  }
}

/**
 * The rows in an order. Rows that are equal in the chosen column follow each other by their
 * incidents, the most first, and otherwise as they were given: the flows from Start, the paths as
 * supplied, the flows to End. A flow has no passages and no lag: sorted by one of those it stands
 * after every path, in either direction.
 */
export function sortedRows(rows: readonly PathRow[], order: PathOrder): PathRow[] {
  return [...rows].sort((one, other) => {
    const [a, b] = [valueOf(one, order.column), valueOf(other, order.column)];
    if (a === undefined || b === undefined) {
      if (a !== b) return a === undefined ? 1 : -1;
    } else {
      // The total is ordered by its exact microseconds, which hours rounded for display would not keep apart.
      const ascending =
        typeof a === "bigint" && typeof b === "bigint"
          ? a < b ? -1 : a > b ? 1 : 0
          : typeof a === "string" || typeof b === "string"
            ? names.compare(String(a), String(b))
            : Number(a) - Number(b);
      if (ascending !== 0) return order.descending ? -ascending : ascending;
    }
    return other.incidents - one.incidents;
  });
}
