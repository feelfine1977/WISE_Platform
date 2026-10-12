"""Stable identities of sources, interpretations and populations.

The scheme depends only on the inputs named here, never on the machine, the
run, the locale or the implementation version.

* The source identity is the SHA-256 of the source bytes, as 64 lowercase
  hexadecimal digits.
* Every derived identity is a short type prefix, an underscore and the SHA-256
  of the canonical JSON of its named parts. Canonical JSON has its keys
  sorted, no whitespace and only ASCII characters (anything else is escaped),
  and always carries a ``kind`` so identities of different kinds cannot
  coincide.

==================  ======  ==================================================
Identity            Prefix  Named parts
==================  ======  ==================================================
preparation         prep    source identity, parser version, order policy,
                            missing-value policy
representation      repr    preparation identity, activity projection policy
case dictionary     dict    preparation identity, incident ids in their order
                            of first appearance in the source
population          pop     representation identity, case dictionary identity,
                            member incident ids sorted by code point
==================  ======  ==================================================

A policy enters as its identifier and its parameters. Changing the bytes or a
policy therefore changes every identity that depends on it, and nothing else.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from .parsing import PARSER_VERSION
from .policies import AppliedPolicies, PolicyChoice
from .version import IMPLEMENTATION_VERSION


@dataclass(frozen=True)
class Identities:
    """The identities an answer is bound to, with the versions that produced it."""

    source_id: str
    preparation_id: str
    representation_id: str
    case_dictionary_id: str
    population_id: str
    parser_version: str
    implementation_version: str

    def to_dict(self) -> dict[str, object]:
        return {
            "source_id": self.source_id,
            "preparation_id": self.preparation_id,
            "representation_id": self.representation_id,
            "case_dictionary_id": self.case_dictionary_id,
            "population_id": self.population_id,
            "parser_version": self.parser_version,
            "implementation_version": self.implementation_version,
        }


def canonical_json(parts: Mapping[str, object]) -> bytes:
    """Serialise named parts in the one form used for hashing."""
    return json.dumps(
        parts, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("ascii")


def source_identity(source: bytes) -> str:
    return hashlib.sha256(source).hexdigest()


def preparation_identity(
    source_id: str,
    parser_version: str,
    order: PolicyChoice,
    missing_value: PolicyChoice,
) -> str:
    return _derived(
        "prep",
        "preparation",
        {
            "source_id": source_id,
            "parser_version": parser_version,
            "order_policy": order.to_dict(),
            "missing_value_policy": missing_value.to_dict(),
        },
    )


def representation_identity(
    preparation_id: str, activity_projection: PolicyChoice
) -> str:
    return _derived(
        "repr",
        "representation",
        {
            "preparation_id": preparation_id,
            "activity_projection_policy": activity_projection.to_dict(),
        },
    )


def case_dictionary_identity(preparation_id: str, incident_ids: Sequence[str]) -> str:
    return _derived(
        "dict",
        "case_dictionary",
        {"preparation_id": preparation_id, "incident_ids": list(incident_ids)},
    )


def population_identity(
    representation_id: str, case_dictionary_id: str, membership: Iterable[str]
) -> str:
    return _derived(
        "pop",
        "population",
        {
            "representation_id": representation_id,
            "case_dictionary_id": case_dictionary_id,
            "members": sorted(set(membership)),
        },
    )


def identify(
    source: bytes,
    policies: AppliedPolicies,
    *,
    incident_ids: Sequence[str],
    membership: Iterable[str],
) -> Identities:
    """Derive the whole chain of identities for a population of a source."""
    source_id = source_identity(source)
    preparation_id = preparation_identity(
        source_id, PARSER_VERSION, policies.order, policies.missing_value
    )
    representation_id = representation_identity(
        preparation_id, policies.activity_projection
    )
    case_dictionary_id = case_dictionary_identity(preparation_id, incident_ids)
    return Identities(
        source_id=source_id,
        preparation_id=preparation_id,
        representation_id=representation_id,
        case_dictionary_id=case_dictionary_id,
        population_id=population_identity(
            representation_id, case_dictionary_id, membership
        ),
        parser_version=PARSER_VERSION,
        implementation_version=IMPLEMENTATION_VERSION,
    )


def _derived(prefix: str, kind: str, parts: Mapping[str, object]) -> str:
    digest = hashlib.sha256(canonical_json({"kind": kind, **parts})).hexdigest()
    return f"{prefix}_{digest}"
