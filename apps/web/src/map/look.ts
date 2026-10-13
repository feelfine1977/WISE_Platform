import { defaultNodeSize, type FlowNode, type NodeSize, type ThemeOverrides } from "wise-flow";
import sheet from "../styles/tokens.css?raw";

/*
 * The look of the map: the sizes of its nodes and the theme the map library draws them in. What is
 * set here reaches the map drawn as elements of the page, the library's Canvas and its exports
 * alike. What only a stylesheet can set is in `look.css`, for the map drawn as elements alone.
 */

/**
 * The value the token stylesheet gives one of its custom properties. The map library draws from a
 * theme, which takes a colour or a size as a value and never as a custom property. The values are
 * written in the token stylesheet all the same, like every other, and read from its text here.
 */
export function tokenValue(name: string): string {
  const declared = new RegExp(`(?<![\\w-])${name}:\\s*([^;]+);`).exec(sheet);
  if (declared === null) throw new Error(`The token stylesheet declares no ${name}.`);
  return declared[1].trim();
}

const START = tokenValue("--color-map-start");
const END = tokenValue("--color-map-end");

/** The circle of Start and End. The frame of the map hands the same size to the library's stylesheet. */
const EVENT: NodeSize = { width: Number.parseFloat(tokenValue("--size-map-event")), height: Number.parseFloat(tokenValue("--size-map-event")) };

/** The card of an activity, as wide as the map library makes a card that holds a whole name. */
const CARD: NodeSize = { width: 280, height: 64 };

/**
 * The size of a node of the map, for the map and for the arrangement of the whole parent alike: a
 * selection's map that reads its places from the parent's draws every node in the box it has there.
 */
export function nodeSize(node: FlowNode): NodeSize {
  if (node.kind === "event") return EVENT;
  return node.kind === "activity" ? CARD : defaultNodeSize(node);
}

/**
 * The theme of the map, as changes over the map library's own.
 *
 * Start and End are found at once: Start is a ring in its green on the paper, End a disc in its
 * purple, both with an outline twice as heavy as a card's. Ring against disc tells them apart
 * without the colours. Their names are as large as a title and semibold.
 */
export const MAP_THEME: ThemeOverrides = {
  text: { eventLabel: { size: Number(tokenValue("--size-map-event-name")) } },
  rules: [
    { match: { part: "node", kind: "event" }, set: { strokeWeight: "strong", text: { label: { weight: 600 } } } },
    { match: { part: "node", kind: "event", tag: "start" }, set: { fill: "paper", stroke: START } },
    { match: { part: "node", kind: "event", tag: "end" }, set: { fill: END, stroke: END } },
  ],
};
