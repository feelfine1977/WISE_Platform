import type { Measure, StyleSpec } from "wise-flow";

/** What the map opens on: how many incidents pass each path and each activity. */
export const OPENING_MEASURE: Measure = "frequency";

/**
 * Laid over every measure: a path is as wide as its incidents say, from 1 for the rarest paths to
 * 6 for the strongest path of the map, on the library's own scale. The library's widest line is 8,
 * which is heavier than the cards it joins. Tagged Start/End flows use the map-added style and
 * its explicit recorded-history legend.
 */
const BASE_STYLE: StyleSpec = {
  edgeWidth: { metric: "cases", range: [1, 6] },
  addedFlowLabel: "Added by the map: start and end of the recorded history.",
};

/**
 * The bounds in hours of the classes a path's supplied median lag is drawn in under both incident
 * and time measures: up to one day, one day to one week, more than one week. The first class is
 * drawn in neutral grey and only the slower ones in the two darker blues; the legend names the
 * bounds. Missing lag is handled separately by each measure.
 */
export const LAG_CLASSES_HOURS = [24, 168] as const;

/**
 * Incidents set the width and count labels; supplied median lag keeps long waits visible in colour.
 * Without lag the path stays neutral and still displays its supplied incidents.
 */
const IN_INCIDENTS: StyleSpec = {
  ...BASE_STYLE,
  edgeColor: { metric: "medianLagHours", palette: "performance", bins: LAG_CLASSES_HOURS },
  frequencyColorLegend: true,
};

/**
 * Laid over the library's performance measure besides: the same width and lag classes, and an
 * activity without a supplied time until the next event reads "–" in its place. Left to itself, the
 * library writes the activity's count there.
 */
const IN_PERFORMANCE: StyleSpec = {
  ...BASE_STYLE,
  edgeColor: { ...IN_INCIDENTS.edgeColor, required: true },
  nodeLine: { metric: "medianNextHours", missing: "dash" },
};

/**
 * What the application lays over the map library's own style of a measure. What the library calls
 * a style says which supplied metric a mark reads, what stands for a missing one and between which
 * widths a path is drawn; it holds no colour. The measures are the library's: which metric each of
 * them writes on a path and on an activity is its decision, and no number is derived here.
 */
export function styleOver(measure: Measure): StyleSpec {
  return measure === "performance" ? IN_PERFORMANCE : measure === "frequency" ? IN_INCIDENTS : BASE_STYLE;
}

/** What the map is asked for in a measure: the measure itself and what is laid over its style. */
export function askedFor(measure: Measure): { measure: Measure; style: StyleSpec } {
  return { measure, style: styleOver(measure) };
}
