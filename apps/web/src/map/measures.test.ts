import { describe, expect, it } from "vitest";
import { buildScene, layout, type Measure } from "wise-flow";
import { checked, closed, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { endFlowId, startFlowId, toFlowGraph } from "./graph";
import { OPENING_MEASURE, styleOver } from "./measures";

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
    expect(styleOver(OPENING_MEASURE)).toBeUndefined();
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
});
