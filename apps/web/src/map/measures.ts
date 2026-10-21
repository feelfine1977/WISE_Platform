import type { Measure, StyleSpec } from "wise-flow";

/** What the map opens on: how many incidents pass each path and each activity. */
export const OPENING_MEASURE: Measure = "frequency";

/**
 * Laid over every measure: a path is as wide as its incidents say, from 1 for the rarest paths to
 * 6 for the strongest path of the map, on the library's own scale. The library's widest line is 8,
 * which is heavier than the cards it joins.
 */
const WIDTH_BY_INCIDENTS: StyleSpec = { edgeWidth: { metric: "cases", range: [1, 6] } };

/**
 * Laid over the library's performance measure besides: an activity without a supplied time until
 * the next event reads "–" in its place. Left to itself, the library writes the activity's count there.
 */
/**
 * The bounds of the classes of a path's median lag in the Time measure, in hours: up to one day, one day to one week,
 * more than one week. The library draws the first class in its neutral grey and the others in the two blues of its
 * performance palette that stand out from the paper, so a busy path of little lag is quiet and never blue; a value on
 * a bound belongs to the class below it, and the legend names each class with its bounds as durations.
 */
export const LAG_CLASSES_HOURS = [24, 168] as const;

const IN_PERFORMANCE: StyleSpec = {
  ...WIDTH_BY_INCIDENTS,
  nodeLine: { metric: "medianNextHours", missing: "dash" },
  edgeColor: { bins: [...LAG_CLASSES_HOURS] },
};

/**
 * What the application lays over the map library's own style of a measure. What the library calls
 * a style says which supplied metric a mark reads, what stands for a missing one and between which
 * widths a path is drawn; it holds no colour. The measures are the library's: which metric each of
 * them writes on a path and on an activity is its decision, and no number is derived here.
 */
export function styleOver(measure: Measure): StyleSpec {
  return measure === "performance" ? IN_PERFORMANCE : WIDTH_BY_INCIDENTS;
}

/** What the map is asked for in a measure: the measure itself and what is laid over its style. */
export function askedFor(measure: Measure): { measure: Measure; style: StyleSpec } {
  return { measure, style: styleOver(measure) };
}
