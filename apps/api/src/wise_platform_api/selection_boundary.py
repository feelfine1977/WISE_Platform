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
one of three kinds told apart by its ``kind``; a failure is named within the
kind the request chose, and a kind the contract does not know is named at the
kind itself.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .boundary import SCHEMA_VERSION, first_difference, read_object
from .generated.selection import SelectionRefusal
from .import_boundary import import_echo

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
        different = first_difference(message, parsed.model_dump(mode="json", exclude_unset=True))
        if different is None:
            return parsed, message
        failures = [(different, "the value has another JSON type than the contract requires")]

    path, reason = min(failures, key=lambda failure: (_rank(failure[0]), len(failure[0])))
    rank = _rank(path)
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
        if (path, reason) not in kept:
            kept.append((path, reason))
    return kept or failures


def _rank(path: Location) -> int:
    if len(path) < 2 or path[0] != "predicates" or not isinstance(path[1], int):
        return _ENVELOPE
    return _POLICY if path[2:3] == ("anchor_policy",) else _PREDICATE


def _message(rank: int, path: Location, reason: str) -> str:
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    where = ".".join(str(part) for part in path) or "the request"
    if rank == _POLICY:
        return f"The opening anchor of {where} is not supported: {reason}."
    if rank == _PREDICATE:
        return f"The predicate is not valid at {where}: {reason}."
    return f"The request is not valid at {where}: {reason}."
