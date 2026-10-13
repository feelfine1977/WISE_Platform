import type { ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { abstract, createLayoutScope, type FlowGraph, layout, type LayoutDirection, type Positions } from "wise-flow";
import type { SuppliedGraph } from "../generated/selection";
import { noStages, withActivity, withStage } from "../stages/definitions";
import { suppliedGraph } from "../test/selections";
import { type Engine, FIRST_ACTIVITY, firstActivity, mapArrangement, parentArrangement, pinned, pinningElk } from "./arrange";
import { END_ID, START_ID, toFlowGraph } from "./graph";

const whole = suppliedGraph(["A-1", "B-2"]);
const idOf = (index: number) => `activity.v1:sha256:${String(index).padStart(64, "0")}`;
const COLUMN = "elk.layered.layering.layerConstraint";

/**
 * A map of six activities, written to be arranged and not counted from incidents. Every incident
 * begins with the last of them, "Activity 5", the only target of Start. The way leads from it
 * through the others in their order, and paths lead back into it from the second, the third and
 * the fifth. Incidents end with the fourth and the fifth. `begun` gives other numbers of incidents
 * that begin with each activity.
 */
function looping(begun = [0, 0, 0, 0, 0, 100]): SuppliedGraph {
  const ended = [0, 0, 0, 40, 60, 0];
  const pairs = [
    [5, 0, 90],
    [0, 1, 80],
    [1, 2, 70],
    [2, 3, 60],
    [3, 4, 50],
    [1, 5, 30],
    [2, 5, 20],
    [4, 5, 10],
  ];
  return {
    ...whole,
    nodes: begun.map((starts, index) => ({
      ...whole.nodes[0],
      id: idOf(index),
      label: `Activity ${index}`,
      metrics: { ...whole.nodes[0].metrics, cases: 100 - index, starts, ends: ended[index] },
    })),
    edges: pairs.map(([source, target, cases]) => ({
      ...whole.edges[0],
      id: `path.v1:sha256:${String(source * 100 + target).padStart(64, "0")}`,
      source: idOf(source),
      target: idOf(target),
      metrics: { ...whole.edges[0].metrics, count: cases, cases },
    })),
  };
}

/** The first three activities of the way in one stage, the next two in another, the fifth in none. */
const two = ["Early", "Late"].reduce(withStage, noStages);
const [early, late] = two.stages.map((stage) => stage.id);
const stages = [
  ["Activity 5", early],
  ["Activity 0", early],
  ["Activity 1", early],
  ["Activity 2", late],
  ["Activity 3", late],
].reduce((definitions, [activity, stage]) => withActivity(definitions, activity, stage), two);

const first = idOf(5);
const activitiesOf = (graph: FlowGraph) => graph.nodes.filter((node) => node.kind === "activity").map((node) => node.id);
/** Along which axis a map runs, and across which its rows or columns lie. */
const axes: [LayoutDirection, "x" | "y", "width" | "height"][] = [
  ["RIGHT", "x", "width"],
  ["DOWN", "y", "height"],
];

describe("the first activity of a map", () => {
  it("is the target of Start's strongest flow, the first of equals in the order of the graph", () => {
    expect(firstActivity(toFlowGraph(looping()))).toBe(first);
    expect(firstActivity(toFlowGraph(looping([10, 70, 0, 0, 0, 20])))).toBe(idOf(1));
    // Three flows of equal strength: the first of them, as the flows are chosen for the map.
    expect(firstActivity(toFlowGraph(looping([0, 30, 30, 0, 0, 30])))).toBe(idOf(1));
  });

  it("is none on a map without Start, and none where Start's flow leads to an activity the map does not show", () => {
    const still: SuppliedGraph = { ...looping(), nodes: looping().nodes.map((node) => ({ ...node, metrics: { ...node.metrics, starts: 0, ends: 0 } })) };
    expect(toFlowGraph(still).nodes.map((node) => node.kind)).not.toContain("event");
    expect(firstActivity(toFlowGraph(still))).toBeUndefined();
    const flow = toFlowGraph(looping());
    expect(firstActivity({ ...flow, nodes: flow.nodes.filter((node) => node.id !== first) })).toBeUndefined();
    // Such a map is given no first activity, and the same options each time.
    expect(mapArrangement(toFlowGraph(still))).not.toHaveProperty("elkOptions");
    expect(mapArrangement(flow).elkOptions).toEqual({ [FIRST_ACTIVITY]: first });
    expect(parentArrangement(flow).elkOptions).toEqual({ [FIRST_ACTIVITY]: first });
  });
});

describe("the columns written into the graph of the engine", () => {
  const leaf = (id: string): ElkNode => ({ id, width: 10, height: 10 });
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { "elk.algorithm": "layered", [FIRST_ACTIVITY]: "b" },
    children: [{ id: "stage:1", layoutOptions: { "elk.partitioning.partition": "0" }, children: [leaf("a"), leaf("b")] }, leaf("c"), leaf(END_ID), leaf(START_ID)],
    edges: [{ id: "e", sources: [START_ID], targets: ["b"] }],
  };

  it("puts Start alone first, End alone last and the first activity after Start, also inside a stage", () => {
    const before = JSON.stringify(graph);
    const written = pinned(graph);
    // The option that carried the first activity is not ELK's and is taken out again.
    expect(written.layoutOptions).toEqual({ "elk.algorithm": "layered" });
    const [stage, c, end, start] = written.children!;
    expect(start.layoutOptions).toEqual({ [COLUMN]: "FIRST_SEPARATE" });
    expect(end.layoutOptions).toEqual({ [COLUMN]: "LAST_SEPARATE" });
    expect(stage.children![1].layoutOptions).toEqual({ [COLUMN]: "FIRST" });
    // Nothing else takes a column, the stage keeps its own options, and the graph given is as it was.
    expect(stage.children![0]).toBe(graph.children![0].children![0]);
    expect(c).toBe(graph.children![1]);
    expect(stage.layoutOptions).toEqual({ "elk.partitioning.partition": "0" });
    expect(written.edges).toBe(graph.edges);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it("writes none for what is not on the map: no Start, no End, no first activity, and never a stage", () => {
    const bare: ElkNode = { id: "root", layoutOptions: { [FIRST_ACTIVITY]: "stage:1" }, children: [{ id: "stage:1", children: [leaf("a")] }, leaf("c")] };
    expect(pinned(bare).children).toEqual(bare.children);
    expect(pinned({ id: "root", children: [leaf("a")] })).toEqual({ id: "root", layoutOptions: {}, children: [leaf("a")] });
    // Start and End keep their own columns, whatever is named as the first activity.
    const odd = pinned({ id: "root", layoutOptions: { [FIRST_ACTIVITY]: START_ID }, children: [leaf(START_ID)] });
    expect(odd.children![0].layoutOptions).toEqual({ [COLUMN]: "FIRST_SEPARATE" });
  });
});

describe("a map arranged with Start first and End last", () => {
  const at = (positions: Positions, id: string, axis: "x" | "y") => positions.nodes[id][axis];

  it.each(axes)("puts Start before every activity and End after every one, where paths lead back into Start's only target (%s)", async (direction, axis, extent) => {
    const flow = toFlowGraph(looping());
    const activities = activitiesOf(flow);
    const positions = await layout(flow, { ...mapArrangement(flow), direction });
    expect(positions.engine).toBe("elk");
    for (const id of activities) {
      expect(at(positions, START_ID, axis), id).toBeLessThan(at(positions, id, axis));
      // End begins where the last activity has ended: it is alone in its column.
      expect(at(positions, END_ID, axis), id).toBeGreaterThan(at(positions, id, axis) + positions.nodes[id][extent]);
    }
    // Start's target stands next: before every other activity.
    for (const id of activities.filter((item) => item !== first)) expect(at(positions, first, axis), id).toBeLessThan(at(positions, id, axis));
    // The arrangement of a whole parent is the same one.
    expect((await layout(flow, { ...parentArrangement(flow), direction })).nodes).toEqual(positions.nodes);

    // Left to itself the map library turns the main way around: Start stands behind activities, and so does its target.
    // When this fails, the library places Start itself and the engine given to it here can go.
    const alone = await layout(flow, { direction });
    expect(alone.engine).toBe("elk");
    expect(activities.some((id) => at(alone, id, axis) < at(alone, START_ID, axis))).toBe(true);
    expect(activities.some((id) => at(alone, id, axis) > at(alone, END_ID, axis))).toBe(true);
  });

  it.each(axes)("keeps the stages in their order and puts Start's target first in its stage (%s)", async (direction, axis, extent) => {
    const flow = toFlowGraph(looping(), 0, undefined, stages);
    expect(flow.nodes.find((node) => node.id === first)?.group).toBe(early);
    const activities = activitiesOf(flow);
    const inEarly = flow.nodes.filter((node) => node.group === early && node.id !== first).map((node) => node.id);
    const positions = await layout(flow, { ...mapArrangement(flow), direction });
    expect(positions.engine).toBe("elk");
    for (const id of activities) {
      expect(at(positions, START_ID, axis), id).toBeLessThan(at(positions, id, axis));
      expect(at(positions, END_ID, axis), id).toBeGreaterThan(at(positions, id, axis) + positions.nodes[id][extent]);
    }
    // Start and End stand outside every stage, and the stages follow each other as the analyst ordered them.
    expect(at(positions, START_ID, axis)).toBeLessThan(positions.groups[early][axis]);
    expect(positions.groups[early][axis] + positions.groups[early][extent]).toBeLessThan(positions.groups[late][axis]);
    expect(positions.groups[late][axis] + positions.groups[late][extent]).toBeLessThan(at(positions, END_ID, axis));
    // Inside its stage Start's target is the first; where the stage stands is left to the order of the stages.
    expect(inEarly).toHaveLength(2);
    for (const id of inEarly) expect(at(positions, first, axis), id).toBeLessThan(at(positions, id, axis));

    // Left to itself the map library puts the activities that lead back into it before Start's target.
    const alone = await layout(flow, { direction });
    expect(alone.engine).toBe("elk");
    expect(inEarly.every((id) => at(alone, id, axis) < at(alone, first, axis))).toBe(true);
  });

  it("arranges a map without Start and End, and one whose stages are shown as nodes", async () => {
    const still: SuppliedGraph = { ...looping(), nodes: looping().nodes.map((node) => ({ ...node, metrics: { ...node.metrics, starts: 0, ends: 0 } })) };
    const bare = toFlowGraph(still);
    const arranged = await layout(bare, mapArrangement(bare));
    expect(arranged.engine).toBe("elk");
    expect(Object.keys(arranged.nodes).sort()).toEqual(activitiesOf(bare).sort());

    // A stage shown as one node takes the flows of its activities: the stage Start leads to stands next to Start.
    const asNodes = abstract(toFlowGraph(looping(), 0, undefined, stages), { collapse: "all", keepConnected: false });
    expect(asNodes.nodes.map((node) => node.kind)).toEqual(["event", "stage", "stage", "activity", "event"]);
    expect(firstActivity(asNodes)).toBe(early);
    const positions = await layout(asNodes, mapArrangement(asNodes));
    expect(positions.engine).toBe("elk");
    const others = asNodes.nodes.map((node) => node.id).filter((id) => id !== START_ID && id !== END_ID);
    for (const id of others) {
      expect(at(positions, START_ID, "x"), id).toBeLessThan(at(positions, id, "x"));
      expect(at(positions, END_ID, "x"), id).toBeGreaterThan(at(positions, id, "x"));
      if (id !== early) expect(at(positions, early, "x"), id).toBeLessThan(at(positions, id, "x"));
    }
  });

  it("is arranged by the library's fallback when ELK fails: every node has its place, in no promised column", async () => {
    const flow = toFlowGraph(looping(), 0, undefined, stages);
    const failing = pinningElk(() => Promise.reject(new Error("The worker did not start.")));
    const positions = await layout(flow, { ...mapArrangement(flow), elk: failing });
    expect(positions.engine).toBe("dagre");
    expect(Object.keys(positions.nodes).sort()).toEqual(flow.nodes.map((node) => node.id).sort());
    expect(Object.keys(positions.groups).sort()).toEqual([early, late]);
  });

  it("is arranged anew when another activity is the first, although the nodes and paths are the same", async () => {
    const seen: ElkNode[] = [];
    const counting = pinningElk(async () => ({ layout: async (graph) => (seen.push(graph), graph), stop: () => undefined }));
    const one = toFlowGraph(looping([0, 30, 0, 0, 0, 70]));
    const other = toFlowGraph(looping([0, 70, 0, 0, 0, 30]));
    expect(other.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual(one.edges.map((edge) => [edge.id, edge.source, edge.target]));
    const scope = createLayoutScope();
    await scope.layout(one, { ...mapArrangement(one), elk: counting });
    await scope.layout(one, { ...mapArrangement(one), elk: counting });
    expect(seen).toHaveLength(1);
    await scope.layout(other, { ...mapArrangement(other), elk: counting });
    expect(seen).toHaveLength(2);
    const columnOf = (graph: ElkNode, id: string) => graph.children!.find((node) => node.id === id)?.layoutOptions?.[COLUMN];
    expect([columnOf(seen[0], idOf(5)), columnOf(seen[0], idOf(1))]).toEqual(["FIRST", undefined]);
    expect([columnOf(seen[1], idOf(5)), columnOf(seen[1], idOf(1))]).toEqual([undefined, "FIRST"]);
    scope.dispose();
  });
});

describe("the engine given to the map library", () => {
  afterEach(() => vi.useRealTimers());

  const graph = (id: string): ElkNode => ({ id, children: [] });
  /** Engines that answer when the test says so, in the order they were started. */
  function engines() {
    const started: { answer: (graph: ElkNode) => void; fail: (error: Error) => void; stopped: boolean; asked: ElkNode[] }[] = [];
    const start = async (): Promise<Engine> => {
      const engine = { answer: (_graph: ElkNode) => {}, fail: (_error: Error) => {}, stopped: false, asked: [] as ElkNode[] };
      started.push(engine);
      return {
        layout: (asked) =>
          new Promise<ElkNode>((resolve, reject) => {
            engine.asked.push(asked);
            engine.answer = resolve;
            engine.fail = reject;
          }),
        stop: () => void (engine.stopped = true),
      };
    };
    return { started, start };
  }
  /** Lets everything that is due happen. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  function watched(promise: Promise<ElkNode>) {
    const seen: { answer?: ElkNode; error?: unknown } = {};
    promise.then(
      (answer) => (seen.answer = answer),
      (error: unknown) => (seen.error = error),
    );
    return seen;
  }

  it("keeps one engine between two arrangements", async () => {
    const { started, start } = engines();
    const elk = pinningElk(start);
    const one = watched(elk.layout(graph("one")));
    await settle();
    started[0].answer(graph("one arranged"));
    await settle();
    expect(one.answer?.id).toBe("one arranged");
    const other = watched(elk.layout(graph("other")));
    await settle();
    expect(started).toHaveLength(1);
    started[0].answer(graph("other arranged"));
    await settle();
    expect(other.answer?.id).toBe("other arranged");
    expect(started[0].stopped).toBe(false);
    expect(started[0].asked.map((asked) => asked.id)).toEqual(["one", "other"]);
  });

  it("ends the arrangement of a map that a newer one replaces: its engine is stopped and it is never answered", async () => {
    const { started, start } = engines();
    const elk = pinningElk(start, { replacing: true });
    const one = watched(elk.layout(graph("one")));
    await settle();
    const other = watched(elk.layout(graph("other")));
    await settle();
    expect(started).toHaveLength(2);
    expect(started[0].stopped).toBe(true);
    started[0].answer(graph("too late"));
    started[1].answer(graph("other arranged"));
    await settle();
    expect(one).toEqual({});
    expect(other.answer?.id).toBe("other arranged");
    // The engine of the newer one is kept for the next.
    expect(started[1].stopped).toBe(false);
    watched(elk.layout(graph("third")));
    await settle();
    expect(started).toHaveLength(2);
  });

  it("computes every arrangement of a whole parent, each in an engine of its own while another runs", async () => {
    const { started, start } = engines();
    const elk = pinningElk(start);
    const one = watched(elk.layout(graph("one")));
    const other = watched(elk.layout(graph("other")));
    await settle();
    expect(started).toHaveLength(2);
    started[1].answer(graph("other arranged"));
    started[0].answer(graph("one arranged"));
    await settle();
    expect([one.answer?.id, other.answer?.id]).toEqual(["one arranged", "other arranged"]);
    // One engine is kept, the other is stopped.
    expect(started.map((engine) => engine.stopped)).toEqual([true, false]);
  });

  it("stops an engine whose time is over and leaves the answer to the library's own timeout", async () => {
    vi.useFakeTimers();
    const { started, start } = engines();
    const elk = pinningElk(start, { timeoutMs: 500 });
    const late = watched(elk.layout(graph("late")));
    await vi.advanceTimersByTimeAsync(499);
    expect(started[0].stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(started[0].stopped).toBe(true);
    started[0].answer(graph("too late"));
    await vi.advanceTimersByTimeAsync(10);
    expect(late).toEqual({});
    // The next arrangement starts an engine of its own.
    const next = watched(elk.layout(graph("next")));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(2);
    started[1].answer(graph("next arranged"));
    await vi.advanceTimersByTimeAsync(0);
    expect(next.answer?.id).toBe("next arranged");
  });

  it("passes an error of the engine on and does not keep that engine", async () => {
    const { started, start } = engines();
    const elk = pinningElk(start);
    const failed = watched(elk.layout(graph("one")));
    await settle();
    started[0].fail(new Error("Unsupported graph."));
    await settle();
    expect(failed.error).toEqual(new Error("Unsupported graph."));
    expect(started[0].stopped).toBe(true);
  });
});
