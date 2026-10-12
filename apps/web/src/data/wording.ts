import type { Delimiter, Encoding, ImportRefusal, RowIssue } from "../generated/imports";
import type { ImportProblem } from "./client";
import { delimiters, encodings } from "./interpretation";

const integer = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Formats a supplied count with what it counts, for example "1 record" or "240,000 records". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${integer.format(count)} ${count === 1 ? singular : plural}`;
}

export function byteSize(count: number): string {
  if (count < 1024) return countOf(count, "byte");
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`;
  return `${(count / (1024 * 1024)).toFixed(1)} MB`;
}

export function utcText(value: string): string {
  return value.replace("T", " ").replace(/Z$/, " UTC");
}

export function wallText(value: string): string {
  return `${value.replace("T", " ")} as recorded`;
}

/** What the analyst can do about each refusal. */
const remedies: Record<ImportRefusal["code"], string> = {
  invalid_request: "This screen and the local service do not agree on the request. Reload the page; if it repeats, restart the application.",
  unsupported_schema: "This screen and the local service are different versions. Reload the page or restart the application.",
  unsupported_policy: "This screen asked for a reading the local service does not support. Reload the page or restart the application.",
  invalid_parameter: "Check the choices above; one of them is outside what can be read.",
  workspace_unavailable: "Check the path: the folder must exist and be reachable. Create it first, or open the workspace again.",
  workspace_not_writable: "Choose a folder you may write to, or get write permission for this one.",
  workspace_incompatible: "Choose an empty folder for a new workspace, or a folder that already is a workspace. A folder of the program itself cannot be used.",
  source_unavailable: "Add the file again; the workspace no longer holds these bytes.",
  invalid_dialect: "Choose one of the offered encodings and delimiters.",
  invalid_mapping: "Choose a different column for each of incident, activity, time and sequence.",
  unsupported_timezone: "Choose “as recorded”, the offsets written in the values, or one fixed offset.",
  timezone_required: "These times carry no zone. Choose “as recorded” or a fixed offset.",
  malformed_source: "Check the encoding and the delimiter. If they are right, the file does not hold complete CSV records.",
  mixed_timezone_values: "Some times carry a zone and others do not. Choose the zone choice that fits the values, or correct the export.",
  cutoff_before_records: "Set “Export taken at” to a moment after the last record of the source.",
  preparation_unavailable: "Read the source again with the same choices in the Data area.",
  interpretation_not_ready: "Confirm the rows with issues in the report first.",
  case_not_found: "Open the incidents again from the Data area.",
  identity_mismatch: "The source or its reading changed. Open the incidents again from the Data area.",
  computation_failed: "Try again. If it fails again, restart the application.",
};

export interface ImportProblemText {
  message: string;
  remedy: string;
  field: string | null;
}

export function describeImportProblem(problem: ImportProblem): ImportProblemText {
  switch (problem.kind) {
    case "refusal":
      return { message: problem.refusal.message, remedy: remedies[problem.refusal.code], field: problem.refusal.field };
    case "unreachable":
      return {
        message: "The local service could not be reached.",
        remedy: "Check that the Python application is still running, then try again.",
        field: null,
      };
    case "http":
      return problem.status === 404 || problem.status === 405
        ? {
            message: `This local service does not offer this operation (HTTP ${problem.status}).`,
            remedy: "Start a version of the application that includes it, then try again.",
            field: null,
          }
        : {
            message: `The local service could not answer this request (HTTP ${problem.status}).`,
            remedy: "Try again; if the failure repeats, restart the Python application.",
            field: null,
          };
    case "unsupported_reply":
      return { message: "The local service sent a reply this screen cannot use.", remedy: problem.detail, field: null };
  }
}

/** Plain names of the reasons the report gives for single rows. */
export const issueLabels: Record<RowIssue["code"], string> = {
  missing_case_id: "No incident id: outside every incident",
  missing_timestamp: "No time: kept in its incident, order not known",
  invalid_timestamp: "Time not readable with the chosen format: kept in its incident, order not known",
  missing_activity: "No activity label: kept, left out of the activity sequence",
  invalid_sequence: "Sequence number not a whole number: blocks the reading",
  duplicate_candidate: "Same cells as an earlier row: both kept",
  timestamp_sequence_disagreement: "Time and sequence number disagree: time decides",
  ragged_record: "Another number of cells than the header: kept as a raw row, outside every incident",
};

export const severityLabels: Record<RowIssue["severity"], string> = {
  blocking: "Blocks the reading",
  confirmation: "Needs your confirmation",
  warning: "For your information",
};

export function encodingName(value: Encoding): string {
  return encodings.find((item) => item.value === value)?.label ?? value;
}

export function delimiterName(value: Delimiter): string {
  return delimiters.find((item) => item.value === value)?.label ?? value;
}
