import { countOf } from "../data/wording";
import type { CaseVerdict, MethodReason, RawMeasurement, ScoreRun, ScoringBlocker } from "../generated/scoring";
import type { ScoringProblem } from "./client";

/** What an incident does with the expectation, as the run says it; an incident can be in two of these. */
export type OutcomeState = "met" | "partly" | "not_met" | "out_of_scope" | "scope_unknown" | "no_start" | "no_response";

export const outcomeStates: readonly OutcomeState[] = ["met", "partly", "not_met", "out_of_scope", "scope_unknown", "no_start", "no_response"];

/** The meaning of a missing response the form offers: counted as not met, or left without a value. */
export type MissingMeaning = "violate" | "skip";

export interface DefinitionWords {
  start: string;
  response: string;
  target: number;
  width: number;
  missing: MissingMeaning;
}

/** A number of hours as the analyst types it: a decimal point or a decimal comma, nothing else. */
export function readHours(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

const hourNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 });
const valueNumber = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 });

export function hoursText(hours: number): string {
  return `${hourNumber.format(hours)} ${hours === 1 ? "hour" : "hours"}`;
}

/** The whole definition as one sentence. */
export function definitionSentence({ start, response, target, width, missing }: DefinitionWords): string {
  const within = `After “${start}”, “${response}” is recorded within ${hoursText(target)}`;
  const partly =
    width > 0
      ? `; up to ${hoursText(width)} later the expectation is partly met, and after that it is not met`
      : "; any later the expectation is not met";
  const without =
    missing === "violate"
      ? `. A case with “${start}” but no “${response}” at or after it counts as not met.`
      : `. A case with “${start}” but no “${response}” at or after it gets no value.`;
  return `${within}${partly}${without} A case without “${start}” gets no value.`;
}

/** Whether an incident of a run is in a state; a response missing under "counted as not met" is in two. */
export function inState(verdict: CaseVerdict, state: OutcomeState): boolean {
  switch (state) {
    case "met":
      return verdict.value === 0;
    case "partly":
      return verdict.value !== null && verdict.value > 0 && verdict.value < 1;
    case "not_met":
      return verdict.value === 1;
    case "out_of_scope":
      return verdict.reason === "out_of_scope";
    case "scope_unknown":
      return verdict.reason === "scope_unknown";
    case "no_start":
      return verdict.measurement.status === "missing_activation";
    case "no_response":
      return verdict.measurement.status === "missing_response";
  }
}

/**
 * The number of incidents in each state. The run supplies every count but the split of the
 * affected incidents into partly met and not met; those two are the incidents of the run listed
 * in each, and `checkStateCounts` refuses a run where they do not add up to its affected count.
 */
export function stateCounts(run: ScoreRun): Record<OutcomeState, number> {
  const { support, cases } = run;
  return {
    met: support.zero_value_case_count,
    partly: cases.filter((verdict) => inState(verdict, "partly")).length,
    not_met: cases.filter((verdict) => inState(verdict, "not_met")).length,
    out_of_scope: support.out_of_scope_case_count,
    scope_unknown: support.scope_unknown_case_count,
    no_start: support.missing_activation_case_count,
    no_response: support.missing_response_case_count,
  };
}

/** Why the listed incidents of a run disagree with its supplied counts, or null when they agree. */
export function checkStateCounts(run: ScoreRun): string | null {
  const counts = stateCounts(run);
  const listed = (state: OutcomeState) => run.cases.filter((verdict) => inState(verdict, state)).length;
  if (counts.partly + counts.not_met !== run.support.affected_case_count) {
    return "The partly met and not met cases do not add up to the affected cases of the run.";
  }
  for (const state of ["met", "out_of_scope", "scope_unknown", "no_start", "no_response"] as const) {
    if (listed(state) !== counts[state]) return "The cases listed in the run do not match its counts.";
  }
  if (run.cases.length !== run.support.scored_case_count) return "The run lists another number of cases than it scored.";
  return null;
}

/** The incidents of a run with the largest value first; incidents without a value last, in the order supplied. */
export function worstFirst(cases: readonly CaseVerdict[]): CaseVerdict[] {
  return cases
    .map((verdict, index) => ({ verdict, index }))
    .sort((one, other) => {
      const a = one.verdict.value;
      const b = other.verdict.value;
      if (a === null || b === null) return a === b ? one.index - other.index : a === null ? 1 : -1;
      return b - a || one.index - other.index;
    })
    .map((item) => item.verdict);
}

export const stateWords: Record<OutcomeState, { label: string; listed: string }> = {
  met: { label: "Meet it", listed: "that meet the expectation" },
  partly: { label: "Partly meet it", listed: "that partly meet the expectation" },
  not_met: { label: "Do not meet it", listed: "that do not meet the expectation" },
  out_of_scope: { label: "Out of scope", listed: "that are out of scope" },
  scope_unknown: { label: "Scope unknown", listed: "whose scope is unknown" },
  no_start: { label: "Without the start", listed: "without the start" },
  no_response: { label: "Without the response", listed: "without the response" },
};

/** The state of one incident in words, for its row. */
export function verdictWords(verdict: CaseVerdict): string {
  if (inState(verdict, "met")) return "Meets it";
  if (inState(verdict, "partly")) return "Partly meets it";
  if (inState(verdict, "not_met")) return "Does not meet it";
  return reasonWords(verdict.reason);
}

export function reasonWords(reason: MethodReason): string {
  switch (reason) {
    case "evaluated":
      return "Evaluated";
    case "missing_activation":
      return "No value: no start";
    case "missing_response":
      return "No value: no response";
    case "censored":
      return "Judged by its age at the cutoff";
    case "out_of_scope":
      return "Out of scope";
    case "scope_unknown":
      return "Scope unknown";
  }
}

/** The value of the method library as it is, or the word for none. */
export function valueText(value: number | null): string {
  return value === null ? "no value" : valueNumber.format(value);
}

export function unitText(amount: number, unit: RawMeasurement["unit"]): string {
  const singular = unit === "hours" ? "hour" : "day";
  return `${hourNumber.format(amount)} ${amount === 1 ? singular : `${singular}s`}`;
}

/** The measured time between start and response, or why there is none. */
export function measurementText(measurement: RawMeasurement): string {
  if (measurement.status === "missing_activation") return "no start";
  if (measurement.status === "missing_response") {
    return measurement.censor_age === null ? "no response" : `no response; open ${unitText(measurement.censor_age, measurement.unit)} at the cutoff`;
  }
  return measurement.value === null ? "not measured" : unitText(measurement.value, measurement.unit);
}

export interface ScoringProblemText {
  message: string;
  remedy: string;
}

const remedies: Partial<Record<string, string>> = {
  invalid_parameter: "Change the field named above and check again.",
  unsupported_definition: "Change the definition and check again.",
  clock_mismatch: "Use the clock of the preparation and check again.",
  definition_not_reviewed: "Mark the definition as reviewed, check it again and then score it.",
  unevaluable_sequence: "Inspect the data quality of these cases, or choose a population without them, for example by selecting the cases whose order can be evaluated.",
  empty_population: "Choose a population with cases.",
  method_unavailable: "Install the method library as described, start the application again and try again.",
  population_unavailable: "Select the cases again in the investigation, then check and score again.",
  definition_unavailable: "Check the definition again, then score it.",
  run_unavailable: "Score the expectation again.",
  workspace_unavailable: "Open the workspace again in the Data area.",
  source_unavailable: "Add the source file to the workspace again.",
  memory_unavailable: "The application does not have enough memory for this now. Close other work you have open, then try again.",
  preparation_unavailable: "Confirm the interpretation of the source again in the Data area.",
  identity_mismatch: "Open the cases of the preparation again.",
  computation_failed: "Try again; if it fails again, the application needs to be repaired.",
};

export function describeScoringProblem(problem: ScoringProblem): ScoringProblemText {
  switch (problem.kind) {
    case "refusal": {
      const { refusal } = problem;
      const named = refusal.case_count > 0 ? ` (${countOf(refusal.case_count, "case")}: ${refusal.case_ids.slice(0, 10).join(", ")}${refusal.case_count > 10 ? ", …" : ""})` : "";
      return {
        message: `${refusal.message}${named}`,
        remedy: remedies[refusal.code] ?? "Reload the page; if it repeats, restart the application.",
      };
    }
    case "unreachable":
      return { message: "The local service could not be reached.", remedy: "Check that the application is still running, then try again." };
    case "http":
      return { message: `The local service answered with status ${problem.status} and no refusal this screen can read.`, remedy: "Try again; if it repeats, restart the application." };
    case "unsupported_reply":
      return { message: problem.detail, remedy: "Reload the page; if it repeats, restart the application." };
  }
}

/** Where a blocker is, in the words of the form. */
export function blockerPlace(blocker: ScoringBlocker): string {
  const places: Record<string, string> = {
    "definition.target": "Target",
    "definition.width": "Width",
    "definition.clock_kind": "Clock",
    "definition.endpoints.activation_activity": "Start activity",
    "definition.endpoints.response_activity": "Response activity",
    named_population: "Cases",
  };
  return places[blocker.field] ?? "Definition";
}

/** The fixed line about the method library: its name and version, and that it is not a release. */
export function methodLine(build: { distribution: string; version: string; sourceCommit: string; eligibleRelease: boolean }): string {
  return (
    `Scored by the method library ${build.distribution} ${build.version}, built from source ${build.sourceCommit.slice(0, 7)}: ` +
    `an untagged state${build.eligibleRelease ? "" : ", not a published release"}.`
  );
}
