"""Linked opening context must retain the frozen selection parent identity."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from test_selection_acceptance import (
    client,
    workspace,
    contains,
    envelope,
    imported,
    select,
)

SCHEMA = json.loads(
    (
        Path(__file__).resolve().parents[1] / "contracts/population-views.schema.json"
    ).read_text()
)
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def opening_context(client, workspace, identity):
    request = envelope(
        "opening_context_request",
        "context-parent",
        7,
        workspace_id=workspace["workspace_id"],
        identity=identity,
    )
    VALIDATOR.validate(request)
    response = client.post("/api/investigations/opening-context", json=request)
    assert response.status_code == 200, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    for field in ("request_id", "query_revision", "workspace_id", "identity"):
        assert answer[field] == request[field]
    return answer


def test_unselected_base_context_keeps_its_original_parent_identity(client, workspace):
    base = imported(client, workspace)
    answer = opening_context(client, workspace, base["identity"])
    assert answer["parent_identity"] == base["identity"]
    assert (
        answer["opening_context"]["parent"] == answer["opening_context"]["population"]
    )


@pytest.mark.parametrize("parent", [None, ["T-01", "T-02"], ["T-01"], []])
def test_context_parent_is_the_exact_parent_returned_by_selection(
    client, workspace, parent
):
    base = imported(client, workspace)
    selected = select(client, workspace, base, [contains("Recorded")], parent=parent)
    answer = opening_context(client, workspace, selected["identity"])
    assert answer["parent_identity"] == selected["parent_identity"]
    assert (
        answer["opening_context"]["parent"]["case_count"]
        == selected["parent"]["case_count"]
    )
    assert (
        answer["opening_context"]["population"]["case_count"]
        == selected["kept"]["case_count"]
    )
