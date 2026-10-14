"""Selecting whole incidents of a preparation, and the map of a selected population.

Both operations of the selection contract work on a preparation kept in a
workspace. Selecting cases freezes a parent (every incident of the
preparation, or the incidents the request names) and evaluates every
predicate over the whole parent; the answer carries kept, removed and
unevaluable incidents for the conjunction and for each predicate on its own.
The map of a population is the supplied graph of exactly its incidents.

The meaning of every number, membership and identity is the analytics
package's: this module finds the workspace and the prepared snapshot, hands
the request's predicates to ``select_cases`` and ``build_process_graph``,
keeps each answered selection under its population identity, and turns what
the package refuses into the contract's typed refusals.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.preparation import PreparedData
from wise_platform_analytics.process_graph import build_process_graph
from wise_platform_analytics.selection import (
    ContainsActivity,
    CaseIdIn,
    CaseStartInWindow,
    OpeningAttributeIn,
    RecordAttributeIn,
    ObservedSpanAtLeast,
    MaxRawGapAtLeast,
    DirectlyFollows,
    EndsWithActivity,
    OpeningAttributeEquals,
    Predicate,
    SelectionError,
    SelectionResult,
    StartsWithActivity,
    select_cases,
)

from .boundary import SCHEMA_VERSION
from .generated.selection import (
    ProcessGraphAnswer,
    ProcessGraphRequest,
    SelectCasesRequest,
    SelectionAnswer,
    SelectionRefusal,
)
from .import_boundary import import_echo
from .graph_lag_boundary import validate_graph_lag_totals
from .imports import Imports
from .selection_boundary import STATUS, parse_selection_body, selection_refusal
from .workspace import Problem, Workspace

logger = logging.getLogger(__name__)

SELECT_CASES = "select_cases"
# The place of the request a refusal of the package is about, where there is one.
_FIELDS = {
    "invalid_predicate": "predicates",
    "unmapped_context_column": "predicates",
    "invalid_parent": "parent_case_ids",
    "unknown_case": "parent_case_ids",
}
PROCESS_GRAPH = "process_graph"


@dataclass(frozen=True)
class SelectionReply:
    """A contract message, as the JSON it is sent as, and its HTTP status."""

    status: int
    body: dict


class Selections:
    """The selection operations over the workspaces and preparations of the import operations."""

    def __init__(self, imports: Imports) -> None:
        self._imports = imports
        self._registry = imports.selections

    def select_cases(self, body: bytes) -> SelectionReply:
        return _answering(SELECT_CASES, parse_selection_body(body, SelectCasesRequest, SELECT_CASES), self._select)

    def process_graph(self, body: bytes) -> SelectionReply:
        return _answering(PROCESS_GRAPH, parse_selection_body(body, ProcessGraphRequest, PROCESS_GRAPH), self._graph)

    # Use cases ----------------------------------------------------------------------------

    def _select(self, request: SelectCasesRequest, given: dict) -> SelectionReply:
        found = self._prepared(SELECT_CASES, given)
        if isinstance(found, SelectionReply):
            return found
        workspace, prepared = found
        if dict(given["identity"]) != prepared.identity_dict():
            return _refused(
                SELECT_CASES,
                "identity_mismatch",
                "Incidents are selected from the population of a preparation as it was opened; this identity "
                "is not that population. Open the incidents of the preparation again.",
                given,
                "identity",
            )
        predicates = [package_predicate(item) for item in given["predicates"]]
        parent_ids = given["parent_case_ids"]
        try:
            selection = select_cases(prepared, predicates, parent_ids, active_step_count=given.get("active_step_count"))
            parent = selection if not predicates else select_cases(prepared, (), parent_ids)
        except SelectionError as error:
            return _package_error(SELECT_CASES, error, given)
        self._registry.keep(workspace.workspace_id, parent)
        self._registry.keep(workspace.workspace_id, selection)
        answered = selection.to_dict()
        return _answer(
            SelectionAnswer,
            _envelope("selection_answer", given)
            | {
                "identity": answered["identity"],
                "parent_identity": parent.identity_dict(),
                "parent": answered["parent"],
                "kept": answered["kept"],
                "removed": answered["removed"],
                "unevaluable": answered["unevaluable"],
                "predicate_results": answered["predicate_results"],
                "active_step_count": answered["active_step_count"],
                "step_results": answered["step_results"],
            },
        )

    def _graph(self, request: ProcessGraphRequest, given: dict) -> SelectionReply:
        found = self._prepared(PROCESS_GRAPH, given)
        if isinstance(found, SelectionReply):
            return found
        workspace, prepared = found
        identity = dict(given["identity"])
        base = prepared.identity_dict()
        selected_ids: tuple[str, ...] | None = None
        if identity["population_id"] == base["population_id"]:
            expected: Mapping[str, object] = base
        else:
            selection = self._registry.find(workspace.workspace_id, identity["population_id"])
            if selection is None:
                return _refused(
                    PROCESS_GRAPH,
                    "population_unavailable",
                    "This selected population is not known to the application any more. Select the incidents again.",
                    given,
                    "identity.population_id",
                )
            expected = selection.identity_dict()
            selected_ids = selection.kept.case_ids
        if identity != dict(expected):
            return _refused(
                PROCESS_GRAPH,
                "identity_mismatch",
                "The identity does not match the population it names. Select the incidents again.",
                given,
                "identity",
            )
        try:
            graph = build_process_graph(prepared, selected_ids)
        except SelectionError as error:
            return _package_error(PROCESS_GRAPH, error, given)
        return _answer(
            ProcessGraphAnswer, _envelope("process_graph_answer", given) | {"identity": identity, "graph": graph}
        )

    # Workspaces and prepared snapshots -----------------------------------------------------

    def _prepared(self, operation: str, given: dict) -> tuple[Workspace, PreparedData] | SelectionReply:
        workspace = self._imports.opened_workspace(given["workspace_id"])
        if isinstance(workspace, Problem):
            return _refused(operation, _code(workspace.code), workspace.message, given, workspace.field)
        found = self._imports.prepared_snapshot(
            workspace, given["identity"]["preparation_id"], "identity.preparation_id"
        )
        if isinstance(found, Problem):
            return _refused(operation, _code(found.code), found.message, given, found.field)
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


def package_predicate(given: Mapping[str, object]) -> Predicate:
    """The package's predicate for a predicate of a validated request."""
    kind, negate = given["kind"], given["negate"]
    if kind == "case_id_in":
        return CaseIdIn(tuple(given["case_ids"]), negate)
    if kind == "case_start_in_window":
        window = given["window"]
        return CaseStartInWindow(window["timestamp_kind"], window["start_inclusive"], window["end_exclusive"], negate)
    if kind in ("opening_attribute_in", "record_attribute_in"):
        constructor = OpeningAttributeIn if kind == "opening_attribute_in" else RecordAttributeIn
        return constructor(given["column_index"], tuple(given["values"]), negate)
    if kind in ("observed_span_at_least", "max_raw_gap_at_least"):
        constructor = ObservedSpanAtLeast if kind == "observed_span_at_least" else MaxRawGapAtLeast
        return constructor(given["hours"], negate)
    if kind == "contains_activity":
        return ContainsActivity(str(given["activity"]), negate)
    if kind == "starts_with_activity":
        return StartsWithActivity(str(given["activity"]), negate)
    if kind == "ends_with_activity":
        return EndsWithActivity(str(given["activity"]), negate)
    if kind == "directly_follows":
        return DirectlyFollows(str(given["source_activity"]), str(given["target_activity"]), negate)
    value = given["value"]
    column = given["column_index"]
    assert kind == "opening_attribute_equals" and type(column) is int
    return OpeningAttributeEquals(column, None if value is None else str(value), negate)


def _code(code: str) -> str:
    """A workspace problem in the selection contract's terms, which has no separate code for a folder."""
    return code if code in STATUS else "workspace_unavailable"


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
        "workspace_id": given["workspace_id"],
    }


def _answering(
    operation: str,
    parsed: tuple[BaseModel, dict] | SelectionRefusal,
    answer: Callable[[BaseModel, dict], SelectionReply],
) -> SelectionReply:
    if isinstance(parsed, SelectionRefusal):
        return _sent_refusal(parsed)
    request, given = parsed
    try:
        return answer(request, given)
    except Exception:
        logger.exception("The %s operation failed unexpectedly", operation)
        return _refused(
            operation,
            "computation_failed",
            "The answer could not be computed. Try again; if it fails again, the application needs to be repaired.",
            given,
        )


def _answer(model: type[BaseModel], body: dict) -> SelectionReply:
    """Check an answer against its generated model and send it with its own values."""
    try:
        model.model_validate(body)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {body.get('message_type')} answer is outside the contract at "
            f"{'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None
    if body.get("message_type") == "process_graph_answer":
        validate_graph_lag_totals(body["graph"])
    return SelectionReply(200, body)


def _package_error(operation: str, error: SelectionError, given: Mapping[str, object]) -> SelectionReply:
    code = error.code if error.code in STATUS else "computation_failed"
    if code != error.code:
        logger.error("The analytics package refused with a code the contract does not name: %s", error.code)
    return _refused(operation, code, str(error) or "The selection cannot be evaluated.", given, getattr(error, "field", None) or _FIELDS.get(code))


def _refused(
    operation: str, code: str, message: str, given: Mapping[str, object], field: str | None = None
) -> SelectionReply:
    return _sent_refusal(selection_refusal(operation, code, message, echo=import_echo(given), field=field))


def _sent_refusal(refusal: SelectionRefusal) -> SelectionReply:
    return SelectionReply(STATUS[refusal.code], refusal.model_dump(mode="json"))
