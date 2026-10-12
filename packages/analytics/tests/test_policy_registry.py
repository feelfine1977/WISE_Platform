"""Selecting registered policies, and refusing everything else by name."""

import json

import pytest

from wise_platform_analytics.policies import (
    AppliedPolicies,
    PolicyChoice,
    PolicySelection,
    resolve_policies,
)
from wise_platform_analytics.refusals import Refusal, RefusalCode

ORDER = "incident.order.timestamp_sequence_source_position.v1"
ACTIVITY_PROJECTION = "incident.activity.omit_missing_retain_raw_gaps.v1"
MISSING_VALUE = "incident.missing_value.empty_cell_only.v1"


def applied(selection: PolicySelection) -> AppliedPolicies:
    result = resolve_policies(selection)
    assert isinstance(result, AppliedPolicies), result
    return result


def refused(selection: PolicySelection, code: str) -> Refusal:
    result = resolve_policies(selection)
    assert isinstance(result, Refusal), result
    assert result.code == code
    assert result.message
    return result


def test_the_supported_order_and_activity_projection_are_applied():
    result = applied(
        PolicySelection.of(order=ORDER, activity_projection=ACTIVITY_PROJECTION)
    )

    assert result.order == PolicyChoice(ORDER)
    assert result.activity_projection == PolicyChoice(ACTIVITY_PROJECTION)


def test_the_fixed_missing_value_policy_is_named_among_the_applied_policies():
    result = applied(
        PolicySelection.of(order=ORDER, activity_projection=ACTIVITY_PROJECTION)
    )

    assert result.missing_value == PolicyChoice(MISSING_VALUE)
    assert result.to_dict() == {
        "order": {"policy_id": ORDER, "parameters": {}},
        "missing_value": {"policy_id": MISSING_VALUE, "parameters": {}},
        "activity_projection": {"policy_id": ACTIVITY_PROJECTION, "parameters": {}},
    }


def test_a_selection_can_be_written_as_choices_or_as_bare_identifiers():
    from_ids = PolicySelection.of(order=ORDER, activity_projection=ACTIVITY_PROJECTION)
    from_choices = PolicySelection(
        {
            "activity_projection": PolicyChoice(ACTIVITY_PROJECTION),
            "order": PolicyChoice(ORDER),
        }
    )
    from_text = PolicySelection({"order": ORDER, "activity_projection": ACTIVITY_PROJECTION})  # type: ignore[dict-item]

    assert from_ids == from_choices == from_text
    assert applied(from_text) == applied(from_ids)


def test_a_selection_is_plain_json_when_asked():
    selection = PolicySelection(
        {
            "order": PolicyChoice(ORDER, {"limit": 3, "strict": True}),
            "activity_projection": PolicyChoice("x.v1"),
        }
    )

    as_dict = selection.to_dict()

    assert as_dict == {
        "activity_projection": {"policy_id": "x.v1", "parameters": {}},
        "order": {"policy_id": ORDER, "parameters": {"limit": 3, "strict": True}},
    }
    assert json.loads(json.dumps(as_dict)) == as_dict


def test_a_selection_cannot_be_changed_after_it_is_made():
    given = {"order": PolicyChoice(ORDER)}
    selection = PolicySelection(given)
    given["activity_projection"] = PolicyChoice(ACTIVITY_PROJECTION)

    assert set(selection.choices) == {"order"}
    with pytest.raises(TypeError):
        selection.choices["activity_projection"] = PolicyChoice(ACTIVITY_PROJECTION)  # type: ignore[index]
    with pytest.raises(TypeError):
        selection.choices["order"].parameters["limit"] = 1  # type: ignore[index]


@pytest.mark.parametrize(
    ("given", "missing"),
    [
        ({}, "order"),
        ({"activity_projection": ACTIVITY_PROJECTION}, "order"),
        ({"order": ORDER}, "activity_projection"),
    ],
)
def test_a_missing_required_policy_is_refused_by_role(given, missing):
    refusal = refused(PolicySelection.of(**given), "missing_policy")

    assert refusal.detail["role"] == missing
    assert missing in refusal.message
    assert refusal.detail["supported_policy_ids"] == (
        (ORDER,) if missing == "order" else (ACTIVITY_PROJECTION,)
    )


def test_an_unknown_policy_is_refused_by_name():
    refusal = refused(
        PolicySelection.of(
            order="incident.order.source_position_only.v1",
            activity_projection=ACTIVITY_PROJECTION,
        ),
        "unknown_policy",
    )

    assert refusal.detail == {
        "reason": "unknown_id",
        "role": "order",
        "policy_id": "incident.order.source_position_only.v1",
        "supported_policy_ids": (ORDER,),
    }
    assert "incident.order.source_position_only.v1" in refusal.message


@pytest.mark.parametrize("suffix", ["v2", "v0", "v01", "v10"])
def test_an_unknown_version_of_a_known_policy_is_refused_as_a_version(suffix):
    policy_id = ACTIVITY_PROJECTION.removesuffix("v1") + suffix

    refusal = refused(
        PolicySelection.of(order=ORDER, activity_projection=policy_id), "unknown_policy"
    )

    assert refusal.detail == {
        "reason": "unknown_version",
        "role": "activity_projection",
        "policy_id": policy_id,
        "supported_policy_ids": (ACTIVITY_PROJECTION,),
    }


@pytest.mark.parametrize(
    "policy_id",
    [
        "incident.order.timestamp_sequence_source_position",
        "incident.order.timestamp_sequence_source_position.v1 ",
        "INCIDENT.ORDER.TIMESTAMP_SEQUENCE_SOURCE_POSITION.V1",
        "incident.order.timestamp_sequence_source_position.v1.v1",
        ACTIVITY_PROJECTION,
        "",
    ],
)
def test_an_identifier_is_matched_exactly_and_within_its_role(policy_id):
    refusal = refused(
        PolicySelection.of(order=policy_id, activity_projection=ACTIVITY_PROJECTION),
        "unknown_policy",
    )

    assert refusal.detail["reason"] == "unknown_id"
    assert refusal.detail["role"] == "order"
    assert refusal.detail["policy_id"] == policy_id


@pytest.mark.parametrize(
    ("role", "policy_id"),
    [
        (
            "context_projection",
            "incident.context.first_opened_assignment_group_retain_missing.v1",
        ),
        ("parent", "incident.parent.all_service_s_and_has_opened.v1"),
        ("predicate", "incident.predicate.has_recorded_resolved.v1"),
        ("comparison", "incident.comparison.target_removed_reference_kept.v1"),
        (
            "nullable_measure",
            "incident.measure.unevaluable_separate_from_true_false.v1",
        ),
        ("missing_value", MISSING_VALUE),
        ("ordering", ORDER),
    ],
)
def test_a_policy_that_is_not_computed_is_refused_instead_of_silently_ignored(
    role, policy_id
):
    selection = PolicySelection.of(
        **{"order": ORDER, "activity_projection": ACTIVITY_PROJECTION, role: policy_id}
    )

    refusal = refused(selection, "unknown_policy")

    assert refusal.detail == {
        "reason": "unknown_role",
        "role": role,
        "policy_id": policy_id,
        "supported_roles": ("activity_projection", "order"),
    }
    assert role in refusal.message


def test_an_unexpected_parameter_is_refused_by_name():
    selection = PolicySelection(
        {
            "order": PolicyChoice(ORDER, {"descending": True}),
            "activity_projection": PolicyChoice(ACTIVITY_PROJECTION),
        }
    )

    refusal = refused(selection, "unsupported_parameter")

    assert refusal.detail == {
        "role": "order",
        "policy_id": ORDER,
        "parameter": "descending",
    }
    assert "descending" in refusal.message


def test_the_refusal_does_not_depend_on_the_order_in_which_roles_were_given():
    one = PolicySelection.of(order="x.v1", activity_projection="y.v1")
    other = PolicySelection.of(activity_projection="y.v1", order="x.v1")

    assert resolve_policies(one) == resolve_policies(other)
    assert refused(one, "unknown_policy").detail["role"] == "activity_projection"


def test_an_identifier_that_is_not_text_is_refused_rather_than_raising():
    selection = PolicySelection.of(order=1, activity_projection=ACTIVITY_PROJECTION)  # type: ignore[arg-type]

    refusal = refused(selection, "unknown_policy")

    assert refusal.detail["reason"] == "unknown_id"
    assert refusal.detail["policy_id"] == 1
