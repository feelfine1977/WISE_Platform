import { describe, expect, it } from "vitest";
import { CANVAS_FROM, mapDetail, statementAsText, WHOLE_DETAIL } from "./detail";
import { rankedDetail, toFlowGraph } from "./graph";
import { busyGraph, crowdedGraph, stagedGraph } from "./testGraphs";

describe("what the map draws at a detail", () => {
  it("is every activity and every path while no detail is set", () => {
    const whole = mapDetail(toFlowGraph(busyGraph()), WHOLE_DETAIL);
    // Twelve activities between Start and End; 42 paths and the seven flows from Start and to End.
    expect(whole.drawn.nodes).toHaveLength(14);
    expect(whole.drawn.edges).toHaveLength(49);
    expect(whole.positions).toEqual({ activities: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12], paths: 42, at: { activities: 12, paths: 42 } });
    expect(whole.statement?.activities.short).toBe("12 of 12 · 100.0 % of events");
    expect(whole.statement?.paths.short).toBe("49 of 49");
    expect(whole.hasStages).toBe(false);
    expect(whole.onCanvas).toBe(false);
  });

  it("collapses the stages first and reduces by the shares after, as the map library does inside its map", () => {
    const staged = stagedGraph();
    expect(mapDetail(staged, WHOLE_DETAIL).hasStages).toBe(true);
    const collapsed = mapDetail(staged, { collapse: "all" });
    expect(collapsed.drawn.nodes.map((node) => node.kind)).toEqual(["event", "stage", "stage", "event"]);
    expect(collapsed.statement?.activities.short).toBe("2 of 2 · 100.0 % of events");
    // The shares count over the collapsed graph: three activities are left to rank once the first stage is one of them.
    const reduced = mapDetail(staged, { collapse: ["first"], activityDetail: 0.5, pathDetail: 0.5 });
    expect(reduced.positions).toEqual({ activities: [1, 2, 3], paths: 3, at: { activities: 2, paths: 2 } });
    expect(reduced.statement?.activities.short).toBe("2 of 3 · 88.2 % of events");
    // A graph that names no stage still offers them while some are collapsed.
    expect(mapDetail({ ...staged, groups: [] }, { collapse: "all" }).hasStages).toBe(true);
  });

  it("is drawn on the map library's Canvas from one element more than the number the map is given", () => {
    const crowded = toFlowGraph(crowdedGraph());
    const everyActivity = (paths: number) => mapDetail(crowded, rankedDetail({ activityDetail: 1, pathDetail: paths / 2450 })!);
    // Fifty activities between Start and End, one flow from Start and one to End, the paths the share takes and one the library keeps.
    const atMost = everyActivity(1945);
    expect(atMost.statement?.paths.short).toBe("1,948 of 2,452 · 1 kept · strongest not shown: 32");
    expect(atMost.drawn.nodes.length + atMost.drawn.edges.length).toBe(CANVAS_FROM);
    expect(atMost.onCanvas).toBe(false);
    const oneMore = everyActivity(1946);
    expect(oneMore.drawn.nodes.length + oneMore.drawn.edges.length).toBe(CANVAS_FROM + 1);
    expect(oneMore.onCanvas).toBe(true);
  });

  it("gives the statements for outside the map with the kept paths' part as words, and nothing else changed", () => {
    const supplied = busyGraph();
    const { statement } = mapDetail(toFlowGraph(supplied, 15), rankedDetail({ activityDetail: 1, pathDetail: 18 / 42 })!);
    expect(statement?.paths.keptPart).toBe("13 kept");
    const outside = statementAsText(statement);
    expect(outside?.paths).toEqual({ short: statement?.paths.short, full: statement?.paths.full, parts: ["36 of 47", "13 kept", "strongest not shown: 14"] });
    expect({ ...outside, paths: statement?.paths }).toEqual(statement);
    expect(statementAsText(undefined)).toBeUndefined();
  });
});
