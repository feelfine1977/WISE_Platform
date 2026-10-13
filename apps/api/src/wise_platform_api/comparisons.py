"""Comparing two groups of incidents, or the incidents started in two periods, of a preparation.

Both operations of the comparison contract work on a preparation kept in a
workspace and name its full identity. The parent is every incident of the
preparation, or the incidents the request lists (an empty list is no incident);
the two groups are taken from it by predicates, by literal incident ids, or as
the kept and removed sides of one selection, and two periods by the start of
each incident.

The meaning of every number, membership and identity is the analytics
package's: this module finds the workspace and the prepared snapshot, hands the
request's own values to ``compare_groups`` or ``compare_periods``, adds the
envelope, and turns what the package refuses into the contract's typed
refusals. The parent and both groups of an answer are kept in the selection
registry as selections without predicates over exactly their incidents, so the
map and the complete history of an incident can be asked for under their
identities.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.comparison import compare_groups, compare_periods
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.preparation import PreparedData
from wise_platform_analytics.selection import select_cases

from .boundary import SCHEMA_VERSION
from .comparison_boundary import STATUS, comparison_refusal, parse_comparison_body
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
from .workspace import Problem, Workspace

logger = logging.getLogger(__name__)

COMPARE_GROUPS = "compare_groups"
COMPARE_PERIODS = "compare_periods"

Compare = Callable[[PreparedData, Mapping, object, int, str, Mapping], "dict[str, object] | PackageRefusal"]


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
    """Keep the parent and both groups of a comparison as selections of exactly their incidents.

    A saved investigation that is opened again keeps its comparison this way, as the comparison
    operations do when they answer.
    """
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
        self._registry: SelectionRegistry = imports.selections

    def compare_groups(self, body: bytes) -> ComparisonReply:
        parsed = parse_comparison_body(body, GroupComparisonRequest, COMPARE_GROUPS)
        return self._answering(COMPARE_GROUPS, parsed, compare_groups, "group_comparison_answer", GroupComparisonAnswer)

    def compare_periods(self, body: bytes) -> ComparisonReply:
        parsed = parse_comparison_body(body, PeriodComparisonRequest, COMPARE_PERIODS)
        return self._answering(
            COMPARE_PERIODS, parsed, compare_periods, "period_comparison_answer", PeriodComparisonAnswer
        )

    def _answering(
        self,
        operation: str,
        parsed: tuple[BaseModel, dict] | ComparisonRefusal,
        compare: Compare,
        message_type: str,
        model: type[BaseModel],
    ) -> ComparisonReply:
        if isinstance(parsed, ComparisonRefusal):
            return _sent_refusal(parsed)
        _, given = parsed
        try:
            return self._compare(operation, given, compare, message_type, model)
        except Exception:
            logger.exception("The %s operation failed unexpectedly", operation)
            return _refused(
                operation,
                "computation_failed",
                "The comparison could not be computed. Try again; if it fails again, the application needs "
                "to be repaired.",
                given,
            )

    def _compare(
        self, operation: str, given: dict, compare: Compare, message_type: str, model: type[BaseModel]
    ) -> ComparisonReply:
        found = self._prepared(operation, given)
        if isinstance(found, ComparisonReply):
            return found
        workspace, prepared = found
        answered = compare(
            prepared,
            given["identity"],
            given["parent_case_ids"],
            given["context_column_index"],
            given["context_policy"],
            given["definition"],
        )
        if isinstance(answered, PackageRefusal):
            return _from_package(operation, answered, given)
        self._keep(workspace, prepared, answered)
        return _answer(model, _envelope(message_type, given) | answered)

    def _keep(self, workspace: Workspace, prepared: PreparedData, answered: Mapping[str, object]) -> None:
        """Keeps the parent and both groups, so that their maps and histories can be asked for."""
        populations = [(answered["parent"], answered["parent_identity"])]
        populations += [(answered[role]["included"], answered[role]["identity"]) for role in ("target", "reference")]
        for support, identity in populations:
            selection = select_cases(prepared, (), support["case_ids"])
            if selection.identity_dict() != identity:
                raise ValueError("A compared population has another identity when it is selected again.")
            self._registry.keep(workspace.workspace_id, selection)

    def _prepared(self, operation: str, given: dict) -> tuple[Workspace, PreparedData] | ComparisonReply:
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _refused(operation, _code(workspace.code), workspace.message, given, workspace.field)
        found = self._imports.prepared_snapshot(
            workspace, given["identity"]["preparation_id"], "identity.preparation_id"
        )
        if isinstance(found, Problem):
            field = f"identity.{found.field}" if found.field in ("source_id", "preparation_id") else found.field
            return _refused(operation, _code(found.code), found.message, given, field)
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
        return workspace, found[0]


def _code(code: str) -> str:
    """A workspace problem in the comparison contract's terms, which has no separate code for a folder."""
    return code if code in STATUS else "workspace_unavailable"


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
        "workspace_id": given["workspace_id"],
    }


def _answer(model: type[BaseModel], body: dict) -> ComparisonReply:
    """Check an answer against its generated model and send it with its own values."""
    try:
        model.model_validate(body)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {body.get('message_type')} answer is outside the contract at "
            f"{'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None
    return ComparisonReply(200, body)


def _from_package(operation: str, refused: PackageRefusal, given: Mapping[str, object]) -> ComparisonReply:
    code = refused.code if refused.code in STATUS else "computation_failed"
    if code != refused.code:
        logger.error("The analytics package refused with a code the contract does not name: %s", refused.code)
    return _refused(operation, code, refused.message or "The comparison cannot be evaluated.", given, refused.field)


def _refused(
    operation: str, code: str, message: str, given: Mapping[str, object], field: str | None = None
) -> ComparisonReply:
    return _sent_refusal(comparison_refusal(operation, code, message, echo=import_echo(given), field=field))


def _sent_refusal(refusal: ComparisonRefusal) -> ComparisonReply:
    return ComparisonReply(STATUS[refusal.code], refusal.model_dump(mode="json"))
