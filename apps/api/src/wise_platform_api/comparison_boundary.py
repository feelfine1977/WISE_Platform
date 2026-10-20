"""Validation of requests against the comparison contract, and its refusals.

A request becomes a generated model only when it is exactly what the
comparison contract allows. The body is read as strictly as every other
request (no ``NaN``, no ``Infinity``, no number too large to be read), the
models are validated strictly as JSON, and the validated model must give back
the very values of the request, with two differences that are no change of a
value: a whole number written for a JSON number (``4`` for ``4.0``) and an
instant the model writes in another spelling. Two conditions of the contract
that the generated models do not carry are checked here: case ids of one list
do not repeat, and an instant is written in UTC with a ``Z``.

The definitions are unions. A failure is named within the member the request
chose (by its ``mode``, its ``kind``, or the clock of the first period's
window), and a member the contract does not know is named at its ``mode`` or
``kind`` itself.

The failing place decides the code. Another whole schema version is
``unsupported_schema``; the context policy and the anchor of an opening
predicate are ``unsupported_policy``; a predicate is ``invalid_predicate``; the
parent's case ids are ``invalid_parent``; the clock of a window is
``clock_mismatch``; any other place in a window is ``invalid_window``; any other
place in the definition is ``invalid_parameter``; everything else is
``invalid_request``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from .boundary import SCHEMA_VERSION, first_difference, read_object
from .generated.comparison import ComparisonRefusal
from .import_boundary import import_echo
from .selection_boundary import predicate_wire_failures, predicate_window_paths, restored_window_echo, _value_at

RequestModel = TypeVar("RequestModel", bound=BaseModel)
Location = tuple[str | int, ...]
Failure = tuple[Location, str]

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "unsupported_schema": 400,
    "unsupported_policy": 400,
    "invalid_parameter": 400,
    "workspace_unavailable": 404,
    "source_unavailable": 404,
    "memory_unavailable": 503,
    "preparation_unavailable": 404,
    "identity_mismatch": 409,
    "population_unavailable": 404,
    "invalid_predicate": 422,
    "invalid_parent": 422,
    "unknown_case": 422,
    "case_outside_parent": 422,
    "unmapped_context_column": 422,
    "invalid_window": 422,
    "clock_mismatch": 422,
    "computation_failed": 500,
}
RETRYABLE = frozenset(
    {
        "workspace_unavailable",
        "source_unavailable",
        "memory_unavailable",
        "preparation_unavailable",
        "population_unavailable",
        "computation_failed",
    }
)
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

_UTC_INSTANT = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z")


def _period_member(given: Mapping[str, object]) -> str:
    """The period definition a request chose: the clock of its first period's window decides."""
    target = given.get("target")
    window = target.get("window") if isinstance(target, Mapping) else None
    kind = window.get("timestamp_kind") if isinstance(window, Mapping) else None
    return "WallPeriodComparisonDefinition" if kind == "wall_clock" else "UtcPeriodComparisonDefinition"


def _by(key: str, members: Mapping[str, str]) -> tuple[str, Callable[[Mapping[str, object]], str | None]]:
    return key, lambda given: members.get(given.get(key)) if isinstance(given.get(key), str) else None


_GROUP_DEFINITIONS = _by("mode", {"two_named_groups": "TwoNamedGroups", "selection_partition": "SelectionPartition"})
_NAMED_GROUPS = _by("kind", {"predicates": "PredicateGroupDefinition", "explicit_case_ids": "ExplicitCaseGroupDefinition"})
_PREDICATES = _by(
    "kind",
    {
        "contains_activity": "ContainsActivity",
        "directly_follows": "DirectlyFollows",
        "opening_attribute_equals": "OpeningAttributeEquals",
        "starts_with_activity": "StartsWithActivity",
        "ends_with_activity": "EndsWithActivity",
        "case_id_in": "CaseIdIn",
        "case_start_in_window": "CaseStartInWindow",
        "opening_attribute_in": "OpeningAttributeIn",
        "record_attribute_in": "RecordAttributeIn",
        "observed_span_at_least": "ObservedSpanAtLeast",
        "max_raw_gap_at_least": "MaxRawGapAtLeast",
        "interval_threshold": "IntervalThreshold",
        "variant_is": "VariantIs",
    },
)
_PERIODS = ("target", _period_member)
# For each member of a union the models name in a failing place: how the request chooses a member.
_UNIONS: dict[str, tuple[str, Callable[[Mapping[str, object]], str | None]]] = {
    **{member: _GROUP_DEFINITIONS for member in ("TwoNamedGroups", "SelectionPartition")},
    **{member: _NAMED_GROUPS for member in ("PredicateGroupDefinition", "ExplicitCaseGroupDefinition")},
    **{
        member: _PREDICATES
        for member in (
            "ContainsActivity",
            "DirectlyFollows",
            "OpeningAttributeEquals",
            "StartsWithActivity",
            "EndsWithActivity", "CaseIdIn", "CaseStartInWindow", "OpeningAttributeIn",
            "RecordAttributeIn", "ObservedSpanAtLeast", "MaxRawGapAtLeast", "IntervalThreshold", "VariantIs",
        )
    },
    "UtcCaseStartWindow": _by("timestamp_kind", {"utc_instant": "UtcCaseStartWindow", "wall_clock": "WallCaseStartWindow"}),
    "WallCaseStartWindow": _by("timestamp_kind", {"utc_instant": "UtcCaseStartWindow", "wall_clock": "WallCaseStartWindow"}),
    **{member: _PERIODS for member in ("UtcPeriodComparisonDefinition", "WallPeriodComparisonDefinition")},
}

# Order in which failing places are named, first one first.
_ENVELOPE, _POLICY, _PARENT, _PREDICATE, _CLOCK, _WINDOW, _PARAMETER = range(7)
_CODES = {
    _ENVELOPE: "invalid_request",
    _POLICY: "unsupported_policy",
    _PARENT: "invalid_parent",
    _PREDICATE: "invalid_predicate",
    _CLOCK: "clock_mismatch",
    _WINDOW: "invalid_window",
    _PARAMETER: "invalid_parameter",
}


def comparison_refusal(
    operation: str,
    code: str,
    message: str,
    *,
    echo: Mapping[str, object] | None = None,
    field: str | None = None,
) -> ComparisonRefusal:
    """Build a comparison refusal; whether a retry can help follows from its code."""
    echo = echo or {}
    return ComparisonRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="comparison_refusal",
        request_id=echo.get("request_id"),
        query_revision=echo.get("query_revision"),
        workspace_id=echo.get("workspace_id"),
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    )


def parse_comparison_body(
    body: bytes, model: type[RequestModel], operation: str
) -> tuple[RequestModel, dict] | ComparisonRefusal:
    """The request model of a JSON body with the body's own values, or the refusal for it."""
    message = read_object(body)
    if isinstance(message, str):
        return comparison_refusal(operation, "invalid_request", message)
    echo = import_echo(message)
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return comparison_refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version {SCHEMA_VERSION}.",
            echo=echo,
            field="schema_version",
        )
    try:
        parsed = model.model_validate_json(json.dumps(message, ensure_ascii=False, allow_nan=False), strict=True)
    except ValidationError as error:
        failures = _chosen_members(message, [(tuple(item["loc"]), item["msg"]) for item in error.errors(include_url=False)])
    else:
        failures = _weaker_than_the_contract(message, parsed)
        if not failures:
            return parsed, message

    path, reason = min(failures, key=lambda failure: (_rank(failure[0], message), len(failure[0])))
    rank = _rank(path, message)
    return comparison_refusal(
        operation, _CODES[rank], _message(path, reason), echo=echo, field=".".join(str(part) for part in path)
    )


def _weaker_than_the_contract(message: dict, parsed: BaseModel) -> list[Failure]:
    """The places where the validated model accepted more than the contract allows."""
    predicate_paths = (("definition", "predicates"), ("definition", "target", "definition", "predicates"),
                       ("definition", "reference", "definition", "predicates"))
    paths = list(predicate_window_paths(message, predicate_paths))
    for role in ("target", "reference"):
        group = message["definition"].get(role)
        window = group.get("window") if isinstance(group, Mapping) else None
        if isinstance(window, Mapping) and window.get("timestamp_kind") == "utc_instant":
            paths.extend(("definition", role, "window", bound) for bound in ("start_inclusive", "end_exclusive"))
    written = restored_window_echo(message, parsed.model_dump(mode="json", exclude_unset=True), tuple(paths))
    different = first_difference(message, written, integers_as_numbers=True)
    if different is not None:
        return [(different, "the value has another JSON type than the contract requires")]
    failures: list[Failure] = [(failure.path, failure.reason) for failure in predicate_wire_failures(message, predicate_paths)]
    definition = message["definition"]
    lists: list[tuple[Location, object]] = [(("parent_case_ids",), message["parent_case_ids"])]
    for role in ("target", "reference"):
        group = definition.get(role)
        if isinstance(group, dict) and isinstance(group.get("definition"), dict):
            lists.append((("definition", role, "definition", "case_ids"), group["definition"].get("case_ids")))
        window = group.get("window") if isinstance(group, dict) else None
        if isinstance(window, dict) and window.get("timestamp_kind") == "utc_instant":
            for bound in ("start_inclusive", "end_exclusive"):
                if not _UTC_INSTANT.fullmatch(window[bound]):
                    failures.append(
                        (
                            ("definition", role, "window", bound),
                            "an instant is written as a date and time of day in UTC ending in Z",
                        )
                    )
    for path, ids in lists:
        if isinstance(ids, list) and len(set(ids)) != len(ids):
            failures.append((path, "an incident id is listed more than once"))
    return failures


def _chosen_members(message: Mapping[str, object], failures: list[Failure]) -> list[Failure]:
    """Keep the failures of the union members the request chose, with the members' names left out."""
    kept: list[Failure] = []
    for location, reason in failures:
        found = _on_chosen_member(message, location, reason)
        if found is not None and found not in kept:
            kept.append(found)
    return kept or failures


def _on_chosen_member(message: Mapping[str, object], location: Location, reason: str) -> Failure | None:
    given: object = message
    path: list[str | int] = []
    for part in location:
        union = _UNIONS.get(part) if isinstance(part, str) else None
        if union is None:
            path.append(part)
            if isinstance(part, int):
                given = given[part] if isinstance(given, list) and part < len(given) else None
            else:
                given = given.get(part) if isinstance(given, Mapping) else None
            continue
        if not isinstance(given, Mapping):
            return tuple(path), "it is not an object"
        key, choose = union
        chosen = choose(given)
        if chosen is None:
            return (*path, key), "it is not a choice this contract knows"
        if chosen != part:
            return None
    return tuple(path), reason


def _rank(path: Location, message: Mapping | None = None) -> int:
    if path[:1] == ("context_policy",):
        return _POLICY
    if path[:1] == ("parent_case_ids",):
        return _PARENT
    if path[:1] != ("definition",):
        return _ENVELOPE
    if "predicates" in path:
        index = path.index("predicates")
        if len(path) > index + 1 and isinstance(path[index + 1], int):
            predicate = _value_at(message, path[:index + 2]) if message is not None else None
            if isinstance(predicate, Mapping) and predicate.get("kind") == "record_attribute_in":
                return _PREDICATE
            return _POLICY if path[index + 2 : index + 3] == ("anchor_policy",) else _PREDICATE
    if len(path) > 2 and path[2] == "window":
        return _CLOCK if path[3:4] == ("timestamp_kind",) else _WINDOW
    return _PARAMETER


def _message(path: Location, reason: str) -> str:
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    where = ".".join(str(part) for part in path) or "the request"
    return f"The request is not valid at {where}: {reason}."
