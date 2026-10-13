import type { FlowGraph } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
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
  /** Whether the map draws it at its detail. */
  drawn: boolean;
}

/**
 * Every path of the supplied graph and every flow from Start and to End, in the order supplied:
 * the flows from Start, the paths, the flows to End. `drawn` is the graph the map draws at its
 * detail (`mapDetail`): a row is drawn when that graph holds its path or flow.
 */
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
  const paths = graph.edges.map(
    (edge): PathRow => ({
      id: edge.id,
      kind: "path",
      from: edge.payload.source_activity,
      to: edge.payload.target_activity,
      title: pathTitle(edge.payload.source_activity, edge.payload.target_activity),
      incidents: edge.metrics.cases,
      passages: edge.metrics.count,
      medianLagHours: edge.metrics.medianLagHours,
      drawn: onTheMap.has(edge.id),
    }),
  );
  return [...flows("start"), ...paths, ...flows("end")];
}

export type PathColumn = "from" | "to" | "incidents" | "passages" | "lag" | "drawn";

/** The column the list is sorted by, and in which direction. */
export interface PathOrder {
  column: PathColumn;
  descending: boolean;
}

/** The list opens on the paths with the most incidents, the number the map ranks its paths by. */
export const OPENING_ORDER: PathOrder = { column: "incidents", descending: true };

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

function valueOf(row: PathRow, column: PathColumn): string | number | undefined {
  switch (column) {
    case "from":
      return row.from;
    case "to":
      return row.to;
    case "incidents":
      return row.incidents;
    case "passages":
      return row.passages;
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
      const ascending = typeof a === "string" || typeof b === "string" ? names.compare(String(a), String(b)) : a - b;
      if (ascending !== 0) return order.descending ? -ascending : ascending;
    }
    return other.incidents - one.incidents;
  });
}
