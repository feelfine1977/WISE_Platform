"""Selecting registered policies, and refusing everything else by name."""

import json

import pytest
from supported_policies import SUPPORTED_CHOICES, selection_with

from wise_platform_analytics.policies import (
    AppliedPolicies,
    PolicyChoice,
    PolicySelection,
    resolve_policies,
)
from wise_platform_analytics.refusals import Refusal

ROLES = (
    "order",
    "missing_values",
    "activity_projection",
    "parent",
    "predicate",
    "comparison",
    "context_projection",
    "clock",
    "nullable_measure",
)
ORDER = "incident.order.timestamp_sequence_source_position.v1"
ACTIVITY_PROJECTION = "incident.activity.omit_missing_retain_raw_gaps.v1"
REMOVE = object()


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


def with_parameters(role: str, **changed: object) -> PolicySelection:
    """The supported selection with some parameters of one role changed or removed."""
    choice = SUPPORTED_CHOICES[role]
    parameters = {**choice.parameters, **changed}
    return selection_with(
        **{
            role: PolicyChoice(
                choice.policy_id,
                {name: value for name, value in parameters.items() if value is not REMOVE},
            )
        }
    )


def test_every_role_of_the_supported_selection_is_applied():
    result = applied(selection_with())

    assert result.by_role() == SUPPORTED_CHOICES
    assert list(result.by_role()) == list(ROLES)


def test_the_applied_policies_are_plain_json_when_asked():
    as_dict = applied(selection_with()).to_dict()

    assert list(as_dict) == list(ROLES)
    assert as_dict["nullable_measure"] == {
        "policy_id": "incident.measure.unevaluable_separate_from_true_false.v1",
        "parameters": {"missing_as_false": False, "missing_endpoint": "unevaluable"},
    }
    assert as_dict["missing_values"] == {
        "policy_id": "incident.missing.empty_activity_context_cells.v1",
        "parameters": {
            "activity_empty_cell": "missing",
            "assignment_group_empty_cell": "missing",
            "literal_Unknown": "value",
        },
    }
    assert json.loads(json.dumps(as_dict)) == as_dict


def test_the_order_in_which_roles_are_given_does_not_matter():
    reversed_choices = dict(reversed(list(SUPPORTED_CHOICES.items())))

    assert applied(PolicySelection(reversed_choices)) == applied(selection_with())


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


@pytest.mark.parametrize("role", ROLES)
def test_every_role_is_required(role):
    refusal = refused(selection_with(**{role: None}), "missing_policy")

    assert refusal.detail == {
        "role": role,
        "supported_policy_ids": (SUPPORTED_CHOICES[role].policy_id,),
    }
    assert role in refusal.message


def test_an_empty_selection_names_the_first_role():
    assert refused(PolicySelection(), "missing_policy").detail["role"] == "order"


@pytest.mark.parametrize("role", ROLES)
def test_an_unknown_policy_is_refused_by_name_in_every_role(role):
    choice = SUPPORTED_CHOICES[role]

    refusal = refused(
        selection_with(**{role: PolicyChoice("unknown-policy.v1", choice.parameters)}),
        "unknown_policy",
    )

    assert refusal.detail == {
        "reason": "unknown_id",
        "role": role,
        "policy_id": "unknown-policy.v1",
        "supported_policy_ids": (choice.policy_id,),
    }
    assert "unknown-policy.v1" in refusal.message


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("suffix", ["v2", "v0", "v01", "v10"])
def test_an_unknown_version_of_a_known_policy_is_refused_as_a_version(role, suffix):
    choice = SUPPORTED_CHOICES[role]
    policy_id = choice.policy_id.removesuffix("v1") + suffix

    refusal = refused(
        selection_with(**{role: PolicyChoice(policy_id, choice.parameters)}),
        "unknown_policy",
    )

    assert refusal.detail == {
        "reason": "unknown_version",
        "role": role,
        "policy_id": policy_id,
        "supported_policy_ids": (choice.policy_id,),
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
        selection_with(
            order=PolicyChoice(policy_id, SUPPORTED_CHOICES["order"].parameters)
        ),
        "unknown_policy",
    )

    assert refusal.detail["reason"] == "unknown_id"
    assert refusal.detail["role"] == "order"
    assert refusal.detail["policy_id"] == policy_id


@pytest.mark.parametrize(
    ("role", "policy_id"),
    [
        ("missing_value", "incident.missing_value.empty_cell_only.v1"),
        ("ordering", ORDER),
        ("outcome", "incident.outcome.no_recorded_resolution.v1"),
    ],
)
def test_an_unknown_role_is_refused_instead_of_silently_ignored(role, policy_id):
    refusal = refused(selection_with(**{role: PolicyChoice(policy_id)}), "unknown_policy")

    assert refusal.detail == {
        "reason": "unknown_role",
        "role": role,
        "policy_id": policy_id,
        "supported_roles": tuple(sorted(ROLES)),
    }
    assert role in refusal.message


def test_an_unexpected_parameter_is_refused_by_name():
    refusal = refused(with_parameters("parent", fallback="guess"), "unsupported_parameter")

    assert refusal.detail == {
        "reason": "unknown_parameter",
        "role": "parent",
        "policy_id": "incident.parent.all_service_s_and_has_opened.v1",
        "parameter": "fallback",
    }
    assert "fallback" in refusal.message


@pytest.mark.parametrize("role", ROLES)
def test_a_missing_parameter_is_refused_by_name_in_every_role(role):
    first = next(iter(SUPPORTED_CHOICES[role].parameters))

    refusal = refused(with_parameters(role, **{first: REMOVE}), "unsupported_parameter")

    assert refusal.detail == {
        "reason": "missing_parameter",
        "role": role,
        "policy_id": SUPPORTED_CHOICES[role].policy_id,
        "parameter": first,
    }


def test_a_choice_without_any_parameters_is_refused():
    refusal = refused(
        selection_with(clock=PolicyChoice("incident.clock.elapsed_utc_hours.v1")),
        "unsupported_parameter",
    )

    assert refusal.detail["reason"] == "missing_parameter"
    assert refusal.detail["parameter"] == "timestamp_field"


@pytest.mark.parametrize(
    ("role", "parameter", "value"),
    [
        ("parent", "service", "T"),
        ("parent", "service", "s"),
        ("parent", "contains_activity", "Resolved"),
        ("predicate", "contains_activity", "Opened"),
        ("comparison", "target", "kept"),
        ("order", "primary", "timestamp_utc_descending"),
        ("missing_values", "literal_Unknown", "missing"),
        ("nullable_measure", "missing_as_false", True),
        ("clock", "unit", "minutes"),
    ],
)
def test_an_unsupported_parameter_value_is_refused(role, parameter, value):
    refusal = refused(with_parameters(role, **{parameter: value}), "unsupported_parameter")

    assert refusal.detail["reason"] == "unsupported_value"
    assert refusal.detail["role"] == role
    assert refusal.detail["parameter"] == parameter
    assert refusal.detail["value"] == value
    assert refusal.detail["supported_value"] == SUPPORTED_CHOICES[role].parameters[parameter]


@pytest.mark.parametrize("value", ["false", 0, None, [], {}])
def test_a_value_of_another_type_is_refused_even_when_it_compares_equal(value):
    refusal = refused(
        with_parameters("nullable_measure", missing_as_false=value),
        "unsupported_parameter",
    )

    assert refusal.detail["reason"] == "unsupported_value"
    assert refusal.detail["supported_value"] is False


def test_the_refusal_does_not_depend_on_the_order_in_which_roles_were_given():
    one = PolicySelection.of(order="x.v1", activity_projection="y.v1")
    other = PolicySelection.of(activity_projection="y.v1", order="x.v1")

    assert resolve_policies(one) == resolve_policies(other)
    assert refused(one, "unknown_policy").detail["role"] == "activity_projection"


def test_an_identifier_that_is_not_text_is_refused_rather_than_raising():
    selection = selection_with(order=PolicyChoice(1))  # type: ignore[arg-type]

    refusal = refused(selection, "unknown_policy")

    assert refusal.detail["reason"] == "unknown_id"
    assert refusal.detail["policy_id"] == 1
