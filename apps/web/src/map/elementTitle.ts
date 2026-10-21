import type { SelectedElement } from "./elements";

/** The name of a path between two activities, by their supplied labels. */
export const pathTitle = (source: string, target: string) => `Path from “${source}” to “${target}”`;

/** The name of a flow the map adds from Start to an activity, or from an activity to End. */
export const flowTitle = (side: "start" | "end", activity: string) => (side === "start" ? `Flow from Start to “${activity}”` : `Flow from “${activity}” to End`);

/** The heading over the steps of a selected element; over none, what the steps do. */
export function elementTitle(element: SelectedElement | null): string {
  if (element?.kind === "activity") return `Activity “${element.label}”`;
  if (element?.kind === "path") return pathTitle(element.source, element.target);
  if (element?.kind === "boundary") return flowTitle(element.side, element.activity);
  return "Keep or remove cases";
}
