"""The selection of every supported policy, written out by hand for the tests."""

from wise_platform_analytics import PolicyChoice, PolicySelection

SUPPORTED_CHOICES = {
    "order": PolicyChoice(
        "incident.order.timestamp_sequence_source_position.v1",
        {
            "primary": "timestamp_utc_ascending",
            "secondary": "source_sequence_ascending",
            "tie_breaker": "source_position_ascending",
        },
    ),
    "missing_values": PolicyChoice(
        "incident.missing.empty_activity_context_cells.v1",
        {
            "activity_empty_cell": "missing",
            "assignment_group_empty_cell": "missing",
            "literal_Unknown": "value",
        },
    ),
    "activity_projection": PolicyChoice(
        "incident.activity.omit_missing_retain_raw_gaps.v1",
        {
            "missing_activity": "omit_from_mapped_sequence",
            "raw_records": "retain_all",
            "gap_evidence": "omitted_row_ids",
        },
    ),
    "parent": PolicyChoice(
        "incident.parent.all_service_s_and_has_opened.v1",
        {
            "service": "S",
            "service_quantifier": "all_records",
            "contains_activity": "Opened",
        },
    ),
    "predicate": PolicyChoice(
        "incident.predicate.has_recorded_resolved.v1",
        {"contains_activity": "Resolved", "semantics": "recorded_event_presence"},
    ),
    "comparison": PolicyChoice(
        "incident.comparison.target_removed_reference_kept.v1",
        {"target": "removed", "comparator": "kept"},
    ),
    "context_projection": PolicyChoice(
        "incident.context.first_opened_assignment_group_retain_missing.v1",
        {
            "anchor_activity": "Opened",
            "anchor_occurrence": "first_in_declared_order",
            "attribute": "assignment_group",
            "missing_at_anchor": "retain",
        },
    ),
    "clock": PolicyChoice(
        "incident.clock.elapsed_utc_hours.v1",
        {"timestamp_field": "timestamp_utc", "timezone": "UTC", "unit": "hours"},
    ),
    "nullable_measure": PolicyChoice(
        "incident.measure.unevaluable_separate_from_true_false.v1",
        {"missing_endpoint": "unevaluable", "missing_as_false": False},
    ),
}


def selection_with(**changed: PolicyChoice | None) -> PolicySelection:
    """The supported selection with some roles replaced, or left out when given ``None``."""
    choices = {**SUPPORTED_CHOICES, **changed}
    return PolicySelection(
        {role: choice for role, choice in choices.items() if choice is not None}
    )
