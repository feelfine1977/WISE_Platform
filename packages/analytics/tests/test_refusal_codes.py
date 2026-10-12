"""The refusal record and its closed set of codes."""

import json
from dataclasses import FrozenInstanceError

import pytest

from wise_platform_analytics.refusals import Refusal, RefusalCode


def test_the_set_of_codes_is_closed():
    assert {code.value for code in RefusalCode} == {
        "malformed_source",
        "unknown_policy",
        "unsupported_parameter",
        "missing_policy",
        "identity_mismatch",
        "unknown_case",
    }


def test_a_code_compares_equal_to_its_text():
    assert RefusalCode.UNKNOWN_CASE == "unknown_case"
    assert str(RefusalCode.UNKNOWN_CASE) == "unknown_case"


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
