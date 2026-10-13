import { describe, expect, it } from "vitest";
import { nodeIds, opened, closed, pathId, suppliedGraph } from "../test/selections";
import { mapDetail, WHOLE_DETAIL } from "./detail";
import { endFlowId, leastFlowIncidents, rankedDetail, startFlowId, toFlowGraph } from "./graph";
import { OPENING_ORDER, orderBy, type PathColumn, pathRows, sortedRows } from "./paths";
import { busyGraph, busyIds, stepName } from "./testGraphs";

describe("the rows of the list of every path", () => {
  it("are the supplied paths with their supplied numbers and the flows from Start and to End with their incidents", () => {
    // A-1 goes from "Eröffnet" to "Geschlossen" in 25.5 hours; the order of B-2 is not known, so it adds no path and no flow.
    const graph = suppliedGraph(["A-1", "B-2"]);
    const rows = pathRows(graph, mapDetail(toFlowGraph(graph), WHOLE_DETAIL).drawn);
    expect(rows).toEqual([
      { id: startFlowId(nodeIds[opened]), kind: "start", from: "Start", to: opened, title: "Flow from Start to “Eröffnet”", incidents: 1, drawn: true },
      { id: pathId, kind: "path", from: opened, to: closed, title: "Path from “Eröffnet” to “Geschlossen”", incidents: 1, passages: 1, medianLagHours: 25.5, drawn: true },
      { id: endFlowId(nodeIds[closed]), kind: "end", from: closed, to: "End", title: "Flow from “Geschlossen” to End", incidents: 1, drawn: true },
    ]);
    expect(pathRows(suppliedGraph(["B-2"]), mapDetail(toFlowGraph(suppliedGraph(["B-2"])), WHOLE_DETAIL).drawn)).toEqual([]);
  });

  it("take every number from the supplied graph, whatever the map draws", () => {
    const graph = busyGraph();
    const detail = { activityDetail: 0.5, pathDetail: 12 / 42 };
    const rows = pathRows(graph, mapDetail(toFlowGraph(graph, leastFlowIncidents(graph, detail)), rankedDetail(detail)!).drawn);
    // 42 paths, three flows from Start and four to End.
    expect(rows).toHaveLength(49);
    for (const edge of graph.edges) {
      const row = rows.find((item) => item.id === edge.id)!;
      expect([row.from, row.to, row.incidents, row.passages, row.medianLagHours]).toEqual([
        edge.payload.source_activity,
        edge.payload.target_activity,
        edge.metrics.cases,
        edge.metrics.count,
        edge.metrics.medianLagHours,
      ]);
    }
    expect(rows.filter((row) => row.kind === "start").map((row) => [row.to, row.incidents])).toEqual([
      [stepName(0), 100],
      [stepName(1), 15],
      [stepName(2), 5],
    ]);
    expect(rows.filter((row) => row.kind === "end").map((row) => [row.from, row.incidents])).toEqual([
      [stepName(8), 5],
      [stepName(9), 15],
      [stepName(10), 30],
      [stepName(11), 70],
    ]);
    // A flow has neither passages nor a lag.
    expect(rows.filter((row) => row.kind !== "path").every((row) => row.passages === undefined && row.medianLagHours === undefined)).toBe(true);
  });

  it("are drawn exactly when the graph the map draws holds them", () => {
    const graph = busyGraph();
    const detail = { activityDetail: 0.5, pathDetail: 12 / 42 };
    const drawn = mapDetail(toFlowGraph(graph, leastFlowIncidents(graph, detail)), rankedDetail(detail)!).drawn;
    const rows = pathRows(graph, drawn);
    const onTheMap = new Set(drawn.edges.map((edge) => edge.id));
    expect(rows.filter((row) => row.drawn).map((row) => row.id).sort()).toEqual(rows.map((row) => row.id).filter((id) => onTheMap.has(id)).sort());
    // The six most frequent activities are drawn: the path between the first two is, a path of the last one is not.
    expect(rows.find((row) => row.id === busyIds.path(0, 1))?.drawn).toBe(true);
    expect(rows.find((row) => row.id === busyIds.path(10, 11))?.drawn).toBe(false);
    // The flow from Start to the first activity is the strongest and is drawn; the one to the third carries too few incidents at this detail.
    expect(rows.find((row) => row.id === startFlowId(busyIds.activity(0)))?.drawn).toBe(true);
    expect(rows.find((row) => row.id === startFlowId(busyIds.activity(2)))?.drawn).toBe(false);
    // The map also draws a dashed line for a way through activities it does not draw: that is no supplied path and no row.
    expect(drawn.edges.filter((edge) => !rows.some((row) => row.id === edge.id)).map((edge) => edge.tags)).toEqual([["indirect"]]);
    // As many rows are drawn as the detail controls count paths shown.
    expect(rows.filter((row) => row.drawn)).toHaveLength(drawn.meta!.shown!.paths.shown);
  });
});

describe("the order of the list of every path", () => {
  const graph = busyGraph();
  const rows = pathRows(graph, mapDetail(toFlowGraph(graph, 15), rankedDetail({ activityDetail: 1, pathDetail: 18 / 42 })!).drawn);
  const ends = (column: PathColumn, descending: boolean, take: (row: (typeof rows)[number]) => unknown) => {
    const sorted = sortedRows(rows, { column, descending });
    return [take(sorted[0]), take(sorted[sorted.length - 1])];
  };

  it("opens on the most incidents, and a column chosen first starts where it reads best", () => {
    expect(OPENING_ORDER).toEqual({ column: "incidents", descending: true });
    expect(sortedRows(rows, OPENING_ORDER).slice(0, 3).map((row) => [row.from, row.to, row.incidents])).toEqual([
      [stepName(0), stepName(1), 105],
      ["Start", stepName(0), 100],
      [stepName(1), stepName(2), 95],
    ]);
    expect(orderBy(OPENING_ORDER, "incidents")).toEqual({ column: "incidents", descending: false });
    expect(orderBy(OPENING_ORDER, "from")).toEqual({ column: "from", descending: false });
    expect(orderBy(OPENING_ORDER, "to")).toEqual({ column: "to", descending: false });
    expect(orderBy(OPENING_ORDER, "passages")).toEqual({ column: "passages", descending: true });
    expect(orderBy(OPENING_ORDER, "lag")).toEqual({ column: "lag", descending: true });
    expect(orderBy(OPENING_ORDER, "drawn")).toEqual({ column: "drawn", descending: true });
    expect(orderBy({ column: "from", descending: false }, "from")).toEqual({ column: "from", descending: true });
  });

  it("sorts by each column in both directions", () => {
    expect(ends("from", false, (row) => row.from)).toEqual([stepName(0), "Start"]);
    expect(ends("from", true, (row) => row.from)).toEqual(["Start", stepName(0)]);
    expect(ends("to", false, (row) => row.to)).toEqual(["End", stepName(11)]);
    expect(ends("to", true, (row) => row.to)).toEqual([stepName(11), "End"]);
    expect(ends("incidents", true, (row) => row.incidents)).toEqual([105, 1]);
    expect(ends("incidents", false, (row) => row.incidents)).toEqual([1, 105]);
    expect(ends("drawn", true, (row) => row.drawn)).toEqual([true, false]);
    expect(ends("drawn", false, (row) => row.drawn)).toEqual([false, true]);
  });

  it("keeps the flows, which have no passages and no lag, after every path when sorted by one of those", () => {
    for (const descending of [true, false]) {
      for (const column of ["passages", "lag"] as const) {
        const kinds = sortedRows(rows, { column, descending }).map((row) => row.kind === "path");
        expect(kinds.lastIndexOf(true)).toBe(41);
        expect(kinds.indexOf(false)).toBe(42);
      }
    }
    // The first path of the graph takes 2 hours and the last 84; the most passages are those of the strongest path.
    expect(ends("lag", false, (row) => row.medianLagHours)).toEqual([2, undefined]);
    expect(sortedRows(rows, { column: "lag", descending: true })[0].medianLagHours).toBe(84);
    expect(sortedRows(rows, { column: "passages", descending: true })[0].passages).toBe(105);
  });

  it("orders rows that are equal in the chosen column by their incidents, and otherwise as they were given", () => {
    const drawnFirst = sortedRows(rows, { column: "drawn", descending: true }).filter((row) => row.drawn);
    expect(drawnFirst.map((row) => row.incidents)).toEqual([...drawnFirst.map((row) => row.incidents)].sort((a, b) => b - a));
    // A number inside a name counts by its value.
    const named = [
      { ...rows[0], id: "a", from: "Schritt 10", incidents: 1 },
      { ...rows[0], id: "b", from: "Schritt 2", incidents: 1 },
      { ...rows[0], id: "c", from: "Schritt 2", incidents: 7 },
      { ...rows[0], id: "d", from: "Schritt 2", incidents: 1 },
    ];
    expect(sortedRows(named, { column: "from", descending: false }).map((row) => row.id)).toEqual(["c", "b", "d", "a"]);
    expect(sortedRows(named, { column: "from", descending: true }).map((row) => row.id)).toEqual(["a", "c", "b", "d"]);
    // Two paths of the graph carry one incident: the one supplied first stands first.
    expect(sortedRows(rows, { column: "incidents", descending: false }).slice(0, 2).map((row) => [row.from, row.to])).toEqual([
      [stepName(11), stepName(10)],
      [stepName(8), stepName(11)],
    ]);
  });
});
