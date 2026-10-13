import { countOf } from "../data/wording";
import type { GraphCoverage, PopulationSupport, PredicateResult, SelectionPredicate, SelectionRefusal } from "../generated/selection";
import type { SelectionProblem } from "./client";
import type { ActivityTimes } from "./elements";

const quoted = (text: string) => `“${text}”`;

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

const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Supplied hours in words: in hours below 48 hours, in days from there on, each with one decimal. */
function hoursOrDays(hours: number): string {
  return hours < 48 ? `${oneDecimal.format(hours)} hours` : `${oneDecimal.format(hours / 24)} days`;
}

/**
 * The two supplied times of an activity in words: the median time since the event before and until
 * the next event, each over the passages it rests on, or that it is not available. The hours are
 * those of the paths' lags, so the caption's sentence on the lag says which clock they are of.
 */
export function activityTimeLines(times: ActivityTimes): [string, string] {
  const line = (name: string, hours: number | undefined, passages: number, direction: "into" | "out of") =>
    hours === undefined
      ? `${name}: not available; no path leads ${direction} this activity.`
      : `${name}: median ${hoursOrDays(hours)} over ${countOf(passages, "passage")} ${direction} this activity.`;
  return [
    line("Time since the event before", times.medianPreviousHours, times.usablePreviousCount, "into"),
    line("Time until the next event", times.medianNextHours, times.usableNextCount, "out of"),
  ];
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

/** The sentences under the map that say what its numbers count, from the map's own coverage. */
export function mapCaption(meta: GraphCoverage): string[] {
  return [
    `Activities count labelled records and distinct incidents of the ${countOf(meta.node_case_denominator, "incident")} on the map.`,
    `Paths count passages and distinct incidents of the ${countOf(meta.path_case_denominator, "incident")} whose order of records can be evaluated.`,
    `${countOf(meta.sequence_unevaluable_case_count, "incident")} with ${countOf(meta.sequence_unevaluable_record_count, "record")} ` +
      `${meta.sequence_unevaluable_case_count === 1 ? "is" : "are"} not evaluable for paths; ` +
      `${countOf(meta.omitted_activity_record_count, "record")} ${meta.omitted_activity_record_count === 1 ? "has" : "have"} no activity label.`,
    "Observed labelled starts and ends: an incident starts or ends at an activity only when its first or last record carries that label.",
    "Start and End are added by the map: a flow leaves Start for every activity incidents begin with and enters End from every activity they end with, each with that number of incidents. They are always shown.",
    lagLine(meta),
  ];
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
  unknown_case: "Open the incidents again from the Data area.",
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
