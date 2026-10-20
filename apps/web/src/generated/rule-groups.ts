/**
 * stated-rule catalogue over an immutable fixed parent; no fitted clusters, completion or causality.
 */
export type RuleGroupsMessage = RuleGroupsRequest | RuleGroupsAnswer | RuleGroupsRefusal;
export type RequestId = string;
export type QueryRevision = number;
export type WorkspaceId = string;
export type SourceId = string;
export type PreparationId = string;
export type RepresentationId = string;
export type CaseDictionaryId = string;
export type PopulationId = string;
export type ImplementationVersion = string;
export type GroupRule =
  | FirstRawActivityRule
  | LastRawActivityRule
  | RawRecordCountBandsRule
  | ActivityPresenceRule
  | SharedReferenceRule
  | ExactMappedSequenceRule;
export type CaseId = string;
export type RuleGroupId = string;
export type RuleGroupKey =
  ActivityGroupKey | RecordCountBandKey | ActivityPresenceKey | ReferenceGroupKey | ExactSequenceKey;
export type ActivityGroupKey = ActivityValueKey | MissingActivityKey;
export type ReferenceGroupKey = ReferenceValueKey | MissingReferenceKey;
export type GroupExemplars = AvailableGroupExemplars | UnavailableGroupExemplars;

export interface RuleGroupsRequest {
  schema_version: 1;
  message_type: "rule_groups_request";
  request_id: RequestId;
  query_revision: QueryRevision;
  workspace_id: WorkspaceId;
  identity: AnswerIdentity;
  query: RuleGroupsQuery;
}
export interface AnswerIdentity {
  source_id: SourceId;
  preparation_id: PreparationId;
  representation_id: RepresentationId;
  case_dictionary_id: CaseDictionaryId;
  population_id: PopulationId;
  implementation_version: ImplementationVersion;
}
export interface RuleGroupsQuery {
  rule: GroupRule;
  /**
   * @minItems 1
   * @maxItems 32
   */
  distribution_edges_hours: number[];
  offset: number;
  limit: number;
}
export interface FirstRawActivityRule {
  kind: "first_raw_activity";
}
export interface LastRawActivityRule {
  kind: "last_raw_activity";
}
export interface RawRecordCountBandsRule {
  kind: "raw_record_count_bands";
  /**
   * @minItems 1
   * @maxItems 32
   */
  edges: number[];
}
export interface ActivityPresenceRule {
  kind: "activity_presence";
  activity: string;
}
export interface SharedReferenceRule {
  kind: "shared_reference";
  column_index: number;
  minimum_parent_case_count: number;
  /**
   * Which values of an incident are read: every record's (the default; an incident can be in several groups), the first record's in the declared order, or the latest record's that has a value. The last two need the order to be known; an incident is then in exactly one group.
   */
  policy?: "any_record" | "first_record" | "latest_record";
}
export interface ExactMappedSequenceRule {
  kind: "exact_mapped_sequence";
}
export interface RuleGroupsAnswer {
  schema_version: 1;
  message_type: "rule_groups_answer";
  request_id: RequestId;
  query_revision: QueryRevision;
  workspace_id: WorkspaceId;
  identity: AnswerIdentity;
  parent_identity: AnswerIdentity;
  query: RuleGroupsQuery;
  rule_policy_id: "incident.rule_groups.stated_rules.v1";
  activity_projection_policy: "incident.activity.omit_missing_retain_raw_gaps.v1";
  catalogue_scope: "frozen_parent";
  timestamp_kind: "utc_instant" | "wall_clock";
  group_membership_overlaps: boolean;
  population_coverage: RuleEligibility;
  parent_coverage: RuleEligibility;
  shared_reference_coverage: SharedReferenceCoverage | null;
  group_count: number;
  next_offset: number | null;
  /**
   * @maxItems 50
   */
  groups: RuleGroup[];
}
export interface RuleEligibility {
  total: CountSupport;
  eligible: CountSupport;
  unevaluable: FixedCaseSupport;
  assigned: CountSupport;
  unassigned: FixedCaseSupport;
  membership_incidence: CountSupport;
}
export interface CountSupport {
  case_count: number;
  record_count: number;
  omitted_activity_record_count: number;
}
export interface FixedCaseSupport {
  case_ids: CaseId[];
  case_count: number;
  record_count: number;
  omitted_activity_record_count: number;
}
export interface SharedReferenceCoverage {
  column_index: number;
  parent_distinct_nonmissing_value_count: number;
  parent_suppressed_nonmissing_value_count: number;
  parent_missing_reference_record_count: number;
  population_missing_reference_record_count: number;
}
export interface RuleGroup {
  id: RuleGroupId;
  key: RuleGroupKey;
  population: RuleGroupSupport;
  parent: ParentRuleGroupSupport;
  span_distribution: CaseDistribution;
  gap_distribution: CaseDistribution;
  exemplars: GroupExemplars;
}
export interface ActivityValueKey {
  kind: "activity";
  activity: string;
}
export interface MissingActivityKey {
  kind: "missing_activity";
  activity: null;
}
export interface RecordCountBandKey {
  kind: "raw_record_count_band";
  start_inclusive: number;
  end_exclusive: number | null;
}
export interface ActivityPresenceKey {
  kind: "activity_presence";
  activity: string;
  present: boolean;
}
export interface ReferenceValueKey {
  kind: "reference_value";
  column_index: number;
  value: string;
}
export interface MissingReferenceKey {
  kind: "missing_reference";
  column_index: number;
  value: null;
}
export interface ExactSequenceKey {
  kind: "exact_sequence";
  activities: string[];
  variant_id: string;
}
export interface RuleGroupSupport {
  cases: FixedCaseSupport;
  share: number | null;
  denominator: number;
}
export interface ParentRuleGroupSupport {
  cases: CountSupport;
  share: number | null;
  denominator: number;
}
export interface CaseDistribution {
  policy_id: "incident.case_distribution.explicit_hours_half_open.v1";
  measure: "observed_span_hours" | "maximum_adjacent_raw_gap_hours";
  timestamp_kind: "utc_instant" | "wall_clock";
  /**
   * @minItems 1
   * @maxItems 32
   */
  edges_hours: number[];
  parent_case_count: number;
  kept_case_count: number;
  parent_available_case_count: number;
  kept_available_case_count: number;
  /**
   * @minItems 1
   * @maxItems 32
   */
  bins: DistributionBin[];
  unavailable: UnavailableDistributionSupport;
}
export interface DistributionBin {
  start_inclusive_hours: number;
  end_exclusive_hours: number | null;
  parent_case_count: number;
  kept_case_count: number;
}
export interface UnavailableDistributionSupport {
  parent_case_count: number;
  kept_case_count: number;
  parent_order_unknown_case_count: number;
  kept_order_unknown_case_count: number;
  parent_fewer_than_two_records_case_count: number;
  kept_fewer_than_two_records_case_count: number;
}
export interface AvailableGroupExemplars {
  status: "available";
  shortest: CaseExemplar;
  longest: CaseExemplar;
}
export interface CaseExemplar {
  case_id: CaseId;
  record_count: number;
  observed_span_hours: number;
}
export interface UnavailableGroupExemplars {
  status: "unavailable";
  reason: "empty_current_group" | "no_evaluable_case";
  shortest: null;
  longest: null;
}
export interface RuleGroupsRefusal {
  schema_version: 1;
  message_type: "rule_groups_refusal";
  request_id: RequestId | null;
  query_revision: QueryRevision | null;
  workspace_id: WorkspaceId | null;
  operation: "rule_groups";
  code:
    | "invalid_request"
    | "unsupported_schema"
    | "unsupported_policy"
    | "invalid_parameter"
    | "workspace_unavailable"
    | "workspace_not_writable"
    | "workspace_incompatible"
    | "source_unavailable"
    | "preparation_unavailable"
    | "identity_mismatch"
    | "population_unavailable"
    | "invalid_parent"
    | "unknown_case"
    | "inconsistent_sequence"
    | "inconsistent_time_kind"
    | "memory_unavailable"
    | "computation_failed"
    | "unmapped_context_column";
  message: string;
  field: string | null;
  retryable: boolean;
}
