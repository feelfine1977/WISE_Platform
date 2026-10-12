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
import type { ImportClient, ImportOutcome } from "../data/client";
import { fixedPolicies } from "../data/interpretation";

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

const noMatches = [
  { format: "iso8601", parsed_count: 0 },
  { format: "dmy_dot_minute", parsed_count: 0 },
  { format: "mdy_dot_minute", parsed_count: 0 },
  { format: "dmy_slash_minute", parsed_count: 0 },
  { format: "mdy_slash_minute", parsed_count: 0 },
] as const;

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
        timestamp_matches: [
          { format: "iso8601", parsed_count: 0 },
          { format: "dmy_dot_minute", parsed_count: 3 },
          { format: "mdy_dot_minute", parsed_count: 3 },
          { format: "dmy_slash_minute", parsed_count: 0 },
          { format: "mdy_slash_minute", parsed_count: 0 },
        ],
      },
      { column_index: 3, roles: ["context", "case_id", "activity"], nonempty_count: 3, distinct_nonempty_count: 3, timestamp_matches: [...noMatches] },
    ],
    unresolved: [
      "Confirm the proposed encoding, separator and column roles.",
      "Column 2 has multiple possible timestamp formats; choose day/month order explicitly.",
    ],
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
  const populations: Call<OpenPopulationRequest, ImportedPopulationAnswer>[] = [];
  const evidence: Call<ImportedCaseEvidenceRequest, ImportedCaseEvidenceAnswer>[] = [];
  const client: ImportClient = {
    openWorkspace: (request, signal) => new Promise((reply) => workspaces.push({ request, signal, reply })),
    uploadSource: (request, file, signal) => new Promise((reply) => uploads.push({ request, file, signal, reply })),
    inspect: (request, signal) => new Promise((reply) => inspections.push({ request, signal, reply })),
    confirmMapping: (request, signal) => new Promise((reply) => confirmations.push({ request, signal, reply })),
    openPopulation: (request, signal) => new Promise((reply) => populations.push({ request, signal, reply })),
    caseEvidence: (request, signal) => new Promise((reply) => evidence.push({ request, signal, reply })),
  };
  return { client, workspaces, uploads, inspections, confirmations, populations, evidence };
}
