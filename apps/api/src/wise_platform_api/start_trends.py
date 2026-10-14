"""Resolve authorized population and supply start counts without registration."""
from __future__ import annotations

import logging

from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.start_trend import start_trend

from .boundary import SCHEMA_VERSION
from .imports import Imports
from .population_views import resolve_population
from .start_trend_boundary import StartTrendReply, checked_answer, parse_start_trend, refused
from .workspace import Problem

logger = logging.getLogger(__name__)


class StartTrends:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def start_trend(self, body: bytes) -> StartTrendReply:
        given = parse_start_trend(body)
        if isinstance(given, StartTrendReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            result = start_trend(prepared, population.case_ids, population.parent_ids, given["definition"])
            if isinstance(result, ImportRefusal):
                return refused(result.code, result.message, given, result.field)
            return checked_answer({"schema_version": SCHEMA_VERSION, "message_type": "start_trend_answer",
                "request_id": given["request_id"], "query_revision": given["query_revision"], "workspace_id": given["workspace_id"],
                "identity": population.identity, "parent_identity": population.parent_identity, "definition": given["definition"], **result})
        except Exception:
            logger.exception("The start-trend operation failed unexpectedly")
            return refused("computation_failed", "The trend could not be computed. Retry; if it fails again, the application needs repair.", given)
