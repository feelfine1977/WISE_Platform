import type { Bpic19MeasuresAnswer, Bpic19MeasuresRequest, CaseFeatures, Milestone, RawMeasure } from "../generated/bpic19-measures";

export const measuresIdentity = { source_id: `source.v1:sha256:${"a".repeat(64)}`, preparation_id: `preparation.v1:sha256:${"b".repeat(64)}`,
  representation_id: `representation.v1:sha256:${"c".repeat(64)}`, case_dictionary_id: `case-dictionary.v1:sha256:${"d".repeat(64)}`,
  population_id: `population.v1:sha256:${"e".repeat(64)}`, implementation_version: "0.1.0" };
export const measuresRoles = { item_category: 3, resource: 4, net_worth: 5, value: 5 };
export const measuresColumns = [{ index: 3, name: "Item Category" }, { index: 4, name: "Original actor" }, { index: 5, name: "Original amount" }];
const ir = "Record Invoice Receipt", create = "Create Purchase Order Item", clear = "Clear Invoice";
const known = (value: number, row_ids: string[], unit = "event_occurrences"): RawMeasure => ({ value, row_ids, available: true, reason: null, unit });
const unavailable = (reason: string, row_ids: string[], unit = "days"): RawMeasure => ({ value: null, row_ids, available: false, reason, unit });
const absentEndpoint = (): Milestone => ({ available: false, reason: "no_parsed_endpoint", endpoint_state: "missing", timestamp: null, selected_row_id: null,
  row_ids: [], candidate_row_ids: [], later_row_ids: [], unparseable_row_ids: [], unknown_activity_row_ids: [] });

/** Independently authored synthetic oracle: known zero, reversed tied minima, raw identity variants, missing labels and equal creation values. */
export function measuresAnswer(request: Bpic19MeasuresRequest): Bpic19MeasuresAnswer {
  const unit = request.query.value_unit ?? "source_units";
  const source: Milestone = { available: true, reason: null, endpoint_state: "available", timestamp: "2018-01-02T00:00:00", selected_row_id: "row-3",
    row_ids: ["row-3", "row-4"], candidate_row_ids: ["row-3", "row-4"], later_row_ids: [], unparseable_row_ids: [], unknown_activity_row_ids: [] };
  const target: Milestone = { available: true, reason: null, endpoint_state: "available", timestamp: "2018-01-01T00:00:00", selected_row_id: "row-5",
    row_ids: ["row-5"], candidate_row_ids: ["row-5"], later_row_ids: [], unparseable_row_ids: [], unknown_activity_row_ids: [] };
  const reversed: RawMeasure = { ...unavailable("reversed_interval", ["row-3", "row-4", "row-5"]), recorded_difference_days: -1,
    activation_row_ids: ["row-3", "row-4"], response_row_ids: ["row-5"], activation_timestamp: source.timestamp, response_timestamp: target.timestamp, interval_state: "reversed" };
  const a: CaseFeatures = {
    case_id: "A_1", flow: "DF1", flow_available: true, document: "A", company: "C", spend_area: "Packaging", context: {}, record_count: 6,
    record_row_ids: ["row-1", "row-2", "row-5", "row-3", "row-4", "row-6"], activity_counts: { [create]: 2, [ir]: 2, [clear]: 1, Unrelated: 1 },
    activity_row_ids: { [create]: ["row-1", "row-2"], [ir]: ["row-3", "row-4"], [clear]: ["row-5"], Unrelated: ["row-6"] }, activity_counts_available: true, missing_activity_row_ids: [],
    milestones: { invoice: source, source, clearing: target, target, receipt: absentEndpoint() },
    activity_measure: { count: known(2, ["row-3", "row-4"]), presence: known(1, ["row-3", "row-4"], "case_presence_boolean"),
      repeat_quantity: known(1, ["row-3", "row-4"], "repeated_event_occurrences"), repeated_presence: known(1, ["row-3", "row-4"], "case_repeated_presence_boolean"),
      matching_row_ids: ["row-3", "row-4"], unknown_row_ids: [], absence_row_ids: [], lower_bound: 2, unknown_label_count: 0, policy_id: "bpic19.exact_activity.v1" },
    actor_records: [{ row_id: "row-1", raw: " USER_1 ", normalized: "user_1", classification: "user" }, { row_id: "row-2", raw: "user_1", normalized: "user_1", classification: "user" },
      { row_id: "row-5", raw: "NONE", normalized: "none", classification: "unknown" }, { row_id: "row-3", raw: " batch_2 ", normalized: "batch_2", classification: "batch" },
      { row_id: "row-4", raw: "user_2", normalized: "user_2", classification: "user" }, { row_id: "row-6", raw: "user_1", normalized: "user_1", classification: "user" }],
    actor_summary: { known_user_event_count: 4, distinct_normalized_user_count: 2, batch_event_count: 1, unknown_event_count: 1, event_count: 6,
      available: false, reason: "incomplete_resource_attribution", batch_all_share: 1 / 6, batch_human_ratio: 1 / 4, batch_all_denominator: 6, batch_human_denominator: 4 },
    amount_records: [{ row_id: "row-1", raw: "100", value: 100, state: "finite" }, { row_id: "row-2", raw: "1E+2", value: 100, state: "finite" },
      { row_id: "row-5", raw: "100", value: 100, state: "finite" }, { row_id: "row-3", raw: "200", value: 200, state: "finite" },
      { row_id: "row-4", raw: "200", value: 200, state: "finite" }, { row_id: "row-6", raw: "NaN", value: null, state: "invalid_nonfinite" }],
    measures: { invoice_count: known(2, ["row-3", "row-4"]), selected_activity: known(2, ["row-3", "row-4"]), invoice_to_clearing_days: reversed, selected_interval: reversed,
      user_event_count: { ...unavailable("incomplete_resource_attribution", ["row-1", "row-2", "row-4", "row-6"], "user_attributed_events"), lower_bound: 4, unknown_label_count: 1, invalid_row_ids: ["row-5"] },
      distinct_user_count: { ...unavailable("incomplete_resource_attribution", ["row-1", "row-2", "row-4", "row-6"], "distinct_user_identities"), lower_bound: 2, unknown_label_count: 1, invalid_row_ids: ["row-5"] },
      creation_value: { ...known(100, ["row-1", "row-2"], unit), candidate_count: 2, winner_row_ids: ["row-1", "row-2"], reducer: "unique_creation_value" },
      selected_value: { ...known(100, ["row-1", "row-2"], unit), candidate_count: 2, winner_row_ids: ["row-1", "row-2"], reducer: "unique_creation_value" },
      exposure: { ...unavailable("invalid_nonfinite", ["row-1", "row-2", "row-5", "row-3", "row-4", "row-6"], unit), candidate_count: 6, invalid_row_ids: ["row-6"], winner_row_ids: [], reducer: "maximum_absolute_event_value" } },
    representations: { exact_sequence: [create, create, clear, ir, ir, "Unrelated"], first_occurrence_signature: [create, clear, ir, "Unrelated"],
      signature_policy_id: "bpic19.first_occurrence_signature.v1", available: true, reason: null, omitted_activity_row_ids: [], signature_suppressed_row_ids: ["row-2", "row-4"],
      signature_retained_row_ids: ["row-1", "row-5", "row-3", "row-6"], exact_representation_id: "exact-A", signature_representation_id: "signature-A" }, selected_value_band: null,
  };
  const absent = { ...known(0, []), absence_row_ids: ["b-1"] };
  const b: CaseFeatures = { case_id: "B_1", flow: null, flow_available: false, document: "B", company: null, spend_area: null, context: {}, record_count: 1,
    record_row_ids: ["b-1"], activity_counts: { "Vendor creates invoice": 1 }, activity_row_ids: { "Vendor creates invoice": ["b-1"] }, activity_counts_available: true, missing_activity_row_ids: [],
    milestones: { invoice: absentEndpoint(), source: absentEndpoint(), clearing: absentEndpoint(), target: absentEndpoint(), receipt: absentEndpoint() },
    activity_measure: { count: absent, presence: { ...absent, unit: "case_presence_boolean" }, repeat_quantity: { ...absent, unit: "repeated_event_occurrences" }, repeated_presence: { ...absent, unit: "case_repeated_presence_boolean" },
      matching_row_ids: [], unknown_row_ids: [], absence_row_ids: ["b-1"], lower_bound: 0, unknown_label_count: 0, policy_id: "bpic19.exact_activity.v1" },
    actor_records: [{ row_id: "b-1", raw: "batch_1", normalized: "batch_1", classification: "batch" }], actor_summary: { known_user_event_count: 0, distinct_normalized_user_count: 0, batch_event_count: 1, unknown_event_count: 0, event_count: 1,
      available: true, reason: null, batch_all_share: 1, batch_human_ratio: null, batch_all_denominator: 1, batch_human_denominator: 0 },
    amount_records: [{ row_id: "b-1", raw: "-5", value: -5, state: "finite" }], measures: { invoice_count: absent, selected_activity: absent,
      selected_interval: unavailable("no_parsed_endpoint", []), creation_value: unavailable("missing_value", [], unit), selected_value: unavailable("missing_value", [], unit),
      exposure: known(5, ["b-1"], unit), user_event_count: known(0, [], "user_attributed_events"), distinct_user_count: known(0, [], "distinct_user_identities") },
    representations: { exact_sequence: null, first_occurrence_signature: null, signature_policy_id: "bpic19.first_occurrence_signature.v1", available: false, reason: "order_unknown", omitted_activity_row_ids: [],
      signature_suppressed_row_ids: [], signature_retained_row_ids: [], exact_representation_id: "exact-B", signature_representation_id: "signature-B" }, selected_value_band: null };
  const partial = { ...unavailable("missing_activity_label", ["d-1"], "event_occurrences"), lower_bound: 1, unknown_label_count: 1, unknown_row_ids: ["d-2"] };
  const d: CaseFeatures = { ...b, case_id: "D_1", document: "D", record_count: 2, record_row_ids: ["d-1", "d-2"], activity_counts: { [ir]: 1 }, activity_row_ids: { [ir]: ["d-1"] }, activity_counts_available: false, missing_activity_row_ids: ["d-2"],
    activity_measure: { count: partial, presence: { ...known(1, ["d-1"], "case_presence_boolean"), lower_bound: 1, unknown_label_count: 1, unknown_row_ids: ["d-2"] },
      repeat_quantity: { ...partial, unit: "repeated_event_occurrences" }, repeated_presence: { ...partial, unit: "case_repeated_presence_boolean" },
      matching_row_ids: ["d-1"], unknown_row_ids: ["d-2"], absence_row_ids: [], lower_bound: 1, unknown_label_count: 1, policy_id: "bpic19.exact_activity.v1" },
    actor_records: [{ row_id: "d-1", raw: "user_12", normalized: "user_12", classification: "user" }, { row_id: "d-2", raw: "user_1_extra", normalized: "user_1_extra", classification: "unknown" }],
    actor_summary: { known_user_event_count: 1, distinct_normalized_user_count: 1, batch_event_count: 0, unknown_event_count: 1, event_count: 2, available: false, reason: "incomplete_resource_attribution", batch_all_share: 0, batch_human_ratio: 0, batch_all_denominator: 2, batch_human_denominator: 1 },
    amount_records: [{ row_id: "d-1", raw: "0", value: 0, state: "finite" }, { row_id: "d-2", raw: "", value: null, state: "missing" }],
    measures: { invoice_count: partial, selected_activity: partial, selected_interval: unavailable("missing_activity_label", ["d-1"]), selected_value: unavailable("missing_activity_label", [], unit) },
    representations: { ...b.representations, reason: "missing_activity_label", omitted_activity_row_ids: ["d-2"], exact_representation_id: "exact-D", signature_representation_id: "signature-D" } };
  const definition_id = "bpic19-measure-definition.v1:sha256:" + "9".repeat(64);
  const answer: Bpic19MeasuresAnswer = { schema_version: 1, message_type: "bpic19_measures_answer", request_id: request.request_id,
    query_revision: request.query_revision, workspace_id: request.workspace_id, identity: request.identity, parent_identity: measuresIdentity, query: request.query,
    result_id: "bpic19-measures.v1:sha256:" + "f".repeat(64), definition_id,
    definition: { policy_id: "bpic19.source_witnessed_measures.v1", measure_profile: request.query.measure_profile, definition_id,
      activity_selector: request.query.activity_selector ?? [ir], activity_operator: request.query.activity_operator ?? "count", interval_source: request.query.interval_source ?? [ir], interval_target: request.query.interval_target ?? [clear],
      interval_policy: request.query.interval_policy ?? "independent_minimum", value_reducer: request.query.value_reducer ?? "unique_creation_value", representation_policy: request.query.representation_policy ?? "first_occurrence",
      value_band_edges: request.query.value_band_edges ?? [], time_policy_id: "bpic19.paper.independent_parsed_minima.2017_2020.v1", resource_policy_id: "bpic19.paper.complete_user_batch_attribution.v1",
      roles: request.query.roles ?? {}, activity_labels: { invoice: ir, clearing: clear, receipt_any: ["Record Goods Receipt", "Record Service Entry Sheet"] },
      clock_kind: "local", clock_policy_id: "reviewed-local-clock", elapsed_unit: "days", endpoint_admissibility: "select_parsed_minimum_then_2017_inclusive_2020_exclusive",
      resource_normalization: "strip_casefold_fullmatch_user_or_batch_numeric_suffix", resource_unknown_policy: "full_effort_unavailable_keep_classified_lower_bounds",
      value_unit: unit, numeric_policy: "finite_float_scientific_notation_no_locale_conversion", value_missing_policy: "unavailable", creation_conflict_policy: request.query.value_reducer ?? "unique_creation_value",
      source_representation: "complete_original_item_histories", creation_selector: [create] },
    roles_proposed_from_headers: false, population_case_count: 3, population_record_count: 9, flow_case_counts: { DF1: 1, unknown: 2 },
    summaries: { invoice_count: { available_case_count: 2, zero_case_count: 1, unavailable_case_count: 1, minimum: 0, median: 1, mean: 1, maximum: 2, reason: null },
      invoice_to_clearing_days: { available_case_count: 0, zero_case_count: 0, unavailable_case_count: 3, minimum: null, median: null, mean: null, maximum: null, reason: "no_available_values" } },
    activity_cohorts: { positive_case_ids: ["A_1"], zero_case_ids: ["B_1"], unavailable_case_ids: ["D_1"], presence_positive_case_ids: ["A_1", "D_1"], presence_absent_case_ids: ["B_1"], presence_unknown_case_ids: [],
      repeated_positive_case_ids: ["A_1"], repeated_absent_case_ids: ["B_1"], repeated_unknown_case_ids: ["D_1"], population_case_count: 3, presence_fraction: 2 / 3, repeated_presence_fraction: 1 / 3, denominator: 3, reason: null },
    representation_groups: { exact: [{ group_id: "group-exact-A", sequence: a.representations.exact_sequence!, case_ids: ["A_1"], case_count: 1, record_count: 6 }],
      first_occurrence: [{ group_id: "group-signature-A", sequence: a.representations.first_occurrence_signature!, case_ids: ["A_1"], case_count: 1, record_count: 6 }] },
    representation_unavailable_case_ids: ["B_1", "D_1"], value_bands: [], value_band_unavailable_case_ids: ["B_1", "D_1"],
    offset: request.query.offset, limit: request.query.limit, next_offset: null, cases: [a, b, d] };
  if (request.query.measure_profile === "historical_v1") answer.definition.calibration = { policy_id: "historical-maxabs-p95.v1", case_count: 5, population_case_ids_hash: "frozen-five",
    net_worth_column: 5, percentile: 0.95, quantile: 38, denominator: 38, unit: "source_units", missing_case_count: 1, invalid_case_count: 0,
    missing_policy: "historical_missing_fill_zero", available: true, calibration_id: "frozen-calibration-five", interpolation: "linear", position: 3.8,
    population_case_ids: ["cal-0", "cal-10", "cal-20", "cal-30", "cal-40"], preparation_id: measuresIdentity.preparation_id, finite_guard: "panel_finite_guard_not_in_historical_helper" };
  return answer;
}
