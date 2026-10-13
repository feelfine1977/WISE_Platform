"""The default workspace is a bound request, separate from an explicit path."""

from copy import deepcopy
import json
from pathlib import Path

from jsonschema import Draft202012Validator
from pydantic import ValidationError
import pytest

from wise_platform_api.generated.imports import OpenDefaultWorkspaceRequest, OpenWorkspaceRequest


SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "contracts/import.schema.json").read_text())
DEFAULT = {
    "schema_version": 1,
    "message_type": "open_default_workspace_request",
    "request_id": "first-use-1",
    "query_revision": 1,
}


def test_default_workspace_request_has_an_exact_closed_envelope():
    Draft202012Validator(SCHEMA).validate(DEFAULT)
    assert OpenDefaultWorkspaceRequest.model_validate(DEFAULT).model_dump(mode="json") == DEFAULT


@pytest.mark.parametrize("field", ["path", "workspace_id", "silent_guess"])
def test_default_workspace_cannot_smuggle_an_override_or_workspace_binding(field):
    request = DEFAULT | {field: "/not-the-selected-default"}
    assert list(Draft202012Validator(SCHEMA).iter_errors(request))
    with pytest.raises(ValidationError):
        OpenDefaultWorkspaceRequest.model_validate(request)


@pytest.mark.parametrize("revision", [True, "1", -1, 9007199254740992])
def test_default_workspace_keeps_the_existing_exact_revision_domain(revision):
    request = DEFAULT | {"query_revision": revision}
    assert list(Draft202012Validator(SCHEMA).iter_errors(request))


@pytest.mark.parametrize("field", ["schema_version", "request_id", "query_revision"])
def test_default_workspace_initialisation_cannot_be_an_unbound_empty_request(field):
    request = deepcopy(DEFAULT)
    del request[field]
    assert list(Draft202012Validator(SCHEMA).iter_errors(request))


def test_explicit_workspace_path_request_remains_distinct_and_unchanged():
    request = DEFAULT | {"message_type": "open_workspace_request", "path": "/analyst/workspace"}
    Draft202012Validator(SCHEMA).validate(request)
    assert OpenWorkspaceRequest.model_validate(request).model_dump(mode="json") == request
    del request["path"]
    assert list(Draft202012Validator(SCHEMA).iter_errors(request))
