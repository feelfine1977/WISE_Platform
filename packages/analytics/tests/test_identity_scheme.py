"""The identity scheme: what each identity is made of and when it changes."""

import hashlib
import json
import re
from dataclasses import replace

import pytest

from wise_platform_analytics.identities import (
    Identities,
    case_dictionary_identity,
    identify,
    population_identity,
    preparation_identity,
    representation_identity,
    row_identity,
    source_identity,
)
from wise_platform_analytics.policies import AppliedPolicies, PolicyChoice

ORDER = PolicyChoice("order.v1")
MISSING_VALUES = PolicyChoice("missing.v1")
PROJECTION = PolicyChoice("projection.v1")
PARENT = PolicyChoice("parent.v1")
PREDICATE = PolicyChoice("predicate.v1")
POLICIES = AppliedPolicies(
    order=ORDER,
    missing_values=MISSING_VALUES,
    activity_projection=PROJECTION,
    parent=PARENT,
    predicate=PREDICATE,
    comparison=PolicyChoice("comparison.v1"),
    context_projection=PolicyChoice("context.v1"),
    clock=PolicyChoice("clock.v1"),
    nullable_measure=PolicyChoice("measure.v1"),
)


def sha256(text: bytes) -> str:
    return hashlib.sha256(text).hexdigest()


def test_the_source_identity_is_the_sha256_of_the_bytes():
    assert (
        source_identity(b"abc")
        == "source.v1:sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


def test_the_preparation_identity_is_made_of_source_parser_order_and_missing_values_policy():
    canonical = (
        b'{"kind":"preparation",'
        b'"missing_values_policy":{"parameters":{},"policy_id":"missing.v1"},'
        b'"order_policy":{"parameters":{},"policy_id":"order.v1"},'
        b'"parser_version":"parser.v1",'
        b'"source_id":"s"}'
    )

    assert preparation_identity(
        "s", "parser.v1", ORDER, MISSING_VALUES
    ) == "preparation.v1:sha256:" + sha256(canonical)


def test_the_representation_identity_is_made_of_preparation_and_activity_projection():
    canonical = (
        b'{"activity_projection_policy":{"parameters":{},"policy_id":"projection.v1"},'
        b'"kind":"representation",'
        b'"preparation_id":"p"}'
    )

    assert representation_identity(
        "p", PROJECTION
    ) == "representation.v1:sha256:" + sha256(canonical)


def test_the_case_dictionary_identity_is_made_of_preparation_and_the_ordered_incident_ids():
    canonical = b'{"incident_ids":["B","A","\\u00dc 1"],"kind":"case_dictionary","preparation_id":"p"}'

    assert case_dictionary_identity(
        "p", ["B", "A", "Ü 1"]
    ) == "case-dictionary.v1:sha256:" + sha256(canonical)


def test_the_population_identity_is_made_of_representation_dictionary_selection_and_sorted_members():
    canonical = (
        b'{"case_dictionary_id":"d",'
        b'"kind":"population",'
        b'"members":["A","B","a"],'
        b'"parent_policy":{"parameters":{},"policy_id":"parent.v1"},'
        b'"predicate_policy":{"parameters":{},"policy_id":"predicate.v1"},'
        b'"representation_id":"r"}'
    )

    assert population_identity(
        "r", "d", PARENT, PREDICATE, ["a", "B", "A"]
    ) == "population.v1:sha256:" + sha256(canonical)


def test_the_row_identity_is_made_of_source_and_position():
    canonical = b'{"kind":"row","source_id":"s","source_position":0}'

    assert row_identity("s", 0) == "row.v1:sha256:" + sha256(canonical)
    assert row_identity("s", 1) != row_identity("s", 0)
    assert row_identity("t", 0) != row_identity("s", 0)


def test_policy_parameters_are_part_of_an_identity():
    with_parameters = PolicyChoice("order.v1", {"strict": True, "limit": 3})
    canonical = (
        b'{"kind":"preparation",'
        b'"missing_values_policy":{"parameters":{},"policy_id":"missing.v1"},'
        b'"order_policy":{"parameters":{"limit":3,"strict":true},"policy_id":"order.v1"},'
        b'"parser_version":"parser.v1",'
        b'"source_id":"s"}'
    )

    assert preparation_identity(
        "s", "parser.v1", with_parameters, MISSING_VALUES
    ) == "preparation.v1:sha256:" + sha256(canonical)


@pytest.mark.parametrize(
    "changed",
    [
        ("t", "parser.v1", ORDER, MISSING_VALUES),
        ("s", "parser.v2", ORDER, MISSING_VALUES),
        ("s", "parser.v1", PolicyChoice("order.v2"), MISSING_VALUES),
        ("s", "parser.v1", PolicyChoice("order.v1", {"strict": True}), MISSING_VALUES),
        ("s", "parser.v1", ORDER, PolicyChoice("missing.v2")),
        ("s", "parser.v1", MISSING_VALUES, ORDER),
    ],
)
def test_every_part_of_a_preparation_changes_its_identity(changed):
    assert preparation_identity(*changed) != preparation_identity(
        "s", "parser.v1", ORDER, MISSING_VALUES
    )


def test_every_part_of_the_other_identities_changes_them():
    assert representation_identity("p2", PROJECTION) != representation_identity(
        "p1", PROJECTION
    )
    assert representation_identity(
        "p1", PolicyChoice("projection.v2")
    ) != representation_identity("p1", PROJECTION)
    assert case_dictionary_identity("p2", ["A", "B"]) != case_dictionary_identity(
        "p1", ["A", "B"]
    )
    assert case_dictionary_identity("p1", ["A"]) != case_dictionary_identity(
        "p1", ["A", "B"]
    )
    base = ("r1", "d1", PARENT, PREDICATE, ["A"])
    for changed in (
        ("r2", "d1", PARENT, PREDICATE, ["A"]),
        ("r1", "d2", PARENT, PREDICATE, ["A"]),
        ("r1", "d1", PolicyChoice("parent.v2"), PREDICATE, ["A"]),
        ("r1", "d1", PARENT, PolicyChoice("predicate.v2"), ["A"]),
        ("r1", "d1", PARENT, PREDICATE, ["A", "B"]),
    ):
        assert population_identity(*changed) != population_identity(*base)


def test_the_case_dictionary_depends_on_the_order_of_incidents_and_the_population_does_not():
    assert case_dictionary_identity("p", ["A", "B"]) != case_dictionary_identity(
        "p", ["B", "A"]
    )
    assert population_identity(
        "r", "d", PARENT, PREDICATE, ["A", "B"]
    ) == population_identity("r", "d", PARENT, PREDICATE, ["B", "A"])


def test_identities_of_different_kinds_never_coincide():
    assert case_dictionary_identity("x", []).split(":")[-1] != population_identity(
        "x", "x", ORDER, ORDER, []
    ).split(":")[-1]
    assert preparation_identity("x", "x", ORDER, ORDER).split(
        ":"
    )[-1] != representation_identity("x", ORDER).split(":")[-1]


def test_the_whole_chain_is_derived_from_the_bytes_the_policies_and_the_incidents():
    identities = identify(b"abc", POLICIES, incident_ids=["B", "A", "C"], members=["B", "A"])

    assert identities.source_id == source_identity(b"abc")
    assert identities.preparation_id == preparation_identity(
        identities.source_id, "incident.event_history_csv.v1", ORDER, MISSING_VALUES
    )
    assert identities.representation_id == representation_identity(
        identities.preparation_id, PROJECTION
    )
    assert identities.case_dictionary_id == case_dictionary_identity(
        identities.preparation_id, ["B", "A", "C"]
    )
    assert identities.population_id == population_identity(
        identities.representation_id,
        identities.case_dictionary_id,
        PARENT,
        PREDICATE,
        ["A", "B"],
    )
    assert identities.implementation_version == "0.1.0"


def test_identities_have_a_fixed_readable_shape():
    identities = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])

    assert re.fullmatch(r"source\.v1:sha256:[0-9a-f]{64}", identities.source_id)
    assert re.fullmatch(r"preparation\.v1:sha256:[0-9a-f]{64}", identities.preparation_id)
    assert re.fullmatch(
        r"representation\.v1:sha256:[0-9a-f]{64}", identities.representation_id
    )
    assert re.fullmatch(
        r"case-dictionary\.v1:sha256:[0-9a-f]{64}", identities.case_dictionary_id
    )
    assert re.fullmatch(r"population\.v1:sha256:[0-9a-f]{64}", identities.population_id)
    assert re.fullmatch(r"row\.v1:sha256:[0-9a-f]{64}", row_identity("s", 3))


def test_the_same_inputs_always_give_the_same_identities():
    first = identify(b"abc", POLICIES, incident_ids=["A", "B"], members=["A", "B"])
    again = identify(
        bytes(b"abc"), POLICIES, incident_ids=("A", "B"), members=iter(["B", "A"])
    )

    assert first == again


def test_changing_the_bytes_changes_every_identity():
    first = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])
    other = identify(b"abd", POLICIES, incident_ids=["A"], members=["A"])

    assert first.source_id != other.source_id
    assert first.preparation_id != other.preparation_id
    assert first.representation_id != other.representation_id
    assert first.case_dictionary_id != other.case_dictionary_id
    assert first.population_id != other.population_id


def test_changing_the_order_policy_changes_the_preparation_and_all_that_follows():
    changed = replace(POLICIES, order=PolicyChoice("order.v2"))

    first = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])
    other = identify(b"abc", changed, incident_ids=["A"], members=["A"])

    assert first.source_id == other.source_id
    assert first.preparation_id != other.preparation_id
    assert first.representation_id != other.representation_id
    assert first.case_dictionary_id != other.case_dictionary_id
    assert first.population_id != other.population_id


def test_changing_the_activity_projection_changes_the_representation_but_not_the_preparation():
    changed = replace(POLICIES, activity_projection=PolicyChoice("projection.v2"))

    first = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])
    other = identify(b"abc", changed, incident_ids=["A"], members=["A"])

    assert first.preparation_id == other.preparation_id
    assert first.case_dictionary_id == other.case_dictionary_id
    assert first.representation_id != other.representation_id
    assert first.population_id != other.population_id


@pytest.mark.parametrize("role", ["parent", "predicate"])
def test_changing_the_parent_or_predicate_policy_changes_only_the_population(role):
    changed = replace(POLICIES, **{role: PolicyChoice(f"{role}.v2")})

    first = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])
    other = identify(b"abc", changed, incident_ids=["A"], members=["A"])

    assert first.representation_id == other.representation_id
    assert first.case_dictionary_id == other.case_dictionary_id
    assert first.population_id != other.population_id


@pytest.mark.parametrize(
    "role", ["comparison", "context_projection", "clock", "nullable_measure"]
)
def test_policies_that_no_population_depends_on_change_no_identity(role):
    changed = replace(POLICIES, **{role: PolicyChoice(f"{role}.v2")})

    assert identify(b"abc", changed, incident_ids=["A"], members=["A"]) == identify(
        b"abc", POLICIES, incident_ids=["A"], members=["A"]
    )


def test_changing_the_membership_changes_only_the_population():
    first = identify(b"abc", POLICIES, incident_ids=["A", "B"], members=["A", "B"])
    other = identify(b"abc", POLICIES, incident_ids=["A", "B"], members=["A"])

    assert first.case_dictionary_id == other.case_dictionary_id
    assert first.representation_id == other.representation_id
    assert first.population_id != other.population_id


def test_the_first_differing_identity_is_named_in_the_order_of_the_chain():
    identities = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])

    assert identities.first_difference(identities) is None
    assert (
        identities.first_difference(replace(identities, implementation_version="9.9.9"))
        == "implementation_version"
    )
    assert (
        identities.first_difference(
            replace(identities, population_id="p", source_id="s")
        )
        == "source_id"
    )


def test_identities_are_plain_json_when_asked():
    identities = identify(b"abc", POLICIES, incident_ids=["A"], members=["A"])

    as_dict = identities.to_dict()

    assert as_dict == {
        "source_id": identities.source_id,
        "preparation_id": identities.preparation_id,
        "representation_id": identities.representation_id,
        "case_dictionary_id": identities.case_dictionary_id,
        "population_id": identities.population_id,
        "implementation_version": identities.implementation_version,
    }
    assert json.loads(json.dumps(as_dict)) == as_dict
    assert isinstance(identities, Identities)
