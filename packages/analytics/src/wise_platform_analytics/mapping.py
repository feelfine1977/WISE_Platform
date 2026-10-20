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
    # The document reference is an optional declared role. It enters the mapping, and so the preparation
    # identity, only when one is chosen; a mapping without it keeps its earlier identity.
    if isinstance(value, Mapping) and "document_reference_column" in value:
        keys = keys | {"document_reference_column"}
    # So are the context columns declared as numbers, with their units: present only when one is declared.
    if isinstance(value, Mapping) and "numeric_context_columns" in value:
        keys = keys | {"numeric_context_columns"}
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
    if "document_reference_column" in value and (type(value["document_reference_column"]) is not int
                                                 or value["document_reference_column"] not in context):
        return ImportRefusal("invalid_mapping", "The document reference must be one of the mapped context columns.",
                             "mapping.document_reference_column")
    if "numeric_context_columns" in value:
        numeric = value["numeric_context_columns"]
        if not isinstance(numeric, (list, tuple)) or not numeric:
            return ImportRefusal("invalid_mapping", "Declare at least one numeric context column, or leave the declaration out.", "mapping.numeric_context_columns")
        for place, item in enumerate(numeric):
            field = f"mapping.numeric_context_columns.{place}"
            if not isinstance(item, Mapping) or set(item) != {"column_index", "unit"}:
                return ImportRefusal("invalid_mapping", "A numeric column names its column and its unit, or no unit.", field)
            if type(item["column_index"]) is not int or item["column_index"] not in context:
                return ImportRefusal("invalid_mapping", "A numeric column must be one of the mapped context columns.", field + ".column_index")
            unit = item["unit"]
            if unit is not None and (not isinstance(unit, str) or not 1 <= len(unit) <= 32 or unit != unit.strip()):
                return ImportRefusal("invalid_mapping", "A unit is a short text without outer spaces, or no unit.", field + ".unit")
        if len({item["column_index"] for item in numeric}) != len(numeric):
            return ImportRefusal("invalid_mapping", "A column is declared numeric once.", "mapping.numeric_context_columns")
        return {**value, "context_columns": list(context),
                "numeric_context_columns": [{"column_index": item["column_index"], "unit": item["unit"]} for item in numeric]}
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
ROWS_V2_ID = "incident.rows.missing_id_outside_invalid_time_retained.v2"
_ROWS_V2_PARAMETERS = {**_POLICIES["rows"][1], "blank_records": "skip_count_preserve_source_ordinal",
                       "ragged_records": "outside_population_preserve_raw", "maximum_ragged_fraction": 0.05,
                       "field_character_limit": 10_485_760}


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
        if role == "rows" and choice["id"] == ROWS_V2_ID:
            policy_id, parameters = ROWS_V2_ID, _ROWS_V2_PARAMETERS
        if choice["id"] != policy_id:
            return ImportRefusal("unsupported_policy", "The policy identifier or version is unsupported.", "policies." + role + ".id")
        if not isinstance(choice["parameters"], Mapping) or dict(choice["parameters"]) != parameters:
            return ImportRefusal("invalid_parameter", "The policy parameters do not match this registered policy.", "policies." + role + ".parameters")
    from .time_formats import validate_time_policy
    time = validate_time_policy(value["time"])
    if isinstance(time, ImportRefusal):
        return time
    return plain_json(value)
