import { countOf, utcText, wallText } from "../data/wording";
import type { NamedGroupDefinition, SavedComparison, SavingRefusal } from "../generated/saving";
import { stepWording } from "../map/wording";
import type { SavingProblem } from "./client";

/** What the analyst can do about each refusal of saving, listing or reopening. */
const remedies: Record<SavingRefusal["code"], string> = {
  invalid_request: "This screen and the local service do not agree on the request. Reload the page; if it repeats, restart the application.",
  unsupported_action: "This pipeline action is not supported. Remove it or choose a reviewed application operation; source code cannot be executed by a saved pipeline.",
  unsupported_schema: "This screen and the local service are different versions. Reload the page or restart the application.",
  unsupported_policy: "This screen asked for a policy the local service does not support. Reload the page or restart the application.",
  invalid_parameter: "This screen and the local service do not agree on the request. Reload the page; if it repeats, restart the application.",
  workspace_unavailable: "Open the workspace folder again in the Data area, then try again.",
  workspace_not_writable: "Get write permission for the workspace folder, then save again.",
  source_unavailable: "Add the same source file again in the Data area; it is recognised by its bytes. Then reopen.",
  source_changed: "Add the original source file again in the Data area, then reopen. A changed file is a new source.",
  preparation_unavailable: "Read the source again with the same choices in the Data area, then reopen.",
  preparation_changed: "Read the source again in the Data area and save the investigation anew; the saved revision keeps its meaning.",
  identity_mismatch: "Open the incidents again from the Data area and take the steps again.",
  selection_mismatch: "Open the incidents again from the Data area and take the steps again.",
  comparison_unavailable: "Compare the groups again; the saved comparison cannot be computed on this preparation.",
  comparison_mismatch: "Compare the groups again; the saved comparison no longer gives the same groups.",
  invalid_bookmark: "Remove the bookmark or pin the incident again, then save.",
  score_reference_unavailable: "Save the investigation without the score run.",
  unsupported_score_reference: "Save the investigation without a score run.",
  investigation_unavailable: "Save the investigation as a new one.",
  revision_unavailable: "Show the saved investigations again and choose one from the list.",
  revision_conflict: "Reopen the latest revision from the saved investigations, then save your changes again.",
  malformed_saved_revision: "Restore the named file from a backup, or move it out of the workspace folder.",
  incompatible_saved_revision: "Reopen it with the application version that saved it, or read its source again and save a new investigation.",
  publication_failed: "Try again in a moment; the earlier revisions are unchanged.",
  computation_failed: "Try again. If it fails again, restart the application.",
};

export interface SavingProblemText {
  message: string;
  remedy: string;
}

export function describeSavingProblem(problem: SavingProblem): SavingProblemText {
  switch (problem.kind) {
    case "refusal":
      return { message: problem.refusal.message, remedy: remedies[problem.refusal.code] };
    case "unreachable":
      return { message: "The local service could not be reached.", remedy: "Check that the Python application is still running, then try again." };
    case "http":
      return problem.status === 404 || problem.status === 405
        ? {
            message: `This local service does not offer this operation (HTTP ${problem.status}).`,
            remedy: "Start a version of the application that includes it, then try again.",
          }
        : {
            message: `The local service could not answer this request (HTTP ${problem.status}).`,
            remedy: "Try again; if the failure repeats, restart the Python application.",
          };
    case "unsupported_reply":
      return { message: "The local service sent a reply this screen cannot use.", remedy: problem.detail };
  }
}

const quoted = (text: string) => `“${text}”`;

function groupMembers(definition: NamedGroupDefinition): string {
  if (definition.kind === "explicit_case_ids") return `${countOf(definition.case_ids.length, "named incident")}`;
  if (definition.predicates.length === 0) return "every incident of the parent";
  return definition.predicates.map((step) => stepWording(step).replace(/^Keep incidents/, "incidents")).join(", and ");
}

/** The roles of a saved comparison in words: which group or period is the target and which the reference. */
export function comparisonRoles(comparison: SavedComparison): string {
  const parent = countOf(comparison.parent_case_ids.length, "incident");
  if (comparison.kind === "group") {
    const definition = comparison.definition;
    if (definition.mode === "two_named_groups") {
      return (
        `Target ${quoted(definition.target.name)} (${groupMembers(definition.target.definition)}) against reference ` +
        `${quoted(definition.reference.name)} (${groupMembers(definition.reference.definition)}), within a parent of ${parent}.`
      );
    }
    const steps = definition.predicates.map((step) => stepWording(step).replace(/^Keep incidents/, "incidents")).join(", and ");
    const side = definition.target_side === "kept" ? "kept" : "removed";
    return (
      `Target ${quoted(definition.target_name)}: the ${side} side of ${steps || "no step"}; reference ` +
      `${quoted(definition.reference_name)}: the other side; within a parent of ${parent}.`
    );
  }
  const definition = comparison.definition;
  const time = (value: string) => (definition.target.window.timestamp_kind === "utc_instant" ? utcText(value) : wallText(value));
  const window = (period: typeof definition.target) => `incidents starting from ${time(period.window.start_inclusive)} before ${time(period.window.end_exclusive)}`;
  return (
    `Target ${quoted(definition.target.name)} (${window(definition.target)}) against reference ${quoted(definition.reference.name)} ` +
    `(${window(definition.reference)}), within a parent of ${parent}; at least ${definition.minimum_followup_hours} hours of follow-up.`
  );
}
