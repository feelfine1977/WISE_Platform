import { countOf } from "../data/wording";
import type { GraphCoverage, PopulationSupport, PredicateResult, SelectionPredicate, SelectionRefusal } from "../generated/selection";
import type { SelectionProblem } from "./client";

const quoted = (text: string) => /[\r\n\t]/.test(text) ? JSON.stringify(text) : `“${text}”`;

/** The names of the context columns of the reading shown, by their place in the source. */
let contextColumnNames: ReadonlyMap<number, string> = new Map();

/**
 * Tells the wording the names of the context columns of the reading shown, so that a step names
 * its column by its name. Without a name for a column, the step names it by its place.
 */
export function nameContextColumns(names: ReadonlyMap<number, string>): void {
  contextColumnNames = names;
}

function columnWording(index: number): string {
  const name = contextColumnNames.get(index)?.trim();
  return name ? `the column ${quoted(name)}` : `column ${index}`;
}

/** What a step keeps, in words. */
/** Up to this many incident numbers a step names every one. */
const NUMBERS_NAMED = 5;

export function stepWording(step: SelectionPredicate): string {
  switch (step.kind) {
    case "contains_activity":
      return step.negate
        ? `Keep incidents that do not contain ${quoted(step.activity)}`
        : `Keep incidents that contain ${quoted(step.activity)}`;
    case "directly_follows":
      return step.negate
        ? `Keep incidents where ${quoted(step.target_activity)} never directly follows ${quoted(step.source_activity)}`
        : `Keep incidents where ${quoted(step.target_activity)} directly follows ${quoted(step.source_activity)}`;
    case "opening_attribute_equals": {
      const value = step.value === null ? "no value" : `the value ${quoted(step.value)}`;
      return step.negate
        ? `Keep incidents whose first record does not have ${value} in ${columnWording(step.column_index)}`
        : `Keep incidents whose first record has ${value} in ${columnWording(step.column_index)}`;
    }
    case "case_id_in": {
      // A long list, as a group hands over, is named by its count and its first numbers; the step holds every one.
      const shown = step.case_ids.length > NUMBERS_NAMED ? step.case_ids.slice(0, 3) : step.case_ids;
      const rest = step.case_ids.length - shown.length;
      const numbers = `${shown.map(quoted).join(", ")}${rest > 0 ? ` and ${rest.toLocaleString("en")} more` : ""}`;
      const these = step.case_ids.length > NUMBERS_NAMED ? `the ${step.case_ids.length.toLocaleString("en")} exact numbers` : "these exact numbers";
      return `Keep incidents ${step.negate ? "outside" : "with"} ${these}: ${numbers}`;
    }
    case "case_start_in_window":
      return `Keep incidents whose first record ${step.negate ? "is outside" : "is in"} ${step.window.start_inclusive} to ${step.window.end_exclusive} (end excluded; ${step.window.timestamp_kind === "utc_instant" ? "UTC" : "recorded wall clock"})`;
    case "opening_attribute_in":
    case "record_attribute_in": {
      const values = step.values.map((value) => value === null ? "no value" : quoted(value)).join(" or ");
      const anchor = step.kind === "opening_attribute_in" ? "the first record" : "any record";
      return step.negate
        ? step.kind === "record_attribute_in"
          ? `Keep incidents where no raw record has ${values} in ${columnWording(step.column_index)}`
          : `Keep incidents where the first record does not have ${values} in ${columnWording(step.column_index)}`
        : `Keep incidents where ${anchor} has ${values} in ${columnWording(step.column_index)}`;
    }
    case "observed_span_at_least":
    case "max_raw_gap_at_least": {
      const measure = step.kind === "observed_span_at_least" ? "recorded span" : "longest adjacent recorded gap";
      return `Keep incidents with ${measure} ${step.negate ? "less than" : "at least"} ${step.hours} hours`;
    }
    case "raw_record_count_between":
      return `Keep incidents with raw-record count ${step.negate ? "outside" : "in"} ${step.minimum_records} to ${step.maximum_records ?? "no upper limit"} (bounds included)`;
    case "observed_span_between":
    case "max_raw_gap_between": {
      const measure = step.kind === "observed_span_between" ? "recorded span" : "longest adjacent raw-record gap";
      return `Keep incidents with ${measure} ${step.negate ? "outside" : "in"} ${step.minimum_hours} to ${step.maximum_hours ?? "no upper limit"} hours (bounds included)`;
    }
    case "directly_follows_lag_between":
      return `Keep incidents ${step.negate ? "not matching" : "matching"} ${step.quantifier === "any" ? "at least one" : "every"} passage from ${quoted(step.source_activity)} to ${quoted(step.target_activity)} in ${step.minimum_hours} to ${step.maximum_hours ?? "no upper limit"} hours (bounds included; ${step.negate ? "known incidents with no passage are included" : "a passage is required"})`;
    case "starts_with_activity":
      return step.negate
        ? `Keep incidents that do not begin with ${quoted(step.activity)}`
        : `Keep incidents that begin with ${quoted(step.activity)}`;
    case "ends_with_activity":
      return step.negate
        ? `Keep incidents that do not end with ${quoted(step.activity)}`
        : `Keep incidents that end with ${quoted(step.activity)}`;
  }
}

/** How many incidents on the map begin or end with the activity of a flow from Start or to End. */
export function boundaryLine(side: "start" | "end", activity: string, incidents: number): string {
  const verb = side === "start" ? "begin" : "end";
  return `${countOf(incidents, "incident")} on the map ${incidents === 1 ? `${verb}s` : verb} with ${quoted(activity)}.`;
}

/** A supplied support as incidents and their records. */
export function supportText(support: PopulationSupport): string {
  return `${countOf(support.case_count, "incident")} · ${countOf(support.record_count, "record")}`;
}

/** The three supports of one step, each counted over the whole parent. */
export function stepCounts(result: PredicateResult): [string, string][] {
  return [
    ["Kept", supportText(result.kept)],
    ["Removed", supportText(result.removed)],
    ["Not evaluable", supportText(result.unevaluable)],
  ];
}

/** Why the counts of the steps do not add up to the incidents removed by all of them. */
export function overlapLine(parent: PopulationSupport): string {
  return (
    `Each step is counted on its own over all ${countOf(parent.case_count, "incident")} of the parent. ` +
    "An incident that several steps remove is counted by each of them, so the removals overlap and do not add up."
  );
}

/**
 * Where the measures of the map are chosen and what each of them writes. The names are the map
 * library's, as its legend shows them. Every number is a supplied one.
 */
export const MEASURES_LINE =
  "Measures: the legend on the map, shown whole, switches what the map writes. " +
  "Frequency: the incidents on every path and activity. " +
  "Performance: before the incidents of a path its median lag, and on an activity the median time until the next event, with “–” where none is available; " +
  "the time since the event before is said under the map for a selected activity. " +
  "Shortfall has no values here: no expectation results are supplied to the map.";

/**
 * The count of incidents whose order of records cannot be evaluated for paths, as it stands in the
 * row above the map while it is above zero; null at zero. It limits every path, so it is never only
 * in "About this map".
 */
export function unevaluableLine(meta: GraphCoverage): string | null {
  const count = meta.sequence_unevaluable_case_count;
  return count === 0 ? null : `${countOf(count, "incident")} not evaluable for paths`;
}

/** The tag of times read as recorded, without a time zone; null for UTC instants. It changes what every lag means, so it stays in view. */
export function clockTag(meta: GraphCoverage): string | null {
  return meta.timestamp_kind === "wall_clock" ? "Wall clock" : null;
}

/** The sentences under the map that say what its numbers count, from the map's own coverage. */
export function mapCaption(meta: GraphCoverage): string[] {
  return [
    `Activities count labelled records and distinct incidents of the ${countOf(meta.node_case_denominator, "incident")} on the map.`,
    `Paths count passages and distinct incidents of the ${countOf(meta.path_case_denominator, "incident")} whose order of records can be evaluated.`,
    `${countOf(meta.sequence_unevaluable_case_count, "incident")} with ${countOf(meta.sequence_unevaluable_record_count, "record")} ` +
      `${meta.sequence_unevaluable_case_count === 1 ? "is" : "are"} not evaluable for paths; ` +
      `${countOf(meta.omitted_activity_record_count, "record")} ${meta.omitted_activity_record_count === 1 ? "has" : "have"} no activity label.`,
    "Observed labelled starts and ends: an incident starts or ends at an activity only when its first or last record carries that label.",
    "Start and End are added by the map: a flow leaves Start for an activity incidents begin with and enters End from an activity they end with, each with that number of incidents. " +
      "Start and End are always shown, each with the strongest flow among the activities shown. The Paths detail ranks the paths by their incidents; another flow is drawn when it carries at least as many incidents as the weakest path drawn by frequency, " +
      "and all are drawn when every path is; the menu of an activity offers the incidents that begin or end with it also while its flow is not drawn.",
    lagLine(meta),
    MEASURES_LINE,
  ];
}

/**
 * What is said under the map while some flows from Start or to End are not drawn; null when all are.
 * The numbers are the map's own: the flows it has, those it draws, and the incidents a flow needs.
 */
export function flowsLine(coverage: { flows: number; drawn: number; unshown?: number }, least: number): string | null {
  const left = coverage.flows - coverage.drawn;
  if (left <= 0) return null;
  const unshown = Math.min(left, coverage.unshown ?? 0);
  const weak = left - unshown;
  const fewer = Number.isFinite(least) ? `fewer than ${countOf(least, "incident")}` : null;
  const start = `Not drawn at this detail: ${left} of the ${coverage.flows} flows from Start and to End`;
  if (unshown === 0) return `${start}${fewer ? `, ${left === 1 ? "with" : "each with"} ${fewer}` : ""}. The Paths slider draws more.`;
  if (weak === 0) return `${start}, of activities that are not shown. The Activities slider shows more.`;
  return `${start}: ${unshown} of activities that are not shown, ${weak}${fewer ? ` with ${fewer}` : " more"}. The sliders draw more.`;
}

export function lagLine(meta: GraphCoverage): string {
  if (meta.lag_clock === "recorded_wall_clock_hours") {
    return `Lag: the median of hours of the recorded wall clock between the two records of a path. ${meta.clock_limitation}`;
  }
  return "Lag: the median of elapsed hours between the two records of a path.";
}

/** Every coverage figure of the map, for the disclosure under the caption. */
export function coverageRows(meta: GraphCoverage): [string, string][] {
  return [
    ["Incidents on the map", countOf(meta.selected_case_count, "incident")],
    ["Records of these incidents", countOf(meta.raw_record_count, "record")],
    ["Records with an activity label", countOf(meta.mapped_record_count, "record")],
    ["Records without activity label", countOf(meta.omitted_activity_record_count, "record")],
    ["Incidents whose order can be evaluated", countOf(meta.sequence_evaluable_case_count, "incident")],
    ["Incidents not evaluable for paths", countOf(meta.sequence_unevaluable_case_count, "incident")],
    ["Records of incidents not evaluable for paths", countOf(meta.sequence_unevaluable_record_count, "record")],
    ["Activities are counted over", countOf(meta.node_case_denominator, "incident")],
    ["Paths are counted over", countOf(meta.path_case_denominator, "incident")],
    ["Times", meta.timestamp_kind === "wall_clock" ? "as recorded (wall clock)" : "UTC instants"],
    ["Lag", meta.lag_clock === "recorded_wall_clock_hours" ? "hours of the recorded wall clock" : "elapsed hours"],
    ["Starts and ends", `observed labelled starts and ends (${meta.boundary_policy})`],
    ["Missing activity labels", `records left out of the paths, their neighbours joined (${meta.activity_projection_policy})`],
  ];
}

/** What the analyst can do about each refusal. */
const remedies: Record<SelectionRefusal["code"], string> = {
  invalid_request: "This screen and the local service do not agree on the request. Reload the page; if it repeats, restart the application.",
  unsupported_schema: "This screen and the local service are different versions. Reload the page or restart the application.",
  unsupported_policy: "This screen asked for a selection the local service does not support. Reload the page or restart the application.",
  invalid_parameter: "This screen asked for a selection the local service does not support. Reload the page or restart the application.",
  workspace_unavailable: "Open the workspace again in the Data area.",
  source_unavailable: "Add the file again in the Data area; the workspace no longer holds these bytes.",
  preparation_unavailable: "Read the source again with the same choices in the Data area.",
  identity_mismatch: "The source or its reading changed. Open the incidents again from the Data area.",
  population_unavailable: "Try again; the selection is made again from the incidents of the preparation.",
  invalid_predicate: "Undo the last step or remove it.",
  invalid_parent: "Open the incidents again from the Data area.",
  unknown_case: "Correct the incident numbers or remove the last step; none of the invalid entry was applied.",
  case_outside_parent: "Choose numbers from this parent or remove the last step; the parent was not widened.",
  unmapped_context_column: "Undo the last step or remove it.",
  inconsistent_sequence: "The order of the records of an incident cannot be evaluated as prepared. Read the source again in the Data area.",
  mixed_time_kinds: "Read the source again in the Data area with one reading of its times.",
  inconsistent_time_kind: "Read the source again in the Data area with one reading of its times.",
  computation_failed: "Try again. If it fails again, restart the application.",
};

export interface SelectionProblemText {
  message: string;
  remedy: string;
}

export function describeSelectionProblem(problem: SelectionProblem): SelectionProblemText {
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

/** A short trail label; full operational wording remains in the chip’s accessible disclosure. */
export function shortStepWording(step: SelectionPredicate): string {
  if (step.kind === "case_id_in") return `${step.negate ? "Exclude" : "Keep"} ${countOf(step.case_ids.length, "incident number")}`;
  const wording = stepWording(step).replace(/^Keep incidents /, "");
  return wording.length > 64 ? `${wording.slice(0, 61)}…` : wording;
}
