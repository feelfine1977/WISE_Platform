"""Registered policies and the selection of them.

A policy is a named, versioned rule under which an answer is computed. Its
identifier ends in a version suffix ``.v<N>``; a different version is a
different policy. A caller selects one policy for each role. The registry
below knows exactly the policies this version computes:

* role ``order``: ``incident.order.timestamp_sequence_source_position.v1``
  orders the records of an incident by timestamp, then by source sequence,
  then by their position in the source.
* role ``activity_projection``:
  ``incident.activity.omit_missing_retain_raw_gaps.v1`` leaves records without
  an activity label out of the mapped sequence, keeps them in the raw evidence
  and counts them.

Both roles are required and neither policy takes a parameter. Any other role,
identifier, version or parameter is refused by name; a selected policy is
never silently ignored. The missing-value policy is fixed by the parser, not
selectable, and is named among the applied policies.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from .parsing import MISSING_VALUE_POLICY
from .refusals import DetailValue, Refusal, RefusalCode

ParameterValue = str | int | bool

ORDER_ROLE = "order"
ACTIVITY_PROJECTION_ROLE = "activity_projection"

ORDER_TIMESTAMP_SEQUENCE_SOURCE_POSITION_V1 = (
    "incident.order.timestamp_sequence_source_position.v1"
)
ACTIVITY_OMIT_MISSING_RETAIN_RAW_GAPS_V1 = (
    "incident.activity.omit_missing_retain_raw_gaps.v1"
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
    """The policies an answer was computed under."""

    order: PolicyChoice
    missing_value: PolicyChoice
    activity_projection: PolicyChoice

    def to_dict(self) -> dict[str, object]:
        return {
            "order": self.order.to_dict(),
            "missing_value": self.missing_value.to_dict(),
            "activity_projection": self.activity_projection.to_dict(),
        }


@dataclass(frozen=True)
class PolicyDefinition:
    """A registered policy: its role, its identifier and the parameters it takes."""

    role: str
    policy_id: str
    parameter_names: frozenset[str] = frozenset()


REGISTRY: tuple[PolicyDefinition, ...] = (
    PolicyDefinition(ORDER_ROLE, ORDER_TIMESTAMP_SEQUENCE_SOURCE_POSITION_V1),
    PolicyDefinition(
        ACTIVITY_PROJECTION_ROLE, ACTIVITY_OMIT_MISSING_RETAIN_RAW_GAPS_V1
    ),
)
REQUIRED_ROLES: tuple[str, ...] = (ORDER_ROLE, ACTIVITY_PROJECTION_ROLE)


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
    for role in REQUIRED_ROLES:
        if role not in choices:
            return Refusal(
                RefusalCode.MISSING_POLICY,
                f"No policy was selected for the required role {role!r}.",
                {"role": role, "supported_policy_ids": _supported_policy_ids(role)},
            )
    return AppliedPolicies(
        order=choices[ORDER_ROLE],
        missing_value=PolicyChoice(MISSING_VALUE_POLICY),
        activity_projection=choices[ACTIVITY_PROJECTION_ROLE],
    )


def _check_choice(role: str, choice: PolicyChoice) -> Refusal | None:
    policy_id = choice.policy_id
    supported = _supported_policy_ids(role)
    if not supported:
        supported_roles = tuple(sorted({definition.role for definition in REGISTRY}))
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
    for name in sorted(choice.parameters, key=str):
        if name not in definition.parameter_names:
            return Refusal(
                RefusalCode.UNSUPPORTED_PARAMETER,
                f"The policy {policy_id!r} does not take a parameter named {name!r}.",
                {"role": role, "policy_id": policy_id, "parameter": _plain(name)},
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
    """Keep text and whole numbers as they are; describe anything else."""
    if value is None or isinstance(value, (str, int)):
        return value
    return repr(value)
