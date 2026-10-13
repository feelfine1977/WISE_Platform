import type { ExampleId, InputPolicies } from "../generated/investigation";

/** The synthetic examples the contract names, in the order they are offered. */
export const exampleIds: readonly ExampleId[] = ["S0", "S1", "S2", "S3"];

export const defaultExampleId: ExampleId = "S0";

/**
 * The registered version 1 policies sent with every request to open an example.
 * Each identifier and parameter is fixed by the contract; the local service echoes them in its answer.
 */
export const examplePolicies: InputPolicies = {
  order: {
    id: "incident.order.timestamp_sequence_source_position.v1",
    parameters: { primary: "timestamp_utc_ascending", secondary: "source_sequence_ascending", tie_breaker: "source_position_ascending" },
  },
  activity_projection: {
    id: "incident.activity.omit_missing_retain_raw_gaps.v1",
    parameters: { missing_activity: "omit_from_mapped_sequence", raw_records: "retain_all", gap_evidence: "omitted_row_ids" },
  },
  context_projection: {
    id: "incident.context.first_opened_assignment_group_retain_missing.v1",
    parameters: { anchor_activity: "Opened", anchor_occurrence: "first_in_declared_order", attribute: "assignment_group", missing_at_anchor: "retain" },
  },
  parent: {
    id: "incident.parent.all_service_s_and_has_opened.v1",
    parameters: { service: "S", service_quantifier: "all_records", contains_activity: "Opened" },
  },
  predicate: {
    id: "incident.predicate.has_recorded_resolved.v1",
    parameters: { contains_activity: "Resolved", semantics: "recorded_event_presence" },
  },
  comparison: {
    id: "incident.comparison.target_removed_reference_kept.v1",
    parameters: { target: "removed", comparator: "kept" },
  },
  missing_values: {
    id: "incident.missing.empty_activity_context_cells.v1",
    parameters: { activity_empty_cell: "missing", assignment_group_empty_cell: "missing", literal_Unknown: "value" },
  },
  clock: {
    id: "incident.clock.elapsed_utc_hours.v1",
    parameters: { timestamp_field: "timestamp_utc", timezone: "UTC", unit: "hours" },
  },
  nullable_measure: {
    id: "incident.measure.unevaluable_separate_from_true_false.v1",
    parameters: { missing_endpoint: "unevaluable", missing_as_false: false },
  },
};
