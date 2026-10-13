"""Resolve a checked population and preview its frozen stated-rule catalogue."""

from __future__ import annotations

import logging

from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.rule_groups import rule_groups

from .boundary import SCHEMA_VERSION
from .imports import Imports
from .population_views import resolve_population
from .rule_groups_boundary import (
    RuleGroupsReply,
    checked_answer,
    parse_rule_groups,
    refused,
)
from .workspace import Problem

logger = logging.getLogger(__name__)


class RuleGroups:
    def __init__(self, imports: Imports) -> None:
        self._imports = imports

    def rule_groups(self, body: bytes) -> RuleGroupsReply:
        given = parse_rule_groups(body)
        if isinstance(given, RuleGroupsReply):
            return given
        try:
            resolved = resolve_population(self._imports, given)
            if isinstance(resolved, Problem):
                return refused(resolved.code, resolved.message, given, resolved.field)
            prepared, population = resolved
            result = rule_groups(
                prepared,
                population.case_ids,
                population.parent_ids,
                population.parent_identity,
                given["query"],
            )
            if isinstance(result, ImportRefusal):
                return refused(result.code, result.message, given, result.field)
            return checked_answer(
                {
                    "schema_version": SCHEMA_VERSION,
                    "message_type": "rule_groups_answer",
                    "request_id": given["request_id"],
                    "query_revision": given["query_revision"],
                    "workspace_id": given["workspace_id"],
                    "identity": population.identity,
                    "parent_identity": population.parent_identity,
                    "query": given["query"],
                    **result,
                }
            )
        except Exception:
            logger.exception("The rule-groups operation failed unexpectedly")
            return refused(
                "computation_failed",
                "The groups could not be computed. Retry; if it fails again, the application needs repair.",
                given,
            )
