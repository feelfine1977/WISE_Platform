"""Stable identities of sources, interpretations, populations and rows.

The scheme depends only on the inputs named here, never on the machine, the
run, the locale or the implementation version.

Every identity is written ``<kind>.v1:sha256:<digest>``: the kind of thing it
identifies, the version of this scheme, and 64 lowercase hexadecimal digits.

* The digest of a source identity is the SHA-256 of the source bytes.
* The digest of every derived identity is the SHA-256 of the canonical JSON
  of its named parts. Canonical JSON has its keys sorted, no whitespace and
  only ASCII characters (anything else is escaped), and always carries a
  ``kind`` so identities of different kinds cannot coincide.

==================  ===============  =========================================
Identity            Written kind     Named parts
==================  ===============  =========================================
source              source           (the bytes)
preparation         preparation      source identity, parser version, order
                                     policy, missing-value policy
representation      representation   preparation identity, activity projection
                                     policy
case dictionary     case-dictionary  preparation identity, incident ids in
                                     their order of first appearance in the
                                     source
population          population       representation identity, case dictionary
                                     identity, parent policy, predicate
                                     policy, parent incident ids sorted by
                                     code point
row                 row              source identity, source position
==================  ===============  =========================================

A policy enters as its identifier and its parameters. Changing the bytes or a
policy therefore changes every identity that depends on it, and nothing else.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, fields

from .parsing import PARSER_VERSION
from .policies import AppliedPolicies, PolicyChoice
from .version import IMPLEMENTATION_VERSION

SCHEME_VERSION = "v1"


@dataclass(frozen=True)
class Identities:
    """The identities an answer is bound to, with the implementation that produced it."""

    source_id: str
    preparation_id: str
    representation_id: str
    case_dictionary_id: str
    population_id: str
    implementation_version: str

    def first_difference(self, other: Identities) -> str | None:
        """Name the first field in which ``other`` differs, or ``None`` if none does."""
        for item in fields(self):
            if getattr(self, item.name) != getattr(other, item.name):
                return item.name
        return None

    def to_dict(self) -> dict[str, object]:
        return {item.name: getattr(self, item.name) for item in fields(self)}


def canonical_json(parts: Mapping[str, object]) -> bytes:
    """Serialise named parts in the one form used for hashing."""
    return json.dumps(
        parts, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("ascii")


def source_identity(source: bytes) -> str:
    return _written("source", hashlib.sha256(source).hexdigest())


def preparation_identity(
    source_id: str,
    parser_version: str,
    order: PolicyChoice,
    missing_values: PolicyChoice,
) -> str:
    return _derived(
        "preparation",
        "preparation",
        {
            "source_id": source_id,
            "parser_version": parser_version,
            "order_policy": order.to_dict(),
            "missing_values_policy": missing_values.to_dict(),
        },
    )


def representation_identity(
    preparation_id: str, activity_projection: PolicyChoice
) -> str:
    return _derived(
        "representation",
        "representation",
        {
            "preparation_id": preparation_id,
            "activity_projection_policy": activity_projection.to_dict(),
        },
    )


def case_dictionary_identity(preparation_id: str, incident_ids: Sequence[str]) -> str:
    return _derived(
        "case-dictionary",
        "case_dictionary",
        {"preparation_id": preparation_id, "incident_ids": list(incident_ids)},
    )


def population_identity(
    representation_id: str,
    case_dictionary_id: str,
    parent: PolicyChoice,
    predicate: PolicyChoice,
    members: Iterable[str],
) -> str:
    return _derived(
        "population",
        "population",
        {
            "representation_id": representation_id,
            "case_dictionary_id": case_dictionary_id,
            "parent_policy": parent.to_dict(),
            "predicate_policy": predicate.to_dict(),
            "members": sorted(set(members)),
        },
    )


def row_identity(source_id: str, source_position: int) -> str:
    return _derived(
        "row", "row", {"source_id": source_id, "source_position": source_position}
    )


def identify(
    source: bytes,
    policies: AppliedPolicies,
    *,
    incident_ids: Sequence[str],
    members: Iterable[str],
) -> Identities:
    """Derive the whole chain of identities for a population of a source.

    ``incident_ids`` are all incidents of the source in order of first
    appearance; ``members`` are the incidents of the parent population.
    """
    source_id = source_identity(source)
    preparation_id = preparation_identity(
        source_id, PARSER_VERSION, policies.order, policies.missing_values
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
            representation_id,
            case_dictionary_id,
            policies.parent,
            policies.predicate,
            members,
        ),
        implementation_version=IMPLEMENTATION_VERSION,
    )


def _derived(written_kind: str, kind: str, parts: Mapping[str, object]) -> str:
    digest = hashlib.sha256(canonical_json({"kind": kind, **parts})).hexdigest()
    return _written(written_kind, digest)


def _written(written_kind: str, digest: str) -> str:
    return f"{written_kind}.{SCHEME_VERSION}:sha256:{digest}"
