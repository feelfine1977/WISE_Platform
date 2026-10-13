import type { Measure, StyleSpec } from "wise-flow";

/** What the map opens on: how many incidents pass each path and each activity. */
export const OPENING_MEASURE: Measure = "frequency";

/**
 * Laid over the library's performance measure: an activity without a supplied time until the next
 * event reads "–" in its place. Left to itself, the library writes the activity's count there.
 */
const NO_TIME_AS_DASH: StyleSpec = { nodeLine: { metric: "medianNextHours", missing: "dash" } };

/**
 * What the application lays over the map library's own style of a measure. What the library calls
 * a style says which supplied metric a mark reads and what stands for a missing one; it holds no
 * colour and no size. The measures are the library's: which metric each of them writes on a path
 * and on an activity is its decision, and no number is derived here.
 */
export function styleOver(measure: Measure): StyleSpec | undefined {
  return measure === "performance" ? NO_TIME_AS_DASH : undefined;
}

/** What the map is asked for in a measure: the measure itself and what is laid over its style. */
export function askedFor(measure: Measure): { measure: Measure; style: StyleSpec | undefined } {
  return { measure, style: styleOver(measure) };
}
