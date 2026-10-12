"""Registered policies and the selection of them.

A policy is a named, versioned rule under which an answer is computed. Its
identifier ends in a version suffix ``.v<N>``; a different version is a
different policy. A caller selects one policy for each of nine roles and
gives every parameter of it. The registry below knows exactly the policies
this version accepts, and the one value each of their parameters takes:

* ``order``: ``incident.order.timestamp_sequence_source_position.v1`` orders
  the records of an incident by timestamp, then by source sequence, then by
  their position in the source.
* ``missing_values``: ``incident.missing.empty_activity_context_cells.v1``
  reads an empty activity or assignment group cell as missing and the text
  ``Unknown`` as a value. The parser implements it.
* ``activity_projection``:
  ``incident.activity.omit_missing_retain_raw_gaps.v1`` leaves records without
  an activity label out of the mapped sequence, keeps them in the raw evidence
  and names them.
* ``parent``: ``incident.parent.all_service_s_and_has_opened.v1`` takes into the
  parent population the incidents whose every record has service ``S`` and
  which have a record with the activity ``Opened``.
* ``predicate``: ``incident.predicate.has_recorded_resolved.v1`` keeps the
  parent incidents with a recorded ``Resolved`` activity and removes the
  others. Recorded presence always has an answer, so no incident is
  unevaluable under it.
* ``comparison``: ``incident.comparison.target_removed_reference_kept.v1``
  names the removed incidents the target and the kept ones the comparator.
* ``context_projection``, ``clock`` and ``nullable_measure``: the opening
  assignment group, elapsed UTC hours, and the rule that a missing endpoint is
  unevaluable and never false.

Every role is required. The last four roles change nothing in a population or
in the evidence of a case; they are checked and applied, so that an answer
names every policy of its investigation, and enter no identity of these
answers. Any other role, identifier, version, parameter or parameter value is
refused by name; a selected policy is never silently ignored.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from .refusals import DetailValue, Refusal, RefusalCode

ParameterValue = str | int | bool

ORDER_ROLE = "order"
MISSING_VALUES_ROLE = "missing_values"
ACTIVITY_PROJECTION_ROLE = "activity_projection"
PARENT_ROLE = "parent"
PREDICATE_ROLE = "predicate"
COMPARISON_ROLE = "comparison"
CONTEXT_PROJECTION_ROLE = "context_projection"
CLOCK_ROLE = "clock"
NULLABLE_MEASURE_ROLE = "nullable_measure"

ORDER_TIMESTAMP_SEQUENCE_SOURCE_POSITION_V1 = (
    "incident.order.timestamp_sequence_source_position.v1"
)
MISSING_EMPTY_ACTIVITY_CONTEXT_CELLS_V1 = (
    "incident.missing.empty_activity_context_cells.v1"
)
ACTIVITY_OMIT_MISSING_RETAIN_RAW_GAPS_V1 = (
    "incident.activity.omit_missing_retain_raw_gaps.v1"
)
PARENT_ALL_SERVICE_S_AND_HAS_OPENED_V1 = (
    "incident.parent.all_service_s_and_has_opened.v1"
)
PREDICATE_HAS_RECORDED_RESOLVED_V1 = "incident.predicate.has_recorded_resolved.v1"
COMPARISON_TARGET_REMOVED_REFERENCE_KEPT_V1 = (
    "incident.comparison.target_removed_reference_kept.v1"
)
CONTEXT_FIRST_OPENED_ASSIGNMENT_GROUP_RETAIN_MISSING_V1 = (
    "incident.context.first_opened_assignment_group_retain_missing.v1"
)
CLOCK_ELAPSED_UTC_HOURS_V1 = "incident.clock.elapsed_utc_hours.v1"
MEASURE_UNEVALUABLE_SEPARATE_FROM_TRUE_FALSE_V1 = (
    "incident.measure.unevaluable_separate_from_true_false.v1"
)

_VERSIONED = re.compile(r"(?P<family>.+)\.v[0-9]+")


@dataclass(frozen=True)
class PolicyChoice:
    """One selected policy: its identifier and the values of its parameters."""

    policy_id: str
    parameters: Mapping[str, ParameterValue] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "parameters", MappingProxyType(dict(self.parameters)))

    def to_dict(self) -> dict[str, object]:
        return {
            "policy_id": self.policy_id,
            "parameters": {
                name: self.parameters[name] for name in sorted(self.parameters)
            },
        }


@dataclass(frozen=True)
class PolicySelection:
    """The policies a caller selects, one choice per role.

    A bare identifier given in place of a choice stands for that policy
    without parameters.
    """

    choices: Mapping[str, PolicyChoice] = field(default_factory=dict, hash=False)

    def __post_init__(self) -> None:
        choices = {
            role: choice if isinstance(choice, PolicyChoice) else PolicyChoice(choice)
            for role, choice in dict(self.choices).items()
        }
        object.__setattr__(self, "choices", MappingProxyType(choices))

    @classmethod
    def of(cls, **policy_ids: str) -> PolicySelection:
        """Select policies without parameters, written as ``role=identifier``."""
        return cls(
            {role: PolicyChoice(policy_id) for role, policy_id in policy_ids.items()}
        )

    def to_dict(self) -> dict[str, object]:
        return {role: self.choices[role].to_dict() for role in sorted(self.choices)}


@dataclass(frozen=True)
class AppliedPolicies:
    """The policies an answer was computed under, one for each role."""

    order: PolicyChoice
    missing_values: PolicyChoice
    activity_projection: PolicyChoice
    parent: PolicyChoice
    predicate: PolicyChoice
    comparison: PolicyChoice
    context_projection: PolicyChoice
    clock: PolicyChoice
    nullable_measure: PolicyChoice

    def by_role(self) -> dict[str, PolicyChoice]:
        """Return the choices keyed by role, in the order of ``ROLES``."""
        return {role: getattr(self, role) for role in ROLES}

    def to_dict(self) -> dict[str, object]:
        return {role: choice.to_dict() for role, choice in self.by_role().items()}


@dataclass(frozen=True)
class PolicyDefinition:
    """A registered policy: its role, its identifier and its parameters.

    ``parameters`` names every parameter the policy takes with the one value
    it accepts. A given value must equal it and be of the same type, so
    ``False`` does not stand for ``0`` nor ``"false"`` for ``False``.
    """

    role: str
    policy_id: str
    parameters: Mapping[str, ParameterValue] = field(hash=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "parameters", MappingProxyType(dict(self.parameters)))


REGISTRY: tuple[PolicyDefinition, ...] = (
    PolicyDefinition(
        ORDER_ROLE,
        ORDER_TIMESTAMP_SEQUENCE_SOURCE_POSITION_V1,
        {
            "primary": "timestamp_utc_ascending",
            "secondary": "source_sequence_ascending",
            "tie_breaker": "source_position_ascending",
        },
    ),
    PolicyDefinition(
        MISSING_VALUES_ROLE,
        MISSING_EMPTY_ACTIVITY_CONTEXT_CELLS_V1,
        {
            "activity_empty_cell": "missing",
            "assignment_group_empty_cell": "missing",
            "literal_Unknown": "value",
        },
    ),
    PolicyDefinition(
        ACTIVITY_PROJECTION_ROLE,
        ACTIVITY_OMIT_MISSING_RETAIN_RAW_GAPS_V1,
        {
            "missing_activity": "omit_from_mapped_sequence",
            "raw_records": "retain_all",
            "gap_evidence": "omitted_row_ids",
        },
    ),
    PolicyDefinition(
        PARENT_ROLE,
        PARENT_ALL_SERVICE_S_AND_HAS_OPENED_V1,
        {
            "service": "S",
            "service_quantifier": "all_records",
            "contains_activity": "Opened",
        },
    ),
    PolicyDefinition(
        PREDICATE_ROLE,
        PREDICATE_HAS_RECORDED_RESOLVED_V1,
        {"contains_activity": "Resolved", "semantics": "recorded_event_presence"},
    ),
    PolicyDefinition(
        COMPARISON_ROLE,
        COMPARISON_TARGET_REMOVED_REFERENCE_KEPT_V1,
        {"target": "removed", "comparator": "kept"},
    ),
    PolicyDefinition(
        CONTEXT_PROJECTION_ROLE,
        CONTEXT_FIRST_OPENED_ASSIGNMENT_GROUP_RETAIN_MISSING_V1,
        {
            "anchor_activity": "Opened",
            "anchor_occurrence": "first_in_declared_order",
            "attribute": "assignment_group",
            "missing_at_anchor": "retain",
        },
    ),
    PolicyDefinition(
        CLOCK_ROLE,
        CLOCK_ELAPSED_UTC_HOURS_V1,
        {"timestamp_field": "timestamp_utc", "timezone": "UTC", "unit": "hours"},
    ),
    PolicyDefinition(
        NULLABLE_MEASURE_ROLE,
        MEASURE_UNEVALUABLE_SEPARATE_FROM_TRUE_FALSE_V1,
        {"missing_endpoint": "unevaluable", "missing_as_false": False},
    ),
)
ROLES: tuple[str, ...] = (
    ORDER_ROLE,
    MISSING_VALUES_ROLE,
    ACTIVITY_PROJECTION_ROLE,
    PARENT_ROLE,
    PREDICATE_ROLE,
    COMPARISON_ROLE,
    CONTEXT_PROJECTION_ROLE,
    CLOCK_ROLE,
    NULLABLE_MEASURE_ROLE,
)
"""Every role, all of them required."""


def resolve_policies(selection: PolicySelection) -> AppliedPolicies | Refusal:
    """Check a selection against the registry.

    Every selected role is checked in the alphabetical order of the roles,
    then the required roles are checked for presence, so the refusal does not
    depend on the order in which the caller wrote the selection.
    """
    choices = selection.choices
    for role in sorted(choices, key=str):
        refusal = _check_choice(role, choices[role])
        if refusal is not None:
            return refusal
    for role in ROLES:
        if role not in choices:
            return Refusal(
                RefusalCode.MISSING_POLICY,
                f"No policy was selected for the required role {role!r}.",
                {"role": role, "supported_policy_ids": _supported_policy_ids(role)},
            )
    return AppliedPolicies(**{role: choices[role] for role in ROLES})


def _check_choice(role: str, choice: PolicyChoice) -> Refusal | None:
    policy_id = choice.policy_id
    supported = _supported_policy_ids(role)
    if not supported:
        supported_roles = tuple(sorted(ROLES))
        return Refusal(
            RefusalCode.UNKNOWN_POLICY,
            f"The role {role!r} (policy {policy_id!r}) is not supported. "
            f"Supported roles: {', '.join(supported_roles)}.",
            {
                "reason": "unknown_role",
                "role": _plain(role),
                "policy_id": _plain(policy_id),
                "supported_roles": supported_roles,
            },
        )
    definition = next(
        (
            candidate
            for candidate in REGISTRY
            if candidate.role == role and candidate.policy_id == policy_id
        ),
        None,
    )
    if definition is None:
        family = _family(policy_id)
        known_version = family is not None and family in {
            _family(supported_id) for supported_id in supported
        }
        described = (
            "is an unknown version of a policy" if known_version else "is not a policy"
        )
        return Refusal(
            RefusalCode.UNKNOWN_POLICY,
            f"{policy_id!r} {described} for the role {role!r}. Supported: {', '.join(supported)}.",
            {
                "reason": "unknown_version" if known_version else "unknown_id",
                "role": role,
                "policy_id": _plain(policy_id),
                "supported_policy_ids": supported,
            },
        )
    return _check_parameters(definition, choice.parameters)


def _check_parameters(
    definition: PolicyDefinition, given: Mapping[str, object]
) -> Refusal | None:
    """Refuse an unknown, a missing or a different parameter, in that order."""
    role, policy_id = definition.role, definition.policy_id
    for name in sorted(given, key=str):
        if name not in definition.parameters:
            return Refusal(
                RefusalCode.UNSUPPORTED_PARAMETER,
                f"The policy {policy_id!r} does not take a parameter named {name!r}.",
                {
                    "reason": "unknown_parameter",
                    "role": role,
                    "policy_id": policy_id,
                    "parameter": _plain(name),
                },
            )
    for name, accepted in definition.parameters.items():
        if name not in given:
            return Refusal(
                RefusalCode.UNSUPPORTED_PARAMETER,
                f"The policy {policy_id!r} needs the parameter {name!r}.",
                {
                    "reason": "missing_parameter",
                    "role": role,
                    "policy_id": policy_id,
                    "parameter": name,
                },
            )
        value = given[name]
        if type(value) is not type(accepted) or value != accepted:
            return Refusal(
                RefusalCode.UNSUPPORTED_PARAMETER,
                f"The parameter {name!r} of the policy {policy_id!r} supports only "
                f"{accepted!r}, not {_shown(value)}.",
                {
                    "reason": "unsupported_value",
                    "role": role,
                    "policy_id": policy_id,
                    "parameter": name,
                    "value": _plain(value),
                    "supported_value": _plain(accepted),
                },
            )
    return None


def _supported_policy_ids(role: object) -> tuple[str, ...]:
    return tuple(
        definition.policy_id for definition in REGISTRY if definition.role == role
    )


def _family(policy_id: object) -> str | None:
    """Return an identifier without its version suffix, or ``None`` if it has none."""
    if not isinstance(policy_id, str):
        return None
    match = _VERSIONED.fullmatch(policy_id)
    return None if match is None else match["family"]


def _plain(value: object) -> DetailValue:
    """Keep text, whole numbers and truth values as they are; describe anything else."""
    if value is None or isinstance(value, (str, int)):
        return value
    return repr(value)


def _shown(value: object) -> str:
    text = repr(value)
    return text if len(text) <= 60 else text[:60] + "..."
