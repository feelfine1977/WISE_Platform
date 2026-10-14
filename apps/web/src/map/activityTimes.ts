import { formatHours } from "wise-flow";
import { countOf } from "../data/wording";
import type { SuppliedGraph } from "../generated/selection";

/**
 * A duration in the format the map library writes every time in (min, h, d; one decimal under 10).
 * A time above zero that the format would write as no time at all is said to be there.
 */
export function duration(hours: number): string {
  const written = formatHours(hours, "en");
  return hours > 0 && /^0(\.0)? min$/.test(written) ? "< 1 min" : written;
}

/** One of the two times of an activity: its supplied median, the passages it rests on, or why it is not available. */
export interface TimeRow {
  name: "From previous" | "To next";
  median: number | null;
  passages: number;
  reason: string | null;
}

/** The two times of an activity as the local service supplied them. */
export function timeRows(graph: SuppliedGraph, nodeId: string): TimeRow[] {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return [];
  const { medianPreviousHours, usablePreviousCount, medianNextHours, usableNextCount } = node.metrics;
  return [
    {
      name: "From previous",
      median: medianPreviousHours ?? null,
      passages: usablePreviousCount,
      reason: medianPreviousHours === undefined ? "no labelled record comes before it in an incident whose order is known" : null,
    },
    {
      name: "To next",
      median: medianNextHours ?? null,
      passages: usableNextCount,
      reason: medianNextHours === undefined ? "no labelled record follows it in an incident whose order is known" : null,
    },
  ];
}

/** A path into or out of an activity: the activity at its other end, its passages and its supplied median lag. */
export interface PathOfActivity {
  id: string;
  other: string;
  passages: number;
  lag: number | null;
  bridged: number;
}

/** The paths into and out of an activity, the strongest first; a repeat of the activity stands in both lists. */
export function pathsOf(graph: SuppliedGraph, nodeId: string): { into: PathOfActivity[]; out: PathOfActivity[] } {
  const label = (id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id;
  const ofEdge = (edge: SuppliedGraph["edges"][number], other: string): PathOfActivity => ({
    id: edge.id,
    other: label(other),
    passages: edge.metrics.count,
    lag: edge.metrics.usableLagCount > 0 ? edge.metrics.medianLagHours : null,
    bridged: edge.payload.bridged_passage_count,
  });
  const strongestFirst = (one: PathOfActivity, other: PathOfActivity) => other.passages - one.passages || one.other.localeCompare(other.other);
  return {
    into: graph.edges.filter((edge) => edge.target === nodeId).map((edge) => ofEdge(edge, edge.source)).sort(strongestFirst),
    out: graph.edges.filter((edge) => edge.source === nodeId).map((edge) => ofEdge(edge, edge.target)).sort(strongestFirst),
  };
}

/** What the times of an activity rest on, said only where it applies: the clock, bridged records, repeats and incidents left out. */
export function activityNotes(graph: SuppliedGraph, nodeId: string): string[] {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return [];
  const { into, out } = pathsOf(graph, nodeId);
  const bridged = [...into, ...out].filter((path, place, all) => all.findIndex((other) => other.id === path.id) === place).reduce((sum, path) => sum + path.bridged, 0);
  const notes: string[] = [];
  if (graph.meta.timestamp_kind === "wall_clock") notes.push(`Hours of the recorded wall clock. ${graph.meta.clock_limitation ?? ""}`.trim());
  if (bridged > 0) notes.push(`${countOf(bridged, "passage")} of these paths pass over records without activity label; they join the labelled records around them.`);
  if (node.metrics.count > node.metrics.cases) {
    notes.push(`Some incidents have this activity more than once (${countOf(node.metrics.count, "record")} in ${countOf(node.metrics.cases, "incident")}); each record counts.`);
  }
  const left = graph.meta.sequence_unevaluable_case_count;
  if (left > 0) notes.push(`${countOf(left, "incident")} whose order of records is not known ${left === 1 ? "is" : "are"} not in these times.`);
  return notes;
}
