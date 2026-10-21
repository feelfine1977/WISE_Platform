# Stated-rule contract boundary types.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, confloat, conint, constr


class RequestId(RootModel[constr(pattern=r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')]):
    root: constr(pattern=r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') = Field(
        ..., title='RequestId'
    )


class QueryRevision(RootModel[conint(ge=1, le=9007199254740991)]):
    root: conint(ge=1, le=9007199254740991) = Field(..., title='QueryRevision')


class WorkspaceId(RootModel[constr(pattern=r'^workspace\.v1:[A-Za-z0-9-]{8,64}$')]):
    root: constr(pattern=r'^workspace\.v1:[A-Za-z0-9-]{8,64}$') = Field(
        ..., title='WorkspaceId'
    )


class SourceId(RootModel[constr(pattern=r'^source\.v1:sha256:[a-f0-9]{64}$')]):
    root: constr(pattern=r'^source\.v1:sha256:[a-f0-9]{64}$') = Field(
        ..., title='SourceId'
    )


class PreparationId(
    RootModel[constr(pattern=r'^preparation\.v1:sha256:[a-f0-9]{64}$')]
):
    root: constr(pattern=r'^preparation\.v1:sha256:[a-f0-9]{64}$') = Field(
        ..., title='PreparationId'
    )


class RepresentationId(
    RootModel[constr(pattern=r'^representation\.v1:sha256:[a-f0-9]{64}$')]
):
    root: constr(pattern=r'^representation\.v1:sha256:[a-f0-9]{64}$') = Field(
        ..., title='RepresentationId'
    )


class CaseDictionaryId(
    RootModel[constr(pattern=r'^case-dictionary\.v1:sha256:[a-f0-9]{64}$')]
):
    root: constr(pattern=r'^case-dictionary\.v1:sha256:[a-f0-9]{64}$') = Field(
        ..., title='CaseDictionaryId'
    )


class PopulationId(RootModel[constr(pattern=r'^population\.v1:sha256:[a-f0-9]{64}$')]):
    root: constr(pattern=r'^population\.v1:sha256:[a-f0-9]{64}$') = Field(
        ..., title='PopulationId'
    )


class ImplementationVersion(RootModel[constr(pattern=r'^\d+\.\d+\.\d+$')]):
    root: constr(pattern=r'^\d+\.\d+\.\d+$') = Field(..., title='ImplementationVersion')


class CaseId(RootModel[constr(min_length=1, max_length=256)]):
    root: constr(min_length=1, max_length=256) = Field(..., title='CaseId')


class EdgesHour(RootModel[conint(ge=0) | confloat(ge=0.0)]):
    root: conint(ge=0) | confloat(ge=0.0)


class DistributionBin(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    start_inclusive_hours: conint(ge=0) | confloat(ge=0.0)
    end_exclusive_hours: conint(ge=0) | confloat(ge=0.0) | None
    parent_case_count: conint(ge=0, le=9007199254740991)
    kept_case_count: conint(ge=0, le=9007199254740991)


class UnavailableDistributionSupport(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    parent_case_count: conint(ge=0, le=9007199254740991)
    kept_case_count: conint(ge=0, le=9007199254740991)
    parent_order_unknown_case_count: conint(ge=0, le=9007199254740991)
    kept_order_unknown_case_count: conint(ge=0, le=9007199254740991)
    parent_fewer_than_two_records_case_count: conint(ge=0, le=9007199254740991)
    kept_fewer_than_two_records_case_count: conint(ge=0, le=9007199254740991)


class FirstRawActivityRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['first_raw_activity']


class LastRawActivityRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['last_raw_activity']


class ExactMappedSequenceRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['exact_mapped_sequence']


class Edge(RootModel[conint(ge=0, le=9007199254740991)]):
    root: conint(ge=0, le=9007199254740991)


class RawRecordCountBandsRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['raw_record_count_bands']
    edges: list[Edge] = Field(..., max_length=32, min_length=1)


class ActivityPresenceRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['activity_presence']
    activity: constr(min_length=1)


class SharedReferenceRule(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['shared_reference']
    column_index: conint(ge=0, le=9007199254740991)
    minimum_parent_case_count: conint(ge=2, le=9007199254740991)
    policy: Literal['any_record', 'first_record', 'latest_record'] | None = Field(
        None,
        description="Which values of an incident are read: every record's (the default; an incident can be in several groups), the first record's in the declared order, or the latest record's that has a value. The last two need the order to be known; an incident is then in exactly one group.",
    )


class GroupRule(
    RootModel[
        FirstRawActivityRule
        | LastRawActivityRule
        | RawRecordCountBandsRule
        | ActivityPresenceRule
        | SharedReferenceRule
        | ExactMappedSequenceRule
    ]
):
    root: (
        FirstRawActivityRule
        | LastRawActivityRule
        | RawRecordCountBandsRule
        | ActivityPresenceRule
        | SharedReferenceRule
        | ExactMappedSequenceRule
    ) = Field(..., title='GroupRule')


class DistributionEdgesHour(RootModel[conint(ge=0) | confloat(ge=0.0)]):
    root: conint(ge=0) | confloat(ge=0.0)


class RuleGroupsQuery(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    rule: GroupRule
    distribution_edges_hours: list[DistributionEdgesHour] = Field(
        ..., max_length=32, min_length=1
    )
    offset: conint(ge=0, le=9007199254740991)
    limit: conint(ge=1, le=50)


class CountSupport(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    case_count: conint(ge=0, le=9007199254740991)
    record_count: conint(ge=0, le=9007199254740991)
    omitted_activity_record_count: conint(ge=0, le=9007199254740991)


class FixedCaseSupport(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    case_ids: list[CaseId]
    case_count: conint(ge=0, le=9007199254740991)
    record_count: conint(ge=0, le=9007199254740991)
    omitted_activity_record_count: conint(ge=0, le=9007199254740991)


class RuleGroupSupport(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    cases: FixedCaseSupport
    share: confloat(ge=0.0, le=1.0) | None
    denominator: conint(ge=0, le=9007199254740991)


class ParentRuleGroupSupport(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    cases: CountSupport
    share: confloat(ge=0.0, le=1.0) | None
    denominator: conint(ge=0, le=9007199254740991)


class RuleEligibility(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    total: CountSupport
    eligible: CountSupport
    unevaluable: FixedCaseSupport
    assigned: CountSupport
    unassigned: FixedCaseSupport
    membership_incidence: CountSupport


class ActivityValueKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['activity']
    activity: constr(min_length=1)


class MissingActivityKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['missing_activity']
    activity: None


class ActivityGroupKey(RootModel[ActivityValueKey | MissingActivityKey]):
    root: ActivityValueKey | MissingActivityKey = Field(..., title='ActivityGroupKey')


class RecordCountBandKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['raw_record_count_band']
    start_inclusive: conint(ge=0, le=9007199254740991)
    end_exclusive: conint(ge=0, le=9007199254740991) | None


class ActivityPresenceKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['activity_presence']
    activity: constr(min_length=1)
    present: bool


class ReferenceValueKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['reference_value']
    column_index: conint(ge=0, le=9007199254740991)
    value: constr(min_length=1)


class MissingReferenceKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['missing_reference']
    column_index: conint(ge=0, le=9007199254740991)
    value: None


class ReferenceGroupKey(RootModel[ReferenceValueKey | MissingReferenceKey]):
    root: ReferenceValueKey | MissingReferenceKey = Field(
        ..., title='ReferenceGroupKey'
    )


class ExactSequenceKey(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    kind: Literal['exact_sequence']
    activities: list[constr(min_length=1)]
    variant_id: constr(pattern=r'^variant\.v1:sha256:[a-f0-9]{64}$')


class RuleGroupKey(
    RootModel[
        ActivityGroupKey
        | RecordCountBandKey
        | ActivityPresenceKey
        | ReferenceGroupKey
        | ExactSequenceKey
    ]
):
    root: (
        ActivityGroupKey
        | RecordCountBandKey
        | ActivityPresenceKey
        | ReferenceGroupKey
        | ExactSequenceKey
    ) = Field(..., title='RuleGroupKey')


class RuleGroupId(RootModel[constr(pattern=r'^rule-group\.v1:sha256:[a-f0-9]{64}$')]):
    root: constr(pattern=r'^rule-group\.v1:sha256:[a-f0-9]{64}$') = Field(
        ..., title='RuleGroupId'
    )


class CaseExemplar(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    case_id: CaseId
    record_count: conint(ge=0, le=9007199254740991)
    observed_span_hours: confloat(ge=0.0)


class AvailableGroupExemplars(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['available']
    shortest: CaseExemplar
    longest: CaseExemplar


class UnavailableGroupExemplars(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    status: Literal['unavailable']
    reason: Literal['empty_current_group', 'no_evaluable_case']
    shortest: None
    longest: None


class GroupExemplars(RootModel[AvailableGroupExemplars | UnavailableGroupExemplars]):
    root: AvailableGroupExemplars | UnavailableGroupExemplars = Field(
        ..., title='GroupExemplars'
    )


class SharedReferenceCoverage(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    column_index: conint(ge=0, le=9007199254740991)
    parent_distinct_nonmissing_value_count: conint(ge=0, le=9007199254740991)
    parent_suppressed_nonmissing_value_count: conint(ge=0, le=9007199254740991)
    parent_missing_reference_record_count: conint(ge=0, le=9007199254740991)
    population_missing_reference_record_count: conint(ge=0, le=9007199254740991)


class RuleGroupsRefusal(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    message_type: Literal['rule_groups_refusal']
    request_id: RequestId | None
    query_revision: QueryRevision | None
    workspace_id: WorkspaceId | None
    operation: Literal['rule_groups']
    code: Literal[
        'invalid_request',
        'unsupported_schema',
        'unsupported_policy',
        'invalid_parameter',
        'workspace_unavailable',
        'workspace_not_writable',
        'workspace_incompatible',
        'source_unavailable',
        'preparation_unavailable',
        'identity_mismatch',
        'population_unavailable',
        'invalid_parent',
        'unknown_case',
        'inconsistent_sequence',
        'inconsistent_time_kind',
        'memory_unavailable',
        'computation_failed',
        'unmapped_context_column',
    ]
    message: constr(min_length=1)
    field: str | None
    retryable: bool


class AnswerIdentity(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    source_id: SourceId
    preparation_id: PreparationId
    representation_id: RepresentationId
    case_dictionary_id: CaseDictionaryId
    population_id: PopulationId
    implementation_version: ImplementationVersion


class CaseDistribution(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    policy_id: Literal['incident.case_distribution.explicit_hours_half_open.v1']
    measure: Literal['observed_span_hours', 'maximum_adjacent_raw_gap_hours']
    timestamp_kind: Literal['utc_instant', 'wall_clock']
    edges_hours: list[EdgesHour] = Field(..., max_length=32, min_length=1)
    parent_case_count: conint(ge=0, le=9007199254740991)
    kept_case_count: conint(ge=0, le=9007199254740991)
    parent_available_case_count: conint(ge=0, le=9007199254740991)
    kept_available_case_count: conint(ge=0, le=9007199254740991)
    bins: list[DistributionBin] = Field(..., max_length=32, min_length=1)
    unavailable: UnavailableDistributionSupport


class RuleGroup(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: RuleGroupId
    key: RuleGroupKey
    population: RuleGroupSupport
    parent: ParentRuleGroupSupport
    span_distribution: CaseDistribution
    gap_distribution: CaseDistribution
    exemplars: GroupExemplars


class RuleGroupsRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    message_type: Literal['rule_groups_request']
    request_id: RequestId
    query_revision: QueryRevision
    workspace_id: WorkspaceId
    identity: AnswerIdentity
    query: RuleGroupsQuery


class RuleGroupsAnswer(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    schema_version: Literal[1]
    message_type: Literal['rule_groups_answer']
    request_id: RequestId
    query_revision: QueryRevision
    workspace_id: WorkspaceId
    identity: AnswerIdentity
    parent_identity: AnswerIdentity
    query: RuleGroupsQuery
    rule_policy_id: Literal['incident.rule_groups.stated_rules.v1']
    activity_projection_policy: Literal[
        'incident.activity.omit_missing_retain_raw_gaps.v1'
    ]
    catalogue_scope: Literal['frozen_parent']
    timestamp_kind: Literal['utc_instant', 'wall_clock']
    group_membership_overlaps: bool
    population_coverage: RuleEligibility
    parent_coverage: RuleEligibility
    shared_reference_coverage: SharedReferenceCoverage | None
    group_count: conint(ge=0, le=9007199254740991)
    next_offset: conint(ge=0, le=9007199254740991) | None
    groups: list[RuleGroup] = Field(..., max_length=50)


class RuleGroupsMessage(
    RootModel[RuleGroupsRequest | RuleGroupsAnswer | RuleGroupsRefusal]
):
    root: RuleGroupsRequest | RuleGroupsAnswer | RuleGroupsRefusal = Field(
        ...,
        description='stated-rule catalogue over an immutable fixed parent; no fitted clusters, completion or causality.',
        title='RuleGroupsMessage',
    )
