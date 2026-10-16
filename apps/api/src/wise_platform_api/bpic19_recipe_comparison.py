"""Persist explicit same-parent recipe pairs through the registered services."""
from __future__ import annotations

import json
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from wise_platform_analytics.preparation import content_identity

from .boundary import first_difference, read_object
from .bpic19_cohorts import Bpic19Cohorts
from .bpic19_operators import Bpic19Operators
from .generated.bpic19_recipe_comparison import Bpic19RecipeComparisonRequest, Bpic19RecipeComparisonAnswer, Bpic19RecipeComparisonRefusal
from .import_boundary import import_echo
from .imports import Imports, ImportReply

logger = logging.getLogger(__name__)


def _refused(given, code, message, field=None):
    body = {"schema_version": 1, "message_type": "bpic19_recipe_comparison_refusal", **import_echo(given),
            "operation": "bpic19_recipe_comparison", "code": code, "message": message, "field": field,
            "retryable": code in {"computation_failed", "source_unavailable", "population_unavailable", "workspace_unavailable"}}
    Bpic19RecipeComparisonRefusal.model_validate_json(json.dumps(body), strict=True)
    return ImportReply(400 if code == "invalid_request" else 500 if code == "computation_failed" else 422, body)


class Bpic19RecipeComparisons:
    def __init__(self, imports: Imports):
        self.operators = Bpic19Operators(imports)
        self.cohorts = Bpic19Cohorts(imports)

    def compare(self, body: bytes) -> ImportReply:
        given = read_object(body)
        if isinstance(given, str): return _refused({}, "invalid_request", given)
        if type(given.get("schema_version")) is int and given["schema_version"] != 1:
            return _refused(given, "unsupported_schema", "Only recipe comparison schema version1 is registered.", "schema_version")
        try:
            parsed = Bpic19RecipeComparisonRequest.model_validate_json(json.dumps(given, allow_nan=False), strict=True)
            difference = first_difference(given, parsed.model_dump(mode="json", exclude_unset=True))
            if difference is not None: return _refused(given, "invalid_request", "A supplied JSON type changed.", ".".join(map(str, difference)))
        except (ValidationError, ValueError, TypeError):
            return _refused(given, "invalid_request", "The recipe pair does not match its closed registered contract.")
        query = given["query"]
        operator = query["policy_id"] == "bpic19.ordinal_fifo_comparison.v1"
        names = ("ordinal", "fifo") if operator else ("target", "reference")
        replies = []
        try:
            for role in names:
                reference = query[role]
                inner = {"schema_version": 1, "message_type": "bpic19_operator_request" if operator else "bpic19_cohorts_request",
                         "request_id": "bpic19-compared-" + role, "query_revision": 1,
                         "workspace_id": given["workspace_id"], "identity": given["identity"], "query": reference["query"]}
                service = self.operators.operators if operator else self.cohorts.cohorts
                reply = service(json.dumps(inner, allow_nan=False).encode())
                if reply.status != 200: return _refused(given, "invalid_parameter", "A compared recipe was refused: " + reply.body["message"], "query." + role)
                answer = reply.body
                if answer["identity"] != given["identity"] or answer["definition_id"] != reference["definition_id"]:
                    return _refused(given, "identity_mismatch", "A comparison reference differs from its replayed source/population/definition.", "query." + role)
                if operator and answer["operation"] != "bpic19_" + role:
                    return _refused(given, "identity_mismatch", "The explicit ordinal/FIFO role names another operator.", "query." + role)
                replies.append(answer)
            first, second = replies
            if first["parent_identity"] != second["parent_identity"]:
                return _refused(given, "identity_mismatch", "Both compared definitions need the same frozen parent.", "query")
            definition = {"identity": given["identity"], "query": query}
            did = content_identity("bpic19-recipe-comparison", definition)
            comparison = {"policy_id": query["policy_id"], "definition_id": did, "first": first, "second": second,
                          "completion_transitions": [], "support_differences": []}
            if not operator:
                states = ("observed_closed", "open_recorded", "unknown", "outside_inclusion")
                memberships = []
                for answer in replies:
                    groups = {group["state"]: set(group["case_ids"]) for group in answer["cohorts"]["completion_groups"]}
                    inclusion = answer["cohorts"]["inclusion"]
                    groups["outside_inclusion"] = set(inclusion["excluded"]["case_ids"]) | set(inclusion["unknown"]["case_ids"])
                    memberships.append(groups)
                for left in states:
                    for right in states:
                        ids = sorted(memberships[0][left] & memberships[1][right])
                        comparison["completion_transitions"].append({"target_state": left, "reference_state": right, "case_count": len(ids), "case_ids": ids})
                for support, field in (("included", "inclusion"), ("retained", "retention")):
                    left, right = (set(answer["cohorts"][field]["retained"]["case_ids"]) for answer in replies)
                    comparison["support_differences"].append({"support": support, "both": sorted(left & right), "target_only": sorted(left - right), "reference_only": sorted(right - left)})
            answer = {"schema_version": 1, "message_type": "bpic19_recipe_comparison_answer",
                      "operation": "bpic19_operator_comparison" if operator else "bpic19_cohort_comparison",
                      "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"],
                      "identity": given["identity"], "parent_identity": first["parent_identity"], "query": query,
                      "definition_id": did, "definition": definition, "comparison": comparison}
            checked = Bpic19RecipeComparisonAnswer.model_validate_json(json.dumps(answer, allow_nan=False), strict=True)
            if first_difference(answer, checked.model_dump(mode="json", exclude_unset=True), integers_as_numbers=True) is not None:
                raise ValueError("Comparison result changed at its contract boundary")
            return ImportReply(200, answer)
        except Exception:
            logger.exception("The explicit recipe pair could not be replayed")
            return _refused(given, "computation_failed", "The reviewed comparison could not be replayed. Retry; a repeated failure needs application repair.")


def register_bpic19_recipe_comparison_routes(app: FastAPI, imports: Imports):
    service = Bpic19RecipeComparisons(imports)

    @app.post("/api/investigations/bpic19-recipe-comparison")
    async def compare(request: Request):
        reply = await run_in_threadpool(service.compare, await request.body())
        return JSONResponse(reply.body, status_code=reply.status, headers={"Cache-Control": "no-store"})

    return service
