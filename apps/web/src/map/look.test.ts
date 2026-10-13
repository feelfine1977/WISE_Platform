import { describe, expect, it } from "vitest";
import { buildScene, checkTheme, defaultTheme, layout, resolveTheme } from "wise-flow";
import sheet from "../styles/tokens.css?raw";
import { suppliedGraph } from "../test/selections";
import { TOP_TO_BOTTOM } from "./arrange";
import { END_ID, START_ID, toFlowGraph } from "./graph";
import { MAP_THEME, nodeSize, tokenValue } from "./look";

const theme = resolveTheme(MAP_THEME);

/** The map of both incidents of ../test/selections.ts as the map draws it: in the theme of the map, every node in its size. */
async function drawn() {
  const graph = toFlowGraph(suppliedGraph(["A-1", "B-2"]));
  const positions = await layout(graph, { engine: "dagre", direction: TOP_TO_BOTTOM, nodeSize });
  const scene = buildScene(graph, positions, { theme, locale: "en" });
  const node = (id: string) => scene.nodeMarks.find((mark) => mark.id === id)!;
  return { graph, positions, scene, node };
}

describe("the values the theme of the map reads from the token stylesheet", () => {
  it("are those written there, and a token that is not declared is an error", () => {
    expect(tokenValue("--color-map-start")).toBe("#205840");
    expect(tokenValue("--color-map-end")).toBe("#803068");
    expect(tokenValue("--size-map-event")).toBe("40px");
    // A name is read whole: a token whose name only begins or ends with it is another one.
    expect(tokenValue("--size-map-event-name")).toBe("15");
    expect(() => tokenValue("--color-map")).toThrow("The token stylesheet declares no --color-map.");
    expect(() => tokenValue("--map-start")).toThrow();
  });

  it("gives the frame of the map the size of an event's circle that the arrangement gives it", () => {
    expect(nodeSize({ id: START_ID, kind: "event", label: "Start" })).toEqual({ width: 40, height: 40 });
    const frame = /\.map-frame\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(frame).toContain("--wf-event-width: var(--size-map-event);");
    expect(frame).toContain("--wf-event-height: var(--size-map-event);");
  });
});

describe("the theme of the map", () => {
  it("falls short of nothing the map library asks of a theme", () => {
    expect(checkTheme(defaultTheme)).toEqual([]);
    expect(checkTheme(theme)).toEqual([]);
  });

  it("draws Start as a ring in its green on the paper and End as a disc in its purple, both found at once", async () => {
    const { node, positions } = await drawn();
    const [start, end] = [node(START_ID), node(END_ID)];
    expect(start).toMatchObject({ shape: "circle", radius: 20, fill: "#ffffff", stroke: { paint: "#205840", width: 2 } });
    expect(end).toMatchObject({ shape: "circle", radius: 20, fill: "#803068", stroke: { paint: "#803068", width: 2 } });
    expect(positions.nodes[START_ID]).toMatchObject({ width: 40, height: 40 });
    expect(positions.nodes[END_ID]).toMatchObject({ width: 40, height: 40 });
    // Their names are as large as a title and semibold.
    for (const mark of [start, end]) expect(mark.texts).toMatchObject([{ role: "label", size: 15, weight: 600, paint: "ink" }]);
    expect([start.texts[0].text, end.texts[0].text]).toEqual(["Start", "End"]);
  });
});
