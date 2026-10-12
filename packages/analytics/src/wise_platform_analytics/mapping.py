"""Closed import choices, immutable JSON values and typed import refusals."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any


@dataclass(frozen=True)
class ImportRefusal:
    code: str
    message: str
    field: str | None = None
    retryable: bool = False

    def to_dict(self) -> dict[str, object]:
        return {"code": self.code, "message": self.message, "field": self.field, "retryable": self.retryable}


def freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: freeze_json(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze_json(item) for item in value)
    return value


def plain_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: plain_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain_json(item) for item in value]
    return value


def exact_object(value: object, keys: set[str], field: str) -> ImportRefusal | None:
    if not isinstance(value, Mapping) or set(value) != keys:
        return ImportRefusal("invalid_parameter", "Expected exactly the supported fields.", field)
    return None


def validate_mapping(value: object, column_count: int) -> dict[str, object] | ImportRefusal:
    keys = {"case_column", "activity_column", "timestamp_column", "sequence_column", "context_columns"}
    refusal = exact_object(value, keys, "mapping")
    if refusal is not None:
        return refusal
    assert isinstance(value, Mapping)
    for role in ("case_column", "activity_column", "timestamp_column", "sequence_column"):
        index = value[role]
        if role == "sequence_column" and index is None:
            continue
        if type(index) is not int or not 0 <= index < column_count:
            return ImportRefusal("invalid_mapping", "The selected column index is outside this source.", "mapping." + role)
    roles = [value[key] for key in ("case_column", "activity_column", "timestamp_column", "sequence_column") if value[key] is not None]
    if len(set(roles)) != len(roles):
        return ImportRefusal("invalid_mapping", "Case, activity, timestamp and sequence roles need distinct columns.", "mapping")
    context = value["context_columns"]
    if not isinstance(context, (list, tuple)) or any(type(index) is not int or not 0 <= index < column_count for index in context):
        return ImportRefusal("invalid_mapping", "Every context column must be a supported index.", "mapping.context_columns")
    if len(set(context)) != len(context):
        return ImportRefusal("invalid_mapping", "Context column indexes must be unique.", "mapping.context_columns")
    return {**value, "context_columns": list(context)}


_POLICIES = {
    "order": ("incident.order.declared_time_optional_sequence_source_position.v1", {
        "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
        "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position",
        "unavailable_timestamp_case_sequence": "unevaluable"}),
    "rows": ("incident.rows.missing_id_outside_invalid_time_retained.v1", {
        "missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
        "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}),
    "missing_values": ("incident.missing.empty_mapped_activity_context.v1", {
        "empty_activity_context": "missing", "literal_values": "preserve"}),
    "identifier": ("incident.identifier.trim_outer_whitespace.v1", {"normalization": "trim_outer_whitespace_preserve_raw"}),
    "activity_projection": ("incident.activity.omit_missing_retain_raw_gaps.v1", {
        "missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}),
    "parent": ("incident.parent.all_identified_cases.v1", {"eligibility": "nonempty_normalized_case_identifier"}),
}


def validate_policies(value: object) -> dict[str, object] | ImportRefusal:
    refusal = exact_object(value, set(_POLICIES) | {"time"}, "policies")
    if refusal is not None:
        return refusal
    assert isinstance(value, Mapping)
    for role, (policy_id, parameters) in _POLICIES.items():
        choice = value[role]
        refusal = exact_object(choice, {"id", "parameters"}, "policies." + role)
        if refusal is not None:
            return refusal
        assert isinstance(choice, Mapping)
        if choice["id"] != policy_id:
            return ImportRefusal("unsupported_policy", "The policy identifier or version is unsupported.", "policies." + role + ".id")
        if not isinstance(choice["parameters"], Mapping) or dict(choice["parameters"]) != parameters:
            return ImportRefusal("invalid_parameter", "The policy parameters do not match this registered policy.", "policies." + role + ".parameters")
    from .time_formats import validate_time_policy
    time = validate_time_policy(value["time"])
    if isinstance(time, ImportRefusal):
        return time
    return plain_json(value)
