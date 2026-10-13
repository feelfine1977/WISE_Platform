import type {
  ComparisonRefusal,
  GroupComparisonAnswer,
  GroupComparisonRequest,
  PeriodComparisonAnswer,
  PeriodComparisonRequest,
  PopulationSupport,
} from "../generated/comparison";
import type { ImportedPopulationAnswer, OpenPopulationRequest } from "../generated/imports";
import type { ProcessGraphAnswer, ProcessGraphRequest, SelectCasesRequest, SelectionAnswer } from "../generated/selection";
import type { ComparisonClient, ComparisonOutcome } from "../compare/client";
import { populationAnswer } from "./imports";
import { suppliedGraph } from "./selections";

/*
 * Answers written by hand for a population of four incidents with one context column, "Team"
 * (column 3), and a snapshot cutoff of 2026-10-10 12:00 UTC:
 *
 *   C-1  Opened Oct 1 08:00, Resolved              2 records  opens with Team "North"
 *   C-2  Opened Oct 2 09:00, Assigned, Resolved    3 records  opens with Team missing
 *   C-3  Opened Oct 9 08:00, Resolved              2 records  opens with Team "South"
 *   C-4  Opened Oct 10 11:00, Assigned             2 records  opens with Team "East"
 *
 * The parent is 4 incidents with 9 records; every first record can be read. The figures below
 * are worked out from this description alone.
 */

const hex = (digit: string) => digit.repeat(64);

export function support(caseIds: string[], records: number): PopulationSupport {
  return { case_ids: caseIds, case_count: caseIds.length, record_count: records };
}

const none = support([], 0);
export const parent = support(["C-1", "C-2", "C-3", "C-4"], 9);
export const teamColumn = 3;

export function comparedPopulationAnswer(request: OpenPopulationRequest): ImportedPopulationAnswer {
  const base = populationAnswer(request);
  const summary = (caseId: string, records: number) => ({
    case_id: caseId,
    record_count: records,
    mapped_record_count: records,
    omitted_activity_record_count: 0,
    sequence_evaluable: true,
  });
  const time = {
    id: "incident.time.explicit_format_timezone_utc.v1" as const,
    parameters: { format: "iso8601" as const, timezone: { mode: "from_values" as const }, snapshot_cutoff_utc: "2026-10-10T12:00:00Z" },
  };
  return {
    ...base,
    preparation: { ...base.preparation, policies: { ...base.preparation.policies, time } },
    population: parent,
    coverage: { raw_record_count: 9, mapped_record_count: 9, omitted_activity_record_count: 0 },
    unassigned_record_count: 0,
    cases: [summary("C-1", 2), summary("C-2", 3), summary("C-3", 2), summary("C-4", 2)],
  };
}

/** The selection of the population: no step keeps all four; "contains Assigned" keeps C-2 and C-4. */
export function comparedSelection(request: SelectCasesRequest): SelectionAnswer {
  const assigned = request.predicates.length > 0;
  const kept = assigned ? support(["C-2", "C-4"], 5) : parent;
  const removed = assigned ? support(["C-1", "C-3"], 4) : none;
  return {
    schema_version: 1,
    message_type: "selection_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: { ...request.identity, population_id: `population.v1:sha256:${hex(assigned ? "2" : "1")}` },
    parent_identity: { ...request.identity, population_id: `population.v1:sha256:${hex("1")}` },
    parent,
    kept,
    removed,
    unevaluable: none,
    predicate_results: request.predicates.map((predicate) => ({ predicate, kept, removed, unevaluable: none })),
  };
}

/** A map of the given incidents with the three activities of the population. */
export function comparedGraph(request: ProcessGraphRequest, caseIds: string[]): ProcessGraphAnswer {
  const graph = suppliedGraph(caseIds);
  const activity = (label: string, digit: string) => ({
    id: `activity.v1:sha256:${hex(digit)}`,
    kind: "activity" as const,
    label,
    metrics: { count: 1, events: 1, cases: 1, starts: 0, ends: 0 },
  });
  return {
    schema_version: 1,
    message_type: "process_graph_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    graph: { ...graph, nodes: [activity("Opened", "b"), activity("Assigned", "c"), activity("Resolved", "d")] },
  };
}

const share = (value: number) => ({ status: "available" as const, value });
const category = (count: number, denominator: number) => ({ case_count: count, denominator, share: share(count / denominator) });
const identityOf = (request: { identity: GroupComparisonRequest["identity"] }, digit: string) => ({
  ...request.identity,
  population_id: `population.v1:sha256:${hex(digit)}`,
});

/**
 * A: the incidents that contain "Assigned" (C-2, C-4); B: the listed C-1, C-2 and C-3. C-2 is in
 * both. Openings in A: missing, East; in B: North, missing, South.
 */
export function groupAnswer(request: GroupComparisonRequest): GroupComparisonAnswer {
  const [targetName, referenceName] =
    request.definition.mode === "two_named_groups"
      ? [request.definition.target.name, request.definition.reference.name]
      : [request.definition.target_name, request.definition.reference_name];
  return {
    schema_version: 1,
    message_type: "group_comparison_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    parent_identity: identityOf(request, "1"),
    parent,
    comparison_id: `comparison.v1:sha256:${hex("e")}`,
    context_column_index: request.context_column_index,
    context_policy: request.context_policy,
    definition: request.definition,
    target: {
      name: targetName,
      identity: identityOf(request, "2"),
      included: support(["C-2", "C-4"], 5),
      excluded: support(["C-1", "C-3"], 4),
      unevaluable: none,
    },
    reference: {
      name: referenceName,
      identity: identityOf(request, "3"),
      included: support(["C-1", "C-2", "C-3"], 7),
      excluded: support(["C-4"], 2),
      unevaluable: none,
    },
    pair_support: {
      overlap: support(["C-2"], 3),
      target_only: support(["C-4"], 2),
      reference_only: support(["C-1", "C-3"], 4),
      neither: none,
      unevaluable: none,
    },
    context_profile: {
      denominator_basis: "context_evaluable_cases",
      parent_evaluable: parent,
      parent_unevaluable: none,
      target_evaluable: support(["C-2", "C-4"], 5),
      target_unevaluable: none,
      reference_evaluable: support(["C-1", "C-2", "C-3"], 7),
      reference_unevaluable: none,
      parent_fixed: { status: "varying", value: null, reason: null },
      categories: [
        // Missing: 1 of 2 against 1 of 3: 100 × (1/2 − 1/3) points, ratio (1/2) / (1/3).
        { value: null, parent: category(1, 4), target: category(1, 2), reference: category(1, 3), difference_percentage_points: share(50 / 3), concentration_ratio: share(1.5) },
        { value: "East", parent: category(1, 4), target: category(1, 2), reference: category(0, 3), difference_percentage_points: share(50), concentration_ratio: { status: "unavailable", reason: "zero_reference_share" } },
        { value: "North", parent: category(1, 4), target: category(0, 2), reference: category(1, 3), difference_percentage_points: { status: "available", value: -100 / 3 }, concentration_ratio: share(0) },
        { value: "South", parent: category(1, 4), target: category(0, 2), reference: category(1, 3), difference_percentage_points: { status: "available", value: -100 / 3 }, concentration_ratio: share(0) },
      ],
    },
  };
}

/**
 * A: started Oct 1 to Oct 2 (C-1, C-2); B: started Oct 9 to Oct 10 (C-3, C-4). To the cutoff,
 * C-1 is followed 220 hours, C-2 195, C-3 28 and C-4 1; "Resolved" is recorded for all but C-4.
 */
export function periodAnswer(request: PeriodComparisonRequest): PeriodComparisonAnswer {
  const minimum = request.definition.minimum_followup_hours;
  const start = (utc: string) => ({ timestamp_kind: "utc_instant" as const, utc_instant: utc, local_timestamp: null });
  const exposure = (caseId: string, at: string, hours: number) => ({
    case_id: caseId,
    case_start: start(at),
    followup_hours: hours,
    status: hours >= minimum ? ("adequate" as const) : ("inadequate" as const),
  });
  const targetCases = [exposure("C-1", "2026-10-01T08:00:00Z", 220), exposure("C-2", "2026-10-02T09:00:00Z", 195)];
  const referenceCases = [exposure("C-3", "2026-10-09T08:00:00Z", 28), exposure("C-4", "2026-10-10T11:00:00Z", 1)];
  const records: Record<string, number> = { "C-1": 2, "C-2": 3, "C-3": 2, "C-4": 2 };
  const supportOf = (cases: { case_id: string }[]) => support(cases.map((item) => item.case_id), cases.reduce((sum, item) => sum + records[item.case_id], 0));
  const endpoint = request.definition.endpoint_activity;
  return {
    schema_version: 1,
    message_type: "period_comparison_answer",
    request_id: request.request_id,
    query_revision: request.query_revision,
    workspace_id: request.workspace_id,
    identity: request.identity,
    parent_identity: identityOf(request, "1"),
    parent,
    comparison_id: `comparison.v1:sha256:${hex("d")}`,
    context_column_index: request.context_column_index,
    context_policy: request.context_policy,
    definition: request.definition,
    target: {
      name: request.definition.target.name,
      identity: identityOf(request, "4"),
      included: support(["C-1", "C-2"], 5),
      excluded: support(["C-3", "C-4"], 4),
      unevaluable: none,
      exposure: {
        adequate: supportOf(targetCases.filter((item) => item.status === "adequate")),
        inadequate: supportOf(targetCases.filter((item) => item.status === "inadequate")),
        cases: targetCases,
      },
      endpoint_coverage: endpoint === null ? null : { activity: endpoint, basis: "recorded_activity_presence_in_complete_history", recorded: support(["C-1", "C-2"], 5), not_recorded: none },
    },
    reference: {
      name: request.definition.reference.name,
      identity: identityOf(request, "5"),
      included: support(["C-3", "C-4"], 4),
      excluded: support(["C-1", "C-2"], 5),
      unevaluable: none,
      exposure: {
        adequate: supportOf(referenceCases.filter((item) => item.status === "adequate")),
        inadequate: supportOf(referenceCases.filter((item) => item.status === "inadequate")),
        cases: referenceCases,
      },
      endpoint_coverage:
        endpoint === null ? null : { activity: endpoint, basis: "recorded_activity_presence_in_complete_history", recorded: support(["C-3"], 2), not_recorded: support(["C-4"], 2) },
    },
    pair_support: { overlap: none, target_only: support(["C-1", "C-2"], 5), reference_only: support(["C-3", "C-4"], 4), neither: none, unevaluable: none },
    context_profile: {
      denominator_basis: "context_evaluable_cases",
      parent_evaluable: parent,
      parent_unevaluable: none,
      target_evaluable: support(["C-1", "C-2"], 5),
      target_unevaluable: none,
      reference_evaluable: support(["C-3", "C-4"], 4),
      reference_unevaluable: none,
      parent_fixed: { status: "varying", value: null, reason: null },
      categories: [
        { value: null, parent: category(1, 4), target: category(1, 2), reference: category(0, 2), difference_percentage_points: share(50), concentration_ratio: { status: "unavailable", reason: "zero_reference_share" } },
        { value: "East", parent: category(1, 4), target: category(0, 2), reference: category(1, 2), difference_percentage_points: { status: "available", value: -50 }, concentration_ratio: share(0) },
        { value: "North", parent: category(1, 4), target: category(1, 2), reference: category(0, 2), difference_percentage_points: share(50), concentration_ratio: { status: "unavailable", reason: "zero_reference_share" } },
        { value: "South", parent: category(1, 4), target: category(0, 2), reference: category(1, 2), difference_percentage_points: { status: "available", value: -50 }, concentration_ratio: share(0) },
      ],
    },
    case_start_basis: "first_record_in_declared_order_of_sequence_evaluable_case",
    followup_clock: {
      timestamp_kind: "utc_instant",
      duration_clock: "elapsed_utc_hours",
      clock_limitation: null,
      snapshot_cutoff: start("2026-10-10T12:00:00Z"),
    },
  };
}

export function comparisonRefusal(
  request: { request_id: string; query_revision: number; workspace_id: string },
  operation: ComparisonRefusal["operation"],
  code: ComparisonRefusal["code"],
  message: string,
): ComparisonOutcome<never> {
  return {
    ok: false,
    problem: {
      kind: "refusal",
      refusal: {
        schema_version: 1,
        message_type: "comparison_refusal",
        request_id: request.request_id,
        query_revision: request.query_revision,
        workspace_id: request.workspace_id,
        operation,
        code,
        message,
        field: null,
        retryable: ["workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable", "computation_failed"].includes(code),
      },
    },
  };
}

interface Call<Request, Answer> {
  request: Request;
  signal: AbortSignal;
  reply: (outcome: ComparisonOutcome<Answer>) => void;
}

/** A comparison client whose replies the test delivers. */
export function scriptedComparisonClient() {
  const groups: Call<GroupComparisonRequest, GroupComparisonAnswer>[] = [];
  const periods: Call<PeriodComparisonRequest, PeriodComparisonAnswer>[] = [];
  const client: ComparisonClient = {
    compareGroups: (request, signal) => new Promise((reply) => groups.push({ request, signal, reply })),
    comparePeriods: (request, signal) => new Promise((reply) => periods.push({ request, signal, reply })),
  };
  return { client, groups, periods };
}
