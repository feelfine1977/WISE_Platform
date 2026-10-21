import type { Selection } from "wise-flow/react";
import type { NodeMetrics, SelectionPredicate, SuppliedGraph } from "../generated/selection";
import { flowOf } from "./graph";

/**
 * The supplied times of an activity: the median hours since the event before and until the next
 * event, each with the number of passages it rests on. A median is left out where no passage leads
 * into or out of the activity.
 */
export type ActivityTimes = Pick<NodeMetrics, "medianPreviousHours" | "usablePreviousCount" | "medianNextHours" | "usableNextCount">;

/** The element of the map the analyst selected, named by the supplied labels. */
export type SelectedElement =
  /** `starts` and `ends` are the supplied numbers of incidents that begin and that end with the activity. */
  | { kind: "activity"; id: string; label: string; starts: number; ends: number; times: ActivityTimes }
  /** `bridged` of the path's `passages` pass over records without activity label between the two activities. */
  | { kind: "path"; source: string; target: string; passages: number; bridged: number; medianLagHours?: number | null }
  /**
   * A flow the map adds from Start to an activity (`side` "start") or from an activity to End, for
   * the supplied number of `incidents` that begin or end with that activity.
   */
  | { kind: "boundary"; side: "start" | "end"; activity: string; incidents: number }
  /** An element the map draws that is no supplied activity or path, such as a line for activities it does not show. */
  | { kind: "unrecorded" }
  | { kind: "several" };

/** What a selection on the map names in the supplied graph; nothing for no selection. */
export function selectedElement(graph: SuppliedGraph, selection: Selection): SelectedElement | null {
  const count = selection.nodes.length + selection.edges.length + selection.groups.length;
  if (count === 0) return null;
  if (count > 1 || selection.groups.length > 0) return { kind: "several" };
  if (selection.nodes.length === 1) return elementOf(graph, "node", selection.nodes[0]);
  return elementOf(graph, "edge", selection.edges[0]);
}

/**
 * The supplied activity or path behind an element id of the map. A flow the map adds from Start or
 * to End is no supplied path; it is named by the supplied activity it joins, with that activity's
 * supplied starts or ends.
 */
export function elementOf(graph: SuppliedGraph, kind: "node" | "edge", id: string): SelectedElement {
  if (kind === "node") {
    const node = graph.nodes.find((item) => item.id === id);
    return node
      ? { kind: "activity", id: node.id, label: node.label, starts: node.metrics.starts, ends: node.metrics.ends, times: timesOf(node.metrics) }
      : { kind: "unrecorded" };
  }
  const edge = graph.edges.find((item) => item.id === id);
  if (edge) {
    return {
      kind: "path",
      source: edge.payload.source_activity,
      target: edge.payload.target_activity,
      passages: edge.metrics.count,
      bridged: edge.payload.bridged_passage_count,
      medianLagHours: edge.metrics.medianLagHours ?? null,
    };
  }
  const flow = flowOf(id);
  const joined = flow && graph.nodes.find((item) => item.id === flow.activityId);
  if (!flow || !joined) return { kind: "unrecorded" };
  const incidents = flow.side === "start" ? joined.metrics.starts : joined.metrics.ends;
  // The map draws such a flow only where incidents begin or end; no step is taken from one it does not draw.
  return incidents > 0 ? { kind: "boundary", side: flow.side, activity: joined.label, incidents } : { kind: "unrecorded" };
}

function timesOf({ medianPreviousHours, usablePreviousCount, medianNextHours, usableNextCount }: NodeMetrics): ActivityTimes {
  return {
    ...(medianPreviousHours === undefined ? {} : { medianPreviousHours }),
    usablePreviousCount,
    ...(medianNextHours === undefined ? {} : { medianNextHours }),
    usableNextCount,
  };
}

export interface StepChoice {
  label: string;
  step: SelectionPredicate;
}

/**
 * The steps an element offers: keep the incidents through it, or the incidents not through it. An
 * activity incidents begin or end with also offers to keep those, after its own two steps; a flow
 * from Start or to End offers them and their opposites.
 */
export function stepChoices(element: SelectedElement | null): StepChoice[] {
  if (element?.kind === "activity") {
    const activity = element.label;
    const choices: StepChoice[] = [
      { label: "Keep cases that contain it", step: { kind: "contains_activity", activity, negate: false } },
      { label: "Keep cases that do not contain it", step: { kind: "contains_activity", activity, negate: true } },
    ];
    if (element.starts > 0) choices.push({ label: "Keep cases that begin with it", step: { kind: "starts_with_activity", activity, negate: false } });
    if (element.ends > 0) choices.push({ label: "Keep cases that end with it", step: { kind: "ends_with_activity", activity, negate: false } });
    return choices;
  }
  if (element?.kind === "boundary") {
    const [kind, verb] = element.side === "start" ? (["starts_with_activity", "begin"] as const) : (["ends_with_activity", "end"] as const);
    return [
      { label: `Keep cases that ${verb} with it`, step: { kind, activity: element.activity, negate: false } },
      { label: `Keep cases that do not ${verb} with it`, step: { kind, activity: element.activity, negate: true } },
    ];
  }
  if (element?.kind === "path") {
    const path = { kind: "directly_follows" as const, source_activity: element.source, target_activity: element.target };
    return [
      {
        // A path that passes over records without activity label joins the labelled records around them; its step says so,
        // so that it is not read as the two records directly following each other in the file.
        label:
          element.bridged > 0
            ? `Keep cases where “${element.target}” directly follows “${element.source}” in the activity sequence, records without activity label between them passed over`
            : `Keep cases where “${element.target}” directly follows “${element.source}”`,
        step: { ...path, negate: false },
      },
      { label: "Keep cases where it never does", step: { ...path, negate: true } },
    ];
  }
  return [];
}
