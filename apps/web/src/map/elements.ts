import type { Selection } from "wise-flow/react";
import type { SelectionPredicate, SuppliedGraph } from "../generated/selection";

/** The element of the map the analyst selected, named by the supplied labels. */
export type SelectedElement =
  | { kind: "activity"; label: string }
  /** `bridged` of the path's `passages` pass over records without activity label between the two activities. */
  | { kind: "path"; source: string; target: string; passages: number; bridged: number }
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

/** The supplied activity or path behind an element id of the map. */
export function elementOf(graph: SuppliedGraph, kind: "node" | "edge", id: string): SelectedElement {
  if (kind === "node") {
    const node = graph.nodes.find((item) => item.id === id);
    return node ? { kind: "activity", label: node.label } : { kind: "unrecorded" };
  }
  const edge = graph.edges.find((item) => item.id === id);
  return edge
    ? {
        kind: "path",
        source: edge.payload.source_activity,
        target: edge.payload.target_activity,
        passages: edge.metrics.count,
        bridged: edge.payload.bridged_passage_count,
      }
    : { kind: "unrecorded" };
}

export interface StepChoice {
  label: string;
  step: SelectionPredicate;
}

/** The two steps an element offers: keep the incidents through it, or the incidents not through it. */
export function stepChoices(element: SelectedElement | null): StepChoice[] {
  if (element?.kind === "activity") {
    return [
      { label: "Keep incidents that contain it", step: { kind: "contains_activity", activity: element.label, negate: false } },
      { label: "Keep incidents that do not contain it", step: { kind: "contains_activity", activity: element.label, negate: true } },
    ];
  }
  if (element?.kind === "path") {
    const path = { kind: "directly_follows" as const, source_activity: element.source, target_activity: element.target };
    return [
      { label: `Keep incidents where “${element.target}” directly follows “${element.source}”`, step: { ...path, negate: false } },
      { label: "Keep incidents where it never does", step: { ...path, negate: true } },
    ];
  }
  return [];
}
