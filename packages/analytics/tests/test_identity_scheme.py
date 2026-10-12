"""The identity scheme: what each identity is made of and when it changes."""

import hashlib
import json
import re

import pytest

from wise_platform_analytics.identities import (
    Identities,
    case_dictionary_identity,
    identify,
    population_identity,
    preparation_identity,
    representation_identity,
    source_identity,
)
from wise_platform_analytics.policies import AppliedPolicies, PolicyChoice

ORDER = PolicyChoice("order.v1")
MISSING_VALUE = PolicyChoice("missing.v1")
PROJECTION = PolicyChoice("projection.v1")
POLICIES = AppliedPolicies(
    order=ORDER, missing_value=MISSING_VALUE, activity_projection=PROJECTION
)


def sha256(text: bytes) -> str:
    return hashlib.sha256(text).hexdigest()


def test_the_source_identity_is_the_sha256_of_the_bytes():
    assert (
        source_identity(b"abc")
        == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


def test_the_preparation_identity_is_made_of_source_parser_order_and_missing_value_policy():
    canonical = (
        b'{"kind":"preparation",'
        b'"missing_value_policy":{"parameters":{},"policy_id":"missing.v1"},'
        b'"order_policy":{"parameters":{},"policy_id":"order.v1"},'
        b'"parser_version":"parser.v1",'
        b'"source_id":"00ff"}'
    )

    assert preparation_identity(
        "00ff", "parser.v1", ORDER, MISSING_VALUE
    ) == "prep_" + sha256(canonical)


def test_the_representation_identity_is_made_of_preparation_and_activity_projection():
    canonical = (
        b'{"activity_projection_policy":{"parameters":{},"policy_id":"projection.v1"},'
        b'"kind":"representation",'
        b'"preparation_id":"prep_1"}'
    )

    assert representation_identity("prep_1", PROJECTION) == "repr_" + sha256(canonical)


def test_the_case_dictionary_identity_is_made_of_preparation_and_the_ordered_incident_ids():
    canonical = b'{"incident_ids":["B","A","\\u00dc 1"],"kind":"case_dictionary","preparation_id":"prep_1"}'

    assert case_dictionary_identity("prep_1", ["B", "A", "Ü 1"]) == "dict_" + sha256(
        canonical
    )


def test_the_population_identity_is_made_of_representation_dictionary_and_sorted_members():
    canonical = (
        b'{"case_dictionary_id":"dict_1",'
        b'"kind":"population",'
        b'"members":["A","B","a"],'
        b'"representation_id":"repr_1"}'
    )

    assert population_identity("repr_1", "dict_1", ["a", "B", "A"]) == "pop_" + sha256(
        canonical
    )


def test_policy_parameters_are_part_of_an_identity():
    with_parameters = PolicyChoice("order.v1", {"strict": True, "limit": 3})
    canonical = (
        b'{"kind":"preparation",'
        b'"missing_value_policy":{"parameters":{},"policy_id":"missing.v1"},'
        b'"order_policy":{"parameters":{"limit":3,"strict":true},"policy_id":"order.v1"},'
        b'"parser_version":"parser.v1",'
        b'"source_id":"00ff"}'
    )

    assert preparation_identity(
        "00ff", "parser.v1", with_parameters, MISSING_VALUE
    ) == "prep_" + sha256(canonical)


@pytest.mark.parametrize(
    "changed",
    [
        ("00fe", "parser.v1", ORDER, MISSING_VALUE),
        ("00ff", "parser.v2", ORDER, MISSING_VALUE),
        ("00ff", "parser.v1", PolicyChoice("order.v2"), MISSING_VALUE),
        (
            "00ff",
            "parser.v1",
            PolicyChoice("order.v1", {"strict": True}),
            MISSING_VALUE,
        ),
        ("00ff", "parser.v1", ORDER, PolicyChoice("missing.v2")),
        ("00ff", "parser.v1", MISSING_VALUE, ORDER),
    ],
)
def test_every_part_of_a_preparation_changes_its_identity(changed):
    assert preparation_identity(*changed) != preparation_identity(
        "00ff", "parser.v1", ORDER, MISSING_VALUE
    )


def test_every_part_of_the_other_identities_changes_them():
    assert representation_identity("prep_2", PROJECTION) != representation_identity(
        "prep_1", PROJECTION
    )
    assert representation_identity(
        "prep_1", PolicyChoice("projection.v2")
    ) != representation_identity("prep_1", PROJECTION)
    assert case_dictionary_identity("prep_2", ["A", "B"]) != case_dictionary_identity(
        "prep_1", ["A", "B"]
    )
    assert case_dictionary_identity("prep_1", ["A"]) != case_dictionary_identity(
        "prep_1", ["A", "B"]
    )
    assert population_identity("repr_2", "dict_1", ["A"]) != population_identity(
        "repr_1", "dict_1", ["A"]
    )
    assert population_identity("repr_1", "dict_2", ["A"]) != population_identity(
        "repr_1", "dict_1", ["A"]
    )
    assert population_identity("repr_1", "dict_1", ["A", "B"]) != population_identity(
        "repr_1", "dict_1", ["A"]
    )


def test_the_case_dictionary_depends_on_the_order_of_incidents_and_the_population_does_not():
    assert case_dictionary_identity("prep_1", ["A", "B"]) != case_dictionary_identity(
        "prep_1", ["B", "A"]
    )
    assert population_identity("repr_1", "dict_1", ["A", "B"]) == population_identity(
        "repr_1", "dict_1", ["B", "A"]
    )


def test_identities_of_different_kinds_never_coincide():
    assert case_dictionary_identity("x", []) != population_identity("x", "x", [])
    assert preparation_identity("x", "x", ORDER, ORDER) != representation_identity(
        "x", ORDER
    )


def test_the_whole_chain_is_derived_from_the_bytes_the_policies_and_the_incidents():
    identities = identify(
        b"abc", POLICIES, incident_ids=["B", "A"], membership=["B", "A"]
    )

    assert identities.source_id == source_identity(b"abc")
    assert identities.preparation_id == preparation_identity(
        identities.source_id, identities.parser_version, ORDER, MISSING_VALUE
    )
    assert identities.representation_id == representation_identity(
        identities.preparation_id, PROJECTION
    )
    assert identities.case_dictionary_id == case_dictionary_identity(
        identities.preparation_id, ["B", "A"]
    )
    assert identities.population_id == population_identity(
        identities.representation_id, identities.case_dictionary_id, ["A", "B"]
    )
    assert identities.parser_version == "incident.event_history_csv.v1"
    assert identities.implementation_version == "0.1.0"


def test_identities_have_a_fixed_readable_shape():
    identities = identify(b"abc", POLICIES, incident_ids=["A"], membership=["A"])

    assert re.fullmatch(r"[0-9a-f]{64}", identities.source_id)
    assert re.fullmatch(r"prep_[0-9a-f]{64}", identities.preparation_id)
    assert re.fullmatch(r"repr_[0-9a-f]{64}", identities.representation_id)
    assert re.fullmatch(r"dict_[0-9a-f]{64}", identities.case_dictionary_id)
    assert re.fullmatch(r"pop_[0-9a-f]{64}", identities.population_id)


def test_the_same_inputs_always_give_the_same_identities():
    first = identify(b"abc", POLICIES, incident_ids=["A", "B"], membership=["A", "B"])
    again = identify(
        bytes(b"abc"), POLICIES, incident_ids=("A", "B"), membership=iter(["B", "A"])
    )

    assert first == again


def test_changing_the_bytes_changes_every_identity():
    first = identify(b"abc", POLICIES, incident_ids=["A"], membership=["A"])
    other = identify(b"abd", POLICIES, incident_ids=["A"], membership=["A"])

    assert first.source_id != other.source_id
    assert first.preparation_id != other.preparation_id
    assert first.representation_id != other.representation_id
    assert first.case_dictionary_id != other.case_dictionary_id
    assert first.population_id != other.population_id


def test_changing_the_order_policy_changes_the_preparation_and_all_that_follows():
    changed = AppliedPolicies(
        order=PolicyChoice("order.v2"),
        missing_value=MISSING_VALUE,
        activity_projection=PROJECTION,
    )

    first = identify(b"abc", POLICIES, incident_ids=["A"], membership=["A"])
    other = identify(b"abc", changed, incident_ids=["A"], membership=["A"])

    assert first.source_id == other.source_id
    assert first.preparation_id != other.preparation_id
    assert first.representation_id != other.representation_id
    assert first.case_dictionary_id != other.case_dictionary_id
    assert first.population_id != other.population_id


def test_changing_the_activity_projection_changes_the_representation_but_not_the_preparation():
    changed = AppliedPolicies(
        order=ORDER,
        missing_value=MISSING_VALUE,
        activity_projection=PolicyChoice("projection.v2"),
    )

    first = identify(b"abc", POLICIES, incident_ids=["A"], membership=["A"])
    other = identify(b"abc", changed, incident_ids=["A"], membership=["A"])

    assert first.preparation_id == other.preparation_id
    assert first.case_dictionary_id == other.case_dictionary_id
    assert first.representation_id != other.representation_id
    assert first.population_id != other.population_id


def test_changing_the_membership_changes_only_the_population():
    first = identify(b"abc", POLICIES, incident_ids=["A", "B"], membership=["A", "B"])
    other = identify(b"abc", POLICIES, incident_ids=["A", "B"], membership=["A"])

    assert first.case_dictionary_id == other.case_dictionary_id
    assert first.representation_id == other.representation_id
    assert first.population_id != other.population_id


def test_identities_are_plain_json_when_asked():
    identities = identify(b"abc", POLICIES, incident_ids=["A"], membership=["A"])

    as_dict = identities.to_dict()

    assert as_dict == {
        "source_id": identities.source_id,
        "preparation_id": identities.preparation_id,
        "representation_id": identities.representation_id,
        "case_dictionary_id": identities.case_dictionary_id,
        "population_id": identities.population_id,
        "parser_version": identities.parser_version,
        "implementation_version": identities.implementation_version,
    }
    assert json.loads(json.dumps(as_dict)) == as_dict
    assert isinstance(identities, Identities)
