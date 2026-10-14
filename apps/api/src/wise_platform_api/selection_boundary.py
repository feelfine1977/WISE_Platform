"""Validation of requests against the selection contract, and its refusals.

A request becomes a generated model only when it is exactly what the
selection contract allows. As for the import contract, the models are
validated strictly as JSON, so a truth value is not a whole number and a
text is not a truth value, and the validated model must give back the very
values of the request.

The failing place decides the code. Another whole schema version is
``unsupported_schema``; the anchor policy of an opening predicate is
``unsupported_policy``; anything else inside a predicate is
``invalid_predicate``; everything else is ``invalid_request``. A predicate is
one of eleven kinds told apart by its ``kind``; a failure is named within the
kind the request chose, and a kind the contract does not know is named at the
kind itself.
"""

from __future__ import annotations

import json
from copy import deepcopy
from collections.abc import Mapping
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .boundary import SCHEMA_VERSION, first_difference, read_object
from .generated.selection import SelectionRefusal
from .import_boundary import import_echo
from .strict_reading import Failure, UTC_INSTANT, instant_failures, repeated_failures

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "unsupported_schema": 400,
    "unsupported_policy": 400,
    "invalid_parameter": 400,
    "workspace_unavailable": 404,
    "source_unavailable": 404,
    "preparation_unavailable": 404,
    "identity_mismatch": 409,
    "population_unavailable": 404,
    "invalid_predicate": 422,
    "invalid_parent": 422,
    "unknown_case": 422,
    "case_outside_parent": 422,
    "unmapped_context_column": 422,
    "inconsistent_sequence": 422,
    "mixed_time_kinds": 422,
    "inconsistent_time_kind": 422,
    "computation_failed": 500,
}
RETRYABLE = frozenset(
    {
        "workspace_unavailable",
        "source_unavailable",
        "preparation_unavailable",
        "population_unavailable",
        "computation_failed",
    }
)
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

_KINDS = {
    "ContainsActivity": "contains_activity",
    "DirectlyFollows": "directly_follows",
    "OpeningAttributeEquals": "opening_attribute_equals",
    "StartsWithActivity": "starts_with_activity",
    "EndsWithActivity": "ends_with_activity",
    "CaseIdIn": "case_id_in",
    "CaseStartInWindow": "case_start_in_window",
    "OpeningAttributeIn": "opening_attribute_in",
    "RecordAttributeIn": "record_attribute_in",
    "ObservedSpanAtLeast": "observed_span_at_least",
    "MaxRawGapAtLeast": "max_raw_gap_at_least",
}

# Order in which failing places are named, first one first.
_ENVELOPE, _PREDICATE, _POLICY = range(3)
_CODES = {_ENVELOPE: "invalid_request", _PREDICATE: "invalid_predicate", _POLICY: "unsupported_policy"}


def selection_refusal(
    operation: str,
    code: str,
    message: str,
    *,
    echo: Mapping[str, object] | None = None,
    field: str | None = None,
) -> SelectionRefusal:
    """Build a selection refusal; whether a retry can help follows from its code."""
    echo = echo or {}
    return SelectionRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="selection_refusal",
        request_id=echo.get("request_id"),
        query_revision=echo.get("query_revision"),
        workspace_id=echo.get("workspace_id"),
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    )


def parse_selection_body(
    body: bytes, model: type[RequestModel], operation: str
) -> tuple[RequestModel, dict] | SelectionRefusal:
    """The request model of a JSON body with the body's own values, or the refusal for it."""
    message = read_object(body)
    if isinstance(message, str):
        return selection_refusal(operation, "invalid_request", message)
    echo = import_echo(message)
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return selection_refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version {SCHEMA_VERSION}.",
            echo=echo,
            field="schema_version",
        )
    try:
        parsed = model.model_validate_json(json.dumps(message, ensure_ascii=False, allow_nan=False), strict=True)
    except ValidationError as error:
        failures = _chosen_kinds(
            message, [(tuple(item["loc"]), item["msg"]) for item in error.errors(include_url=False)]
        )
    else:
        paths = predicate_window_paths(message, (("predicates",),))
        written = restored_window_echo(message, parsed.model_dump(mode="json", exclude_unset=True), paths)
        different = first_difference(message, written, integers_as_numbers=True)
        failures = [] if different is None else [(different, "the value has another JSON type than the contract requires")]
        failures += [(failure.path, failure.reason) for failure in predicate_wire_failures(message, (("predicates",),))]
        if not failures:
            return parsed, message

    path, reason = min(failures, key=lambda failure: (_rank(failure[0], message), len(failure[0])))
    rank = _rank(path, message)
    return selection_refusal(
        operation, _CODES[rank], _message(rank, path, reason), echo=echo, field=".".join(str(part) for part in path)
    )


def _chosen_kinds(message: Mapping[str, object], failures: list[tuple[Location, str]]) -> list[tuple[Location, str]]:
    """Keep the failures of the predicate kind each predicate chose, without the name of the kind."""
    predicates = message.get("predicates")
    kept: list[tuple[Location, str]] = []
    for path, reason in failures:
        if len(path) > 2 and path[0] == "predicates" and isinstance(path[1], int) and path[2] in _KINDS:
            given = predicates[path[1]] if isinstance(predicates, list) and path[1] < len(predicates) else None
            chosen = given.get("kind") if isinstance(given, Mapping) else None
            if not isinstance(given, Mapping):
                path = path[:2]
            elif chosen not in _KINDS.values():
                path, reason = (*path[:2], "kind"), "it is not a kind of predicate this contract knows"
            elif _KINDS[str(path[2])] != chosen:
                continue
            else:
                path = (*path[:2], *path[3:])
        branch = next((index for index, part in enumerate(path) if part in ("UtcCaseStartWindow", "WallCaseStartWindow")), None)
        if branch is not None:
            prefix = path[:branch]
            given = _value_at(message, prefix)
            clock = given.get("timestamp_kind") if isinstance(given, Mapping) else None
            selected = "UtcCaseStartWindow" if clock == "utc_instant" else "WallCaseStartWindow" if clock == "wall_clock" else None
            if selected is not None and path[branch] != selected:
                continue
            path = (*prefix, *path[branch + 1:]) if selected else (*prefix, "timestamp_kind")
        if (path, reason) not in kept:
            kept.append((path, reason))
    return kept or failures


def _rank(path: Location, message: Mapping | None = None) -> int:
    if len(path) < 2 or path[0] != "predicates" or not isinstance(path[1], int):
        return _ENVELOPE
    if path[2:3] == ("anchor_policy",) and message is not None:
        predicate = _value_at(message, path[:2])
        if isinstance(predicate, Mapping) and predicate.get("kind") == "record_attribute_in":
            return _PREDICATE
    return _POLICY if path[2:3] == ("anchor_policy",) else _PREDICATE


def _message(rank: int, path: Location, reason: str) -> str:
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    where = ".".join(str(part) for part in path) or "the request"
    if rank == _POLICY:
        return f"The opening anchor of {where} is not supported: {reason}."
    if rank == _PREDICATE:
        return f"The predicate is not valid at {where}: {reason}."
    return f"The request is not valid at {where}: {reason}."


def _value_at(message: object, path: Location) -> object:
    value = message
    for part in path:
        if isinstance(part, int) and isinstance(value, list) and part < len(value):
            value = value[part]
        elif isinstance(part, str) and isinstance(value, Mapping):
            value = value.get(part)
        else:
            return None
    return value


def predicate_window_paths(message: Mapping, predicate_paths: tuple[Location, ...]) -> tuple[Location, ...]:
    """Only UTC bounds of the declared date predicate may normalize in a generated model."""
    paths = []
    for prefix in predicate_paths:
        predicates = _value_at(message, prefix)
        if not isinstance(predicates, list):
            continue
        for index, predicate in enumerate(predicates):
            window = predicate.get("window") if isinstance(predicate, Mapping) else None
            if predicate.get("kind") == "case_start_in_window" and isinstance(window, Mapping) and window.get("timestamp_kind") == "utc_instant":
                paths.extend((*prefix, index, "window", bound) for bound in ("start_inclusive", "end_exclusive"))
    return tuple(paths)


def restored_window_echo(message: Mapping, written: dict, paths: tuple[Location, ...]) -> dict:
    """Restore only allowlisted, canonically spelled UTC text for wire-type comparison."""
    result = deepcopy(written)
    for path in paths:
        given = _value_at(message, path)
        if not isinstance(given, str) or UTC_INSTANT.fullmatch(given) is None:
            continue
        current = result
        for part in path[:-1]:
            current = current[part]
        current[path[-1]] = given
    return result


def predicate_wire_failures(message: Mapping, predicate_paths: tuple[Location, ...]) -> list[Failure]:
    """Source-only set uniqueness and UTC spelling checks at every predicate-bearing seam."""
    unique = [(*prefix, "*", member) for prefix in predicate_paths for member in ("case_ids", "values")]
    return repeated_failures(message, unique) + instant_failures(message, predicate_window_paths(message, predicate_paths))
