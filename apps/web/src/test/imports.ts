import type {
  ConfirmMappingRequest,
  CsvInspectionAnswer,
  ImportedCaseEvidenceAnswer,
  ImportedCaseEvidenceRequest,
  ImportedCaseSummary,
  ImportedPopulationAnswer,
  ImportRefusal,
  InspectCsvRequest,
  InterpretationAnswer,
  InterpretationReport,
  OpenPopulationRequest,
  OpenWorkspaceRequest,
  SourceAnswer,
  UploadSourceMetadata,
  WorkspaceAnswer,
} from "../generated/imports";
import type { CutoffProposal, ImportClient, ImportOutcome } from "../data/client";
import { fixedPolicies, rowPolicies } from "../data/interpretation";
import type { ExampleId } from "../generated/investigation";

/*
 * Answers written by hand in the shape of the import contract. The numbers are chosen for these
 * tests and agree with each other; they are not taken from any implementation.
 *
 * Source "Vorgänge.csv" (hand-made), semicolons, Windows-1252, four records after the header:
 *   0  A-1  Eröffnet     03.04.2026 08:00  Büro
 *   1  A-1  Geschlossen  04.04.2026 09:30  (empty)
 *   2  (no incident id) Eröffnet  05.04.2026 07:15  Unknown
 *   3  B-2  Prüfung      xx                Größe & Maß
 * Every time reads both day first and month first, so the format is a question. Read day first at
 * UTC+02:00: records 0, 1 and 3 have an incident id, record 2 is outside every incident,
 * record 3 without a usable time; 2 incidents, A-1 in a known order, B-2 not.
 */

const hex = (digit: string) => digit.repeat(64);

export const workspaceId = "workspace.v1:0123456789abcdef";
export const sourceId = `source.v1:sha256:${hex("5")}`;
export const otherSourceId = `source.v1:sha256:${hex("7")}`;
export const preparationId = `preparation.v1:sha256:${hex("6")}`;
export const earlierPreparationId = `preparation.v1:sha256:${hex("8")}`;

export const identity = {
  source_id: sourceId,
  preparation_id: preparationId,
  representation_id: `representation.v1:sha256:${hex("9")}`,
  case_dictionary_id: `case-dictionary.v1:sha256:${hex("a")}`,
  population_id: `population.v1:sha256:${hex("b")}`,
  implementation_version: "0.1.0",
};

export function workspaceAnswer(request: OpenWorkspaceRequest, earlier = false): WorkspaceAnswer {
  return {
    schema_version: 1,
    message_type: "workspace_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: workspaceId,
    path: request.path,
    writable: true,
    sources: earlier ? [{ source_id: otherSourceId, filename: "Ältere Vorgänge.csv", byte_count: 2048 }] : [],
    preparations: earlier ? [{ preparation_id: earlierPreparationId, source_id: otherSourceId }] : [],
  };
}

export function sourceAnswer(metadata: UploadSourceMetadata, byteCount: number): SourceAnswer {
  return {
    schema_version: 1,
    message_type: "source_answer",
    request_id: metadata.request_id,
    query_revision: metadata.query_revision,
    workspace_id: metadata.workspace_id,
    source: { source_id: sourceId, filename: metadata.filename, byte_count: byteCount },
  };
}

type Matches = CsvInspectionAnswer["role_suggestions"][number]["timestamp_matches"];

/** The inspection's evidence for all eleven formats, in the order the inspection lists them; unnamed formats read nothing. */
function matches(read: Partial<Record<Matches[number]["format"], number>> = {}): Matches {
  const formats = [
    "iso8601", "dmy_dot_minute", "mdy_dot_minute", "dmy_slash_minute", "mdy_slash_minute", "dmy_dot_second",
    "mdy_dot_second", "dmy_slash_second", "mdy_slash_second", "mdy_slash_12h_minute", "mdy_slash_12h_second",
  ] as const;
  return formats.map((format) => ({ format, parsed_count: read[format] ?? 0 }));
}

const noMatches = matches();

export function inspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  return {
    schema_version: 1,
    message_type: "csv_inspection_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    source_id: request.source_id,
    dialect_candidates: [{ encoding: "windows-1252", delimiter: ";", quotechar: '"', header: "first_record" }],
    columns: [
      { index: 0, name: "Vorgang" },
      { index: 1, name: "Aktivität" },
      { index: 2, name: "Zeitpunkt" },
      { index: 3, name: "Gruppe" },
    ],
    record_count: 4,
    sample_rows: [
      { source_position: 0, cells: ["A-1", "Eröffnet", "03.04.2026 08:00", "Büro"] },
      { source_position: 1, cells: ["A-1", "Geschlossen", "04.04.2026 09:30", ""] },
      { source_position: 2, cells: ["", "Eröffnet", "05.04.2026 07:15", "Unknown"] },
      { source_position: 3, cells: ["B-2", "Prüfung", "xx", "Größe & Maß"] },
    ],
    role_suggestions: [
      { column_index: 0, roles: ["context", "case_id", "activity"], nonempty_count: 3, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      { column_index: 1, roles: ["context", "case_id", "activity"], nonempty_count: 4, distinct_nonempty_count: 3, timestamp_matches: [...noMatches] },
      {
        column_index: 2,
        roles: ["context", "case_id", "activity", "timestamp"],
        nonempty_count: 4,
        distinct_nonempty_count: 4,
        timestamp_matches: matches({ dmy_dot_minute: 3, mdy_dot_minute: 3 }),
      },
      { column_index: 3, roles: ["context", "case_id", "activity"], nonempty_count: 3, distinct_nonempty_count: 3, timestamp_matches: [...noMatches] },
    ],
    unresolved: [
      "Confirm the proposed encoding, separator and column roles.",
      "Column 2 has multiple possible timestamp formats; choose day/month order explicitly.",
    ],
    blank_record_count: 0,
    ragged_record_count: 0,
  };
}

/** The same source with a readable time in record 3, 06.04.2026 10:00: day first and month first both read all four. */
export function bothWaysInspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  const answer = inspectionAnswer(request);
  return {
    ...answer,
    sample_rows: answer.sample_rows.map((row) => (row.source_position === 3 ? { ...row, cells: ["B-2", "Prüfung", "06.04.2026 10:00", "Größe & Maß"] } : row)),
    role_suggestions: answer.role_suggestions.map((item) =>
      item.column_index === 2 ? { ...item, timestamp_matches: matches({ dmy_dot_minute: 4, mdy_dot_minute: 4 }) } : item,
    ),
  };
}

/*
 * Source "Störungen.csv" (hand-made), semicolons, Windows-1252, times with seconds, a blank last line:
 *   physical line 1  Vorgang;Aktivität;Zeitpunkt;Gruppe
 *   0  line 2  A-1;Eröffnet;03.04.2026 08:00:15;Büro
 *   1  line 3  A-1;Geschlossen;14.04.2026 09:30:20;(empty)
 *   2  line 4  B-2;Eröffnet;05.04.2026 07:15:40;Größe & Maß;extra   five cells: outside every incident
 *   3  line 5  B-2;Prüfung;06.04.2026 10:00:05;Büro
 *   4  line 6  (blank)
 * The inspection counts four records, one blank line and one record of another length; its time
 * evidence covers the three records of four cells. Only day first with seconds reads all three; month
 * first with seconds reads two (14 is no month). Read at UTC+02:00, the latest usable time is
 * 2026-04-14T07:30:20Z, so 2026-04-14T07:31:00Z is proposed.
 */
export const raggedText = "B-2;Eröffnet;05.04.2026 07:15:40;Größe & Maß;extra\r\n";

export function secondsInspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  return {
    ...inspectionAnswer(request),
    sample_rows: [
      { source_position: 0, cells: ["A-1", "Eröffnet", "03.04.2026 08:00:15", "Büro"] },
      { source_position: 1, cells: ["A-1", "Geschlossen", "14.04.2026 09:30:20", ""] },
      { source_position: 2, cells: ["B-2", "Eröffnet", "05.04.2026 07:15:40", "Größe & Maß", "extra"] },
      { source_position: 3, cells: ["B-2", "Prüfung", "06.04.2026 10:00:05", "Büro"] },
    ],
    role_suggestions: [
      { column_index: 0, roles: ["context", "case_id", "activity"], nonempty_count: 3, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      { column_index: 1, roles: ["context", "case_id", "activity"], nonempty_count: 3, distinct_nonempty_count: 3, timestamp_matches: [...noMatches] },
      {
        column_index: 2,
        roles: ["context", "case_id", "activity", "timestamp"],
        nonempty_count: 3,
        distinct_nonempty_count: 3,
        timestamp_matches: matches({ dmy_dot_second: 3, mdy_dot_second: 2 }),
      },
      { column_index: 3, roles: ["context", "case_id", "activity"], nonempty_count: 2, distinct_nonempty_count: 1, timestamp_matches: [...noMatches] },
    ],
    unresolved: [
      "Confirm the proposed encoding, separator and column roles.",
      "1 zero-cell blank records are skipped; source ordinals retain their gaps.",
      "1 ragged records must remain outside every population and require explicit row-issue confirmation.",
    ],
    blank_record_count: 1,
    ragged_record_count: 1,
  };
}

/*
 * The source "Vorgänge.csv" as an inspection could answer it that suggests each column for one role
 * only: Vorgang for the incident id, Aktivität for the activity, Zeitpunkt for the time and Gruppe for
 * the context. No column is suggested as a sequence number.
 */
export function narrowInspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  const answer = inspectionAnswer(request);
  const roles: CsvInspectionAnswer["role_suggestions"][number]["roles"][] = [["case_id"], ["activity"], ["timestamp"], ["context"]];
  return { ...answer, role_suggestions: answer.role_suggestions.map((item) => ({ ...item, roles: roles[item.column_index] })) };
}

/*
 * Source "Meldungen.csv" (hand-made), commas, UTF-8, four records after the header:
 *   0  T-1  (empty)  früh  Netz  1
 *   1  T-1  (empty)  spät  Netz  2
 *   2  (empty) (empty) früh  Büro  3
 *   3  T-2  (empty)  spät  Büro  4
 * No format reads "früh" or "spät", so the time column Zeit is not suggested for the time; the
 * activity column Schritt is empty throughout, so it is suggested for the context only. Ticket has
 * 3 filled cells of 2 distinct values; Zeit and Team 4 of 2; Nr 4 of 4, all whole numbers.
 */
export function unreadableInspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  return {
    ...inspectionAnswer(request),
    dialect_candidates: [{ encoding: "utf-8", delimiter: ",", quotechar: '"', header: "first_record" }],
    columns: ["Ticket", "Schritt", "Zeit", "Team", "Nr"].map((name, index) => ({ index, name })),
    record_count: 4,
    sample_rows: [
      { source_position: 0, cells: ["T-1", "", "früh", "Netz", "1"] },
      { source_position: 1, cells: ["T-1", "", "spät", "Netz", "2"] },
      { source_position: 2, cells: ["", "", "früh", "Büro", "3"] },
      { source_position: 3, cells: ["T-2", "", "spät", "Büro", "4"] },
    ],
    role_suggestions: [
      { column_index: 0, roles: ["context", "case_id", "activity"], nonempty_count: 3, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      { column_index: 1, roles: ["context"], nonempty_count: 0, distinct_nonempty_count: 0, timestamp_matches: [...noMatches] },
      { column_index: 2, roles: ["context", "case_id", "activity"], nonempty_count: 4, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      { column_index: 3, roles: ["context", "case_id", "activity"], nonempty_count: 4, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      {
        column_index: 4,
        roles: ["context", "case_id", "activity", "source_sequence"],
        nonempty_count: 4,
        distinct_nonempty_count: 4,
        timestamp_matches: [...noMatches],
      },
    ],
    unresolved: ["Confirm the proposed encoding, separator and column roles."],
    blank_record_count: 0,
    ragged_record_count: 0,
  };
}

export function secondsInterpretationAnswer(request: ConfirmMappingRequest): InterpretationAnswer {
  const ready = request.accept_report_issues;
  return {
    ...interpretationAnswer(request),
    state: ready ? "ready" : "needs_confirmation",
    report: {
      ...report(),
      raw_record_count: 4,
      identified_record_count: 3,
      unassigned_record_count: 1,
      usable_timestamp_record_count: 3,
      unavailable_timestamp_record_count: 1,
      case_count: 2,
      sequence_evaluable_case_count: 2,
      sequence_unevaluable_case_count: 0,
      first_usable_utc_instant: "2026-04-03T06:00:15Z",
      last_usable_utc_instant: "2026-04-14T07:30:20Z",
      snapshot_cutoff_utc: "2026-04-14T07:31:00Z",
      missing_cells: [
        { column_index: 0, record_count: 0 },
        { column_index: 1, record_count: 0 },
        { column_index: 2, record_count: 0 },
        { column_index: 3, record_count: 1 },
      ],
      issues: [
        {
          source_position: 2,
          column_index: null,
          case_id: null,
          code: "ragged_record",
          severity: "confirmation",
          message: "This source record has 5 cells; expected 4. Keep its exact raw text outside every case population; no fields were padded or associated.",
        },
      ],
      blank_record_count: 1,
      ragged_record_count: 1,
      excluded_source_records: [
        {
          source_position: 2,
          physical_line_start: 4,
          physical_line_end: 4,
          cell_count: 5,
          reason: "ragged_record",
          original_cells: ["B-2", "Eröffnet", "05.04.2026 07:15:40", "Größe & Maß", "extra"],
          original_text: raggedText,
        },
      ],
    } as InterpretationReport,
  } as InterpretationAnswer;
}

export function proposalAnswer(request: ConfirmMappingRequest, last: string | null, proposed: string | null): CutoffProposal {
  return {
    schema_version: 1,
    message_type: "cutoff_proposal_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    source_id: request.source_id,
    timestamp_kind: request.policies.time.id === "incident.time.wall_clock_as_recorded.v1" ? "wall_clock" : "utc_instant",
    last_usable_time: last,
    proposed_cutoff: proposed,
  } as CutoffProposal;
}

/** The inspection of a packaged example as the local service answers it: comma, UTF-8, ISO times with their UTC mark. */
export function exampleInspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  const names = ["incident_id", "source_event_id", "source_sequence", "activity", "timestamp_utc", "service", "assignment_group"];
  return {
    ...inspectionAnswer(request),
    dialect_candidates: [{ encoding: "utf-8", delimiter: ",", quotechar: '"', header: "first_record" }],
    columns: names.map((name, index) => ({ index, name })),
    record_count: 2,
    sample_rows: [
      { source_position: 0, cells: ["S3A", "e-S3A-01", "1", "Opened", "2026-10-01T09:00:00Z", "S", "Unknown"] },
      { source_position: 1, cells: ["S3B", "e-S3B-01", "1", "Opened", "2026-10-01T09:00:00Z", "S", ""] },
    ],
    role_suggestions: [
      { column_index: 0, roles: ["context", "case_id", "activity"], nonempty_count: 2, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      { column_index: 1, roles: ["context", "case_id", "activity"], nonempty_count: 2, distinct_nonempty_count: 2, timestamp_matches: [...noMatches] },
      { column_index: 2, roles: ["context", "case_id", "activity", "source_sequence"], nonempty_count: 2, distinct_nonempty_count: 1, timestamp_matches: [...noMatches] },
      { column_index: 3, roles: ["context", "case_id", "activity"], nonempty_count: 2, distinct_nonempty_count: 1, timestamp_matches: [...noMatches] },
      { column_index: 4, roles: ["context", "case_id", "activity", "timestamp"], nonempty_count: 2, distinct_nonempty_count: 1, timestamp_matches: matches({ iso8601: 2 }) },
      { column_index: 5, roles: ["context", "case_id", "activity"], nonempty_count: 2, distinct_nonempty_count: 1, timestamp_matches: [...noMatches] },
      { column_index: 6, roles: ["context", "case_id", "activity"], nonempty_count: 1, distinct_nonempty_count: 1, timestamp_matches: [...noMatches] },
    ],
    unresolved: ["Confirm the proposed encoding, separator and column roles."],
  };
}

/** The same source read with commas: one column, as an analyst would see after a wrong delimiter. */
export function commaInspectionAnswer(request: InspectCsvRequest): CsvInspectionAnswer {
  return {
    ...inspectionAnswer(request),
    dialect_candidates: [{ encoding: "windows-1252", delimiter: ",", quotechar: '"', header: "first_record" }],
    columns: [{ index: 0, name: "Vorgang;Aktivität;Zeitpunkt;Gruppe" }],
    sample_rows: [{ source_position: 0, cells: ["A-1;Eröffnet;03.04.2026 08:00;Büro"] }],
    role_suggestions: [
      { column_index: 0, roles: ["context", "case_id", "activity"], nonempty_count: 4, distinct_nonempty_count: 4, timestamp_matches: [...noMatches] },
    ],
    unresolved: ["Confirm the proposed encoding, separator and column roles."],
  };
}

function report(): InterpretationReport {
  return {
    raw_record_count: 4,
    identified_record_count: 3,
    unassigned_record_count: 1,
    usable_timestamp_record_count: 3,
    unavailable_timestamp_record_count: 1,
    case_count: 2,
    sequence_evaluable_case_count: 1,
    sequence_unevaluable_case_count: 1,
    mapped_activity_record_count: 3,
    omitted_activity_record_count: 0,
    timestamp_kind: "utc_instant",
    first_usable_utc_instant: "2026-04-03T06:00:00Z",
    last_usable_utc_instant: "2026-04-05T05:15:00Z",
    first_usable_local_timestamp: null,
    last_usable_local_timestamp: null,
    snapshot_cutoff_utc: "2027-01-01T00:00:00Z",
    snapshot_cutoff_local: null,
    missing_cells: [
      { column_index: 0, record_count: 1 },
      { column_index: 1, record_count: 0 },
      { column_index: 2, record_count: 0 },
      { column_index: 3, record_count: 1 },
    ],
    tied_timestamp_groups: 0,
    tied_timestamp_record_count: 0,
    duplicate_candidate_record_count: 0,
    activities: [
      { activity: "Eröffnet", record_count: 1, case_count: 1 },
      { activity: "Geschlossen", record_count: 1, case_count: 1 },
      { activity: "Prüfung", record_count: 1, case_count: 1 },
    ],
    issues: [
      {
        source_position: 2,
        column_index: 0,
        case_id: null,
        code: "missing_case_id",
        severity: "confirmation",
        message: "This original row has no incident identifier and remains outside every case population.",
      },
      {
        source_position: 3,
        column_index: 2,
        case_id: "B-2",
        code: "invalid_timestamp",
        severity: "confirmation",
        message: "This row's time is unavailable; retain raw evidence and mark the incident's sequence unevaluable.",
      },
    ],
    assumptions: ["Every unzoned timestamp uses the explicitly chosen fixed UTC offset of 120 minutes; no daylight-saving adjustment is inferred."],
  } as InterpretationReport;
}

export function interpretationAnswer(request: ConfirmMappingRequest): InterpretationAnswer {
  const ready = request.accept_report_issues;
  return {
    schema_version: 1,
    message_type: "interpretation_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    source_id: request.source_id,
    state: ready ? "ready" : "needs_confirmation",
    preparation: ready
      ? { preparation_id: preparationId, source_id: request.source_id, dialect: request.dialect, mapping: request.mapping, policies: request.policies }
      : null,
    report: report(),
  } as InterpretationAnswer;
}

export function caseSummaries(count: number): ImportedCaseSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    case_id: `INC-${String(index).padStart(5, "0")}`,
    record_count: 6,
    mapped_record_count: 6,
    omitted_activity_record_count: 0,
    sequence_evaluable: true,
  }));
}

export function populationAnswer(request: OpenPopulationRequest, cases?: ImportedCaseSummary[]): ImportedPopulationAnswer {
  const listed = cases ?? [
    { case_id: "A-1", record_count: 2, mapped_record_count: 2, omitted_activity_record_count: 0, sequence_evaluable: true },
    { case_id: "B-2", record_count: 1, mapped_record_count: 1, omitted_activity_record_count: 0, sequence_evaluable: false },
  ];
  const large = cases !== undefined;
  return {
    schema_version: 1,
    message_type: "imported_population_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: { ...identity, preparation_id: request.preparation_id },
    preparation: {
      preparation_id: request.preparation_id,
      source_id: sourceId,
      dialect: { encoding: "windows-1252", delimiter: ";", quotechar: '"', header: "first_record" },
      mapping: { case_column: 0, activity_column: 1, timestamp_column: 2, sequence_column: null, context_columns: [3] },
      policies: {
        time: {
          id: "incident.time.explicit_format_timezone_utc.v1",
          parameters: { format: "dmy_dot_minute", timezone: { mode: "fixed_offset", offset_minutes: 120 }, snapshot_cutoff_utc: "2027-01-01T00:00:00Z" },
        },
        rows: rowPolicies.tolerant,
        ...fixedPolicies,
      },
    },
    source: { source_id: sourceId, filename: "Vorgänge.csv", byte_count: 120 },
    population: large
      ? { case_ids: listed.map((item) => item.case_id), case_count: 40000, record_count: 240000 }
      : { case_ids: ["A-1", "B-2"], case_count: 2, record_count: 3 },
    coverage: large
      ? { raw_record_count: 240000, mapped_record_count: 240000, omitted_activity_record_count: 0 }
      : { raw_record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0 },
    unassigned_record_count: large ? 0 : 1,
    cases: listed,
  };
}

/** Incident A-1 with a missing context cell next to a literal value, and a record without activity label. */
export function evidenceAnswer(request: ImportedCaseEvidenceRequest): ImportedCaseEvidenceAnswer {
  const rows = [`row.v1:sha256:${hex("c")}`, `row.v1:sha256:${hex("d")}`, `row.v1:sha256:${hex("e")}`];
  return {
    schema_version: 1,
    message_type: "imported_case_evidence_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    case_id: request.case_id,
    coverage: { raw_record_count: 3, mapped_record_count: 2, omitted_activity_record_count: 1 },
    columns: [
      { index: 0, name: "Vorgang" },
      { index: 1, name: "Aktivität" },
      { index: 2, name: "Zeitpunkt" },
      { index: 3, name: "Gruppe" },
    ],
    sequence_evaluable: false,
    records: [
      {
        row_id: rows[0], source_position: 0, source_sequence: null, activity: "Eröffnet", timestamp_kind: "utc_instant",
        utc_instant: "2026-04-03T06:00:00Z", local_timestamp: null, timestamp_status: "usable",
        context: [{ column_index: 3, value: "Unknown" }], original_cells: [request.case_id, "Eröffnet", "03.04.2026 08:00", "Unknown"],
      },
      {
        row_id: rows[1], source_position: 1, source_sequence: null, activity: null, timestamp_kind: "utc_instant",
        utc_instant: "2026-04-04T07:30:00Z", local_timestamp: null, timestamp_status: "usable",
        context: [{ column_index: 3, value: null }], original_cells: [request.case_id, "", "04.04.2026 09:30", ""],
      },
      {
        row_id: rows[2], source_position: 3, source_sequence: null, activity: "Prüfung", timestamp_kind: "utc_instant",
        utc_instant: null, local_timestamp: null, timestamp_status: "invalid",
        context: [{ column_index: 3, value: "Größe & Maß" }], original_cells: [request.case_id, "Prüfung", "xx", "Größe & Maß"],
      },
    ],
    mapped_row_ids: [rows[0], rows[2]],
    omitted_activity_row_ids: [rows[1]],
  } as ImportedCaseEvidenceAnswer;
}

export function importRefusal(
  request: { request_id: string; query_revision: number; workspace_id?: string },
  operation: ImportRefusal["operation"],
  code: ImportRefusal["code"],
  message: string,
  field: string | null = null,
): ImportOutcome<never> {
  return {
    ok: false,
    problem: {
      kind: "refusal",
      refusal: {
        schema_version: 1,
        message_type: "import_refusal",
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id ?? null,
        operation,
        code,
        message,
        field,
        retryable: ["workspace_unavailable", "workspace_not_writable", "source_unavailable", "preparation_unavailable", "computation_failed"].includes(code),
      },
    },
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: ImportOutcome<Answer>) => void;
}

/** An import client whose replies the test delivers, one pending call at a time. */
export function scriptedImportClient() {
  const workspaces: Call<OpenWorkspaceRequest, WorkspaceAnswer>[] = [];
  const uploads: (Call<UploadSourceMetadata, SourceAnswer> & { file: Blob })[] = [];
  const inspections: Call<InspectCsvRequest, CsvInspectionAnswer>[] = [];
  const confirmations: Call<ConfirmMappingRequest, InterpretationAnswer>[] = [];
  const proposals: Call<ConfirmMappingRequest, CutoffProposal>[] = [];
  const examples: Call<ExampleId, Blob>[] = [];
  const populations: Call<OpenPopulationRequest, ImportedPopulationAnswer>[] = [];
  const evidence: Call<ImportedCaseEvidenceRequest, ImportedCaseEvidenceAnswer>[] = [];
  const client: ImportClient = {
    openWorkspace: (request, signal) => new Promise((reply) => workspaces.push({ request, signal, reply })),
    uploadSource: (request, file, signal) => new Promise((reply) => uploads.push({ request, file, signal, reply })),
    inspect: (request, signal) => new Promise((reply) => inspections.push({ request, signal, reply })),
    confirmMapping: (request, signal) => new Promise((reply) => confirmations.push({ request, signal, reply })),
    proposeCutoff: (request, signal) => new Promise((reply) => proposals.push({ request, signal, reply })),
    exampleSource: (request, signal) => new Promise((reply) => examples.push({ request, signal, reply })),
    openPopulation: (request, signal) => new Promise((reply) => populations.push({ request, signal, reply })),
    caseEvidence: (request, signal) => new Promise((reply) => evidence.push({ request, signal, reply })),
  };
  return { client, workspaces, uploads, inspections, confirmations, proposals, examples, populations, evidence };
}
