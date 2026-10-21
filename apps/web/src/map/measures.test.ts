import { describe, expect, it } from "vitest";
import { buildScene, layout, legendOfScene, type Measure } from "wise-flow";
import { checked, closed, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { endFlowId, startFlowId, toFlowGraph } from "./graph";
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
    // Only the widths of the paths are laid over the library's style of the counts.
    expect(styleOver(OPENING_MEASURE)).toEqual({ edgeWidth: { metric: "cases", range: [1, 6] } });
    const { scene, line, path } = await written(OPENING_MEASURE);
    expect(scene.scales.pathMetric).toBe("cases");
    expect(scene.style.pathLabel).toBeUndefined();
    expect(scene.style.nodeLine).toBeUndefined();
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
    expect(line(closed)).toEqual(["– to next", "· 50 %"]);
    expect(line(checked)).toEqual(["– to next", "· 50 %"]);
  });
});

describe("the lag of the paths in classes in the Time measure (#86)", () => {
  /** A busy path of no lag, a rare slow path, one between, and one without a usable lag, as the library colours them in the Time measure. */
  async function classed() {
    const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
    const template = graph.edges.find((edge) => edge.id === pathId)!;
    const paths = [
      { id: "busy-zero", metrics: { count: 900, cases: 800, medianLagHours: 0, usableLagCount: 900 } },
      { id: "under-a-day", metrics: { count: 40, cases: 40, medianLagHours: 23.9, usableLagCount: 40 } },
      { id: "exactly-a-day", metrics: { count: 30, cases: 30, medianLagHours: 24, usableLagCount: 30 } },
      { id: "days", metrics: { count: 20, cases: 20, medianLagHours: 72, usableLagCount: 20 } },
      { id: "rare-slow", metrics: { count: 2, cases: 2, medianLagHours: 900, usableLagCount: 2 } },
      { id: "no-lag", metrics: { count: 5, cases: 5 } },
    ].map((path) => ({ ...template, ...path, metrics: path.metrics as Record<string, number> }));
    const several = { ...graph, edges: paths };
    const scene = buildScene(several, await layout(several, { engine: "dagre" }), { measure: "performance", style: styleOver("performance"), locale: "en" });
    const colour = (id: string) => scene.edgeMarks.find((edge) => edge.id === id)!.color;
    return { scene, colour };
  }

  it("draws a path of little or no lag in the neutral grey, never blue, and the slower classes in the readable blues", async () => {
    const { scene, colour } = await classed();
    expect(LAG_CLASSES_HOURS).toEqual([24, 168]);
    const legend = scene.scales.legend.find((item) => item.kind === "classes");
    expect(legend).toMatchObject({ kind: "classes", metric: "medianLagHours", bounds: [24, 168] });
    const [neutral, blue, darker] = (legend as { colors: string[] }).colors;
    // The busy path of no lag, the path just under a day and the one exactly at the bound are in the first class: the neutral grey.
    expect([colour("busy-zero"), colour("under-a-day"), colour("exactly-a-day")]).toEqual([neutral, neutral, neutral]);
    expect([colour("days"), colour("rare-slow")]).toEqual([blue, darker]);
    expect(new Set([neutral, blue, darker]).size).toBe(3);
    // A path without a usable lag stays as before: not evaluated, its label a dash.
    const missing = scene.edgeMarks.find((edge) => edge.id === "no-lag")!;
    expect(missing.notEvaluated).toBe(true);
    expect(missing.texts.map((text) => text.text)).toEqual(["– · 5"]);
  });

  it("names the classes in the legend with their bounds as durations", async () => {
    const { scene } = await classed();
    const swatches = legendOfScene(scene).rows.find((row) => row.kind === "swatches");
    expect(swatches && "entries" in swatches ? swatches.entries.map((entry) => entry.text) : null).toEqual(["up to 24 h", "24 h to 7.0 d", "over 7.0 d"]);
  });
});
