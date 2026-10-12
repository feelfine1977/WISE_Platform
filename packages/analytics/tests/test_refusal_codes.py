"""The refusal record, its closed set of codes, and how each code is reached."""

import json
from dataclasses import FrozenInstanceError

import pytest

from wise_platform_analytics import (
    PolicyChoice,
    PolicySelection,
    PopulationAnswer,
    Refusal,
    RefusalCode,
    open_case,
    open_population,
)

ORDER = "incident.order.timestamp_sequence_source_position.v1"
ACTIVITY_PROJECTION = "incident.activity.omit_missing_retain_raw_gaps.v1"
SOURCE = (
    b"incident_id,source_event_id,source_sequence,activity,timestamp_utc,service,assignment_group\n"
    b"A,a-1,1,Opened,2026-10-01T09:00:00Z,S,Desk\n"
)
SUPPORTED = PolicySelection.of(order=ORDER, activity_projection=ACTIVITY_PROJECTION)

# A source or a selection that neither operation can use, by the code it must be refused with.
UNUSABLE = {
    "malformed_source": (SOURCE.replace(b"09:00:00Z", b"09:00"), SUPPORTED),
    "unknown_policy": (
        SOURCE,
        PolicySelection.of(order=ORDER + "0", activity_projection=ACTIVITY_PROJECTION),
    ),
    "unsupported_parameter": (
        SOURCE,
        PolicySelection(
            {
                "order": PolicyChoice(ORDER),
                "activity_projection": PolicyChoice(ACTIVITY_PROJECTION, {"keep": 1}),
            }
        ),
    ),
    "missing_policy": (
        SOURCE,
        PolicySelection.of(activity_projection=ACTIVITY_PROJECTION),
    ),
}
# What only the opening of a case can be refused with: (population identity, case).
UNBOUND = {
    "identity_mismatch": ("pop_other", "A"),
    "unknown_case": (None, "Z"),
}


def test_the_set_of_codes_is_closed():
    assert {code.value for code in RefusalCode} == {
        "malformed_source",
        "unknown_policy",
        "unsupported_parameter",
        "missing_policy",
        "identity_mismatch",
        "unknown_case",
    }
    assert set(UNUSABLE) | set(UNBOUND) == {code.value for code in RefusalCode}


def test_a_code_compares_equal_to_its_text():
    assert RefusalCode.UNKNOWN_CASE == "unknown_case"
    assert str(RefusalCode.UNKNOWN_CASE) == "unknown_case"


@pytest.mark.parametrize("code", sorted(UNUSABLE))
def test_both_operations_return_the_same_refusal_for_what_they_cannot_use(code):
    source, selection = UNUSABLE[code]

    from_population = open_population(source, selection)
    from_case = open_case(source, selection, "pop_any", "A")

    assert isinstance(from_population, Refusal), from_population
    assert from_population.code == code
    assert from_population.code is RefusalCode(code)
    assert from_case == from_population


@pytest.mark.parametrize("code", sorted(UNBOUND))
def test_opening_a_case_is_refused_when_it_is_not_bound_to_the_population(code):
    population = open_population(SOURCE, SUPPORTED)
    assert isinstance(population, PopulationAnswer), population
    supplied, case_id = UNBOUND[code]

    refusal = open_case(
        SOURCE, SUPPORTED, supplied or population.identities.population_id, case_id
    )

    assert isinstance(refusal, Refusal), refusal
    assert refusal.code == code


def test_a_refusal_is_plain_json_when_asked():
    refusal = Refusal(
        RefusalCode.UNKNOWN_POLICY,
        "The policy is not registered.",
        {"role": "order", "policy_id": "x.v9", "supported": ("x.v1",), "line": None},
    )

    as_dict = refusal.to_dict()

    assert as_dict == {
        "kind": "refusal",
        "code": "unknown_policy",
        "message": "The policy is not registered.",
        "detail": {
            "role": "order",
            "policy_id": "x.v9",
            "supported": ["x.v1"],
            "line": None,
        },
    }
    assert json.loads(json.dumps(as_dict)) == as_dict


@pytest.mark.parametrize("code", sorted(UNUSABLE))
def test_every_refusal_an_operation_returns_is_plain_json_when_asked(code):
    refusal = open_population(*UNUSABLE[code])
    assert isinstance(refusal, Refusal), refusal

    as_dict = refusal.to_dict()

    assert as_dict["kind"] == "refusal"
    assert as_dict["code"] == code
    assert json.loads(json.dumps(as_dict)) == as_dict


def test_a_refusal_cannot_be_changed_after_it_is_made():
    given = {"case_id": "A"}
    refusal = Refusal(RefusalCode.UNKNOWN_CASE, "No such case.", given)
    given["case_id"] = "B"

    assert refusal.detail == {"case_id": "A"}
    with pytest.raises(FrozenInstanceError):
        refusal.message = "changed"  # type: ignore[misc]
    with pytest.raises(TypeError):
        refusal.detail["case_id"] = "C"  # type: ignore[index]
    assert hash(refusal) == hash(
        Refusal(RefusalCode.UNKNOWN_CASE, "No such case.", {"case_id": "A"})
    )
