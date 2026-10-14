"""Validation of requests against the saving contract, and its refusals.

A request becomes a generated model only when it is exactly what the saving
contract allows; ``strict_reading`` reads it. The source schema has conditions
the generated models do not carry, and they are enforced here:

* a new investigation names neither an investigation nor an expected
  revision, an update names both;
* no incident id, row id or parent id repeats where the contract says the
  items are unique;
* the bounds of a period on the UTC clock are instants written as the
  contract's pattern requires;
* an implementation version is written in ASCII digits.

The failing place decides the code: another whole schema version is
``unsupported_schema``; a context or anchor policy the contract does not know
is ``unsupported_policy``; everything else is ``invalid_request``. When
several places fail, any other place is named before a policy, and a shorter
place before a longer one.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TypeVar

from pydantic import BaseModel

from .boundary import SCHEMA_VERSION, read_object
from .generated import saving as saving_models
from .generated.saving import SaveInvestigationRequest1, SavingRefusal, Bpic19PipelineAction
from typing import get_args
from .import_boundary import import_echo
from .selection_boundary import predicate_wire_failures, _value_at
from .strict_reading import (
    Failure,
    alternatives_of,
    instant_failures,
    read_strictly,
    repeated_failures,
    version_failures,
)

RequestModel = TypeVar("RequestModel", bound=BaseModel)

SAVE = "save_investigation"
LIST_SAVED = "list_saved"
REOPEN = "reopen_investigation"
RECOVER_METADATA = "recover_investigation_metadata"

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "unsupported_action": 400,
    "unsupported_schema": 400,
    "unsupported_policy": 400,
    "invalid_parameter": 400,
    "workspace_unavailable": 404,
    "workspace_not_writable": 403,
    "source_unavailable": 404,
    "source_changed": 409,
    "preparation_unavailable": 404,
    "preparation_changed": 409,
    "identity_mismatch": 409,
    "selection_mismatch": 409,
    "comparison_unavailable": 422,
    "comparison_mismatch": 409,
    "invalid_bookmark": 422,
    "score_reference_unavailable": 404,
    "unsupported_score_reference": 422,
    "investigation_unavailable": 404,
    "revision_unavailable": 404,
    "revision_conflict": 409,
    "malformed_saved_revision": 422,
    "incompatible_saved_revision": 409,
    "publication_failed": 503,
    "computation_failed": 500,
    "artifact_unavailable": 409,
    "checksum_mismatch": 409,
}
RETRYABLE = frozenset({"workspace_unavailable", "publication_failed", "computation_failed"})
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

_ALTERNATIVES = alternatives_of(saving_models)
_POLICIES = frozenset({"context_policy", "anchor_policy"})
_UNIQUE = (
    ("selection_recipe", "parent_case_ids"),
    ("comparison", "parent_case_ids"),
    ("comparison", "definition", "target", "definition", "case_ids"),
    ("comparison", "definition", "reference", "definition", "case_ids"),
    ("bookmarks", "*", "row_ids"),
)
_VERSIONS = (
    ("base_identity", "implementation_version"),
    ("selection_identity", "implementation_version"),
    ("bookmarks", "*", "identity", "implementation_version"),
)


def saving_refusal(
    operation: str,
    code: str,
    message: str,
    *,
    echo: Mapping[str, object] | None = None,
    field: str | None = None,
    investigation_id: str | None = None,
    expected_revision_id: str | None = None,
    current_revision_id: str | None = None,
) -> SavingRefusal:
    """Build a saving refusal; a conflict names the investigation, the head expected and the actual head."""
    echo = echo or {}
    if code == "revision_conflict" and None in (investigation_id, expected_revision_id, current_revision_id):
        raise ValueError("A revision conflict names the investigation, the expected and the current revision.")
    conflict = (
        {
            "investigation_id": investigation_id,
            "expected_revision_id": expected_revision_id,
            "current_revision_id": current_revision_id,
        }
        if code == "revision_conflict"
        else {}
    )
    return SavingRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="saving_refusal",
        request_id=echo.get("request_id"),
        query_revision=echo.get("query_revision"),
        workspace_id=echo.get("workspace_id"),
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
        **conflict,
    )


def refusal_body(refusal: SavingRefusal) -> dict:
    """The JSON of a refusal: the conflict fields only where the contract names them."""
    return refusal.model_dump(mode="json", exclude_unset=True)


def parse_saving_body(
    body: bytes, model: type[RequestModel], operation: str
) -> tuple[RequestModel, dict] | SavingRefusal:
    """The request model of a JSON body with the body's own values, or the refusal for it."""
    message = read_object(body)
    if isinstance(message, str):
        return saving_refusal(operation, "invalid_request", message)
    echo = import_echo(message)
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return saving_refusal(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version {SCHEMA_VERSION}.",
            echo=echo,
            field="schema_version",
        )
    read = read_strictly(message, model, _ALTERNATIVES)
    pipeline = message.get("bpic19_pipeline")
    if isinstance(pipeline, dict) and isinstance(pipeline.get("actions"), list):
        registered = set(get_args(Bpic19PipelineAction.model_fields["operation"].annotation))
        for index, action in enumerate(pipeline["actions"]):
            if isinstance(action, dict) and isinstance(action.get("operation"), str) and action["operation"] not in registered:
                return saving_refusal(operation, "unsupported_action", "This pipeline action is not registered; supplied code is never executed.",
                                      echo=echo, field=f"bpic19_pipeline.actions.{index}.operation")
    failures = read if isinstance(read, list) else _beyond_the_models(message, model)
    if not failures:
        assert not isinstance(read, list)
        return read, message
    failure = min(failures, key=lambda item: (_is_policy(item, message), len(item.path)))
    code = "unsupported_policy" if _is_policy(failure, message) else "invalid_request"
    where = failure.field or "the request"
    text = (
        f"The policy at {where} is not supported: {failure.reason}."
        if code == "unsupported_policy"
        else f"The request is not valid at {where}: {failure.reason}."
    )
    return saving_refusal(operation, code, text, echo=echo, field=failure.field or None)


def _beyond_the_models(message: dict, model: type[BaseModel]) -> list[Failure]:
    if model is not SaveInvestigationRequest1:
        return []
    failures: list[Failure] = []
    named = [message.get("investigation_id") is not None, message.get("expected_revision_id") is not None]
    if named[0] != named[1]:
        missing = "expected_revision_id" if named[0] else "investigation_id"
        failures.append(
            Failure(
                (missing,),
                "an update names both the investigation and the revision it replaces; "
                "a new investigation names neither",
            )
        )
    predicate_paths = (("selection_recipe", "predicates"), ("comparison", "definition", "predicates"),
                       ("comparison", "definition", "target", "definition", "predicates"),
                       ("comparison", "definition", "reference", "definition", "predicates"))
    failures += predicate_wire_failures(message, predicate_paths)
    failures += repeated_failures(message, _UNIQUE)
    failures += version_failures(message, _VERSIONS)
    comparison = message.get("comparison")
    definition = comparison.get("definition") if isinstance(comparison, dict) else None
    if isinstance(comparison, dict) and comparison.get("kind") == "period" and isinstance(definition, dict):
        for role in ("target", "reference"):
            period = definition.get(role)
            window = period.get("window") if isinstance(period, dict) else None
            if isinstance(window, dict) and window.get("timestamp_kind") == "utc_instant":
                failures += instant_failures(
                    message,
                    [("comparison", "definition", role, "window", bound) for bound in ("start_inclusive", "end_exclusive")],
                )
    return failures


def _is_policy(failure: Failure, message: Mapping | None = None) -> bool:
    if failure.path and failure.path[-1] == "anchor_policy" and message is not None:
        predicate = _value_at(message, failure.path[:-1])
        if isinstance(predicate, Mapping) and predicate.get("kind") == "record_attribute_in":
            return False
    return bool(failure.path) and failure.path[-1] in _POLICIES
