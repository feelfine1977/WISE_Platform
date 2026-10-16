"""Registered BPIC19 interval distribution comparison boundary, ready for the shared immutable pipeline."""
from __future__ import annotations

import json
import logging
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from wise_platform_analytics.bpic19_interval_comparison import compare_intervals
from wise_platform_analytics.mapping import ImportRefusal

from .boundary import first_difference, read_object
from .generated.bpic19_interval_comparison import Bpic19IntervalComparisonAnswer, Bpic19IntervalComparisonRefusal, Bpic19IntervalComparisonRequest
from .import_boundary import import_echo
from .imports import ImportReply, Imports
from .population_views import resolve_population
from .workspace import Problem

logger = logging.getLogger(__name__)


def _refused(given, code, message, field=None):
    allowed = {"invalid_request", "unsupported_schema", "unsupported_policy", "invalid_parameter", "workspace_unavailable", "workspace_not_writable", "workspace_incompatible", "source_unavailable", "preparation_unavailable", "identity_mismatch", "population_unavailable", "invalid_parent", "unknown_case", "computation_failed"}
    if code not in allowed: code = "computation_failed"
    status = 400 if code == "invalid_request" else 422 if code in {"unsupported_schema", "unsupported_policy", "invalid_parameter", "invalid_parent", "unknown_case"} else 500 if code == "computation_failed" else 409
    body = {"schema_version": 1, "message_type": "bpic19_interval_comparison_refusal", **import_echo(given),
            "operation": "bpic19_interval_comparison", "code": code, "message": message, "field": field,
            "retryable": code in {"computation_failed", "workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable"}}
    Bpic19IntervalComparisonRefusal.model_validate_json(json.dumps(body), strict=True)
    return ImportReply(status, body)


class Bpic19IntervalComparisons:
    def __init__(self, imports: Imports):
        self._imports = imports

    def compare(self, body: bytes) -> ImportReply:
        given = read_object(body)
        if isinstance(given, str): return _refused({}, "invalid_request", given)
        if type(given.get("schema_version")) is int and given["schema_version"] != 1:
            return _refused(given, "unsupported_schema", "Only interval comparison schema version 1 is registered.", "schema_version")
        try:
            parsed = Bpic19IntervalComparisonRequest.model_validate_json(json.dumps(given, allow_nan=False), strict=True)
            difference = first_difference(given, parsed.model_dump(mode="json", exclude_unset=True))
            if difference is not None:
                return _refused(given, "invalid_request", "A field has a different JSON type.", ".".join(map(str, difference)))
            if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", given["identity"]["implementation_version"]):
                return _refused(given, "invalid_request", "Implementation versions use ASCII digits.", "identity.implementation_version")
        except (ValidationError, ValueError, TypeError) as error:
            field = ".".join(map(str, error.errors()[0]["loc"])) if isinstance(error, ValidationError) else None
            return _refused(given, "invalid_request", "The interval comparison request does not match its registered contract.", field)
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem): return _refused(given, resolved.code, resolved.message, resolved.field)
            prepared, population = resolved
            result = compare_intervals(prepared, given["query"], population.case_ids)
            if isinstance(result, ImportRefusal): return _refused(given, result.code, result.message, result.field)
            answer = {"schema_version": 1, "message_type": "bpic19_interval_comparison_answer", "operation": "bpic19_interval_comparison",
                      "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"],
                      "identity": population.identity, "parent_identity": population.parent_identity,
                      "query": given["query"], "definition_id": result["definition_id"], "definition": result["definition"], "comparison": result}
            checked = Bpic19IntervalComparisonAnswer.model_validate_json(json.dumps(answer, allow_nan=False), strict=True)
            if first_difference(answer, checked.model_dump(mode="json", exclude_unset=True), integers_as_numbers=True) is not None:
                raise ValueError("Interval comparison contract changed supplied values")
            return ImportReply(200, answer)
        except Exception:
            logger.exception("The interval comparison operation failed")
            return _refused(given, "computation_failed", "The interval comparison could not be computed. Retry; repeated failures need application repair.")


def register_bpic19_interval_comparison_routes(app: FastAPI, imports: Imports) -> Bpic19IntervalComparisons:
    """Explicit integration hook; does not replace the app or persistence registries."""
    service = Bpic19IntervalComparisons(imports)

    @app.post("/api/investigations/bpic19-interval-comparison")
    async def bpic19_interval_comparison(request: Request):
        reply = await run_in_threadpool(service.compare, await request.body())
        return JSONResponse(reply.body, status_code=reply.status, headers={"Cache-Control": "no-store"})

    return service
