"""Messages of the opening-context and variants operations.

The platform contracts do not describe these operations yet, so their models are written here, in
the envelope every other operation uses: schema version, message type, request id, query revision
and workspace id, and the full identity of the population the answer is about, as the selection
contract writes it. Identifiers reuse the generated definitions of that contract.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, NonNegativeInt, PositiveInt, constr

from .generated.selection import AnswerIdentity, CaseId, QueryRevision, RequestId, WorkspaceId

OPENING_CONTEXT = "opening_context"
VARIANTS = "variants"

RefusalCode = Literal[
    "invalid_request",
    "unsupported_schema",
    "workspace_unavailable",
    "workspace_not_writable",
    "workspace_incompatible",
    "source_unavailable",
    "preparation_unavailable",
    "identity_mismatch",
    "population_unavailable",
    "invalid_parent",
    "unknown_case",
    "no_context_columns",
    "computation_failed",
]

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

Share = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
Difference = Annotated[float, Field(ge=-100, le=100, allow_inf_nan=False)]


class _Message(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OpeningContextRequest(_Message):
    schema_version: Literal[1]
    message_type: Literal["opening_context_request"]
    request_id: RequestId
    query_revision: QueryRevision
    workspace_id: WorkspaceId
    identity: AnswerIdentity


class VariantsRequest(_Message):
    schema_version: Literal[1]
    message_type: Literal["variants_request"]
    request_id: RequestId
    query_revision: QueryRevision
    workspace_id: WorkspaceId
    identity: AnswerIdentity


class CategoryShare(_Message):
    count: NonNegativeInt
    share: Share | None
    denominator: NonNegativeInt


class ContextCategory(_Message):
    kind: Literal["value", "missing"]
    value: str | None
    population: CategoryShare
    parent: CategoryShare
    difference_percentage_points: Difference | None


class ContextRemainder(_Message):
    distinct_value_count: PositiveInt
    population: CategoryShare
    parent: CategoryShare
    difference_percentage_points: Difference | None


class ContextColumn(_Message):
    column_index: NonNegativeInt
    column_name: str
    distinct_value_count: NonNegativeInt
    categories: list[ContextCategory]
    remainder: ContextRemainder | None


class GroupCoverage(_Message):
    case_count: NonNegativeInt
    evaluable_case_count: NonNegativeInt
    unevaluable_case_count: NonNegativeInt
    unevaluable_case_ids: list[CaseId]


class OpeningContext(_Message):
    anchor_policy: Literal["incident.context.first_record_in_declared_order.v1"]
    category_limit: PositiveInt
    population: GroupCoverage
    parent: GroupCoverage
    columns: list[ContextColumn] = Field(min_length=1)


class OpeningContextAnswer(_Message):
    schema_version: Literal[1]
    message_type: Literal["opening_context_answer"]
    request_id: RequestId
    query_revision: QueryRevision
    workspace_id: WorkspaceId
    identity: AnswerIdentity
    parent_identity: AnswerIdentity
    opening_context: OpeningContext


class Variant(_Message):
    id: constr(pattern=r"^variant\.v1:sha256:[0-9a-f]{64}$")
    activities: list[constr(min_length=1)]
    case_count: PositiveInt
    share: Share
    denominator: PositiveInt
    case_ids: list[CaseId] = Field(min_length=1)
    record_count: PositiveInt
    omitted_activity_record_count: NonNegativeInt


class UnevaluableSupport(_Message):
    case_ids: list[CaseId]
    case_count: NonNegativeInt
    record_count: NonNegativeInt
    omitted_activity_record_count: NonNegativeInt


class VariantSummary(_Message):
    activity_projection_policy: Literal["incident.activity.omit_missing_retain_raw_gaps.v1"]
    case_count: NonNegativeInt
    record_count: NonNegativeInt
    omitted_activity_record_count: NonNegativeInt
    sequence_evaluable_case_count: NonNegativeInt
    variant_count: NonNegativeInt
    variants: list[Variant]
    unevaluable: UnevaluableSupport


class VariantsAnswer(_Message):
    schema_version: Literal[1]
    message_type: Literal["variants_answer"]
    request_id: RequestId
    query_revision: QueryRevision
    workspace_id: WorkspaceId
    identity: AnswerIdentity
    variants: VariantSummary


class PopulationViewRefusal(_Message):
    schema_version: Literal[1]
    message_type: Literal["population_view_refusal"]
    request_id: RequestId | None
    query_revision: QueryRevision | None
    workspace_id: WorkspaceId | None
    operation: Literal["opening_context", "variants"]
    code: RefusalCode
    message: constr(min_length=1)
    field: str | None
    retryable: bool
