import type { CaseSummary, InputPolicies, Refusal } from "../generated/investigation";
import type { Problem } from "./client";

const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** A supplied count, formatted, and the unit it counts: "12" and "incidents". */
export function countParts(count: number, singular: "incident" | "record"): { figure: string; unit: string } {
  return { figure: integer.format(count), unit: count === 1 ? singular : `${singular}s` };
}

/** Formats a supplied count with the unit it counts, for example "12 incidents". */
export function countOf(count: number, singular: "incident" | "record"): string {
  const { figure, unit } = countParts(count, singular);
  return `${figure} ${unit}`;
}

export function utcInstant(value: string): string {
  return value.replace("T", " ").replace(/Z$/, " UTC");
}

const refusalReasons: Record<Refusal["code"], string> = {
  unsupported_schema: "This screen and the local service use different message versions.",
  unsupported_policy: "The local service does not support one of the requested policies.",
  invalid_parameter: "A policy parameter was not accepted.",
  invalid_request: "The request was not accepted.",
  source_unavailable: "The example source is not available on this computer.",
  malformed_source: "The example source could not be read as an event history.",
  case_not_found: "This incident is not recorded in the source.",
  case_not_in_population: "This incident is outside the current population.",
  identity_mismatch: "The source or its interpretation is no longer the one this population was opened with.",
  computation_failed: "The local service could not complete the calculation.",
};

export interface ProblemText {
  message: string;
  reason: string | null;
}

export function describeProblem(problem: Problem): ProblemText {
  switch (problem.kind) {
    case "refusal": {
      const field = problem.refusal.field ? ` Field: ${problem.refusal.field}.` : "";
      const retry = problem.refusal.retryable ? "" : " Trying again gives the same answer unless the source or the request changes.";
      return { message: problem.refusal.message, reason: `${refusalReasons[problem.refusal.code]}${field}${retry}` };
    }
    case "unreachable":
      return {
        message: "The local service could not be reached.",
        reason: "Check that the Python application is still running, then try again.",
      };
    case "http":
      return problem.status === 404 || problem.status === 405
        ? {
            message: `Investigations are not available from this local service (HTTP ${problem.status}).`,
            reason: "The running service does not offer this operation. Start a version that includes it, then try again.",
          }
        : {
            message: `The local service could not answer this request (HTTP ${problem.status}).`,
            reason: "It did not send an explanation. Try again; if the failure repeats, restart the Python application.",
          };
    case "unsupported_reply":
      return { message: "The local service sent a reply this screen cannot use.", reason: problem.detail };
  }
}

/** Names a partition by the supplied predicate policy, without implying a verdict. */
export function partitionLabel(partition: CaseSummary["partition"], policies: InputPolicies): string {
  const activity = policies.predicate.parameters.contains_activity;
  return partition === "kept" ? `Kept: ${activity} recorded` : `Removed: no ${activity} recorded`;
}

/** States what separates kept from removed incidents, from the supplied predicate policy. */
export function partitionRule(policies: InputPolicies): string {
  const activity = policies.predicate.parameters.contains_activity;
  return `Kept incidents have ${activity} recorded; removed incidents have no ${activity} recorded.`;
}
