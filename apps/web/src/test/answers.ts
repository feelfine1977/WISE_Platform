import type {
  AnswerIdentity,
  CaseEvidenceAnswer,
  CaseEvidenceRequest,
  OpenExampleRequest,
  PopulationAnswer,
  Refusal,
  SourceRecord,
} from "../generated/investigation";
import type { InvestigationClient, Outcome } from "../investigation/client";

/*
 * Answers written by hand in the shape of the investigation contract. The numbers are chosen for
 * these tests and are consistent with each other; they are not taken from any implementation.
 *
 * Example S0 (hand-made): incidents INC01, INC02 and INC03 are in the parent population, INC04 is
 * outside it.
 *   INC01: 3 records, all with an activity, Resolved recorded          -> kept
 *   INC02: 2 records, all with an activity, Resolved recorded          -> kept
 *   INC03: 2 records, the second without an activity, no Resolved      -> removed
 *   INC04: 1 record                                                    -> outside
 * Parent 3 incidents / 7 records; kept 2 / 5; removed 1 / 2; outside 1 / 1; all 4 / 8.
 * Mapped sequence of the parent: 6 of 7 records, 1 left out.
 *
 * Example S1 (hand-made): INC05 with 6 records is the whole parent population; INC06 (1 record)
 * is outside it. All 2 incidents / 7 records.
 */

const hex = (digit: string) => digit.repeat(64);

export const identityZero: AnswerIdentity = {
  source_id: `source.v1:sha256:${hex("a")}`,
  preparation_id: `preparation.v1:sha256:${hex("b")}`,
  representation_id: `representation.v1:sha256:${hex("c")}`,
  case_dictionary_id: `case-dictionary.v1:sha256:${hex("d")}`,
  population_id: `population.v1:sha256:${hex("e")}`,
  implementation_version: "0.1.0",
};

export const identityOne: AnswerIdentity = {
  ...identityZero,
  source_id: `source.v1:sha256:${hex("1")}`,
  population_id: `population.v1:sha256:${hex("2")}`,
};

export function populationZero(request: OpenExampleRequest): PopulationAnswer {
  return {
    schema_version: 1,
    message_type: "population_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    identity: identityZero,
    source: {
      example_id: "S0",
      synthetic: true,
      label: "Synthetic incidents, hand-made example zero",
      snapshot_cutoff_utc: "2026-10-02T00:00:00Z",
    },
    policies: request.policies,
    populations: {
      base: { case_ids: ["INC01", "INC02", "INC03", "INC04"], case_count: 4, record_count: 8 },
      parent: { case_ids: ["INC01", "INC02", "INC03"], case_count: 3, record_count: 7 },
      kept: { case_ids: ["INC01", "INC02"], case_count: 2, record_count: 5 },
      removed: { case_ids: ["INC03"], case_count: 1, record_count: 2 },
      unevaluable: { case_ids: [], case_count: 0, record_count: 0 },
      outside: { case_ids: ["INC04"], case_count: 1, record_count: 1 },
    },
    coverage: { raw_record_count: 7, mapped_record_count: 6, omitted_activity_record_count: 1 },
    cases: [
      { case_id: "INC01", record_count: 3, mapped_record_count: 3, omitted_activity_record_count: 0, partition: "kept" },
      { case_id: "INC02", record_count: 2, mapped_record_count: 2, omitted_activity_record_count: 0, partition: "kept" },
      { case_id: "INC03", record_count: 2, mapped_record_count: 1, omitted_activity_record_count: 1, partition: "removed" },
    ],
  };
}

export function populationOne(request: OpenExampleRequest): PopulationAnswer {
  return {
    schema_version: 1,
    message_type: "population_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    identity: identityOne,
    source: {
      example_id: "S1",
      synthetic: true,
      label: "Synthetic incidents, hand-made example one",
      snapshot_cutoff_utc: "2026-10-02T00:00:00Z",
    },
    policies: request.policies,
    populations: {
      base: { case_ids: ["INC05", "INC06"], case_count: 2, record_count: 7 },
      parent: { case_ids: ["INC05"], case_count: 1, record_count: 6 },
      kept: { case_ids: ["INC05"], case_count: 1, record_count: 6 },
      removed: { case_ids: [], case_count: 0, record_count: 0 },
      unevaluable: { case_ids: [], case_count: 0, record_count: 0 },
      outside: { case_ids: ["INC06"], case_count: 1, record_count: 1 },
    },
    coverage: { raw_record_count: 6, mapped_record_count: 6, omitted_activity_record_count: 0 },
    cases: [{ case_id: "INC05", record_count: 6, mapped_record_count: 6, omitted_activity_record_count: 0, partition: "kept" }],
  };
}

function record(
  incident: string,
  position: number,
  sequence: number,
  activity: string,
  timestamp: string,
  group: string,
  rowDigit: string,
): SourceRecord {
  return {
    row_id: `row.v1:sha256:${hex(rowDigit)}`,
    source_position: position,
    source_event_id: `e-${incident}-0${sequence}`,
    source_sequence: sequence,
    activity: activity === "" ? null : activity,
    timestamp_utc: timestamp,
    service: "S",
    assignment_group: group === "" ? null : group,
    original_values: {
      incident_id: incident,
      source_event_id: `e-${incident}-0${sequence}`,
      source_sequence: String(sequence),
      activity,
      timestamp_utc: timestamp,
      service: "S",
      assignment_group: group,
    },
  };
}

/** Every record of one incident of example S0, keyed by incident. */
const historiesZero: Record<string, CaseEvidenceAnswer["records"]> = {
  INC01: [
    record("INC01", 0, 1, "Opened", "2026-10-01T08:00:00Z", "Desk", "3"),
    record("INC01", 1, 2, "Assigned", "2026-10-01T08:30:00Z", "Network", "4"),
    record("INC01", 2, 3, "Resolved", "2026-10-01T11:00:00Z", "Network", "5"),
  ],
  INC02: [
    record("INC02", 3, 1, "Opened", "2026-10-01T09:00:00Z", "Desk", "6"),
    record("INC02", 4, 2, "Resolved", "2026-10-01T09:45:00Z", "Desk", "7"),
  ],
  // The first record carries the literal text "Unknown"; the second has empty activity and group cells.
  INC03: [
    record("INC03", 5, 1, "Opened", "2026-10-01T10:00:00Z", "Unknown", "8"),
    record("INC03", 6, 2, "", "2026-10-01T10:20:00Z", "", "9"),
  ],
};

/** Supplied coverage of each history above, written out: raw, mapped and left-out records. */
const coverageZero: Record<string, [number, number, number]> = { INC01: [3, 3, 0], INC02: [2, 2, 0], INC03: [2, 1, 1] };
const omittedZero: Record<string, string[]> = { INC01: [], INC02: [], INC03: [`row.v1:sha256:${hex("9")}`] };

export function evidenceZero(request: CaseEvidenceRequest): CaseEvidenceAnswer {
  const records = historiesZero[request.case_id];
  if (!records) throw new Error(`No hand-made history for ${request.case_id}.`);
  const [raw, mapped, omitted] = coverageZero[request.case_id];
  const omittedRows = omittedZero[request.case_id];
  return {
    schema_version: 1,
    message_type: "case_evidence_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    identity: request.identity,
    case_id: request.case_id,
    coverage: { raw_record_count: raw, mapped_record_count: mapped, omitted_activity_record_count: omitted },
    records,
    mapped_row_ids: records.map((row) => row.row_id).filter((rowId) => !omittedRows.includes(rowId)),
    omitted_activity_row_ids: omittedRows,
  };
}

export function refusalOf(
  request: OpenExampleRequest | CaseEvidenceRequest,
  operation: Refusal["operation"],
  code: Refusal["code"],
  message: string,
  retryable = true,
): Refusal {
  return {
    schema_version: 1,
    message_type: "refusal",
    request_id: request.request_id,
    query_revision: request.query_revision,
    operation,
    code,
    message,
    field: null,
    retryable,
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: Outcome<Answer>) => void;
}

/** A client whose replies the test delivers by hand, in any order. */
export function scriptedClient() {
  const opens: Call<OpenExampleRequest, PopulationAnswer>[] = [];
  const cases: Call<CaseEvidenceRequest, CaseEvidenceAnswer>[] = [];
  const client: InvestigationClient = {
    openExample: (request, signal) => new Promise((reply) => opens.push({ request, signal, reply })),
    caseEvidence: (request, signal) => new Promise((reply) => cases.push({ request, signal, reply })),
  };
  return { client, opens, cases };
}

export const healthy = () => Promise.resolve({ status: "ok", stage: "foundation", version: "0.1.0" } as const);
