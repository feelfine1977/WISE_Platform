"""Resolve a checked population and project its complete cases for a local list."""
from __future__ import annotations

import logging

from wise_platform_analytics.case_profiles import case_list_projection
from wise_platform_analytics.mapping import ImportRefusal

from .boundary import SCHEMA_VERSION
from .case_list_boundary import CaseListReply, checked_answer, parse_case_list, refused
from .imports import Imports
from .population_views import resolve_population
from .workspace import Problem

logger = logging.getLogger(__name__)


class CaseLists:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def case_list(self, body: bytes) -> CaseListReply:
        given = parse_case_list(body)
        if isinstance(given, CaseListReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            result = case_list_projection(prepared, population.case_ids, population.parent_ids, given["query"])
            if isinstance(result, ImportRefusal):
                return refused(result.code, result.message, given, result.field)
            return checked_answer({"schema_version": SCHEMA_VERSION, "message_type": "case_list_answer",
                "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"],
                "identity": population.identity, "parent_identity": population.parent_identity, "query": given["query"], **result})
        except Exception:
            logger.exception("The case-list operation failed unexpectedly")
            return refused("computation_failed", "The list could not be computed. Retry; if it fails again, the application needs repair.", given)
