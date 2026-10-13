import { describe, expect, it } from "vitest";
import type { FlowGraph } from "wise-flow";
import { abstract, buildScales, layout, measureStyle, palettes, validateGraph } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { END_ID, endFlowId, flowCoverage, inStages, leastFlowIncidents, rankedDetail, showsStageNodes, stageOrder, START_ID, startFlowId, toFlowGraph } from "../map/graph";
import { checked, closed, nodeIds, opened, suppliedGraph } from "../test/selections";
import { moved, noStages, type StageDefinitions, withActivity, withoutStage, withStage } from "./definitions";

/*
 * The map of both incidents of ../test/selections.ts: "Eröffnet" and then "Geschlossen" in A-1,
 * "Prüfung" alone in B-2. The analyst defines three stages for it: "Intake" with "Eröffnet",
 * "Closure" with "Geschlossen", and "Review", to which no activity belongs yet. "Prüfung" is in no
 * stage.
 */
const supplied = suppliedGraph(["A-1", "B-2"]);
const named = ["Intake", "Closure", "Review"].reduce(withStage, noStages);
const [intake, closure, review] = named.stages.map((stage) => stage.id);
const stages = withActivity(withActivity(named, opened, intake), closed, closure);

const groupOf = (flow: FlowGraph, id: string) => flow.nodes.find((node) => node.id === id)?.group;

describe("the stages of a log on the graph of the map", () => {
  it("declares a stage group for every stage with an activity, in the order of the stages, and puts the activities into them", () => {
    const flow: FlowGraph = toFlowGraph(supplied, 0, undefined, stages);
    // As the map library's own example declares its stages: groups of the kind "stage", and their ids on the activities.
    expect(flow.groups).toEqual([
      { id: intake, kind: "stage", label: "Intake" },
      { id: closure, kind: "stage", label: "Closure" },
    ]);
    expect(groupOf(flow, nodeIds[opened])).toBe(intake);
    expect(groupOf(flow, nodeIds[closed])).toBe(closure);
    // An activity without a stage carries none, and a stage without an activity declares no group.
    expect(flow.nodes.find((node) => node.id === nodeIds[checked])).not.toHaveProperty("group");
    expect(flow.groups?.map((group) => group.id)).not.toContain(review);
    expect(validateGraph(flow)).toEqual([]);

    // The order is the analyst's, whatever the flow of the log is.
    expect(toFlowGraph(supplied, 0, undefined, moved(stages, closure, "earlier")).groups?.map((group) => group.label)).toEqual(["Closure", "Intake"]);
    expect(toFlowGraph(supplied, 0, undefined, withActivity(stages, checked, review)).groups?.map((group) => group.label)).toEqual(["Intake", "Closure", "Review"]);
  });

  it("leaves Start and End outside every stage, also when an activity is called as they are", () => {
    const odd: SuppliedGraph = { ...supplied, nodes: supplied.nodes.map((node) => (node.label === checked ? { ...node, label: "Start" } : node)) };
    const flow = toFlowGraph(odd, 0, undefined, withActivity(withActivity(stages, "Start", review), "End", review));
    expect(flow.nodes[0]).toMatchObject({ id: START_ID, kind: "event", label: "Start" });
    expect(flow.nodes[0]).not.toHaveProperty("group");
    expect(flow.nodes[flow.nodes.length - 1]).toMatchObject({ id: END_ID, kind: "event", label: "End" });
    expect(flow.nodes[flow.nodes.length - 1]).not.toHaveProperty("group");
    // The activity of that name is an activity of the log and is in its stage.
    expect(groupOf(flow, nodeIds[checked])).toBe(review);
  });

  it("changes nothing else: every node, path, flow and coverage field is as without stages", () => {
    const before = JSON.stringify(supplied);
    const plain = toFlowGraph(supplied);
    const flow = toFlowGraph(supplied, 0, undefined, stages);
    expect(flow.nodes.map(({ group: _group, ...node }) => node)).toEqual(plain.nodes);
    expect(flow.edges).toEqual(plain.edges);
    expect(flow.meta).toEqual(plain.meta);
    expect(JSON.stringify(supplied)).toBe(before);
    expect(stages.assigned.size).toBe(2);
  });

  it("is exactly the graph of today without a stage, and with stages none of whose activities is on the map", () => {
    const plain = toFlowGraph(supplied);
    expect(plain).not.toHaveProperty("groups");
    for (const without of [undefined, noStages, named, withActivity(named, "Another activity", review)]) {
      const flow = toFlowGraph(supplied, 0, undefined, without);
      expect(flow).toEqual(plain);
      expect(flow).not.toHaveProperty("groups");
      expect(flow.nodes.some((node) => "group" in node)).toBe(false);
    }
    // The graph given is given back as it is.
    expect(inStages(plain, noStages)).toBe(plain);
    expect(inStages(plain, named)).toBe(plain);
    // A map of incidents that begin and end nowhere has no Start and End, and takes its stages all the same.
    const still: SuppliedGraph = { ...supplied, nodes: supplied.nodes.map((node) => ({ ...node, metrics: { ...node.metrics, starts: 0, ends: 0 } })) };
    expect(toFlowGraph(still, 0, undefined, stages).groups?.map((group) => group.id)).toEqual([intake, closure]);
    expect(toFlowGraph(still, 0, undefined, stages).nodes.map((node) => node.kind)).toEqual(["activity", "activity", "activity"]);
  });

  it("gives a stage that is removed back to no stage", () => {
    const flow = toFlowGraph(supplied, 0, undefined, withoutStage(stages, intake));
    expect(flow.groups).toEqual([{ id: closure, kind: "stage", label: "Closure" }]);
    expect(flow.nodes.find((node) => node.id === nodeIds[opened])).not.toHaveProperty("group");
    // Definitions that name a stage they do not hold put no activity into it.
    const loose: StageDefinitions = { stages: named.stages.slice(0, 1), assigned: new Map([[closed, closure]]) };
    expect(toFlowGraph(supplied, 0, undefined, loose)).toEqual(toFlowGraph(supplied));
  });
});

/** A graph of activities that all begin and end incidents, with paths of the given numbers of incidents between neighbours. */
function busy(starts: number[], ends: number[], pathCases: number[]): SuppliedGraph {
  const id = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
  return {
    ...supplied,
    nodes: starts.map((count, index) => ({
      ...supplied.nodes[0],
      id: id(index),
      label: `Activity ${index}`,
      metrics: { ...supplied.nodes[0].metrics, cases: 1000 - index, starts: count, ends: ends[index] },
    })),
    edges: pathCases.map((cases, index) => ({
      ...supplied.edges[0],
      id: `path.v1:sha256:${String(index).padStart(64, "0")}`,
      source: id(index % starts.length),
      target: id((index + 1) % starts.length),
      metrics: { ...supplied.edges[0].metrics, count: 10000 - cases, cases },
    })),
  };
}

describe("the flows from Start and to End of a map in stages", () => {
  const log = busy([900, 40, 7, 0], [5, 300, 60, 2], [500, 80, 50, 6]);
  const [a, b, c, d] = log.nodes.map((node) => node.id);
  // The first two activities in one stage, the third in another, the fourth in none.
  const two = ["Early", "Late"].reduce(withStage, noStages);
  const [early, late] = two.stages.map((stage) => stage.id);
  const staged = withActivity(withActivity(withActivity(two, "Activity 0", early), "Activity 1", early), "Activity 2", late);
  const flowsOf = (least: number, definitions?: StageDefinitions) =>
    toFlowGraph(log, least, undefined, definitions)
      .edges.filter((edge) => edge.kind === "flow")
      .map((edge) => edge.id);

  it("draws the same flows as without stages at every detail", () => {
    expect(flowsOf(0, staged)).toEqual([startFlowId(a), startFlowId(b), startFlowId(c), endFlowId(a), endFlowId(b), endFlowId(c), endFlowId(d)]);
    for (const least of [0, 50, 80, Number.POSITIVE_INFINITY]) expect(flowsOf(least, staged), String(least)).toEqual(flowsOf(least));
    expect(flowsOf(80, staged)).toEqual([startFlowId(a), endFlowId(b)]);
    // The number of incidents a flow has to carry is taken from the supplied paths, which the stages do not change.
    const half = { activityDetail: 1, pathDetail: 0.5 };
    expect(leastFlowIncidents(log, half)).toBe(80);
    expect(flowCoverage(log, 80)).toEqual({ flows: 7, drawn: 2 });
    // Start and End say every start and end, in stages as without.
    const thinned = toFlowGraph(log, 80, undefined, staged);
    expect(thinned.nodes[0].metrics).toStrictEqual({ cases: 947, count: 947 });
    expect(thinned.nodes[thinned.nodes.length - 1].metrics).toStrictEqual({ cases: 367, count: 367 });
  });

  it("lets the map library reduce the paths of a map in stages as it does without them", () => {
    const half = rankedDetail({ activityDetail: 1, pathDetail: 0.5 });
    const byFrequency = (flow: FlowGraph) =>
      abstract(flow, half)
        .edges.filter((edge) => edge.kind === "follows" && !edge.tags?.includes("anchor") && !edge.tags?.includes("indirect"))
        .map((edge) => edge.id);
    expect(byFrequency(toFlowGraph(log, 80, undefined, staged))).toEqual(byFrequency(toFlowGraph(log, 80)));
    const drawn = abstract(toFlowGraph(log, 80, undefined, staged), half);
    // The stages stay declared on what the detail leaves, so the library goes on drawing them.
    expect(drawn.groups?.map((group) => group.id)).toEqual([early, late]);
    expect(drawn.nodes.filter((node) => node.kind === "event").map((node) => [node.id, node.group])).toEqual([
      [START_ID, undefined],
      [END_ID, undefined],
    ]);
  });

  it("has the map library show each stage as one node between Start and End, as “Show stages” asks it to", () => {
    const shown = abstract(toFlowGraph(log, 0, undefined, staged), { collapse: "all" });
    expect(shown.nodes.map((node) => [node.id, node.kind, node.label])).toEqual([
      [START_ID, "event", "Start"],
      [early, "stage", "Early"],
      [late, "stage", "Late"],
      [d, "activity", "Activity 3"],
      [END_ID, "event", "End"],
    ]);
    // The flows of the activities of a stage become the flows of the stage; Start and End are joined as before.
    const flows = shown.edges.filter((edge) => edge.kind === "flow").map((edge) => [edge.source, edge.target, edge.metrics?.count]);
    expect(flows).toEqual([
      [START_ID, early, 940],
      [START_ID, late, 7],
      [early, END_ID, 305],
      [late, END_ID, 60],
      [d, END_ID, 2],
    ]);
    // Asked to show stages where no stage is declared, the library leaves the map as it is.
    expect(abstract(toFlowGraph(log), { collapse: "all" }).nodes.map((node) => node.id)).toEqual([START_ID, a, b, c, d, END_ID]);
  });

  it("needs every flow of the activities of a stage that is shown as one node: a flow left out would be missing from the flow of the stage", () => {
    // At half of the paths only the flow from Start to the first activity is drawn; the stage of the first two would say 900 of its 940.
    const thinned = abstract(toFlowGraph(log, 80, undefined, staged), { collapse: "all" });
    expect(thinned.edges.filter((edge) => edge.kind === "flow").map((edge) => [edge.source, edge.target, edge.metrics?.count])).toEqual([
      [START_ID, early, 900],
      [early, END_ID, 300],
    ]);
    // So the map asks for every flow while its detail shows a stage as one node, all stages or one of them.
    expect(showsStageNodes({ activityDetail: 1, pathDetail: 0.5, collapse: "all" })).toBe(true);
    expect(showsStageNodes({ collapse: [late] })).toBe(true);
    for (const detail of [undefined, {}, { activityDetail: 1, pathDetail: 0.5 }, { collapse: false as const }, { collapse: [] }]) {
      expect(showsStageNodes(detail), JSON.stringify(detail)).toBe(false);
    }
  });
});

describe("the stages as the map library arranges and colours them", () => {
  it("lays the stages out one after the other in their order", async () => {
    const flow = toFlowGraph(supplied, 0, undefined, stages);
    const arranged = await layout(flow);
    expect(Object.keys(arranged.groups).sort()).toEqual([intake, closure].sort());
    expect(arranged.groups[intake].x + arranged.groups[intake].width).toBeLessThanOrEqual(arranged.groups[closure].x);
    // Every activity of a stage lies in the box of its stage.
    const inside = (node: string, group: string) => {
      const [box, around] = [arranged.nodes[node], arranged.groups[group]];
      return box.x >= around.x && box.y >= around.y && box.x + box.width <= around.x + around.width && box.y + box.height <= around.y + around.height;
    };
    expect(inside(nodeIds[opened], intake)).toBe(true);
    expect(inside(nodeIds[closed], closure)).toBe(true);
    expect(inside(nodeIds[checked], intake) || inside(nodeIds[checked], closure)).toBe(false);

    // Moved before "Intake", "Closure" lies before it, although the incidents pass "Intake" first.
    const turned = await layout(toFlowGraph(supplied, 0, undefined, moved(stages, closure, "earlier")));
    expect(turned.groups[closure].x + turned.groups[closure].width).toBeLessThanOrEqual(turned.groups[intake].x);
  });

  it("colours a stage with the library's own stage colours, the same on every map of the log", () => {
    // A fourth stage, which the library would give the colour of the second if it did not know of the second.
    const four = withStage(stages, "Archive");
    const archive = four.stages[3].id;
    const all = withActivity(four, checked, archive);
    const scalesOf = (graph: SuppliedGraph, order?: string[]) => buildScales(toFlowGraph(graph, 0, undefined, all), measureStyle("frequency", order && { stages: order }));
    const coloursOf = (graph: SuppliedGraph) => Object.fromEntries(stageOrder(all).map((id) => [id, scalesOf(graph, stageOrder(all)).categorical(id).color]));
    const whole = coloursOf(supplied);
    expect(new Set(Object.values(whole)).size).toBe(4);
    for (const colour of Object.values(whole)) expect(palettes.categorical).toContain(colour);

    // A selection that keeps B-2 alone has no activity of "Intake" or "Closure": "Archive" keeps its colour all the same,
    const alone = suppliedGraph(["B-2"]);
    expect(toFlowGraph(alone, 0, undefined, all).groups).toEqual([{ id: archive, kind: "stage", label: "Archive" }]);
    expect(coloursOf(alone)).toEqual(whole);
    expect(coloursOf(suppliedGraph(["A-1"]))).toEqual(whole);
    // which it would not without the whole list of the stages.
    expect(scalesOf(alone).categorical(archive).color).toBe(whole[closure]);
    expect(stageOrder(moved(all, review, "earlier"))).toEqual([intake, review, closure, archive]);
  });
});
