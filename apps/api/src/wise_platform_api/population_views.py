"""The opening context and the variants of a population of a prepared source in a workspace.

A request names a workspace and the full identity of a population: the parent population of a
preparation, or a selection made from it and held in the selection registry. The opening context
compares the population with the parent it was made from; for the parent itself both sides are the
parent. Every count, share, order and refusal reason comes from the analytics package; this module
finds the prepared snapshot and the population, adds the envelope, and checks each answer against
the generated model of the population-views contract before sending it with the package's own
values: read strictly as JSON, written back to the very same values, without an incident id twice
in a list the contract keeps unique, and with implementation versions in ASCII digits.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from wise_platform_analytics.mapping import ImportRefusal as PackageRefusal
from wise_platform_analytics.opening_context import opening_context
from wise_platform_analytics.preparation import PreparedData
from wise_platform_analytics.selection import select_cases
from wise_platform_analytics.variants import variants

from .boundary import SCHEMA_VERSION, first_difference, read_object
from .import_boundary import import_echo
from .imports import Imports
from .population_view_messages import (
    OPENING_CONTEXT,
    RETRYABLE,
    STATUS,
    UNIQUE,
    VARIANTS,
    VERSIONS,
    OpeningContextAnswer,
    OpeningContextRequest,
    PopulationViewRefusal,
    VariantsAnswer,
    VariantsRequest,
)
from .registry import SelectionRegistry
from .strict_reading import repeated_failures, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ViewReply:
    """A message, as the JSON it is sent as, and its HTTP status."""

    status: int
    body: dict


@dataclass(frozen=True)
class Population:
    """The incidents a request names, and the parent they were taken from."""

    identity: dict[str, str]
    case_ids: tuple[str, ...]
    parent_identity: dict[str, str]
    parent_ids: tuple[str, ...]


class PopulationViews:
    """The opening-context and variants operations over the preparations of open workspaces."""

    def __init__(self, imports: Imports) -> None:
        self._imports = imports
        self._selections: SelectionRegistry = imports.selections

    def opening_context(self, body: bytes) -> ViewReply:
        return _answering(OPENING_CONTEXT, _parse(body, OpeningContextRequest, OPENING_CONTEXT), self._opening_context)

    def variants(self, body: bytes) -> ViewReply:
        return _answering(VARIANTS, _parse(body, VariantsRequest, VARIANTS), self._variants)

    def _opening_context(self, given: dict) -> ViewReply:
        found = self._population(OPENING_CONTEXT, given)
        if isinstance(found, ViewReply):
            return found
        prepared, population = found
        answer = opening_context(prepared, population.case_ids, population.parent_ids)
        if isinstance(answer, PackageRefusal):
            return _from_package(OPENING_CONTEXT, answer, given)
        return _answer(
            OpeningContextAnswer,
            _envelope("opening_context_answer", given)
            | {
                "identity": population.identity,
                "parent_identity": population.parent_identity,
                "opening_context": answer.to_dict(),
            },
        )

    def _variants(self, given: dict) -> ViewReply:
        found = self._population(VARIANTS, given)
        if isinstance(found, ViewReply):
            return found
        prepared, population = found
        answer = variants(prepared, population.case_ids)
        if isinstance(answer, PackageRefusal):
            return _from_package(VARIANTS, answer, given)
        return _answer(
            VariantsAnswer,
            _envelope("variants_answer", given) | {"identity": population.identity, "variants": answer.to_dict()},
        )

    def _population(self, operation: str, given: dict) -> tuple[PreparedData, Population] | ViewReply:
        found = resolve_population(self._imports, given)
        if isinstance(found, Problem):
            return _refused(operation, found.code, found.message, given, found.field)
        return found


def resolve_population(imports: Imports, given: dict) -> tuple[PreparedData, Population] | Problem:
    """Read the exact checked source/selection and its frozen parent, without registration."""
    identity: Mapping[str, str] = given["identity"]
    found = imports.prepared(given["workspace_id"], identity["preparation_id"])
    if isinstance(found, Problem):
        return found
    if isinstance(found, PackageRefusal):
        return Problem("preparation_unavailable",
            "This preparation cannot be reproduced from the stored source. Confirm the interpretation of the source again.",
            "identity.preparation_id")
    prepared = found[0]
    base = prepared.identity_dict()
    everything = tuple(sorted(prepared.histories))
    if dict(identity) == base:
        return prepared, Population(base, everything, base, everything)
    different = next((name for name in base if name != "population_id" and identity[name] != base[name]), None)
    if different is not None:
        return Problem("identity_mismatch", "The identity does not belong to this preparation.", "identity." + different)
    selection = imports.selections.find(given["workspace_id"], identity["population_id"])
    if selection is None or selection.identity_dict() != dict(identity):
        return Problem("population_unavailable",
            "This population is neither the parent of the preparation nor a selection the application holds. Open the cases again or repeat the selection.",
            "identity.population_id")
    parent_ids = selection.parent.case_ids
    parent_identity = select_cases(prepared, (), parent_ids).identity_dict()
    return prepared, Population(selection.identity_dict(), selection.kept.case_ids, parent_identity, parent_ids)


def _parse(body: bytes, model: type[BaseModel], operation: str) -> dict | ViewReply:
    """The request's own values when it is exactly what its model allows, or the refusal for it."""
    message = read_object(body)
    if isinstance(message, str):
        return _refused(operation, "invalid_request", message, {})
    version = message.get("schema_version")
    if type(version) is int and version != SCHEMA_VERSION:
        return _refused(
            operation,
            "unsupported_schema",
            f"Schema version {version} is not supported; this application reads version {SCHEMA_VERSION}.",
            message,
            "schema_version",
        )
    try:
        parsed = model.model_validate_json(json.dumps(message, ensure_ascii=False, allow_nan=False), strict=True)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        path, reason = tuple(first["loc"]), first["msg"]
    else:
        path = first_difference(message, parsed.model_dump(mode="json", exclude_unset=True))
        reason = "the value has another JSON type than the request requires"
        if path is None:
            versions = version_failures(message, VERSIONS[message["message_type"]])
            if not versions:
                return message
            path, reason = versions[0].path, versions[0].reason
    where = ".".join(str(part) for part in path)
    reason = reason[0].lower() + reason[1:] if reason else "it is not valid"
    return _refused(
        operation, "invalid_request", f"The request is not valid at {where or 'the request'}: {reason}.", message, where
    )


def _answering(operation: str, parsed: dict | ViewReply, answer: Callable[[dict], ViewReply]) -> ViewReply:
    if isinstance(parsed, ViewReply):
        return parsed
    try:
        return answer(parsed)
    except Exception:
        logger.exception("The %s operation failed unexpectedly", operation)
        return _refused(
            operation,
            "computation_failed",
            "The answer could not be computed. Try again; if it fails again, the application needs to be repaired.",
            parsed,
        )


def _envelope(message_type: str, given: Mapping[str, object]) -> dict[str, object]:
    return {
        "schema_version": SCHEMA_VERSION,
        "message_type": message_type,
        "request_id": given["request_id"],
        "query_revision": given["query_revision"],
        "workspace_id": given["workspace_id"],
    }


def _answer(model: type[BaseModel], body: dict) -> ViewReply:
    """Check an answer as strictly as a request and send it with its own values."""
    kind = body.get("message_type")
    try:
        parsed = model.model_validate_json(json.dumps(body, ensure_ascii=False, allow_nan=False), strict=True)
    except ValidationError as error:
        first = error.errors(include_url=False)[0]
        raise ValueError(
            f"A {kind} answer is outside its model at {'.'.join(str(part) for part in first['loc'])}: {first['msg']}"
        ) from None
    different = first_difference(body, parsed.model_dump(mode="json"), integers_as_numbers=True)
    if different is not None:
        raise ValueError(f"A {kind} answer has another JSON type at {'.'.join(str(part) for part in different)}")
    failures = repeated_failures(body, UNIQUE[kind]) + version_failures(body, VERSIONS[kind])
    if failures:
        raise ValueError(f"A {kind} answer is outside its contract at {failures[0].field}: {failures[0].reason}")
    return ViewReply(200, body)


def _refused(
    operation: str, code: str, message: str, given: Mapping[str, object], field: str | None = None
) -> ViewReply:
    if code not in STATUS:
        logger.error("A refusal with a code these operations do not name: %s", code)
        code = "computation_failed"
    echo = import_echo(given)
    refusal = PopulationViewRefusal(
        schema_version=SCHEMA_VERSION,
        message_type="population_view_refusal",
        request_id=echo["request_id"],
        query_revision=echo["query_revision"],
        workspace_id=echo["workspace_id"],
        operation=operation,
        code=code,
        message=message,
        field=field,
        retryable=code in RETRYABLE,
    )
    return ViewReply(STATUS[code], refusal.model_dump(mode="json"))


def _from_package(operation: str, refused: PackageRefusal, given: Mapping[str, object]) -> ViewReply:
    return _refused(operation, refused.code, refused.message, given, refused.field)
