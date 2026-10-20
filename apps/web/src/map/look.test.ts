import { describe, expect, it } from "vitest";
import { type ActivityLabelOptions, activityReferences, buildScene, checkTheme, colorTokens, contrastRatio, defaultTheme, hexToRgb, layout, type Measure, resolveTheme, stateStyle, themeColors } from "wise-flow";
import libraryTokens from "wise-flow/tokens.css?raw";
import { noStages, type StageDefinitions, withActivity, withStage } from "../stages/definitions";
import sheet from "../styles/tokens.css?raw";
import { closed, nodeIds, opened, pathId, suppliedGraph } from "../test/selections";
import { TOP_TO_BOTTOM } from "./arrange";
import { END_ID, endFlowId, START_ID, startFlowId, toFlowGraph } from "./graph";
import { MAP_THEME, nodeSize, tokenValue } from "./look";
import { styleOver } from "./measures";

const theme = resolveTheme(MAP_THEME);

/**
 * The map of both incidents of ../test/selections.ts as the map draws it: in the theme of the map,
 * every node in its size, the activities with their whole names and their incidents. `renamed`
 * gives the first activity, "Eröffnet", another name.
 */
async function drawn(renamed?: string, stages?: StageDefinitions, measure: Measure = "frequency") {
  const supplied = suppliedGraph(["A-1", "B-2"]);
  const named = renamed === undefined ? supplied : { ...supplied, nodes: supplied.nodes.map((node) => (node.label === opened ? { ...node, label: renamed } : node)) };
  const graph = toFlowGraph(named, 0, undefined, stages);
  const positions = await layout(graph, { engine: "dagre", direction: TOP_TO_BOTTOM, nodeSize });
  const activityLabels: ActivityLabelOptions = { mode: "names", references: activityReferences(graph), showCounts: true, caseLabel: "incidents" };
  const scene = buildScene(graph, positions, { theme, locale: "en", activityLabels, measure, style: styleOver(measure) });
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

  it("draws an activity as a card of 200 by 64 with rounded corners, and its share as a bar along the bottom edge", async () => {
    const { node, positions } = await drawn();
    const card = node(nodeIds[opened]);
    expect(positions.nodes[nodeIds[opened]]).toMatchObject({ width: 200, height: 64 });
    expect(card).toMatchObject({ shape: "box", radius: 8, fill: "paper", stroke: { paint: "lineStrong", width: 1 }, band: 8 });
    // One of the two incidents passes the activity: the bar is half as long as the card is wide inside its band and outline, and 3 high.
    expect(card.cue?.share).toBe(0.5);
    expect(card.cue?.stripe).toBeUndefined();
    expect(card.cue?.foot).toMatchObject({ box: { width: (200 - 8 - 1) / 2, height: 3 }, paint: "cueFoot" });
    // The name, then the incidents and their share of all.
    expect(card.texts.map((text) => [text.role, text.text])).toEqual([
      ["nameLine", opened],
      ["countLine", "1"],
      ["share", "· 50 %"],
    ]);
    expect(card.texts.map((text) => [text.size, text.weight, text.paint])).toEqual([
      [13, 500, "ink"],
      [11, 600, "ink"],
      [11, undefined, "inkMuted"],
    ]);
  });

  it("keeps a long name whole on two lines of the card", async () => {
    const long = "Weiterleitung ans Service-Postfach";
    const { node } = await drawn(long);
    const lines = node(nodeIds[opened]).texts.filter((text) => text.role === "nameLine").map((text) => text.text);
    expect(lines).toEqual(["Weiterleitung ans", "Service-Postfach"]);
    expect(node(nodeIds[opened]).texts.map((text) => text.role)).toEqual(["nameLine", "nameLine", "countLine", "share"]);
  });

  it("fills a selected card with the tint of a selection as it looks on the paper, and outlines it in the colour of the focus", async () => {
    const { scene, node } = await drawn();
    expect(stateStyle(scene, "node", node(nodeIds[opened]), { selected: true })).toEqual({ fill: "#dbebf4", stroke: colorTokens.focus });
    expect(stateStyle(scene, "node", node(nodeIds[opened]), { hovered: true })).toBeUndefined();
    // Start and End are not filled: they keep their own colours when selected.
    expect(stateStyle(scene, "node", node(START_ID), { selected: true })).toBeUndefined();

    // The token is the library's translucent tint of a selection painted on its paper, opaque.
    const [red, green, blue, share] = /--wf-selection:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(libraryTokens)!.slice(1).map(Number);
    expect(/--wf-paper:\s*([^;]+);/.exec(libraryTokens)?.[1]).toBe("#ffffff");
    const onPaper = [red, green, blue].map((channel) => Math.round(channel * share + 255 * (1 - share)).toString(16).padStart(2, "0")).join("");
    expect(tokenValue("--color-map-selected")).toBe(`#${onPaper}`);
  });

  it.each<Measure>(["frequency", "performance"])("draws the flows from Start and to End in one flat grey and writes the number of a path in the muted ink (%s)", async (measure) => {
    const { scene } = await drawn(undefined, undefined, measure);
    const edge = (id: string) => scene.edgeMarks.find((mark) => mark.id === id)!;
    for (const id of [startFlowId(nodeIds[opened]), endFlowId(nodeIds[closed])]) {
      expect(edge(id)).toMatchObject({ kind: "flow", color: colorTokens.neutral });
      // Solid: the library's dash says that a path was not directly observed.
      expect(edge(id).dash).toBeUndefined();
    }
    // A path of the log keeps the colour the library gives it in the measure.
    expect(edge(pathId).kind).toBe("follows");
    expect(edge(pathId).color).toBe(buildScene(scene.graph, scene.positions, { measure, style: styleOver(measure) }).edgeMarks.find((mark) => mark.id === pathId)!.color);
    for (const mark of scene.edgeMarks) expect(mark.texts.map((text) => [text.size, text.paint]), mark.id).toEqual([[11, colorTokens.inkMuted]]);
  });

  it("tints the box of a stage lightly with the colour of the stage and writes its title in the ink", async () => {
    const named = withStage(noStages, "Intake");
    const { scene } = await drawn(undefined, withActivity(named, opened, named.stages[0].id));
    expect(scene.groupMarks).toHaveLength(1);
    const [box] = scene.groupMarks;
    expect(box.fill).toEqual({ paint: "value", opacity: 0.12 });
    expect(box.texts).toMatchObject([{ text: "Intake", paint: colorTokens.ink, weight: 600 }]);
    // Without the theme of the map the library outlines a stage without a tint and titles it in the muted ink.
    const plain = buildScene(scene.graph, scene.positions, {}).groupMarks[0];
    expect([plain.fill.opacity, plain.texts[0].paint]).toEqual([0, "inkMuted"]);
  });

  it("colours the stages from a restrained palette in which every title stays readable and every colour has a pattern twin (#71)", () => {
    const { palette, patterns } = theme;
    const colors = themeColors(theme);
    // Six colours that colour-blind readers tell apart (Okabe and Ito), each with its own pattern, so that colour is never the only cue.
    expect(palette.categorical).toHaveLength(6);
    expect(new Set(patterns).size).toBe(palette.categorical.length);
    for (const colour of palette.categorical) {
      // The title of a stage is in the ink on the paper with the stage's colour laid over it at the box's opacity.
      const [r, g, b] = hexToRgb(colour);
      const [pr, pg, pb] = hexToRgb(colors.paper);
      const mix = (one: number, paper: number) => Math.round(paper + (one - paper) * 0.12).toString(16).padStart(2, "0");
      const box = `#${mix(r, pr)}${mix(g, pg)}${mix(b, pb)}`;
      expect(contrastRatio(colors.ink, box), `title on the box of ${colour}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
