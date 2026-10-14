import { describe, expect, it } from "vitest";
import { abstract, buildScene, colorTokens, layout, type Measure } from "wise-flow";
import { noStages, withActivity, withStage } from "../stages/definitions";
import { checked, closed, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { END_ID, endFlowId, START_ID, startFlowId, toFlowGraph } from "./graph";
import { LAG_CLASSES_HOURS, OPENING_MEASURE, styleOver } from "./measures";

/**
 * What the map library writes in a measure on the map of both incidents, built as the map asks for
 * it. "Geschlossen" follows "Eröffnet" once, after 25.5 hours; the order of B-2 is not known, so no
 * path leads into or out of its only activity, "Prüfung".
 */
async function written(measure: Measure) {
  const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
  const scene = buildScene(graph, await layout(graph, { engine: "dagre" }), { measure, style: styleOver(measure), locale: "en" });
  const line = (label: keyof typeof nodeIds) =>
    scene.nodeMarks
      .find((node) => node.id === nodeIds[label])!
      .texts.filter((text) => text.role === "countLine" || text.role === "share")
      .map((text) => text.text);
  const path = (id: string) => {
    const mark = scene.edgeMarks.find((edge) => edge.id === id)!;
    return { label: mark.texts.map((text) => text.text), notEvaluated: mark.notEvaluated === true };
  };
  return { scene, line, path };
}

describe("the measures of the map", () => {
  it("opens on the counts: the incidents on every path and on every activity", async () => {
    expect(OPENING_MEASURE).toBe("frequency");
    // Width and labels remain incidents while colour keeps supplied long waits visible.
    expect(styleOver(OPENING_MEASURE)).toEqual({
      edgeWidth: { metric: "cases", range: [1, 6] },
      addedFlowLabel: "Added by the map: start and end of the recorded history.",
      edgeColor: { metric: "medianLagHours", palette: "performance", bins: [24, 168] },
      frequencyColorLegend: true,
    });
    const { scene, line, path } = await written(OPENING_MEASURE);
    expect(scene.scales.pathMetric).toBe("cases");
    expect(scene.style.pathLabel).toBeUndefined();
    expect(scene.style.nodeLine).toBeUndefined();
    expect(scene.legend.rows).toContainEqual({ kind: "measure", text: "Frequency: width = cases per path. Colour = median lag classes. Bar = share of all cases." });
    expect(path(pathId)).toEqual({ label: ["1"], notEvaluated: false });
    expect(path(startFlowId(nodeIds[opened]))).toEqual({ label: ["1"], notEvaluated: false });
    expect(line(opened)).toEqual(["1", "· 50 %"]);
    expect(line(closed)).toEqual(["1", "· 50 %"]);
    expect(line(checked)).toEqual(["1", "· 50 %"]);
  });

  it.each<Measure>(["frequency", "performance"])("draws a path between 1 and 6 wide by its incidents, on the library's scale (%s)", async (measure) => {
    const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
    // Three paths of 1, 25 and 100 incidents between the same activities, as the map library scales them: by the square root, from nothing to the strongest.
    const several = { ...graph, edges: [1, 25, 100].map((cases) => ({ ...graph.edges.find((edge) => edge.id === pathId)!, id: `path:${cases}`, metrics: { count: cases, cases } })) };
    const scene = buildScene(several, await layout(several, { engine: "dagre" }), { measure, style: styleOver(measure), locale: "en" });
    expect(scene.style.edgeWidth).toEqual({ metric: "cases", scale: "sqrt", range: [1, 6] });
    expect(scene.edgeMarks.map((edge) => edge.width)).toEqual([1, 3, 6]);
  });

  it("writes the supplied median lag before the incidents of a path in the performance measure", async () => {
    const { scene, path } = await written("performance");
    expect(scene.style.edgeColor?.metric).toBe("medianLagHours");
    expect(scene.style.pathLabel).toEqual({ metric: "medianLagHours" });
    // The 25.5 supplied hours, as the library writes hours.
    expect(path(pathId)).toEqual({ label: ["26 h · 1"], notEvaluated: false });
    // The flows from Start and to End are added by the map and have no time: they keep their incidents.
    expect(path(startFlowId(nodeIds[opened]))).toEqual({ label: ["1"], notEvaluated: false });
    expect(path(endFlowId(nodeIds[closed]))).toEqual({ label: ["1"], notEvaluated: false });
  });

  it("writes the supplied median time until the next event on an activity, and a dash where none is supplied", async () => {
    const { scene, line } = await written("performance");
    expect(scene.style.nodeLine).toEqual({ metric: "medianNextHours", format: "toNext", then: "share", missing: "dash" });
    expect(line(opened)).toEqual(["26 h to next", "· 50 %"]);
    // No time until a next event is supplied where no path leads out of the activity.
    expect(line(closed)).toEqual(["–", "· 50 %"]);
    expect(line(checked)).toEqual(["–", "· 50 %"]);
  });

  it.each<Measure>(["frequency", "performance"])("draws supplied median lag in the same classes, including each exact upper bound (%s)", async (measure) => {
    expect(LAG_CLASSES_HOURS).toEqual([24, 168]);
    const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
    const original = graph.edges.find((edge) => edge.id === pathId)!;
    // Literal supplied values at and on either side of the two inclusive upper bounds.
    const lags = [0, 24, 24.000001, 168, 168.000001, 400];
    const several = {
      ...graph,
      edges: lags.map((hours, place) => ({ ...original, id: `path:${place}`, metrics: { ...original.metrics, count: place === 0 ? 100 : 2, cases: place === 0 ? 100 : 2, medianLagHours: hours, usableLagCount: 2 } })),
    };
    const scene = buildScene(several, await layout(several, { engine: "dagre" }), { measure, style: styleOver(measure), locale: "en" });
    const colours = lags.map((_, place) => scene.edgeMarks.find((edge) => edge.id === `path:${place}`)!.color);
    expect(scene.style.edgeColor).toMatchObject({ metric: "medianLagHours", bins: [24, 168] });
    expect(styleOver(measure).edgeColor?.bins).toBe(LAG_CLASSES_HOURS);
    expect(colours.map((colour) => colour.toLowerCase())).toEqual([colorTokens.neutral, colorTokens.neutral, "#2171b5", "#2171b5", "#08306b", "#08306b"]);
    expect(scene.legend.rows).toContainEqual({
      kind: "swatches", title: "Path colour: median lag (min, h, d)", entries: [
        { text: "up to 24 h", color: colorTokens.neutral, pattern: "solid" },
        { text: "24 h to 7.0 d", color: "#2171b5", pattern: "solid" },
        { text: "over 7.0 d", color: "#08306b", pattern: "solid" },
      ],
    });
    expect(scene.legend.rows.some((row) => row.kind === "width" && row.title.startsWith("Path width: cases"))).toBe(true);
  });

  it.each<Measure>(["frequency", "performance"])("keeps missing lag and Start/End out of the slow classes, with incidents still supplying width (%s)", async (measure) => {
    const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
    const original = graph.edges.find((edge) => edge.id === pathId)!;
    const { medianLagHours: _missing, ...withoutLag } = original.metrics!;
    const several = {
      ...graph,
      edges: [
        ...graph.edges.filter((edge) => edge.id !== pathId),
        { ...original, id: "busy-fast", metrics: { ...original.metrics, count: 100, cases: 100, medianLagHours: 0 } },
        { ...original, id: "slower", metrics: { ...original.metrics, count: 999, cases: 25, medianLagHours: 400 } },
        { ...original, id: "missing-lag", metrics: { ...withoutLag, count: 999, cases: 1, usableLagCount: 0 } },
      ],
    };
    const scene = buildScene(several, await layout(several, { engine: "dagre" }), { measure, style: styleOver(measure), locale: "en" });
    const mark = (id: string) => scene.edgeMarks.find((edge) => edge.id === id)!;
    expect(["busy-fast", "slower", "missing-lag"].map((id) => mark(id).width)).toEqual([6, 3, 1]);
    expect(mark("busy-fast")).toMatchObject({ color: colorTokens.neutral });
    expect(mark("busy-fast").notEvaluated).toBeUndefined();
    if (measure === "frequency") {
      expect(styleOver(measure).edgeColor?.required).toBeUndefined();
      expect(mark("missing-lag").color).toBe(colorTokens.neutral);
      expect(mark("missing-lag").notEvaluated).toBeUndefined();
    } else {
      expect(styleOver(measure).edgeColor?.required).toBe(true);
      expect(mark("missing-lag")).toMatchObject({ color: colorTokens.line, notEvaluated: true });
    }
    expect(mark("missing-lag").texts.map((text) => text.text)).toEqual([measure === "frequency" ? "1" : "– · 1"]);
    for (const id of [startFlowId(nodeIds[opened]), endFlowId(nodeIds[closed])]) {
      expect(mark(id)).toMatchObject({ color: colorTokens.neutral });
      expect(mark(id).notEvaluated).toBeUndefined();
      expect(mark(id).texts.map((text) => text.text)).toEqual(["1"]);
    }
    expect(scene.legend.rows.some((row) => row.kind === "key" && row.key === "notEvaluated")).toBe(measure === "performance");
  });

  it("leaves the shortfall measure's own colour and labels to the library", () => {
    expect(styleOver("shortfall")).toEqual({
      edgeWidth: { metric: "cases", range: [1, 6] },
      addedFlowLabel: "Added by the map: start and end of the recorded history.",
    });
  });

  it("keeps added flows dotted when a stage combines several recorded starts and ends", async () => {
    const supplied = suppliedGraph(["A-1", "B-2"]);
    // Two single-record histories in different activities of one analyst-defined stage.
    const singles = {
      ...supplied,
      nodes: supplied.nodes.filter((node) => node.label !== checked).map((node) => ({ ...node, metrics: { ...node.metrics, starts: 1, ends: 1 } })),
      edges: [],
    };
    const named = withStage(noStages, "Recorded activities");
    const stage = named.stages[0].id;
    const definitions = withActivity(withActivity(named, opened, stage), closed, stage);
    const graph = abstract(toFlowGraph(singles, 0, undefined, definitions), { collapse: "all" });
    const scene = buildScene(graph, await layout(graph, { engine: "dagre" }), { measure: "frequency", style: styleOver("frequency"), locale: "en" });
    expect(scene.edgeMarks).toHaveLength(2);
    expect(scene.edgeMarks.map((edge) => [edge.edge.source, edge.edge.target])).toEqual([[START_ID, stage], [stage, END_ID]]);
    for (const edge of scene.edgeMarks) {
      expect(edge.edge.tags).toContain("added-by-map");
      // The library preserves its documented lower bound for merged case counts; it has no case IDs to union.
      expect(edge.edge.metrics).toMatchObject({ count: 2, cases: 1 });
      expect(edge.edge.metricBasis?.cases).toBe("atLeast");
      expect(edge.edge.metrics?.medianLagHours).toBeUndefined();
      expect(edge).toMatchObject({ addedFlow: true, color: colorTokens.neutral, width: 6, dash: [0, 18] });
      expect(edge.texts.map((text) => text.text)).toEqual(["≥1"]);
    }
  });

  it("keeps a reconnected path distinct from added flows and a recorded long self-loop coloured by lag", async () => {
    const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
    const original = graph.edges.find((edge) => edge.id === pathId)!;
    const several = {
      ...graph,
      edges: [
        ...graph.edges,
        { ...original, id: "reconnected", tags: ["reconnected"] },
        { ...original, id: "recorded-loop", target: original.source, metrics: { ...original.metrics, medianLagHours: 192 } },
      ],
    };
    const scene = buildScene(several, await layout(several, { engine: "dagre" }), { measure: "frequency", style: styleOver("frequency"), locale: "en" });
    const reconnected = scene.edgeMarks.find((edge) => edge.id === "reconnected")!;
    expect(reconnected).toMatchObject({ reconnected: true, dash: [6, 5] });
    expect(reconnected.addedFlow).toBeUndefined();
    expect(scene.edgeMarks.find((edge) => edge.id === pathId)?.dash).toBeUndefined();
    const loop = scene.marks.find((mark) => mark.kind === "selfLoop" && mark.overlay.payload?.edgeId === "recorded-loop")!;
    expect(loop).toBeDefined();
    expect(loop.color).toBe("#08306b");
    expect(scene.legend.rows).toContainEqual({ kind: "key", key: "reconnected", glyph: "┄", text: "Not directly observed (re-added)" });
  });
});
