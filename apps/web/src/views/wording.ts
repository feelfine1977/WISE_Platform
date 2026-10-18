import { describeImportProblem, type ImportProblemText } from "../data/wording";
import type { ViewProblem } from "./client";
import type { CategoryShare, PopulationViewRefusal } from "./messages";

const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A supplied share as a percentage with one decimal. */
export function percent(share: number): string {
  return `${oneDecimal.format(share * 100)}%`;
}

/** A supplied difference in percentage points, with its sign. */
export function points(difference: number, unit = "pp"): string {
  const text = oneDecimal.format(Math.abs(difference));
  const sign = text === "0.0" ? "±" : difference > 0 ? "+" : "−";
  return `${sign}${text} ${unit}`;
}

/** "1 of 3 (33.3%)", or what stands in for a share of an empty group. */
export function shareOf(part: CategoryShare): string {
  if (part.share === null) return `${part.count} of ${part.denominator}, no share`;
  return `${part.count} of ${part.denominator} (${percent(part.share)})`;
}

/** What the analyst can do about each refusal of these operations. */
const remedies: Record<PopulationViewRefusal["code"], string> = {
  invalid_request: "This screen and the local service do not agree on the request. Reload the page; if it repeats, restart the application.",
  unsupported_schema: "This screen and the local service are different versions. Reload the page or restart the application.",
  workspace_unavailable: "Open the workspace again in the Data area.",
  workspace_not_writable: "Get write permission for the workspace folder, then open it again in the Data area.",
  workspace_incompatible: "Open the workspace again in the Data area; the folder no longer holds this workspace.",
  source_unavailable: "Add the file again in the Data area; the workspace no longer holds these bytes.",
  memory_unavailable: "The application does not have enough memory for this now. Close other work you have open, then try again.",
  preparation_unavailable: "Read the source again with the same choices in the Data area.",
  identity_mismatch: "The source or its reading changed. Open the incidents again from the Data area.",
  population_unavailable: "Open the incidents again from the Data area.",
  invalid_parent: "Open the incidents again from the Data area.",
  unknown_case: "Open the incidents again from the Data area.",
  no_context_columns: "Choose one or more context columns when you read the source in the Data area.",
  computation_failed: "Try again. If it fails again, restart the application.",
};

export function describeViewProblem(problem: ViewProblem): ImportProblemText {
  if (problem.kind === "refusal") {
    return { message: problem.refusal.message, remedy: remedies[problem.refusal.code], field: problem.refusal.field };
  }
  return describeImportProblem(problem);
}
