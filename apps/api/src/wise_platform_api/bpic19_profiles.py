"""Application boundary for a reviewed BPIC19 source/grain/purchasing-flow profile."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from pydantic import ValidationError
from wise_platform_analytics.bpic19_profiles import CATEGORY_LINEAGE_POLICY_ID, POLICY_ID, SOURCE_POLICY_ID, profile_bpic19, suggested_roles
from wise_platform_analytics.mapping import ImportRefusal

from .boundary import first_difference, read_object
from .generated.bpic19_profile import Bpic19ProfileAnswer, Bpic19ProfileRequest, Bpic19ProfileRefusal
from .import_boundary import import_echo
from .imports import Imports
from .population_views import resolve_population
from .workspace import Problem

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Bpic19ProfileReply:
    status: int
    body: dict


def _refused(given: dict, code: str, message: str, field: str | None = None) -> Bpic19ProfileReply:
    allowed = {"invalid_request", "unsupported_schema", "unsupported_policy", "invalid_parameter",
        "workspace_unavailable", "workspace_not_writable", "workspace_incompatible", "source_unavailable",
        "preparation_unavailable", "identity_mismatch", "population_unavailable", "invalid_parent", "unknown_case", "memory_unavailable", "computation_failed"}
    if code not in allowed: code = "computation_failed"
    status = 503 if code == "memory_unavailable" else 400 if code == "invalid_request" else 422 if code in {"unsupported_schema", "unsupported_policy", "invalid_parameter", "invalid_parent", "unknown_case"} else 500 if code == "computation_failed" else 409
    answer = {"schema_version": 1, "message_type": "bpic19_profile_refusal", **import_echo(given),
              "operation": "bpic19_profile", "code": code, "message": message, "field": field,
              "retryable": code in {"memory_unavailable", "computation_failed", "workspace_unavailable", "source_unavailable", "preparation_unavailable", "population_unavailable"}}
    Bpic19ProfileRefusal.model_validate_json(json.dumps(answer), strict=True)
    return Bpic19ProfileReply(status, answer)


class Bpic19Profiles:
    def __init__(self, imports: Imports):
        self._imports = imports

    def profile(self, body: bytes) -> Bpic19ProfileReply:
        given = read_object(body)
        if isinstance(given, str): return _refused({}, "invalid_request", given)
        if type(given.get("schema_version")) is int and given["schema_version"] != 1:
            return _refused(given, "unsupported_schema", "Only BPIC19 profile schema version 1 is supported.", "schema_version")
        if isinstance(given.get("query"), dict) and isinstance(given["query"].get("policy_id"), str) and given["query"]["policy_id"] != POLICY_ID:
            return _refused(given, "unsupported_policy", "Review the supported all-record case attribute policy.", "query.policy_id")
        source_query = given.get("query", {}).get("source_interpretation") if isinstance(given.get("query"), dict) else None
        if isinstance(source_query, dict) and isinstance(source_query.get("policy_id"), str) and source_query["policy_id"] != SOURCE_POLICY_ID:
            return _refused(given, "unsupported_policy", "This named source interpretation policy is not supported.", "query.source_interpretation.policy_id")
        lineage_query = given.get("query", {}).get("category_lineage") if isinstance(given.get("query"), dict) else None
        if isinstance(lineage_query, dict) and isinstance(lineage_query.get("policy_id"), str) and lineage_query["policy_id"] != CATEGORY_LINEAGE_POLICY_ID:
            return _refused(given, "unsupported_policy", "This category lineage policy is not supported.", "query.category_lineage.policy_id")
        try:
            parsed = Bpic19ProfileRequest.model_validate_json(json.dumps(given, allow_nan=False), strict=True)
            difference = first_difference(given, parsed.model_dump(mode="json", exclude_unset=True))
            if difference is not None:
                return _refused(given, "invalid_request", "A field has a different JSON type than the request requires.", ".".join(map(str, difference)))
            if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", given["identity"]["implementation_version"]):
                return _refused(given, "invalid_request", "Implementation versions use ASCII digits.", "identity.implementation_version")
        except (ValidationError, ValueError, TypeError) as error:
            field = ".".join(map(str, error.errors()[0]["loc"])) if isinstance(error, ValidationError) else None
            return _refused(given, "invalid_request", "The source profile request does not match its contract.", field)
        try:
            lineage = given["query"].get("category_lineage")
            if lineage is not None:
                # Both sources are admitted together, before either is read.
                refused = self._imports.admit_preparations(given["workspace_id"], (given["identity"]["preparation_id"], lineage["origin_preparation_id"]))
                if refused is not None: return _refused(given, refused.code, refused.message, refused.field)
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem): return _refused(given, resolved.code, resolved.message, resolved.field)
            prepared, population = resolved
            query = given["query"]
            if query["policy_id"] != POLICY_ID:
                return _refused(given, "unsupported_policy", "Review the supported all-record case attribute policy.", "query.policy_id")
            origin = None
            if query.get("category_lineage") is not None:
                if query["roles"] is None:
                    return _refused(given, "invalid_parameter", "Review category roles before checking lineage.", "query.roles")
                found = self._imports.prepared(given["workspace_id"], query["category_lineage"]["origin_preparation_id"])
                if not isinstance(found, tuple):
                    return _refused(given, found.code, found.message, "query.category_lineage.origin_preparation_id")
                origin = found[0]
            profile = None if query["roles"] is None else profile_bpic19(prepared, query["roles"], population.case_ids,
                query["profile_columns"], query.get("source_interpretation"), query.get("attribute_view"),
                query.get("include_zero_cells", False), query.get("include_document_siblings", False),
                query.get("category_lineage"), origin)
            if isinstance(profile, ImportRefusal): return _refused(given, profile.code, profile.message, profile.field)
            answer = {"schema_version": 1, "message_type": "bpic19_profile_answer",
                "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"],
                "identity": population.identity, "parent_identity": population.parent_identity, "query": query,
                "binding_state": "needs_review" if profile is None else "reviewed",
                "columns": [{"index": i, "name": name, "mapped_context": i in prepared.mapping["context_columns"]} for i, name in enumerate(prepared.columns)],
                "suggested_roles": suggested_roles(prepared.columns), "profile": profile}
            checked = Bpic19ProfileAnswer.model_validate_json(json.dumps(answer, ensure_ascii=False, allow_nan=False), strict=True)
            difference = first_difference(answer, checked.model_dump(mode="json", exclude_unset=True), integers_as_numbers=True)
            if difference is not None: raise ValueError("Profile answer changed values during contract validation")
            return Bpic19ProfileReply(200, answer)
        except Exception:
            logger.exception("The BPIC19 source profile could not be computed")
            return _refused(given, "computation_failed", "The source profile could not be computed. Retry; if it fails again, the application needs repair.")
