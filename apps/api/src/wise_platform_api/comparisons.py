"""Comparing two groups of incidents, or two periods of incident starts, of a preparation.

Both operations of the comparison contract work on a preparation kept in a
workspace. The meaning of every membership, count, share and identity is the
analytics package's: this module finds the workspace and the prepared
snapshot, hands the request's parent, context column, policy and definition
to ``compare_groups`` or ``compare_periods`` unchanged, and turns what the
package refuses into the contract's typed refusals.

Before an answer is sent, its parent and the incidents of both groups are
kept in the selection registry under their population identities, each as a
selection without steps of exactly those incidents, so that the complete
history of their incidents and their map can be asked for at once. Reopening
a saved investigation computes and keeps its comparison the same way.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.comparison import compare_groups, compare_periods
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.preparation import PreparedData
from wise_platform_analytics.selection import select_cases

from .boundary import SCHEMA_VERSION, read_object
from .generated import comparison as comparison_models
from .generated.comparison import (
    ComparisonRefusal,
    GroupComparisonAnswer,
    GroupComparisonRequest,
    PeriodComparisonAnswer,
    PeriodComparisonRequest,
)
from .import_boundary import import_echo
from .imports import Imports
from .registry import SelectionRegistry
from .strict_reading import (
    Failure,
    alternatives_of,
    instant_failures,
    read_strictly,
    repeated_failures,
    version_failures,
)
from .workspace import Problem

logger = logging.getLogger(__name__)

COMPARE_GROUPS = "compare_groups"
COMPARE_PERIODS = "compare_periods"

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
    "invalid_window": 422,
    "clock_mismatch": 422,
    "computation_failed": 500,
}
RETRYABLE = frozenset(
    {"workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable", "computation_failed"}
)

_ALTERNATIVES = alternatives_of(comparison_models)
_UNIQUE = (
    ("parent_case_ids",),
    ("definition", "target", "definition", "case_ids"),
    ("definition", "reference", "definition", "case_ids"),
)


def compared(
    prepared: PreparedData,
    kind: str,
    identity: Mapping[str, object],
    parent_case_ids: object,
    context_column_index: int,
    context_policy: str,
    definition: Mapping[str, object],
) -> dict[str, object] | PackageRefusal:
    """The package's comparison of groups (``kind`` "group") or of periods (``kind`` "period")."""
    compare = compare_groups if kind == "group" else compare_periods
    return compare(prepared, identity, parent_case_ids, context_column_index, context_policy, definition)


def keep_comparison(
    registry: SelectionRegistry, workspace_id: str, prepared: PreparedData, answer: Mapping[str, object]
) -> None:
    """Keep the parent and both groups of a comparison as selections of exactly their incidents."""
    for support in (answer["parent"], answer["target"]["included"], answer["reference"]["included"]):
        registry.keep(workspace_id, select_cases(prepared, (), support["case_ids"]))


@dataclass(frozen=True)
class ComparisonReply:
    """A contract message, as the JSON it is sent as, and its HTTP status."""

    status: int
    body: dict


class Comparisons:
    """The comparison operations over the workspaces and preparations of the import operations."""

    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def compare_groups(self, body: bytes) -> ComparisonReply:
        return self._answering(COMPARE_GROUPS, body, GroupComparisonRequest)

    def compare_periods(self, body: bytes) -> ComparisonReply:
        return self._answering(COMPARE_PERIODS, body, PeriodComparisonRequest)

    def _answering(self, operation: str, body: bytes, model: type[BaseModel]) -> ComparisonReply:
        parsed = _parse(body, model, operation)
        if isinstance(parsed, ComparisonRefusal):
            return _sent_refusal(parsed)
        try:
            return self._compare(operation, parsed)
        except Exception:
            logger.exception("The %s operation failed unexpectedly", operation)
            return _refused(
                operation,
                "computation_failed",
                "The answer could not be computed. Try again; if it fails again, the application needs to be repaired.",
                parsed,
            )

    def _compare(self, operation: str, given: dict) -> ComparisonReply:
        found = self._imports.prepared(given["workspace_id"], given["identity"]["preparation_id"])
        if isinstance(found, Problem):
            code = found.code if found.code in STATUS else "workspace_unavailable"
            return _refused(operation, code, found.message, given, found.field)
        if isinstance(found, PackageRefusal):
            logger.error("A kept preparation could not be prepared again: %s", found.code)
            return _refused(
                operation,
                "preparation_unavailable",
                "This preparation cannot be prepared again from its stored source. "
                "Confirm the interpretation of the source again.",
                given,
                "identity.preparation_id",
            )
        prepared = found[0]
        answer = compared(
            prepared,
            "group" if operation == COMPARE_GROUPS else "period",
            given["identity"],
            given["parent_case_ids"],
            given["context_column_index"],
            given["context_policy"],
            given["definition"],
        )
        if isinstance(answer, PackageRefusal):
            code = answer.code if answer.code in STATUS else "computation_failed"
            if code != answer.code:
                logger.error("The analytics package refused with a code the contract does not name: %s", answer.code)
            return _refused(operation, code, answer.message, given, answer.field)
        message_type = "group_comparison_answer" if operation == COMPARE_GROUPS else "period_comparison_answer"
        body = _envelope(message_type, given) | answer
        model = GroupComparisonAnswer if operation == COMPARE_GROUPS else PeriodComparisonAnswer
        _checked(model, body)
        keep_comparison(self._imports.selections, given["workspace_id"], prepared, answer)
        return ComparisonReply(200, body)


def _parse(body: bytes, model: type[BaseModel], operation: str) -> dict | ComparisonRefusal:
    message = read_object(body)
    if isinstance(message, str):
        return _refusal(operation, "invalid_request", message, {})
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return _refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version {SCHEMA_VERSION}.",
            message,
            "schema_version",
        )
    read = read_strictly(message, model, _ALTERNATIVES)
    failures = read if isinstance(read, list) else _beyond_the_models(message)
    if not failures:
        return message
    failure = min(failures, key=lambda item: (_rank(item) != "invalid_request", len(item.path)))
    code = _rank(failure)
    where = failure.field or "the request"
    return _refusal(operation, code, f"The request is not valid at {where}: {failure.reason}.", message, failure.field or None)


def _beyond_the_models(message: dict) -> list[Failure]:
    failures = repeated_failures(message, _UNIQUE)
    failures += version_failures(message, [("identity", "implementation_version")])
    definition = message.get("definition")
    for role in ("target", "reference"):
        period = definition.get(role) if isinstance(definition, dict) else None
        window = period.get("window") if isinstance(period, dict) else None
        if isinstance(window, dict) and window.get("timestamp_kind") == "utc_instant":
            failures += instant_failures(
                message, [("definition", role, "window", bound) for bound in ("start_inclusive", "end_exclusive")]
            )
    return failures


def _rank(failure: Failure) -> str:
    if failure.path and failure.path[-1] in ("context_policy", "anchor_policy"):
        return "unsupported_policy"
    if "predicates" in failure.path:
        return "invalid_predicate"
    if failure.path[:1] == ("definition",):
        return "invalid_parameter"
    return "invalid_request"


def _checked(model: type[BaseModel], body: dict) -> None:
    try:
        model.model_validate(body)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {body.get('message_type')} answer is outside the contract at "
            f"{'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
        "workspace_id": given["workspace_id"],
    }


def _refusal(
    operation: str, code: str, message: str, given: Mapping[str, object], field: str | None = None
) -> ComparisonRefusal:
    echo = import_echo(given)
    return ComparisonRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="comparison_refusal",
        request_id=echo["request_id"],
        query_revision=echo["query_revision"],
        workspace_id=echo["workspace_id"],
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    )


def _refused(
    operation: str, code: str, message: str, given: Mapping[str, object], field: str | None = None
) -> ComparisonReply:
    return _sent_refusal(_refusal(operation, code, message, given, field))


def _sent_refusal(refusal: ComparisonRefusal) -> ComparisonReply:
    return ComparisonReply(STATUS[refusal.code], refusal.model_dump(mode="json"))
