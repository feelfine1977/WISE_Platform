import type {
  ColumnIndex,
  ConfirmMappingRequest,
  CsvInspectionAnswer,
  Delimiter,
  Encoding,
  ImportPolicies,
  RoleSuggestion,
  SourceId,
  TimePolicy,
  TimestampFormat,
  WorkspaceId,
} from "../generated/imports";

/** How the analyst says the times of the source relate to a clock. */
export type ZoneChoice = "as_recorded" | "from_values" | "fixed_offset";

/** The analyst's choices for reading one source; nothing here is decided without the analyst. */
export interface Draft {
  encoding: Encoding | null;
  delimiter: Delimiter | null;
  caseColumn: ColumnIndex | null;
  activityColumn: ColumnIndex | null;
  timestampColumn: ColumnIndex | null;
  sequenceColumn: ColumnIndex | null;
  contextColumns: ColumnIndex[];
  timeFormat: TimestampFormat | null;
  zone: ZoneChoice | null;
  offsetMinutes: number;
  /** When the export was taken, as YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS on the chosen clock. */
  cutoff: string;
  /** Whether the analyst typed the cutoff; otherwise it follows the clock of the zone choice. */
  cutoffEdited: boolean;
}

export const emptyDraft: Draft = {
  encoding: null,
  delimiter: null,
  caseColumn: null,
  activityColumn: null,
  timestampColumn: null,
  sequenceColumn: null,
  contextColumns: [],
  timeFormat: null,
  zone: null,
  offsetMinutes: 0,
  cutoff: "",
  cutoffEdited: false,
};

export const encodings: readonly { value: Encoding; label: string }[] = [
  { value: "utf-8", label: "UTF-8" },
  { value: "utf-8-sig", label: "UTF-8 with byte-order mark" },
  { value: "windows-1252", label: "Windows-1252 (Western European)" },
];

export const delimiters: readonly { value: Delimiter; label: string }[] = [
  { value: ",", label: "Comma ," },
  { value: ";", label: "Semicolon ;" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Vertical bar |" },
];

export const formatLabels: Record<TimestampFormat, string> = {
  iso8601: "ISO 8601, for example 2026-10-09T08:00:00Z or 2026-10-09 08:00",
  dmy_dot_minute: "Day first with dots: dd.mm.yyyy HH:MM",
  mdy_dot_minute: "Month first with dots: mm.dd.yyyy HH:MM",
  dmy_slash_minute: "Day first with slashes: dd/mm/yyyy HH:MM",
  mdy_slash_minute: "Month first with slashes: mm/dd/yyyy HH:MM",
  dmy_dot_second: "Day first with dots, with seconds: dd.mm.yyyy HH:MM:SS",
  mdy_dot_second: "Month first with dots, with seconds: mm.dd.yyyy HH:MM:SS",
  dmy_slash_second: "Day first with slashes, with seconds: dd/mm/yyyy HH:MM:SS",
  mdy_slash_second: "Month first with slashes, with seconds: mm/dd/yyyy HH:MM:SS",
  mdy_slash_12h_minute: "Month first with slashes, 12-hour clock: mm/dd/yyyy hh:MM AM",
  mdy_slash_12h_second: "Month first with slashes, 12-hour clock with seconds: mm/dd/yyyy hh:MM:SS AM",
};

/** The registered version 1 policies of every role but time; each is fixed by the contract. */
export const fixedPolicies: Omit<ImportPolicies, "time"> = {
  order: {
    id: "incident.order.declared_time_optional_sequence_source_position.v1",
    parameters: {
      primary: "usable_declared_time_ascending",
      secondary: "mapped_sequence_or_source_position",
      tie_breaker: "source_position_ascending",
      unavailable_timestamp: "presentation_tail_source_position",
      unavailable_timestamp_case_sequence: "unevaluable",
    },
  },
  rows: {
    id: "incident.rows.missing_id_outside_invalid_time_retained.v1",
    parameters: {
      missing_case_id: "outside_population_preserve_source",
      unavailable_timestamp: "retain_case_raw_flag_order_unknown",
      invalid_mapped_sequence: "block_preparation",
      duplicate_candidates: "retain_all",
    },
  },
  missing_values: {
    id: "incident.missing.empty_mapped_activity_context.v1",
    parameters: { empty_activity_context: "missing", literal_values: "preserve" },
  },
  identifier: {
    id: "incident.identifier.trim_outer_whitespace.v1",
    parameters: { normalization: "trim_outer_whitespace_preserve_raw" },
  },
  activity_projection: {
    id: "incident.activity.omit_missing_retain_raw_gaps.v1",
    parameters: { missing_activity: "omit_from_mapped_sequence", raw_records: "retain_all", gap_evidence: "omitted_row_ids" },
  },
  parent: {
    id: "incident.parent.all_identified_cases.v1",
    parameters: { eligibility: "nonempty_normalized_case_identifier" },
  },
};

/** Offsets from UTC in quarter hours, from −14:00 to +14:00, as the contract allows. */
export const offsets: readonly number[] = Array.from({ length: 113 }, (_, index) => (index - 56) * 15);

export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

const two = (value: number) => String(value).padStart(2, "0");

/** The present moment as a cutoff text: on the UTC clock, or on this computer's clock for times as recorded. */
export function cutoffNow(now: Date, zone: ZoneChoice | null): string {
  return zone === "as_recorded"
    ? `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`
    : `${now.getUTCFullYear()}-${two(now.getUTCMonth() + 1)}-${two(now.getUTCDate())}T${two(now.getUTCHours())}:${two(now.getUTCMinutes())}:${two(now.getUTCSeconds())}`;
}

const cutoffPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function cutoffText(cutoff: string): string | null {
  if (!cutoffPattern.test(cutoff)) return null;
  return cutoff.length === 16 ? `${cutoff}:00` : cutoff;
}

/**
 * The formats that read at least one filled cell of a column, and whether the column leaves a
 * question: several formats read every filled cell, or none does.
 */
export function formatEvidence(suggestion: RoleSuggestion | undefined): {
  readable: { format: TimestampFormat; parsed: number }[];
  complete: TimestampFormat[];
  question: boolean;
} {
  if (!suggestion) return { readable: [], complete: [], question: false };
  const readable = suggestion.timestamp_matches
    .filter((match) => match.parsed_count > 0)
    .map((match) => ({ format: match.format, parsed: match.parsed_count }));
  const complete = readable.filter((match) => match.parsed === suggestion.nonempty_count).map((match) => match.format);
  return { readable, complete, question: complete.length !== 1 && readable.length > 1 };
}

/**
 * The draft after an inspection: its dialect is the one asked for or else the first candidate.
 * Column choices are kept when the columns are the same as before and cleared otherwise.
 */
export function draftAfterInspection(
  previous: Draft,
  previousColumns: readonly string[] | null,
  answer: CsvInspectionAnswer,
  now: Date,
): Draft {
  const candidate = answer.dialect_candidates[0];
  const columns = answer.columns.map((column) => column.name);
  const same = previousColumns !== null && previousColumns.length === columns.length && previousColumns.every((name, index) => name === columns[index]);
  const dialect = {
    encoding: candidate ? candidate.encoding : previous.encoding,
    delimiter: candidate ? candidate.delimiter : previous.delimiter,
  };
  if (same) return { ...previous, ...dialect };
  return { ...emptyDraft, ...dialect, cutoff: cutoffNow(now, null) };
}

/** The format a column's evidence settles, or null when the analyst has to answer. */
export function settledFormat(suggestion: RoleSuggestion | undefined): TimestampFormat | null {
  const evidence = formatEvidence(suggestion);
  return evidence.complete.length === 1 ? evidence.complete[0] : null;
}

/** What the analyst still has to choose before the source can be read; empty when nothing. */
export function missingChoices(draft: Draft): string[] {
  const missing: string[] = [];
  if (draft.encoding === null) missing.push("the encoding");
  if (draft.delimiter === null) missing.push("the delimiter");
  if (draft.caseColumn === null) missing.push("the incident column");
  if (draft.activityColumn === null) missing.push("the activity column");
  if (draft.timestampColumn === null) missing.push("the time column");
  const roles = [draft.caseColumn, draft.activityColumn, draft.timestampColumn, draft.sequenceColumn].filter((column) => column !== null);
  if (new Set(roles).size !== roles.length) missing.push("a different column for each of incident, activity, time and sequence");
  if (draft.timeFormat === null) missing.push("the time format");
  if (draft.zone === null) missing.push("the zone of the times");
  if (cutoffText(draft.cutoff) === null) missing.push("when the export was taken");
  return missing;
}

function timePolicy(draft: Draft, format: TimestampFormat, cutoff: string): TimePolicy {
  if (draft.zone === "as_recorded") {
    return {
      id: "incident.time.wall_clock_as_recorded.v1",
      parameters: { format, timezone: "none_as_recorded", snapshot_cutoff_local: cutoff },
    };
  }
  return {
    id: "incident.time.explicit_format_timezone_utc.v1",
    parameters: {
      format,
      timezone: draft.zone === "fixed_offset" ? { mode: "fixed_offset", offset_minutes: draft.offsetMinutes } : { mode: "from_values" },
      snapshot_cutoff_utc: `${cutoff}Z`,
    },
  };
}

/** The confirmation of a complete draft, or null while a choice is missing. */
export function confirmationOf(
  draft: Draft,
  ids: { workspaceId: WorkspaceId; sourceId: SourceId },
  envelope: { requestId: string; revision: number },
  acceptReportIssues: boolean,
): ConfirmMappingRequest | null {
  const cutoff = cutoffText(draft.cutoff);
  if (
    missingChoices(draft).length > 0 ||
    cutoff === null ||
    draft.encoding === null ||
    draft.delimiter === null ||
    draft.caseColumn === null ||
    draft.activityColumn === null ||
    draft.timestampColumn === null ||
    draft.timeFormat === null
  ) {
    return null;
  }
  return {
    schema_version: 1,
    message_type: "confirm_mapping_request",
    request_id: envelope.requestId,
    query_revision: envelope.revision,
    workspace_id: ids.workspaceId,
    source_id: ids.sourceId,
    dialect: { encoding: draft.encoding, delimiter: draft.delimiter, quotechar: '"', header: "first_record" },
    mapping: {
      case_column: draft.caseColumn,
      activity_column: draft.activityColumn,
      timestamp_column: draft.timestampColumn,
      sequence_column: draft.sequenceColumn,
      context_columns: [...draft.contextColumns].sort((left, right) => left - right),
    },
    policies: { time: timePolicy(draft, draft.timeFormat, cutoff), ...fixedPolicies },
    accept_report_issues: acceptReportIssues,
  };
}
