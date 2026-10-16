"""Closed declarations of historical29 prepared attributes, separate from raw input.

This artifact admits numbers, never source algorithms or a caller-supplied norm.
The attribute names are the existing historical Method binding attributes. Units
come from the product's historical measures (event_occurrences also names the
total retained-event count); scopes and operators come from the pinned catalogue.
Every item declares all 29 cells, including unavailable and out-of-scope cells.
Availability and flow applicability are independent: Method decides scope.

Provenance records declarations only. In particular, original_row_refs neither
assert the existence of original rows nor qualify a raw witness. No source is
opened, synthesized or inferred. Assessment references inhabit a separate field.

Row order and provenance-reference order are part of the content identity. JSON
object order is immaterial. The optional presentation.item_order is a permutation
for display only and follows the project's convention of preserving analytical
identity on display reordering. The immutable snapshot owns its canonical bytes;
all dictionaries returned to callers are detached copies.

This is an in-process artifact boundary, with no HTTP, persistence or scoring
admission. In particular it does not close T25-AC07 or prove raw-adapter parity.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import re
from typing import Any

from wise_platform_analytics.preparation import content_identity

from .bpic19_method import (
    FLOWS, HISTORICAL_PROFILE, HISTORICAL_UPSTREAM_CATALOGUE_SHA256,
    verified_historical_catalogue,
)

# This v1 field identifies the immutable upstream authority, not distribution
# bytes. verified_historical_catalogue checks the separately pinned copy.
CATALOGUE_SHA256 = HISTORICAL_UPSTREAM_CATALOGUE_SHA256
PROFILE_ID = HISTORICAL_PROFILE.replace(".partial", "")
INPUT_POLICY = "declared_prepared_measurements.v1"
_SAFE_INTEGER = 2**53 - 1
_SPECIAL_VALUES = {
    "c_l2_df1_invoice_after_goods": ("boolean_observation", "binary"),
    "c_l2_df2_release_after_goods": ("boolean_observation", "binary"),
    "c_l3_df1_goods_to_invoice_days": ("days", "nonnegative"),
    "c_l3_invoice_to_clear_days": ("days", "nonnegative"),
    "c_l3_df2_goods_to_rpb_days": ("days", "nonnegative"),
    "c_l3_df2_rpb_to_clear_days": ("days", "nonnegative"),
    "c_l7_manual_touches": ("resource_proxy_events", "count"),
    "c_l7_distinct_human_resources": ("resource_proxy_identities", "count"),
    "c_l7_manual_share": ("share_of_original_events", "share"),
    "c_l6_bal_networth_volatility": ("coefficient_of_variation", "nonnegative"),
    "c_l6_high_exposure_memo": ("normalized_proxy", "share"),
    "c_l6_high_exposure_price_change": ("normalized_proxy", "share"),
}


@dataclass(frozen=True)
class Binding:
    attribute: str
    unit: str
    applicable_flows: tuple[str, ...]
    source_operator: str
    value_kind: str


def binding_catalogue() -> tuple[Binding, ...]:
    """The exact existing bindings; callers cannot redefine units or scope."""
    try:
        catalogue = verified_historical_catalogue()
    except ValueError as error:
        raise ValueError("The frozen historical catalogue differs from prepared-input v1.") from error
    return tuple(
        Binding(
            criterion["id"],
            _SPECIAL_VALUES.get(criterion["id"], ("event_occurrences", "count"))[0],
            tuple("two_way" if flow == "2-way" else flow for flow in criterion["applicable_flows"]),
            criterion["type"],
            _SPECIAL_VALUES.get(criterion["id"], ("event_occurrences", "count"))[1],
        )
        for criterion in catalogue["source"]["constraints"]
    )


def _object(value: Any, keys: set[str], field: str, optional: set[str] | None = None) -> None:
    if type(value) is not dict or not keys <= value.keys() or value.keys() - keys - (optional or set()):
        raise ValueError(f"{field}: expected exactly the declared object fields.")


def _text(value: Any, field: str) -> None:
    if type(value) is not str or not value.strip() or len(value) > 256:
        raise ValueError(f"{field}: expected a nonblank string of at most 256 characters.")


def _references(value: Any, field: str) -> None:
    if type(value) is not list:
        raise ValueError(f"{field}: expected a reference array.")
    for reference in value:
        _text(reference, field)
    if len(set(value)) != len(value):
        raise ValueError(f"{field}: references must be distinct.")


def _number(value: Any, binding: Binding, field: str) -> None:
    # Testing type first is essential: bool is an int in Python.
    if type(value) not in (int, float):
        raise ValueError(f"{field}: expected a finite numeric value.")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite or value < 0:
        raise ValueError(f"{field}: expected a finite nonnegative numeric value.")
    if binding.value_kind == "count" and (value > _SAFE_INTEGER or value != int(value)):
        raise ValueError(f"{field}: expected an exact nonnegative count up to {_SAFE_INTEGER}.")
    if binding.value_kind == "binary" and value not in (0, 1):
        raise ValueError(f"{field}: expected numeric zero or one.")
    if binding.value_kind == "share" and value > 1:
        raise ValueError(f"{field}: expected a value between zero and one.")


def _provenance(value: Any, field: str, assessment_refs: set[str], own_ref: str) -> None:
    _object(value, {"kind", "declaration_ref", "assessment_row_refs", "original_row_refs"}, field)
    if value["kind"] != "declared_prepared_measurement":
        raise ValueError(f"{field}.kind: unsupported provenance kind.")
    _text(value["declaration_ref"], field + ".declaration_ref")
    _references(value["assessment_row_refs"], field + ".assessment_row_refs")
    if own_ref not in value["assessment_row_refs"] or not set(value["assessment_row_refs"]) <= assessment_refs:
        raise ValueError(f"{field}: assessment references must name declared rows and include this row.")
    original = value["original_row_refs"]
    if type(original) is not list:
        raise ValueError(f"{field}.original_row_refs: expected an array of unverified declarations.")
    seen = set()
    for reference in original:
        _object(reference, {"source_id", "row_id"}, field + ".original_row_refs")
        for key, prefix in (("source_id", "source"), ("row_id", "row")):
            identifier = reference[key]
            if type(identifier) is not str or re.fullmatch(prefix + r"\.v1:sha256:[a-f0-9]{64}", identifier) is None:
                raise ValueError(f"{field}.original_row_refs.{key}: expected a declared {prefix} identity.")
        pair = (reference["source_id"], reference["row_id"])
        if pair in seen:
            raise ValueError(f"{field}.original_row_refs: duplicate declaration.")
        seen.add(pair)


def _meaning(document: dict) -> dict:
    return {key: value for key, value in document.items() if key not in {"content_id", "presentation"}}


def _validate(document: Any, *, check_identity: bool) -> None:
    _object(document, {"schema_version", "artifact_kind", "profile_id", "catalogue_sha256",
                       "input_policy", "rows", "content_id"}, "artifact", {"presentation"})
    if type(document["schema_version"]) is not int or document["schema_version"] != 1:
        raise ValueError("schema_version: only integer version 1 is supported.")
    for key, expected in (("artifact_kind", "bpic19.prepared-input"), ("profile_id", PROFILE_ID),
                          ("catalogue_sha256", CATALOGUE_SHA256), ("input_policy", INPUT_POLICY)):
        if document[key] != expected:
            raise ValueError(f"{key}: unsupported prepared-input definition.")
    rows = document["rows"]
    if type(rows) is not list or not rows:
        raise ValueError("rows: at least one assessment item is required.")
    item_ids, assessment_refs = set(), set()
    for row in rows:
        _object(row, {"assessment_item_id", "assessment_row_ref", "flow", "measurements"}, "row")
        for key, seen in (("assessment_item_id", item_ids), ("assessment_row_ref", assessment_refs)):
            _text(row[key], "row." + key)
            if row[key] in seen:
                raise ValueError(f"row.{key}: identities must be unique.")
            seen.add(row[key])
        if type(row["flow"]) is not str or row["flow"] not in FLOWS:
            raise ValueError("row.flow: choose an existing native purchasing flow.")
    bindings = binding_catalogue()
    for row in rows:
        measures = row["measurements"]
        _object(measures, {binding.attribute for binding in bindings}, "measurements")
        for binding in bindings:
            field = "measurements." + binding.attribute
            cell = measures[binding.attribute]
            _object(cell, {"state", "value", "reason", "unit", "provenance"}, field)
            if cell["unit"] != binding.unit:
                raise ValueError(f"{field}.unit: expected {binding.unit}.")
            if cell["state"] == "available":
                _number(cell["value"], binding, field + ".value")
                if cell["reason"] is not None:
                    raise ValueError(f"{field}: an available value cannot have an unavailable reason.")
            elif cell["state"] == "unavailable":
                if cell["value"] is not None:
                    raise ValueError(f"{field}: unavailable values must be null, never zero.")
                _text(cell["reason"], field + ".reason")
            else:
                raise ValueError(f"{field}.state: choose available or unavailable.")
            _provenance(cell["provenance"], field + ".provenance", assessment_refs, row["assessment_row_ref"])
    if "presentation" in document:
        _object(document["presentation"], {"item_order"}, "presentation")
        order = document["presentation"]["item_order"]
        _references(order, "presentation.item_order")
        if set(order) != item_ids:
            raise ValueError("presentation.item_order: expected a permutation of the assessment items.")
    if check_identity and document["content_id"] != content_identity("bpic19-prepared-input", _meaning(document)):
        raise ValueError("content_id: the declared content identity does not match this artifact.")


def _canonical(document: dict) -> bytes:
    # Match preparation.content_identity's canonical JSON convention.
    return json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object fields are not admitted.")
        result[key] = value
    return result


def _invalid_constant(value: str) -> None:
    raise ValueError(f"Nonfinite JSON number {value} is not admitted.")


@dataclass(frozen=True, init=False)
class PreparedInput:
    """Validated immutable artifact, with a checked identity on every reopen."""

    _serialized: bytes

    def __init__(self, document: dict):
        _validate(document, check_identity=True)
        object.__setattr__(self, "_serialized", _canonical(document))

    @property
    def content_id(self) -> str:
        return self.to_dict()["content_id"]

    def to_dict(self) -> dict:
        return json.loads(self._serialized)

    def to_json(self) -> bytes:
        return self._serialized

    @classmethod
    def from_json(cls, payload: bytes | str) -> PreparedInput:
        if type(payload) is bytes:
            payload = payload.decode("utf-8")
        if type(payload) is not str:
            raise ValueError("Expected a UTF-8 JSON artifact.")
        return cls(json.loads(payload, object_pairs_hook=_unique_object, parse_constant=_invalid_constant))

    def method_attributes(self) -> list[dict]:
        """Detached numeric case attributes for a later native Method adapter.

        assessment_row_id identifies a transport row only. These are not original
        events and carry no original row_ids, timestamps or fabricated activities.
        The caller must retain this artifact for declared reasons and provenance.
        """
        return [
            {"case_id": row["assessment_item_id"], "assessment_row_id": row["assessment_row_ref"],
             "flow": row["flow"], **{key: cell["value"] for key, cell in row["measurements"].items()}}
            for row in self.to_dict()["rows"]
        ]


def build_prepared_input(rows: list[dict], *, presentation_order: list[str] | None = None) -> PreparedInput:
    """Freeze complete explicit declarations; never fill in a measurement or witness."""
    document = {"schema_version": 1, "artifact_kind": "bpic19.prepared-input", "profile_id": PROFILE_ID,
                "catalogue_sha256": CATALOGUE_SHA256, "input_policy": INPUT_POLICY, "rows": rows, "content_id": ""}
    if presentation_order is not None:
        document["presentation"] = {"item_order": presentation_order}
    _validate(document, check_identity=False)
    document["content_id"] = content_identity("bpic19-prepared-input", _meaning(document))
    return PreparedInput(document)
