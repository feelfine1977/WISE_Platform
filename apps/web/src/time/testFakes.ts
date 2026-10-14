import { vi } from "vitest";
import type { CaseListAnswer, CaseListRequest } from "../generated/case-list";
import type { AnswerIdentity } from "../generated/selection";
import type { StartTrendAnswer, StartTrendRequest } from "../generated/start-trend";
import type { CaseListOutcome } from "../filters/client";
import type { StartTrendOutcome } from "./client";

export const parent: AnswerIdentity = {
  source_id: "source-1", preparation_id: "preparation-1", representation_id: "representation-1",
  case_dictionary_id: "dictionary-1", population_id: "parent", implementation_version: "test",
};
export const kept: AnswerIdentity = { ...parent, population_id: "kept" };

export interface CaseListFilters {
  withoutSpan?: number;
  withoutFirstTime?: number;
  outside?: number;
  refuseTrend?: string;
}

const support = (count: number) => ({ case_ids: Array.from({ length: count }, (_, place) => `C-${place}`), case_count: count, record_count: count * 2 });

/** A case list that answers every question with spans in the asked bins, the parent ten times the kept, over 5 to 18 March 2025. */
export function caseListsAnswering(filters: CaseListFilters) {
  return {
    list: vi.fn(async (request: CaseListRequest): Promise<CaseListOutcome> => {
      const edges = request.query.distribution?.edges_hours ?? [];
      const answer = {
        schema_version: 1, message_type: "case_list_answer", request_id: request.request_id, query_revision: request.query_revision,
        workspace_id: request.workspace_id, identity: request.identity, parent_identity: parent, query: request.query,
        summary_policy: "incident.case_summary.full_raw_declared_order.v1", context_columns: [],
        distribution: {
          policy_id: "incident.case_distribution.explicit_hours_half_open.v1", measure: "observed_span_hours", timestamp_kind: "utc_instant", edges_hours: edges,
          parent_case_count: 100, kept_case_count: 10, parent_available_case_count: 100, kept_available_case_count: 10,
          bins: edges.map((start, place) => ({ start_inclusive_hours: start, end_exclusive_hours: edges[place + 1] ?? null, parent_case_count: 10, kept_case_count: 1 })),
          unavailable: { parent_case_count: 0, kept_case_count: filters.withoutSpan ?? 0, parent_order_unknown_case_count: 0, kept_order_unknown_case_count: 0, parent_fewer_than_two_records_case_count: 0, kept_fewer_than_two_records_case_count: 0 },
        },
        parent_time_range: { timestamp_kind: "utc_instant", earliest_recorded_timestamp: "2025-03-05T10:00:00Z", latest_recorded_timestamp: "2025-03-18T12:00:00Z" },
        population_case_count: 10, population_record_count: 20, total_matching_case_count: 10, next_offset: null, rows: [],
      } as unknown as CaseListAnswer;
      return { ok: true, answer };
    }),
  };
}

/** A trend that answers in the asked edges, the parent eight starts a week and the kept two. */
export function trendsAnswering(filters: CaseListFilters) {
  return {
    trend: vi.fn(async (request: StartTrendRequest): Promise<StartTrendOutcome> => {
      if (filters.refuseTrend !== undefined) {
        return { ok: false, problem: { kind: "refusal", refusal: { schema_version: 1, message_type: "start_trend_refusal", request_id: request.request_id, query_revision: request.query_revision, workspace_id: request.workspace_id, operation: "start_trend", code: "invalid_parent", message: filters.refuseTrend, field: null, retryable: false } } };
      }
      const edges = request.definition.binning.kind === "explicit_edges" ? request.definition.binning.edges : [];
      const pair = (keptCount: number) => ({ parent_support: support(0), kept_support: support(keptCount) });
      const answer = {
        schema_version: 1, message_type: "start_trend_answer", request_id: request.request_id, query_revision: request.query_revision,
        workspace_id: request.workspace_id, identity: request.identity, parent_identity: parent, definition: request.definition,
        grain: "distinct_incident_starts", anchor_policy: "first_raw_record_in_declared_order_of_sequence_evaluable_case",
        clock: { timestamp_kind: "utc_instant", snapshot_cutoff: "2025-03-18T12:00:00Z" },
        source_time_range: null, parent_time_range: null,
        bin_generation: { kind: "explicit_edges", max_bin_count: null, upper_extension_microseconds: 0, status: "available" },
        edges, parent_support: support(24), kept_support: support(6),
        bins: edges.slice(0, -1).map((start, place) => ({ start_inclusive: start, end_exclusive: edges[place + 1], parent_support: support(8), kept_support: support(2) })),
        available: pair(6),
        unevaluable: { ...pair(filters.withoutFirstTime ?? 0), reason_supports: { order_unknown: pair(0), first_raw_timestamp_missing: pair(0) }, reason_supports_are_nonadditive: true },
        before_range: pair(filters.outside ?? 0), after_range: pair(0),
      } as unknown as StartTrendAnswer;
      return { ok: true, answer };
    }),
  };
}
