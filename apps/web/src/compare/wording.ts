import { countOf, describeImportProblem, type ImportProblemText } from "../data/wording";
import type {
  CategorySupport,
  ComparisonRefusal,
  ConcentrationRatio,
  FollowupClock,
  NamedGroupDefinition,
  PairSupport,
  PopulationSupport,
  ShareDifference,
} from "../generated/comparison";
import { stepWording } from "../map/wording";
import { percent, points } from "../views/wording";
import type { ComparisonProblem } from "./client";

const quoted = (text: string) => `“${text}”`;
const twoDecimals = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hours = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

/** An opening value as it is shown: missing is "not recorded", and text of blanks only stays visible. */
export function valueText(value: string | null): string {
  if (value === null) return "not recorded";
  if (value.trim() === "") return `${quoted(value)} (blank text)`;
  return value;
}

/** "4 of 8 incidents · 10 records": a supplied part of a supplied whole, both counted in incidents. */
export function partOf(part: PopulationSupport, whole: PopulationSupport, wholeName: string): string {
  return `${part.case_count} of ${countOf(whole.case_count, "incident")} ${wholeName} · ${countOf(part.record_count, "record")}`;
}

/** "3 of 4 (75.0%)", or what stands in for the share of a group without denominator. */
export function shareText(support: CategorySupport): string {
  if (support.share.status === "unavailable") return `${support.case_count} of ${support.denominator}, no share`;
  return `${support.case_count} of ${support.denominator} (${percent(support.share.value)})`;
}

/** The difference of the shares of A and B in percentage points, or why there is none. */
export function differenceText(difference: ShareDifference, names: [string, string]): string {
  if (difference.status === "available") return points(difference.value);
  return `not available: ${emptyReason(difference.reason, names)}`;
}

/** The share of A divided by the share of B, or why there is none. */
export function ratioText(ratio: ConcentrationRatio, names: [string, string]): string {
  if (ratio.status === "available") return `ratio ${twoDecimals.format(ratio.value)}`;
  if (ratio.reason === "zero_reference_share") return `ratio not available: the share in ${names[1]} is 0`;
  return `ratio not available: ${emptyReason(ratio.reason, names)}`;
}

function emptyReason(reason: "empty_target_profile" | "empty_reference_profile" | "empty_both_profiles", [a, b]: [string, string]): string {
  switch (reason) {
    case "empty_target_profile":
      return `${a} has no incident whose first record can be read`;
    case "empty_reference_profile":
      return `${b} has no incident whose first record can be read`;
    case "empty_both_profiles":
      return "neither group has an incident whose first record can be read";
  }
}

/** What a group is, in words: the steps of a selection, or a list that claims no reason. */
export function groupWording(definition: NamedGroupDefinition): string {
  if (definition.kind === "explicit_case_ids") {
    return `${countOf(definition.case_ids.length, "listed incident id")}; the list says nothing about why these incidents belong together`;
  }
  if (definition.predicates.length === 0) return "every incident of the parent (a selection without steps)";
  return definition.predicates.map(stepWording).join("; and ");
}

/** The sentences of the overlap notice, from the supplied pair supports. */
export function overlapSentences(pair: PairSupport, [a, b]: [string, string]): string[] {
  const sentences: string[] = [];
  if (pair.overlap.case_count > 0) {
    sentences.push(
      `${countOf(pair.overlap.case_count, "incident")} with ${countOf(pair.overlap.record_count, "record")} ` +
        `${pair.overlap.case_count === 1 ? "is" : "are"} in both ${a} and ${b}. ` +
        "They are counted in each group, so the counts and records of the two groups overlap and cannot be added.",
    );
  } else {
    sentences.push(`No incident is in both ${a} and ${b}.`);
  }
  if (pair.unevaluable.case_count > 0) {
    sentences.push(
      `${countOf(pair.unevaluable.case_count, "incident")} of the parent cannot be placed in or outside ${a} or ${b}, ` +
        "as what decides their membership cannot be evaluated; they are counted in neither group.",
    );
  }
  if (pair.neither.case_count > 0) {
    sentences.push(`${countOf(pair.neither.case_count, "incident")} of the parent ${pair.neither.case_count === 1 ? "is" : "are"} in neither group.`);
  }
  return sentences;
}

/** A supplied number of hours. */
export function hoursText(value: number): string {
  return `${hours.format(value)} ${value === 1 ? "hour" : "hours"}`;
}

/** The snapshot cutoff stored with the preparation, written on its clock. */
export function cutoffText(clock: FollowupClock): string {
  const point = clock.snapshot_cutoff;
  if (point.timestamp_kind === "utc_instant") return `${point.utc_instant.replace("T", " ").replace(/:00(\.0+)?Z$/, "").replace(/Z$/, "")} UTC`;
  return `${point.local_timestamp.replace("T", " ").replace(/:00(\.0+)?$/, "")} as recorded`;
}

/** What the analyst can do about each refusal. */
const remedies: Record<ComparisonRefusal["code"], string> = {
  invalid_request: "This screen and the local service do not agree on the request. Reload the page; if it repeats, restart the application.",
  unsupported_schema: "This screen and the local service are different versions. Reload the page or restart the application.",
  unsupported_policy: "This screen asked for a comparison the local service does not support. Reload the page or restart the application.",
  invalid_parameter: "Check the names and the minimum follow-up, then compare again.",
  workspace_unavailable: "Open the workspace again in the Data area.",
  source_unavailable: "Add the file again in the Data area; the workspace no longer holds these bytes.",
  preparation_unavailable: "Read the source again with the same choices in the Data area.",
  identity_mismatch: "The source or its reading changed. Open the incidents again from the Data area.",
  population_unavailable: "Open the incidents again from the Data area.",
  invalid_predicate: "Take the group again from a selection in Investigations.",
  invalid_parent: "Open the incidents again from the Data area.",
  unknown_case: "Take the group again from the incidents of this preparation.",
  case_outside_parent: "Take the group again from the incidents of this preparation.",
  unmapped_context_column: "Choose one of the context columns of this preparation.",
  invalid_window: "Pick a last day on or after the first day of each period.",
  clock_mismatch: "Open the incidents again from the Data area, then pick the periods again.",
  computation_failed: "Try again. If it fails again, restart the application.",
};

export function describeComparisonProblem(problem: ComparisonProblem): ImportProblemText {
  if (problem.kind === "refusal") {
    return { message: problem.refusal.message, remedy: remedies[problem.refusal.code], field: problem.refusal.field };
  }
  return describeImportProblem(problem);
}
