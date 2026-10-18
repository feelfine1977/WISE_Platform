"""Validation of requests against the import contract, and its refusals.

A request becomes a generated model only when it is exactly what the import
contract allows. The models are validated strictly as JSON, so a truth value
is not a whole number and a text is not a truth value, and the validated
model must give back the very types of the request. Instants stay texts as
the request wrote them: the operations pass the request's own values on.

The failing place decides the code. Another whole schema version is
``unsupported_schema``; a confirmed dialect or a dialect hint the contract
does not allow is ``invalid_dialect``; a column role is ``invalid_mapping``;
a policy the contract does not know is ``unsupported_policy``; a zone mode it
does not know is ``unsupported_timezone``; a policy parameter is
``invalid_parameter``; everything else is ``invalid_request``. When several
places fail, the envelope is named first, then the dialect, the mapping, the
shape of the policies, a policy identifier, a zone mode and a parameter.

The time policy is one of two policies told apart by their identifier, and
the zone of the explicit one is one of two modes; a failure is named within
the policy or mode the request chose, not within the one it did not choose.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .boundary import (
    SCHEMA_VERSION,
    echo_of,
    first_difference,
    holds_half_a_character,
    read_object,
)
from .generated.imports import ImportPolicies, ImportRefusal
from .workspace import is_workspace_id

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "unsupported_schema": 400,
    "unsupported_policy": 400,
    "invalid_parameter": 400,
    "workspace_unavailable": 404,
    "workspace_not_writable": 403,
    "workspace_incompatible": 409,
    "source_unavailable": 404,
    "memory_unavailable": 503,
    "invalid_dialect": 422,
    "invalid_mapping": 422,
    "unsupported_timezone": 422,
    "timezone_required": 422,
    "malformed_source": 422,
    "mixed_timezone_values": 422,
    "cutoff_before_records": 422,
    "preparation_unavailable": 404,
    "interpretation_not_ready": 409,
    "case_not_found": 404,
    "identity_mismatch": 409,
    "computation_failed": 500,
}
RETRYABLE = frozenset(
    {
        "workspace_unavailable",
        "workspace_not_writable",
        "source_unavailable",
        "memory_unavailable",
        "preparation_unavailable",
        "computation_failed",
    }
)
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

_ROLES = frozenset(ImportPolicies.model_fields)
_TIME_POLICIES = {
    "UtcTimePolicy": "incident.time.explicit_format_timezone_utc.v1",
    "WallTimePolicy": "incident.time.wall_clock_as_recorded.v1",
}
_ROW_POLICIES = {
    "StrictImportRowPolicy": "incident.rows.missing_id_outside_invalid_time_retained.v1",
    "TolerantImportRowPolicy": "incident.rows.missing_id_outside_invalid_time_retained.v2",
}
_ZONE_MODES = {"RecordedTimezone": "from_values", "FixedOffsetTimezone": "fixed_offset"}
_TIME = ("policies", "time")
_ROWS = ("policies", "rows")
_ZONE = ("policies", "time", "parameters", "timezone")
_DECIMAL = re.compile(r"0|[1-9][0-9]*")
_DIGITS_READ = 20
"""More digits than the largest admitted whole number has; longer digit strings stay text."""

# Order in which failing places are named, first one first.
_ENVELOPE, _DIALECT, _MAPPING, _POLICY_SHAPE, _POLICY_ID, _ZONE_MODE, _PARAMETER = range(7)
_CODES = {
    _ENVELOPE: "invalid_request",
    _DIALECT: "invalid_dialect",
    _MAPPING: "invalid_mapping",
    _POLICY_SHAPE: "invalid_request",
    _POLICY_ID: "unsupported_policy",
    _ZONE_MODE: "unsupported_timezone",
    _PARAMETER: "invalid_parameter",
}


def import_refusal(
    operation: str,
    code: str,
    message: str,
    *,
    echo: Mapping[str, object] | None = None,
    field: str | None = None,
) -> ImportRefusal:
    """Build an import refusal; whether a retry can help follows from its code."""
    echo = echo or {}
    return ImportRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="import_refusal",
        request_id=echo.get("request_id"),
        query_revision=echo.get("query_revision"),
        workspace_id=echo.get("workspace_id"),
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    )


def import_echo(message: Mapping[str, object]) -> dict[str, object]:
    """The request id, query revision and workspace id of a message, each only when valid itself."""
    echo: dict[str, object] = echo_of(dict(message))
    workspace_id = message.get("workspace_id")
    echo["workspace_id"] = workspace_id if is_workspace_id(workspace_id) else None
    return echo


def parse_import_body(
    body: bytes, model: type[RequestModel], operation: str
) -> tuple[RequestModel, dict] | ImportRefusal:
    """The request model of a JSON body with the body's own values, or the refusal for it."""
    message = read_object(body)
    if isinstance(message, str):
        return import_refusal(operation, "invalid_request", message)
    return parse_import(message, model, operation)


def upload_message(items: Iterable[tuple[str, str]]) -> dict[str, object] | str:
    """The metadata of a source upload from its query parameters, or why it cannot be read.

    The schema version and the query revision are read as decimal whole numbers written with
    ASCII digits; any other spelling stays text, so that validation refuses it. So does a number
    of more digits than any admitted value has: it is never converted.
    """
    message: dict[str, object] = {}
    for name, value in items:
        if holds_half_a_character([name, value]):
            return "A query parameter holds text that is not valid Unicode."
        if name in message:
            return f"The query parameter {name!r} is given more than once."
        if name in ("schema_version", "query_revision") and len(value) <= _DIGITS_READ and _DECIMAL.fullmatch(value):
            message[name] = int(value)
        else:
            message[name] = value
    return message


def parse_import(
    message: dict, model: type[RequestModel], operation: str
) -> tuple[RequestModel, dict] | ImportRefusal:
    """The request model of a message with the message itself, or the refusal for it."""
    echo = import_echo(message)
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return import_refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version "
            f"{SCHEMA_VERSION}.",
            echo=echo,
            field="schema_version",
        )
    try:
        parsed = model.model_validate_json(
            json.dumps(message, ensure_ascii=False, allow_nan=False), strict=True
        )
    except ValidationError as error:
        failures = _chosen_alternatives(
            message,
            [(tuple(item["loc"]), item["type"], item["msg"]) for item in error.errors(include_url=False)],
        )
    else:
        different = first_difference(
            message, parsed.model_dump(mode="json", exclude_unset=True), compare_text=False
        )
        if different is None:
            return parsed, message
        failures = [(different, "type", "the value has another JSON type than the contract requires")]

    path, kind, reason = min(failures, key=lambda failure: (_rank(failure[0], failure[1]), len(failure[0])))
    rank = _rank(path, kind)
    return import_refusal(
        operation,
        _CODES[rank],
        _message(rank, path, reason),
        echo=echo,
        field=".".join(str(part) for part in path),
    )


def _chosen_alternatives(
    message: Mapping[str, object], failures: list[tuple[Location, str, str]]
) -> list[tuple[Location, str, str]]:
    """Keep the failures of the time policy, row policy and zone mode the request chose, without their tags."""
    time = _at(message, _TIME)
    chosen_id = time.get("id") if isinstance(time, Mapping) else None
    rows = _at(message, _ROWS)
    chosen_rows = rows.get("id") if isinstance(rows, Mapping) else None
    zone = _at(message, _ZONE)
    chosen_mode = zone.get("mode") if isinstance(zone, Mapping) else None
    kept: list[tuple[Location, str, str]] = []
    for path, kind, reason in failures:
        if path[:2] == _TIME and len(path) > 2 and path[2] in _TIME_POLICIES:
            if not isinstance(time, Mapping):
                path, kind = _TIME, "model_type"
            elif "id" not in time:
                path, kind = (*_TIME, "id"), "missing"
            elif chosen_id not in _TIME_POLICIES.values():
                path, kind, reason = (*_TIME, "id"), "literal_error", "it is not a time policy of this contract"
            elif _TIME_POLICIES[str(path[2])] != chosen_id:
                continue
            else:
                path = (*_TIME, *path[3:])
        if path[:2] == _ROWS and len(path) > 2 and path[2] in _ROW_POLICIES:
            if not isinstance(rows, Mapping):
                path, kind = _ROWS, "model_type"
            elif "id" not in rows:
                path, kind = (*_ROWS, "id"), "missing"
            elif chosen_rows not in _ROW_POLICIES.values():
                path, kind, reason = (*_ROWS, "id"), "literal_error", "it is not a row policy of this contract"
            elif _ROW_POLICIES[str(path[2])] != chosen_rows:
                continue
            else:
                path = (*_ROWS, *path[3:])
        if path[:4] == _ZONE and len(path) > 4 and path[4] in _ZONE_MODES:
            if not isinstance(zone, Mapping):
                path, kind = _ZONE, "model_type"
            elif chosen_mode not in _ZONE_MODES.values():
                path, kind, reason = _ZONE, "zone_mode", "this zone mode is not supported"
            elif _ZONE_MODES[str(path[4])] != chosen_mode:
                continue
            else:
                path = (*_ZONE, *path[5:])
        kept.append((path, kind, reason))
    return kept or failures


def _at(message: Mapping[str, object], path: Sequence[str]) -> object:
    value: object = message
    for name in path:
        if not isinstance(value, Mapping):
            return None
        value = value.get(name)
    return value


def _rank(path: Sequence[str | int], kind: str) -> int:
    if not path:
        return _ENVELOPE
    if path[0] in ("dialect", "hints"):
        return _DIALECT if len(path) > 1 else _ENVELOPE
    if path[0] == "mapping":
        return _MAPPING if len(path) > 1 else _ENVELOPE
    if path[0] != "policies" or len(path) < 2:
        return _ENVELOPE
    if len(path) == 2:
        return _POLICY_SHAPE if path[1] in _ROLES else _POLICY_ID
    if path[2] == "id":
        return _POLICY_SHAPE if kind == "missing" else _POLICY_ID
    if path[2] == "parameters":
        return _ZONE_MODE if kind == "zone_mode" else _PARAMETER
    return _POLICY_SHAPE


def _message(rank: int, path: Sequence[str | int], reason: str) -> str:
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    where = ".".join(str(part) for part in path) or "the request"
    if rank == _DIALECT:
        return f"The reading of the source at {where} is not supported: {reason}."
    if rank == _MAPPING:
        return f"The column roles are not valid at {where}: {reason}."
    if rank == _POLICY_ID:
        return f"The policy given for the role {path[1]!r} is not supported: {reason}."
    if rank == _ZONE_MODE:
        return (
            "The time zone choice is not supported: choose the offsets recorded in the values "
            "or one fixed offset."
        )
    if rank == _PARAMETER:
        return f"The parameter {where} is not supported: {reason}."
    return f"The request is not valid at {where}: {reason}."
