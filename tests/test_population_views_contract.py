"""Opening context and variants share a closed, generated message boundary."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
import pytest

from wise_platform_api.generated.population_views import PopulationViewMessage

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts/population-views.schema.json").read_text())
EXAMPLES = json.loads(
    (ROOT / "tests/fixtures/population-views/contract-examples.json").read_text()
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


@pytest.mark.parametrize("name", list(EXAMPLES))
def test_population_view_examples_preserve_their_generated_wire_shape(name):
    Draft202012Validator.check_schema(SCHEMA)
    value = EXAMPLES[name]
    VALIDATOR.validate(value)
    model = PopulationViewMessage.model_validate_json(json.dumps(value), strict=True)
    assert model.model_dump(mode="json") == value


@pytest.mark.parametrize(
    "mutation",
    [
        "null-value",
        "literal-missing",
        "unsafe-count",
        "fractional-count",
        "boolean-count",
        "unsafe-revision",
        "negative-share",
        "excess-share",
        "wrong-anchor",
        "extra-field",
    ],
)
def test_context_refuses_ambiguous_categories_and_unrepresentable_support(mutation):
    value = deepcopy(EXAMPLES["opening_context.parent.answer"])
    context = value["opening_context"]
    literal, missing = context["columns"][0]["categories"]
    if mutation == "null-value":
        literal["value"] = None
    elif mutation == "literal-missing":
        missing["value"] = "Unknown"
    elif mutation == "unsafe-count":
        context["population"]["case_count"] = 9007199254740992
    elif mutation == "fractional-count":
        context["population"]["case_count"] = 1.5
    elif mutation == "boolean-count":
        context["population"]["case_count"] = True
    elif mutation == "unsafe-revision":
        value["query_revision"] = 9007199254740992
    elif mutation == "negative-share":
        literal["population"]["share"] = -0.1
    elif mutation == "excess-share":
        literal["population"]["share"] = 1.1
    elif mutation == "wrong-anchor":
        context["anchor_policy"] = "latest_nonnull"
    else:
        value["invented"] = 1
    assert not VALIDATOR.is_valid(value)
    with pytest.raises(ValidationError):
        PopulationViewMessage.model_validate_json(json.dumps(value), strict=True)


@pytest.mark.parametrize("mutation", ["empty-membership", "invalid-id", "empty-label"])
def test_variants_preserve_explicit_membership_and_activity_projection(mutation):
    value = deepcopy(EXAMPLES["variants.parent.answer"])
    variant = value["variants"]["variants"][0]
    if mutation == "empty-membership":
        variant["case_ids"] = []
    elif mutation == "invalid-id":
        variant["id"] = "variant:A"
    else:
        variant["activities"] = [""]
    assert not VALIDATOR.is_valid(value)
    with pytest.raises(ValidationError):
        PopulationViewMessage.model_validate_json(json.dumps(value), strict=True)


def test_source_boundary_rejects_duplicate_variant_membership():
    value = deepcopy(EXAMPLES["variants.parent.answer"])
    variant = value["variants"]["variants"][0]
    variant["case_ids"] = [variant["case_ids"][0]] * 2
    assert not VALIDATOR.is_valid(value)


def test_population_identity_definitions_match_the_selection_boundary():
    selection = json.loads((ROOT / "contracts/selection.schema.json").read_text())
    for name in (
        "AnswerIdentity",
        "CaseId",
        "SourceId",
        "PreparationId",
        "RepresentationId",
        "CaseDictionaryId",
        "PopulationId",
        "ImplementationVersion",
        "RequestId",
        "QueryRevision",
        "WorkspaceId",
    ):
        assert SCHEMA["$defs"][name] == selection["$defs"][name]
