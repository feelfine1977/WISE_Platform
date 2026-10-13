"""Validation of requests against the scoring contract, its refusals, and the conditions its models do not carry.

A request becomes a generated model only when it is exactly what the scoring
contract allows. The body is read as every other request body is read (no
``NaN``, no ``Infinity``, no number too large to be held), the models are
validated strictly as JSON, and the validated model must give back the values
of the request. Two things differ from a literal comparison: a field the
client left out is not compared with a default the model fills in, and a
whole number is the same value as the decimal number the model holds for it
(``4`` is ``4.0``), unless the decimal number cannot hold it exactly.

The failing place decides the code. Another whole schema version is
``unsupported_schema``; the target or the width of a definition is
``invalid_parameter``; a choice of meaning the contract does not admit
(another pairing, missing-value policy, calibration or unit) is
``unsupported_definition``; everything else is ``invalid_request``.

The source schema states a few conditions that the generated models do not
carry: the parts of a validation answer that go with its state, the parts of a
measurement that go with its status, the record of a time that goes with its
kind, lists without repeated items, and that a refusal for an unevaluable
sequence names its incidents and a way out. ``unmet_condition`` checks them
for every answer before it is sent.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .boundary import SCHEMA_VERSION, first_difference, read_object
from .generated.scoring import ScoringRefusal
from .import_boundary import import_echo

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "unsupported_schema": 400,
    "invalid_parameter": 422,
    "unsupported_definition": 422,
    "workspace_unavailable": 404,
    "source_unavailable": 404,
    "preparation_unavailable": 404,
    "identity_mismatch": 409,
    "population_unavailable": 404,
    "empty_population": 422,
    "definition_unavailable": 404,
    "definition_not_reviewed": 409,
    "clock_mismatch": 422,
    "unevaluable_sequence": 422,
    "method_unavailable": 503,
    "run_unavailable": 404,
    "case_not_found": 404,
    "computation_failed": 500,
}
RETRYABLE = frozenset(
    {
        "workspace_unavailable",
        "source_unavailable",
        "preparation_unavailable",
        "population_unavailable",
        "method_unavailable",
        "computation_failed",
    }
)
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

RECOVERY: dict[str, tuple[str, ...]] = {
    "invalid_parameter": ("edit_definition",),
    "unsupported_definition": ("edit_definition",),
    "clock_mismatch": ("edit_definition",),
    "definition_not_reviewed": ("review_definition",),
    "unevaluable_sequence": ("inspect_quality", "choose_qualified_named_population"),
    "empty_population": ("choose_qualified_named_population",),
    "source_unavailable": ("restore_source",),
    "workspace_unavailable": ("retry",),
    "preparation_unavailable": ("retry",),
    "population_unavailable": ("retry",),
    "method_unavailable": ("retry",),
    "computation_failed": ("retry",),
}
"""What the analyst can do about a refusal or a blocker of each code."""

_UNEVALUABLE_RECOVERY = frozenset({"inspect_quality", "choose_qualified_named_population"})
_PARAMETERS = (("definition", "target"), ("definition", "width"))

# Order in which failing places are named, first one first.
_ENVELOPE, _DEFINITION, _MEANING, _PARAMETER = range(4)
_CODES = {
    _ENVELOPE: "invalid_request",
    _DEFINITION: "invalid_request",
    _MEANING: "unsupported_definition",
    _PARAMETER: "invalid_parameter",
}


def scoring_refusal(
    operation: str,
    code: str,
    message: str,
    *,
    echo: Mapping[str, object] | None = None,
    field: str | None = None,
    case_ids: Sequence[str] = (),
) -> ScoringRefusal:
    """Build a scoring refusal; whether a retry can help and what to do follow from its code."""
    echo = echo or {}
    return ScoringRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="scoring_refusal",
        request_id=echo.get("request_id"),
        query_revision=echo.get("query_revision"),
        workspace_id=echo.get("workspace_id"),
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
        case_ids=list(case_ids),
        case_count=len(case_ids),
        recovery_actions=list(RECOVERY.get(code, ())),
    )


def parse_scoring_body(
    body: bytes, model: type[RequestModel], operation: str
) -> tuple[RequestModel, dict] | ScoringRefusal:
    """The request model of a JSON body with the body's own values, or the refusal for it."""
    message = read_object(body)
    if isinstance(message, str):
        return scoring_refusal(operation, "invalid_request", message)
    echo = import_echo(message)
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return scoring_refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version {SCHEMA_VERSION}.",
            echo=echo,
            field="schema_version",
        )
    try:
        parsed = model.model_validate_json(json.dumps(message, ensure_ascii=False, allow_nan=False), strict=True)
    except ValidationError as error:
        failures = [(tuple(item["loc"]), item["type"], item["msg"]) for item in error.errors(include_url=False)]
    else:
        different = first_difference(
            message, parsed.model_dump(mode="json", exclude_unset=True), numbers_by_value=True
        )
        if different is None:
            return parsed, message
        reason = (
            "the number cannot be held exactly"
            if different in _PARAMETERS
            else "the value has another JSON type than the contract requires"
        )
        failures = [(different, "type", reason)]

    path, kind, reason = min(failures, key=lambda failure: (_rank(failure[0], failure[1]), len(failure[0])))
    rank = _rank(path, kind)
    return scoring_refusal(
        operation, _CODES[rank], _message(rank, path, reason), echo=echo, field=".".join(str(part) for part in path)
    )


def unmet_condition(body: Mapping[str, object]) -> str | None:
    """The first condition of the source schema that an answer breaks and its generated model does not check."""
    kind = body.get("message_type")
    if kind == "scoring_refusal":
        return _refusal_condition(body)
    if kind == "expectation_validation_answer":
        return _validation_condition(body)
    if kind == "score_run_answer":
        run = _mapping(body.get("run"))
        population = _mapping(run.get("population"))
        if _repeats(population.get("case_ids")):
            return "run.population.case_ids repeats an incident"
        for index, case in enumerate(_sequence(run.get("cases"))):
            problem = _measurement_condition(_mapping(_mapping(case).get("measurement")))
            if problem is not None:
                return f"run.cases.{index}.measurement: {problem}"
        return None
    if kind == "score_case_witness_answer":
        for name in ("method_trace_row_ids", "activation_candidate_row_ids", "response_candidate_row_ids"):
            if _repeats(body.get(name)):
                return f"{name} repeats a record"
        problem = _measurement_condition(_mapping(_mapping(body.get("case")).get("measurement")))
        if problem is not None:
            return f"case.measurement: {problem}"
        trace = _mapping(body.get("trace"))
        for name in ("mapped_row_ids", "omitted_activity_row_ids"):
            if _repeats(trace.get(name)):
                return f"trace.{name} repeats a record"
        for index, record in enumerate(_sequence(trace.get("records"))):
            problem = _record_condition(_mapping(record))
            if problem is not None:
                return f"trace.records.{index}: {problem}"
        return None
    return None


def _refusal_condition(body: Mapping[str, object]) -> str | None:
    case_ids = _sequence(body.get("case_ids"))
    if _repeats(case_ids):
        return "case_ids repeats an incident"
    if body.get("code") == "unevaluable_sequence":
        if not case_ids or not isinstance(body.get("case_count"), int) or body["case_count"] < 1:
            return "an unevaluable sequence names at least one incident"
        if not _UNEVALUABLE_RECOVERY & set(_sequence(body.get("recovery_actions"))):
            return "an unevaluable sequence names a way to qualify the population"
    return None


def _validation_condition(body: Mapping[str, object]) -> str | None:
    blockers = _sequence(body.get("blockers"))
    for index, blocker in enumerate(blockers):
        if _repeats(_mapping(blocker).get("case_ids")):
            return f"blockers.{index}.case_ids repeats an incident"
    readiness = _mapping(body.get("readiness"))
    if body.get("state") == "ready":
        if body.get("definition_version") is None:
            return "a ready answer carries its definition version"
        if blockers:
            return "a ready answer has no blocker"
        if not all(readiness.get(flag) is True for flag in ("supported_definition", "preparation_gate_passed", "method_check_passed")):
            return "a ready answer has passed every gate"
    elif body.get("state") == "blocked":
        if body.get("definition_version") is not None:
            return "a blocked answer carries no definition version"
        if not blockers:
            return "a blocked answer names at least one blocker"
    return None


def _measurement_condition(measurement: Mapping[str, object]) -> str | None:
    status = measurement.get("status")
    value, age = measurement.get("value"), measurement.get("censor_age")
    if status == "observed" and (value is None or age is not None):
        return "an observed interval has a value and no censoring age"
    if status == "missing_activation" and (value is not None or age is not None):
        return "without a start there is no interval and no censoring age"
    if status == "missing_response" and value is not None:
        return "without a response there is no interval"
    return None


def _record_condition(record: Mapping[str, object]) -> str | None:
    status, kind = record.get("timestamp_status"), record.get("timestamp_kind")
    utc, local = record.get("utc_instant"), record.get("local_timestamp")
    if status == "usable":
        if kind == "utc_instant" and (utc is None or local is not None):
            return "a usable instant is written as an instant only"
        if kind == "wall_clock" and (local is None or utc is not None):
            return "a usable wall-clock time is written as a local time only"
    elif utc is not None or local is not None:
        return "a record without a usable time has no time"
    return None


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _sequence(value: object) -> Sequence[object]:
    return value if isinstance(value, list) else []


def _repeats(value: object) -> bool:
    items = _sequence(value)
    return len(set(map(str, items))) != len(items)


def _rank(path: Location, kind: str) -> int:
    if not path or path[0] != "definition" or len(path) < 2:
        return _ENVELOPE
    if path[:2] in _PARAMETERS:
        return _PARAMETER
    if kind in ("literal_error", "enum"):
        return _MEANING
    return _DEFINITION


def _message(rank: int, path: Location, reason: str) -> str:
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    where = ".".join(str(part) for part in path) or "the request"
    if rank == _PARAMETER:
        return (
            f"The {path[1]} of the definition cannot be taken: {reason}. "
            "The target is a number above zero and the width a number of zero or more."
        )
    if rank == _MEANING:
        return f"The definition asks for a meaning this application does not support at {where}: {reason}."
    return f"The request is not valid at {where}: {reason}."
