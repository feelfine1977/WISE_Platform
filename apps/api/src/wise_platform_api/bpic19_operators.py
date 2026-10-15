"""Strict HTTP seam for finite source-witnessed recorded-event operators."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import json
import logging
from threading import RLock

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from wise_platform_analytics.bpic19_operators import (
    POLICY_ID,
    evaluate_operator_case,
    operator_population,
)
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import content_identity

from .boundary import read_object
from .generated import bpic19_operators as generated
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .strict_reading import alternatives_of, read_strictly, version_failures
from .workspace import Problem

logger = logging.getLogger(__name__)
_ALTERNATIVES = alternatives_of(generated)
_UNIQUE = {
    "record_row_ids",
    "unmatched_row_ids",
    "included_row_ids",
    "excluded_row_ids",
    "unknown_row_ids",
    "row_ids",
    "activation_row_ids",
    "response_row_ids",
    "candidate_row_ids",
    "selected_row_ids",
    "case_ids",
    "peak_case_ids",
    "activities",
    "target_activities",
    "cancellation_activities",
    "left_activities",
    "right_activities",
    "activation_activities",
    "response_activities",
}


@dataclass(frozen=True)
class Bpic19OperatorReply:
    status: int
    body: dict


def _repeats(value: object) -> bool:
    if isinstance(value, dict):
        return any(
            (name in _UNIQUE and isinstance(item, list) and len(set(item)) != len(item))
            or _repeats(item)
            for name, item in value.items()
        )
    return isinstance(value, list) and any(_repeats(item) for item in value)


def _refused(
    given: dict,
    code: str,
    message: str,
    field: str | None = None,
    *,
    method_context: dict | None = None,
) -> Bpic19OperatorReply:
    status = (
        400
        if code
        in {
            "invalid_request",
            "unsupported_schema",
            "unsupported_policy",
            "invalid_parameter",
        }
        else (
            404
            if code
            in {
                "workspace_unavailable",
                "source_unavailable",
                "preparation_unavailable",
                "population_unavailable",
            }
            else (
                403
                if code == "workspace_not_writable"
                else 500 if code == "computation_failed" else 409
            )
        )
    )
    body = {
        "schema_version": 1,
        "message_type": "bpic19_operator_refusal",
        **import_echo(given),
        "operation": "bpic19_operators",
        "code": code,
        "message": message,
        "field": field,
        "retryable": code
        in {
            "computation_failed",
            "workspace_unavailable",
            "source_unavailable",
            "preparation_unavailable",
            "population_unavailable",
        },
    }
    if method_context is not None:
        body["method_context"] = method_context
    if isinstance(
        read_strictly(body, generated.Bpic19OperatorRefusal, _ALTERNATIVES), list
    ):
        raise ValueError("Operator refusal violates its contract")
    return Bpic19OperatorReply(status, body)


def _checked_answer(body: dict) -> Bpic19OperatorReply:
    if isinstance(
        read_strictly(body, generated.Bpic19OperatorAnswer, _ALTERNATIVES), list
    ) or _repeats(body):
        raise ValueError("Operator answer violates its contract")
    if version_failures(
        body,
        (
            ("identity", "implementation_version"),
            ("parent_identity", "implementation_version"),
        ),
    ):
        raise ValueError("Operator answer version is invalid")
    if body["definition_id"] != body["definition"]["definition_id"]:
        raise ValueError("Definition receipt does not agree")
    if (
        body["definition"]["recipe"] != body["query"]["recipe"]
        or body["definition"]["roles"] != body["query"]["roles"]
    ):
        raise ValueError("The answer does not echo its reviewed meaning")
    recipe = body["query"]["recipe"]
    operation = "bpic19_" + recipe["kind"] if recipe else "bpic19_catalogue"
    if body["operation"] != operation:
        raise ValueError("The operation does not identify its finite recipe")
    if (
        recipe
        and sum(body["summary"]["case_state_counts"].values())
        != body["population_case_count"]
    ):
        raise ValueError("Case states do not partition the population")
    if len({case["case_id"] for case in body["cases"]}) != len(body["cases"]):
        raise ValueError("A case repeats in its page")
    for group in body["selection_groups"]:
        if group["case_count"] != len(group["case_ids"]):
            raise ValueError("Group support disagrees with membership")
    return Bpic19OperatorReply(200, body)


class Bpic19Operators:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports
        self._summaries: OrderedDict[str, dict] = OrderedDict()
        self._lock = RLock()

    def operators(self, body: bytes) -> Bpic19OperatorReply:
        given = read_object(body)
        if isinstance(given, str):
            return _refused({}, "invalid_request", given)
        if type(given.get("schema_version")) is int and given["schema_version"] != 1:
            return _refused(
                given,
                "unsupported_schema",
                "Only operator schema version 1 is admitted.",
                "schema_version",
            )
        query = given.get("query")
        if (
            isinstance(query, dict)
            and isinstance(query.get("policy_id"), str)
            and query["policy_id"] != POLICY_ID
        ):
            return _refused(
                given,
                "unsupported_policy",
                "Choose an admitted finite recorded-event recipe.",
                "query.policy_id",
            )
        checked = read_strictly(given, generated.Bpic19OperatorRequest, _ALTERNATIVES)
        if isinstance(checked, list):
            return _refused(
                given,
                "invalid_request",
                "The operator request does not match its contract: "
                + checked[0].reason,
                checked[0].field,
            )
        # The generator represents an omitted property with a nullable default;
        # the closed wire contract admits omission, never explicit null.
        if "intent" in given and given["intent"] is None:
            return _refused(
                given,
                "invalid_request",
                "Choose an admitted operator intent.",
                "intent",
            )
        if _repeats(given):
            return _refused(
                given,
                "invalid_request",
                "Activity label sets must not repeat labels.",
                "query.recipe",
            )
        failures = version_failures(given, (("identity", "implementation_version"),))
        if failures:
            return _refused(
                given, "invalid_request", failures[0].reason, failures[0].field
            )
        if given.get("intent") == "normative_admission" and (
            given["query"]["recipe"] is None
            or given["query"]["recipe"]["kind"] != "rule"
        ):
            return _refused(
                given,
                "invalid_request",
                "Normative admission is only defined for a recorded-event rule.",
                "query.recipe",
            )
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return _refused(given, resolved.code, resolved.message, resolved.field)
            prepared, population = resolved
            query = given["query"]
            key = json.dumps(
                {
                    "workspace_id": given["workspace_id"],
                    "identity": population.identity,
                    "parent_identity": population.parent_identity,
                    "query": {
                        name: value
                        for name, value in query.items()
                        if name not in {"offset", "limit"}
                    },
                },
                sort_keys=True,
            )
            with self._lock:
                cached = self._summaries.get(key)
                if cached is not None:
                    self._summaries.move_to_end(key)
            if cached is None:
                result = operator_population(
                    prepared,
                    population.case_ids,
                    query["roles"],
                    query["recipe"],
                    query["offset"],
                    query["limit"],
                )
                if isinstance(result, ImportRefusal):
                    return _refused(given, result.code, result.message, result.field)
                result["result_id"] = content_identity(
                    "bpic19-operator-result",
                    {
                        "identity": population.identity,
                        "parent_identity": population.parent_identity,
                        "definition_id": result["definition_id"],
                        "case_ids": population.case_ids,
                    },
                )
                cached = {
                    name: value
                    for name, value in result.items()
                    if name not in {"cases", "offset", "limit", "next_offset"}
                }
                with self._lock:
                    self._summaries[key] = cached
                    while len(self._summaries) > 2:
                        self._summaries.popitem(last=False)
            else:
                definition = cached["definition"]
                recipe = definition["recipe"]
                cases = (
                    []
                    if recipe is None
                    else [
                        evaluate_operator_case(
                            prepared,
                            case_id,
                            recipe,
                            definition["roles"],
                            definition["definition_id"],
                        )
                        for case_id in population.case_ids[
                            query["offset"] : query["offset"] + query["limit"]
                        ]
                    ]
                )
                result = {
                    **cached,
                    "cases": cases,
                    "offset": query["offset"],
                    "limit": query["limit"],
                    "next_offset": (
                        query["offset"] + query["limit"]
                        if recipe is not None
                        and query["offset"] + query["limit"] < len(population.case_ids)
                        else None
                    ),
                }
            if given.get("intent") == "normative_admission":
                # This finite descriptive rule family has no admitted Method
                # binding. Native installation is a separate concern; other
                # actual Method policies must keep their own admission paths.
                return _refused(
                    given,
                    "method_binding_unavailable",
                    "This recorded-event rule has no admitted actual Method binding for normative grading. Its descriptive result and complete original histories remain usable.",
                    "intent",
                    method_context={
                        "intent": "normative_admission",
                        "identity": population.identity,
                        "query": query,
                        "definition_id": result["definition_id"],
                    },
                )
            return _checked_answer(
                {
                    "schema_version": 1,
                    "message_type": "bpic19_operator_answer",
                    "request_id": given["request_id"],
                    "query_revision": given["query_revision"],
                    "workspace_id": given["workspace_id"],
                    "identity": population.identity,
                    "parent_identity": population.parent_identity,
                    "query": query,
                    **result,
                }
            )
        except Exception:
            logger.exception(
                "The declared recorded-event operator could not be computed"
            )
            return _refused(
                given,
                "computation_failed",
                "This recorded-event answer could not be computed. Retry; repeated failure needs application repair.",
            )


def register_bpic19_operator_routes(app: FastAPI, imports: Imports) -> Bpic19Operators:
    service = Bpic19Operators(imports)

    @app.post("/api/investigations/bpic19-operators")
    async def operators(request: Request) -> JSONResponse:
        reply = await run_in_threadpool(service.operators, await request.body())
        return JSONResponse(reply.body, status_code=reply.status)

    return service
