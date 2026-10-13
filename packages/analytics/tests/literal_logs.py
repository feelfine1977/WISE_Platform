"""Literal semicolon logs prepared by the package, read with ISO times and their own offsets."""

from wise_platform_analytics.preparation import PreparationResult, prepare

POLICIES = {
    "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {
        "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
        "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position",
        "unavailable_timestamp_case_sequence": "unevaluable"}},
    "rows": {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": {
        "missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
        "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}},
    "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1",
                       "parameters": {"empty_activity_context": "missing", "literal_values": "preserve"}},
    "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1",
                   "parameters": {"normalization": "trim_outer_whitespace_preserve_raw"}},
    "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {
        "missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
    "parent": {"id": "incident.parent.all_identified_cases.v1",
               "parameters": {"eligibility": "nonempty_normalized_case_identifier"}},
    "time": {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {
        "format": "iso8601", "timezone": {"mode": "from_values"}, "snapshot_cutoff_utc": "2027-01-01T00:00:00Z"}},
}


def prepared_from(lines, context=(3, 4)):
    raw = ("\n".join(lines) + "\n").encode("utf-8")
    dialect = {"encoding": "utf-8", "delimiter": ";", "quotechar": '"', "header": "first_record"}
    mapping = {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
               "context_columns": list(context)}
    result = prepare(raw, dialect, mapping, POLICIES, True)
    assert isinstance(result, PreparationResult) and result.preparation is not None, result
    return result.preparation
