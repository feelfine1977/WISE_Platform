"""Strict generated validation and native binding without replacing transport values."""

from __future__ import annotations

from collections.abc import Mapping
import json

from wise_platform_analytics.incident_time import incident_time_diagnostics
from wise_platform_analytics.preparation import PreparedData
from wise_platform_analytics.prepared_operations import open_prepared_case

from .boundary import first_difference
from .generated.imports import ImportedCaseEvidenceAnswer


def validate_incident_time_answer(body: dict, prepared: PreparedData, request: Mapping[str, object], *,
                                 require_diagnostics: bool = False) -> dict:
    """Check an already authorized retained-case answer against its immutable source.

    Native equivalence covers source rules lost by generated models: positional
    rows, U/cardinality/zero-span coupling, calendars, exact bounds/arithmetic,
    maxima/ties and summary reasons. The independently supplied request binds
    the envelope and approved population; it is never inferred from the answer.
    Legacy omission is valid only when diagnostics are not required.
    """
    parsed = ImportedCaseEvidenceAnswer.model_validate_json(
        json.dumps(body, ensure_ascii=False, allow_nan=False), strict=True)
    checked = parsed.model_dump(mode="json", exclude_unset=True)
    if isinstance(checked.get("incident_time"), dict):
        summary = checked["incident_time"]["summary"]
        # Generation writes the singleton's JSON number constant as Literal[0].
        if type(summary["observed_span_hours"]) is int:
            summary["observed_span_hours"] = float(summary["observed_span_hours"])
    different = first_difference(body, checked,
                                 compare_text=False, integers_as_numbers=True)
    if different is not None:
        raise ValueError(f"The evidence model changes the transport at {different}.")
    if require_diagnostics and "incident_time" not in body:
        raise ValueError("The evidence producer must supply time diagnostics.")
    identity = dict(request["identity"])
    native_identity = prepared.identity_dict()
    if set(identity) != set(native_identity) or any(
        identity[key] != value for key, value in native_identity.items() if key != "population_id"
    ):
        raise ValueError("The authorized evidence identity does not bind this preparation.")
    native = open_prepared_case(prepared, native_identity, request["case_id"])
    if not isinstance(native, dict):
        raise ValueError("The authorized incident has no complete native evidence.")
    expected = {"schema_version": request["schema_version"], "message_type": "imported_case_evidence_answer",
                "request_id": request["request_id"], "query_revision": request["query_revision"],
                "workspace_id": request["workspace_id"], **native, "identity": identity}
    # Native clock/status guards also apply when a legacy transport omits diagnostics.
    diagnostics = incident_time_diagnostics(prepared, request["case_id"])
    if "incident_time" in body:
        expected["incident_time"] = diagnostics
    different = first_difference(body, expected, integers_as_numbers=True)
    if different is not None:
        raise ValueError(f"The supplied evidence does not bind its native source at {different}.")
    return body
