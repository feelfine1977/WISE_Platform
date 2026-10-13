"""Messages of the opening-context and variants operations.

The messages are the generated models of the population-views contract, named here for the
operations together with what the contract leaves to the application: the HTTP status of each
refusal code and whether a retry of the same request can help. What the generated models do not
carry is checked where the messages are read and written: incident ids of one list do not repeat, and
an implementation version is written in ASCII digits.
"""

from __future__ import annotations

from .generated.population_views import (
    AnswerIdentity,
    CategoryShare,
    ContextCategory,
    ContextColumn,
    ContextRemainder,
    GroupCoverage,
    MissingContextCategory,
    OpeningContext,
    OpeningContextAnswer,
    OpeningContextRequest,
    PopulationViewMessage,
    PopulationViewRefusal,
    UnevaluableSupport,
    ValueContextCategory,
    Variant,
    VariantsAnswer,
    VariantsRequest,
    VariantSummary,
)

__all__ = [
    "OPENING_CONTEXT",
    "RETRYABLE",
    "STATUS",
    "UNIQUE",
    "VARIANTS",
    "VERSIONS",
    "AnswerIdentity",
    "CategoryShare",
    "ContextCategory",
    "ContextColumn",
    "ContextRemainder",
    "GroupCoverage",
    "MissingContextCategory",
    "OpeningContext",
    "OpeningContextAnswer",
    "OpeningContextRequest",
    "PopulationViewMessage",
    "PopulationViewRefusal",
    "UnevaluableSupport",
    "ValueContextCategory",
    "Variant",
    "VariantsAnswer",
    "VariantsRequest",
    "VariantSummary",
]

OPENING_CONTEXT = "opening_context"
VARIANTS = "variants"

STATUS: dict[str, int] = {
    "invalid_request": 400,
    "unsupported_schema": 400,
    "workspace_unavailable": 404,
    "workspace_not_writable": 403,
    "workspace_incompatible": 409,
    "source_unavailable": 404,
    "preparation_unavailable": 404,
    "identity_mismatch": 409,
    "population_unavailable": 404,
    "invalid_parent": 409,
    "unknown_case": 409,
    "no_context_columns": 422,
    "computation_failed": 500,
}
RETRYABLE = frozenset(
    {
        "workspace_unavailable",
        "workspace_not_writable",
        "source_unavailable",
        "preparation_unavailable",
        "computation_failed",
    }
)
"""Codes for a state of this computer rather than of the request: the same request can succeed later."""

UNIQUE: dict[str, tuple[tuple[str, ...], ...]] = {
    "opening_context_answer": (
        ("opening_context", "population", "unevaluable_case_ids"),
        ("opening_context", "parent", "unevaluable_case_ids"),
    ),
    "variants_answer": (("variants", "variants", "*", "case_ids"), ("variants", "unevaluable", "case_ids")),
}
"""For each answer, the lists the contract marks as holding no item twice; ``*`` stands for every index."""

VERSIONS: dict[str, tuple[tuple[str, ...], ...]] = {
    "opening_context_request": (("identity", "implementation_version"),),
    "variants_request": (("identity", "implementation_version"),),
    "opening_context_answer": (("identity", "implementation_version"), ("parent_identity", "implementation_version")),
    "variants_answer": (("identity", "implementation_version"),),
}
"""For each request and answer, the places of an implementation version, whose digits are ASCII."""
