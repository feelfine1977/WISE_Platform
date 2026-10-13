import type { OpenPopulationRequest, ImportedPopulationAnswer } from "../generated/imports";
import type {
  CaseVerdict,
  DefinitionVersion,
  ExpectationValidationAnswer,
  ResolutionDefinition,
  ScoreCaseWitnessAnswer,
  ScoreCaseWitnessRequest,
  ScoreExpectationRequest,
  ScoreRunAnswer,
  ScoringBlocker,
  ScoringRefusal,
  ValidateExpectationRequest,
} from "../generated/scoring";
import type { ProcessGraphAnswer, ProcessGraphRequest, SelectCasesRequest, SelectionAnswer } from "../generated/selection";
import { type ScoringClient, type ScoringOutcome, scoringContract } from "../expectation/client";
import { populationAnswer } from "./imports";
import { closed, graphAnswer, opened, selectionAnswer, everyIncident, support } from "./selections";

/*
 * Answers written by hand for five incidents of a preparation, scored against "after Eröffnet,
 * Geschlossen within 4 hours, partly met up to 2 hours later, a missing Geschlossen counted as not
 * met". The library's rule gives 0 up to 4 hours, (hours - 4) / 2 up to 6 hours and 1 beyond:
 *
 *   A-1  Eröffnet 00:00, Geschlossen 03:00    3 h   value 0
 *   B-2  Eröffnet 00:00, Geschlossen 05:00    5 h   value 0.5   (two Geschlossen records at 05:00)
 *   C-3  Eröffnet 00:00, Geschlossen 08:00    8 h   value 1
 *   D-4  Eröffnet 00:00, no Geschlossen             value 1, counted as not met; no measured time
 *   E-5  Prüfung 00:00, no Eröffnet                  no value: no start
 *
 * Counts: 1 meets it (A-1), 1 partly (B-2), 2 do not (C-3, D-4), 3 affected, 1 without the start,
 * 1 without the response; worst first C-3, D-4, B-2, A-1, E-5.
 */

const hex = (digit: string) => digit.repeat(64);

export const scoredIds = ["A-1", "B-2", "C-3", "D-4", "E-5"];
export const definitionVersionId = `definition-version.v1:sha256:${hex("1")}`;
export const runId = `score-run.v1:sha256:${hex("2")}`;
export const otherRunId = `score-run.v1:sha256:${hex("3")}`;
const calibrationId = `calibration.v1:sha256:${hex("4")}`;
const normVersionId = `norm-version.v1:sha256:${hex("5")}`;
const row = (digit: string) => `row.v1:sha256:${hex(digit)}`;

export const methodArtifact = {
  distribution: "wise-pm",
  version: "0.2.0",
  source_commit: "6883db5269e622d9ce5274d207e831d12ab134fe",
  wheel_sha256: "7329b7929bb8a3e40c596b359f352aace23cc233d8f29322ee063612733aecc3",
  qualification: "candidate_component_checked_release_pending",
  eligible_release: false,
} as const;

/** The population of the five incidents, as the investigation opens it. */
export function scoringPopulationAnswer(request: OpenPopulationRequest): ImportedPopulationAnswer {
  const answer = populationAnswer(request);
  return {
    ...answer,
    population: { case_ids: scoredIds, case_count: 5, record_count: 9 },
    coverage: { raw_record_count: 9, mapped_record_count: 9, omitted_activity_record_count: 0 },
    unassigned_record_count: 0,
    cases: scoredIds.map((caseId) => ({
      case_id: caseId,
      record_count: caseId === "B-2" ? 3 : caseId === "C-3" || caseId === "A-1" ? 2 : 1,
      mapped_record_count: caseId === "B-2" ? 3 : caseId === "C-3" || caseId === "A-1" ? 2 : 1,
      omitted_activity_record_count: 0,
      sequence_evaluable: true,
    })),
  };
}

/** No step: every one of the five incidents is kept. */
export function scoringSelectionAnswer(request: SelectCasesRequest): SelectionAnswer {
  const answer = selectionAnswer(request, everyIncident);
  return { ...answer, parent: support(scoredIds, 9), kept: support(scoredIds, 9) };
}

/** The map of the five incidents: its activities are Eröffnet, Geschlossen and Prüfung. */
export function scoringGraphAnswer(request: ProcessGraphRequest): ProcessGraphAnswer {
  return graphAnswer(request, scoredIds);
}

function definitionVersion(request: ValidateExpectationRequest): DefinitionVersion {
  const { definition } = request;
  const { population_id: _population, ...binding } = request.base_identity;
  return {
    definition_version_id: definitionVersionId,
    source_binding: binding,
    definition,
    norm: {
      norm_version_id: normVersionId,
      norm_fingerprint: hex("6"),
      document: {
        schema_version: 3,
        name: definition.name,
        version: String(definition.definition_revision),
        missing_values: "three_valued",
        scoring_mode: "flat",
        layers: [{ id: "Timing" }],
        views: [{ name: "Resolution", constraint_weights: { resolution: 1 } }],
        constraints: [
          {
            id: "resolution",
            layer: "Timing",
            type: "lag",
            params: {
              a: definition.endpoints.activation_activity,
              b: definition.endpoints.response_activity,
              activation: "first",
              response: "first_after",
              delta: definition.target,
              width: definition.width,
              unit: "h",
              missing_a: "skip",
              missing_b: definition.missing_response,
            },
          },
        ],
      },
    },
    compilation: {
      requested_constraint_count: 1,
      compiled_constraint_count: 1,
      omitted_constraint_count: 0,
      scope_kind: "all_cases",
      pairing: "first_after",
      unsupported_meaning_omitted: false,
    },
    method_artifact: methodArtifact,
  };
}

function envelope<Kind extends string>(messageType: Kind, request: { request_id: string; query_revision: number; workspace_id: string }) {
  return {
    schema_version: 1 as const,
    message_type: messageType,
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
  };
}

const readiness = (passed: boolean) => ({
  method_artifact: methodArtifact,
  supported_definition: passed,
  preparation_gate_passed: true,
  method_check_passed: passed,
  release_gate_pending: true as const,
});

/** A hand-written message, refused here unless it is a message of the scoring contract. */
function contractMessage<T>(isMessage: (value: unknown) => value is T, value: unknown): T {
  if (!isMessage(value)) throw new Error("A hand-written answer is outside the scoring contract.");
  return value;
}

export function readyAnswer(request: ValidateExpectationRequest): ExpectationValidationAnswer {
  return contractMessage(scoringContract.validationAnswer, {
    ...envelope("expectation_validation_answer", request),
    state: "ready",
    definition_version: definitionVersion(request),
    readiness: readiness(true),
    blockers: [],
  });
}

export function blockedAnswer(request: ValidateExpectationRequest, blockers: ScoringBlocker[]): ExpectationValidationAnswer {
  return contractMessage(scoringContract.validationAnswer, {
    ...envelope("expectation_validation_answer", request),
    state: "blocked",
    definition_version: null,
    readiness: readiness(false),
    blockers,
  });
}

const observed = (hours: number) => ({ status: "observed" as const, value: hours, unit: "hours" as const, activation_known: true as const, response_known: true as const, censor_age: null });

export const verdicts: CaseVerdict[] = [
  { case_id: "A-1", value: 0, in_scope: true, reason: "evaluated", measurement: observed(3) },
  { case_id: "B-2", value: 0.5, in_scope: true, reason: "evaluated", measurement: observed(5) },
  { case_id: "C-3", value: 1, in_scope: true, reason: "evaluated", measurement: observed(8) },
  {
    case_id: "D-4",
    value: 1,
    in_scope: true,
    reason: "evaluated",
    measurement: { status: "missing_response", value: null, unit: "hours", activation_known: true, response_known: false, censor_age: null },
  },
  {
    case_id: "E-5",
    value: null,
    in_scope: true,
    reason: "missing_activation",
    measurement: { status: "missing_activation", value: null, unit: "hours", activation_known: false, response_known: false, censor_age: null },
  },
];

/** The run of the checked definition over the five incidents. */
export function runAnswer(request: ScoreExpectationRequest, definition: ResolutionDefinition, id = runId): ScoreRunAnswer {
  const validation = { ...envelope("validate_expectation_request", request), base_identity: request.base_identity, named_population: request.named_population, definition };
  const version = definitionVersion({ ...validation, message_type: "validate_expectation_request" });
  return contractMessage(scoringContract.scoreRunAnswer, {
    ...envelope("score_run_answer", request),
    run: {
      identity: {
        run_id: id,
        base_identity: request.base_identity,
        scored_population_identity: request.named_population.identity,
        definition_version_id: request.definition_version_id,
        norm_version_id: normVersionId,
        norm_fingerprint: hex("6"),
        method_log_fingerprint: hex("7"),
        calibration_id: calibrationId,
        method_artifact: methodArtifact,
        clock: {
          timestamp_kind: "utc_instant",
          duration_meaning: "elapsed_utc",
          observation_start_utc: "2026-10-09T00:00:00Z",
          snapshot_cutoff_utc: "2026-10-10T00:00:00Z",
          observation_start_local: null,
          snapshot_cutoff_local: null,
        },
      },
      named_population: request.named_population,
      population: { case_ids: scoredIds, case_count: 5, record_count: 9 },
      definition_version: version,
      calibration: {
        calibration_id: calibrationId,
        policy: "fixed_threshold",
        scored_population_id: request.named_population.identity.population_id,
        target: definition.target,
        width: definition.width,
        unit: "hours",
        population_fitted: false,
        method_calibration_count: 0,
        method_calibrations: {},
      },
      support: {
        scored_case_count: 5,
        in_scope_case_count: 5,
        out_of_scope_case_count: 0,
        scope_unknown_case_count: 0,
        numeric_value_case_count: 4,
        unavailable_value_case_count: 1,
        affected_case_count: 3,
        zero_value_case_count: 1,
        observed_interval_case_count: 3,
        activation_known_case_count: 4,
        response_known_case_count: 3,
        missing_activation_case_count: 1,
        missing_response_case_count: 1,
        censored_case_count: 0,
        method_reason_counts: [
          { reason: "evaluated", case_count: 4 },
          { reason: "missing_activation", case_count: 1 },
        ],
      },
      cases: verdicts,
    },
  });
}

/** The records of B-2 (two Geschlossen records at the same instant) or of D-4 (no Geschlossen). */
export function witnessAnswer(request: ScoreCaseWitnessRequest, run: ScoreRunAnswer["run"]): ScoreCaseWitnessAnswer {
  const verdict = run.cases.find((item) => item.case_id === request.case_id);
  if (!verdict) throw new Error(`No hand-written witness for ${request.case_id}.`);
  const record = (digit: string, position: number, activity: string, time: string) => ({
    row_id: row(digit),
    source_position: position,
    source_sequence: null,
    activity,
    timestamp_kind: "utc_instant" as const,
    utc_instant: time,
    local_timestamp: null,
    timestamp_status: "usable" as const,
    context: [],
    original_cells: [request.case_id, activity, time],
  });
  const records =
    request.case_id === "B-2"
      ? [record("a", 2, opened, "2026-10-09T00:00:00Z"), record("b", 3, closed, "2026-10-09T05:00:00Z"), record("c", 4, closed, "2026-10-09T05:00:00Z")]
      : [record("d", 7, opened, "2026-10-09T00:00:00Z")];
  return contractMessage(scoringContract.witnessAnswer, {
    ...envelope("score_case_witness_answer", request),
    run_identity: run.identity,
    case: verdict,
    trace: {
      kind: "imported_csv",
      columns: [
        { index: 0, name: "Vorgang" },
        { index: 1, name: "Aktivität" },
        { index: 2, name: "Zeitpunkt" },
      ],
      records,
      coverage: { raw_record_count: records.length, mapped_record_count: records.length, omitted_activity_record_count: 0 },
      mapped_row_ids: records.map((item) => item.row_id),
      omitted_activity_row_ids: [],
    },
    method_trace_row_ids: records.map((item) => item.row_id),
    activation_candidate_row_ids: [records[0].row_id],
    response_candidate_row_ids: request.case_id === "B-2" ? [records[1].row_id, records[2].row_id] : [],
    endpoint_tie_policy: "matching_timestamp_candidates_in_declared_order.v1",
  });
}

export function scoringRefusal(
  request: { request_id: string; query_revision: number; workspace_id: string },
  operation: ScoringRefusal["operation"],
  code: ScoringRefusal["code"],
  message: string,
  caseIds: string[] = [],
): ScoringOutcome<never> {
  const recovery: ScoringRefusal["recovery_actions"] =
    code === "unevaluable_sequence" ? ["inspect_quality", "choose_qualified_named_population"] : code === "method_unavailable" ? ["retry"] : [];
  return {
    ok: false,
    problem: {
      kind: "refusal",
      refusal: {
        schema_version: 1,
        message_type: "scoring_refusal",
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id,
        operation,
        code,
        message,
        field: code === "unevaluable_sequence" ? "named_population" : null,
        retryable: code === "method_unavailable",
        case_ids: caseIds,
        case_count: caseIds.length,
        recovery_actions: recovery,
      },
    },
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: ScoringOutcome<Answer>) => void;
}

/** A scoring client whose replies the test delivers. */
export function scriptedScoringClient() {
  const validations: Call<ValidateExpectationRequest, ExpectationValidationAnswer>[] = [];
  const scores: Call<ScoreExpectationRequest, ScoreRunAnswer>[] = [];
  const witnesses: Call<ScoreCaseWitnessRequest, ScoreCaseWitnessAnswer>[] = [];
  const client: ScoringClient = {
    validate: (request, signal) => new Promise((reply) => validations.push({ request, signal, reply })),
    score: (request, signal) => new Promise((reply) => scores.push({ request, signal, reply })),
    caseWitness: (request, signal) => new Promise((reply) => witnesses.push({ request, signal, reply })),
  };
  return { client, validations, scores, witnesses };
}
