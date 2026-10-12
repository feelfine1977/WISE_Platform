import type {
  ColumnIndex,
  ConfirmMappingRequest,
  CsvInspectionAnswer,
  Delimiter,
  Encoding,
  ImportPolicies,
  ImportRowPolicy,
  RoleSuggestion,
  SourceId,
  TimePolicy,
  TimestampFormat,
  WorkspaceId,
} from "../generated/imports";

/** How the analyst says the times of the source relate to a clock. */
export type ZoneChoice = "as_recorded" | "from_values" | "fixed_offset";

/** Which registered row rule reads the source: the tolerant one for new preparations, or the strict one. */
export type RowRule = "tolerant" | "strict";

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
  /** When the export was taken, as YYYY-MM-DDTHH:MM or YYYY-MM-DDTHH:MM:SS on the chosen clock; empty until known. */
  cutoff: string;
  /** Whether the analyst (or a fixed interpretation) set the cutoff; otherwise the proposal from the data fills it. */
  cutoffEdited: boolean;
  rowRule: RowRule;
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
  rowRule: "tolerant",
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

/** Every time format of the contract, in the order the screen offers them. */
export const timeFormats: readonly TimestampFormat[] = [
  "iso8601",
  "dmy_dot_minute",
  "dmy_dot_second",
  "mdy_dot_minute",
  "mdy_dot_second",
  "dmy_slash_minute",
  "dmy_slash_second",
  "mdy_slash_minute",
  "mdy_slash_second",
  "mdy_slash_12h_minute",
  "mdy_slash_12h_second",
];

export const formatLabels: Record<TimestampFormat, string> = {
  iso8601: "Year-Month-Day, ISO 8601 (2026-12-31T17:45:10Z or 2026-12-31 17:45)",
  dmy_dot_minute: "Day.Month.Year, 24-hour clock (31.12.2026 17:45)",
  dmy_dot_second: "Day.Month.Year, 24-hour clock with seconds (31.12.2026 17:45:10)",
  mdy_dot_minute: "Month.Day.Year, 24-hour clock (12.31.2026 17:45)",
  mdy_dot_second: "Month.Day.Year, 24-hour clock with seconds (12.31.2026 17:45:10)",
  dmy_slash_minute: "Day/Month/Year, 24-hour clock (31/12/2026 17:45)",
  dmy_slash_second: "Day/Month/Year, 24-hour clock with seconds (31/12/2026 17:45:10)",
  mdy_slash_minute: "Month/Day/Year, 24-hour clock (12/31/2026 17:45)",
  mdy_slash_second: "Month/Day/Year, 24-hour clock with seconds (12/31/2026 17:45:10)",
  mdy_slash_12h_minute: "Month/Day/Year, 12-hour clock (12/31/2026 5:45 PM)",
  mdy_slash_12h_second: "Month/Day/Year, 12-hour clock with seconds (12/31/2026 5:45:10 PM)",
};

/** The two registered row rules with the parameters the contract fixes for each. */
export const rowPolicies: Record<RowRule, ImportRowPolicy> = {
  tolerant: {
    id: "incident.rows.missing_id_outside_invalid_time_retained.v2",
    parameters: {
      missing_case_id: "outside_population_preserve_source",
      unavailable_timestamp: "retain_case_raw_flag_order_unknown",
      invalid_mapped_sequence: "block_preparation",
      duplicate_candidates: "retain_all",
      blank_records: "skip_count_preserve_source_ordinal",
      ragged_records: "outside_population_preserve_raw",
      maximum_ragged_fraction: 0.05,
      field_character_limit: 10485760,
    },
  },
  strict: {
    id: "incident.rows.missing_id_outside_invalid_time_retained.v1",
    parameters: {
      missing_case_id: "outside_population_preserve_source",
      unavailable_timestamp: "retain_case_raw_flag_order_unknown",
      invalid_mapped_sequence: "block_preparation",
      duplicate_candidates: "retain_all",
    },
  },
};

/** The registered version 1 policies of every role but time and rows; each is fixed by the contract. */
export const fixedPolicies: Omit<ImportPolicies, "time" | "rows"> = {
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

const cutoffPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function cutoffText(cutoff: string): string | null {
  if (!cutoffPattern.test(cutoff)) return null;
  return cutoff.length === 16 ? `${cutoff}:00` : cutoff;
}

/** What the inspection found for one format in the chosen time column; null when it reported nothing. */
export interface FormatReading {
  format: TimestampFormat;
  parsed: number | null;
}

/**
 * The inspection's evidence for every format in a column: how many filled cells each reads of how
 * many. A format is proposed only when it is the one format that reads every filled cell. Otherwise
 * nothing is proposed, and when more than one format reads some of the values the choice is put as
 * a question.
 */
export function formatEvidence(suggestion: RoleSuggestion | undefined): {
  readings: FormatReading[];
  filled: number;
  complete: TimestampFormat[];
  proposed: TimestampFormat | null;
  question: boolean;
} {
  if (!suggestion) return { readings: [], filled: 0, complete: [], proposed: null, question: false };
  const filled = suggestion.nonempty_count;
  const readings = timeFormats.map((format) => ({
    format,
    parsed: suggestion.timestamp_matches.find((match) => match.format === format)?.parsed_count ?? null,
  }));
  const complete = filled === 0 ? [] : readings.filter((item) => item.parsed === filled).map((item) => item.format);
  const proposed = complete.length === 1 ? complete[0] : null;
  const reading = readings.filter((item) => item.parsed !== null && item.parsed > 0).length;
  return { readings, filled, complete, proposed, question: proposed === null && reading > 1 };
}

/**
 * The draft after an inspection: its dialect is the one asked for or else the first candidate.
 * Column choices are kept when the columns are the same as before and cleared otherwise.
 */
export function draftAfterInspection(previous: Draft, previousColumns: readonly string[] | null, answer: CsvInspectionAnswer): Draft {
  const candidate = answer.dialect_candidates[0];
  const columns = answer.columns.map((column) => column.name);
  const same = previousColumns !== null && previousColumns.length === columns.length && previousColumns.every((name, index) => name === columns[index]);
  const dialect = {
    encoding: candidate ? candidate.encoding : previous.encoding,
    delimiter: candidate ? candidate.delimiter : previous.delimiter,
  };
  if (same) return { ...previous, ...dialect };
  return { ...emptyDraft, ...dialect, rowRule: previous.rowRule };
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
  if (missingChoices(draft).length > 0 || cutoff === null) return null;
  return readingOf(draft, cutoff, ids, envelope, acceptReportIssues);
}

/** The latest cutoff each clock of the contract can express; no record of a real export lies after it. */
export const LATEST_CUTOFF = "9999-12-31T23:59:59";

/**
 * The request for a cutoff proposal: the draft's reading under the latest cutoff, so that every
 * usable time counts. Null while a choice other than the cutoff is missing. Context columns do not
 * change any time and are left out, so that choosing them asks for nothing new.
 */
export function proposalRequestOf(
  draft: Draft,
  ids: { workspaceId: WorkspaceId; sourceId: SourceId },
  envelope: { requestId: string; revision: number },
): ConfirmMappingRequest | null {
  if (missingChoices({ ...draft, cutoff: LATEST_CUTOFF }).length > 0) return null;
  return readingOf({ ...draft, contextColumns: [] }, LATEST_CUTOFF, ids, envelope, false);
}

function readingOf(
  draft: Draft,
  cutoff: string,
  ids: { workspaceId: WorkspaceId; sourceId: SourceId },
  envelope: { requestId: string; revision: number },
  acceptReportIssues: boolean,
): ConfirmMappingRequest | null {
  if (
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
    policies: { time: timePolicy(draft, draft.timeFormat, cutoff), rows: rowPolicies[draft.rowRule], ...fixedPolicies },
    accept_report_issues: acceptReportIssues,
  };
}

/** A supplied time as the value of the cutoff field: the same clock, without the UTC mark. */
export function cutoffFieldValue(time: string): string {
  return time.replace(/Z$/, "");
}
