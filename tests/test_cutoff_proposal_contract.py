"""Cutoff proposals preserve clock interpretation and explicit unavailable values."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
import pytest

from wise_platform_api.generated.imports import ImportMessage, CutoffProposalAnswer

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/import.schema.json").read_text())
EXAMPLES = json.loads(
    (ROOT / "tests/fixtures/imports/cutoff-proposal-examples.json").read_text()
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_cutoff_proposal_and_existing_request_have_generated_shapes(name):
    for side in ("request", "answer"):
        value = EXAMPLES[name][side]
        VALIDATOR.validate(value)
        model = ImportMessage.model_validate_json(json.dumps(value), strict=True)
        assert model.model_dump(mode="json") == value


@pytest.mark.parametrize("clock", ["utc", "wall"])
@pytest.mark.parametrize(
    "mutation", ["mixed-clock", "null-last", "unsafe-revision", "extra-field"]
)
def test_cutoff_proposal_refuses_inconsistent_clock_or_envelope(clock, mutation):
    value = deepcopy(EXAMPLES[clock + ".known"]["answer"])
    if mutation == "mixed-clock":
        other = "wall" if clock == "utc" else "utc"
        value["proposed_cutoff"] = EXAMPLES[other + ".known"]["answer"][
            "proposed_cutoff"
        ]
    elif mutation == "null-last":
        value["last_usable_time"] = None
    elif mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    else:
        value["invented"] = True
    assert not VALIDATOR.is_valid(value)
    # Datetime models can parse more lexical forms than the source schema admits.
    if mutation != "mixed-clock" or clock == "wall":
        with pytest.raises(ValidationError):
            CutoffProposalAnswer.model_validate_json(json.dumps(value), strict=True)


@pytest.mark.parametrize("clock", ["utc", "wall"])
def test_known_last_time_can_have_no_representable_rounded_proposal(clock):
    value = EXAMPLES[clock + ".unroundable"]["answer"]
    assert value["last_usable_time"].startswith("9999-12-31T23:59:59.999999")
    assert value["proposed_cutoff"] is None
    VALIDATOR.validate(value)
    assert (
        CutoffProposalAnswer.model_validate_json(
            json.dumps(value), strict=True
        ).model_dump(mode="json")
        == value
    )


@pytest.mark.parametrize(
    "timestamp",
    [
        "2026-10-09T10:00:00.1234567Z",
        "2026-10-09T11:00:00+01:00",
        "2026-02-30T10:00:00Z",
    ],
)
def test_authoritative_utc_proposal_requires_canonical_precision_and_calendar(
    timestamp,
):
    value = deepcopy(EXAMPLES["utc.known"]["answer"])
    value["last_usable_time"] = timestamp
    assert not VALIDATOR.is_valid(value)
