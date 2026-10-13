"""Import provenance and typed-denial regressions over real HTTP operations.

Sources are the existing synthetic B2 fixture; only the API-stored copy under
tmp_path changes.
"""

from contextlib import nullcontext
import hashlib
import json

from fastapi.testclient import TestClient
import pytest

import test_import_acceptance as acceptance
from wise_platform_api.app import create_app
from wise_platform_api import workspace as workspace_module
import wise_platform_analytics

MAX_SAFE_INTEGER = 9007199254740991


def refusal(response, operation, code, request, *, bad_revision=False):
    assert response.status_code == (
        400
        if code == "invalid_request"
        else 404 if code == "source_unavailable" else 409
    ), response.text
    # A plain-text500 or a malformed-Unicode response is not a contract refusal.
    answer = json.loads(response.content.decode("utf-8", errors="strict"))
    acceptance.VALIDATOR.validate(answer)
    assert answer["message_type"] == "import_refusal"
    assert answer["operation"] == operation and answer["code"] == code
    assert answer["message"].strip()
    assert answer["request_id"] in (
        (None, request["request_id"]) if bad_revision else (request["request_id"],)
    )
    expected_revision = None if bad_revision else request["query_revision"]
    assert answer["query_revision"] == expected_revision
    if "workspace_id" in request:
        assert answer["workspace_id"] == request["workspace_id"]
    return answer


@pytest.mark.parametrize("number_text", [str(MAX_SAFE_INTEGER + 1), "1e400"])
def test_bad_numeric_metadata_gets_utf8_schema_refusal_without_invalid_revision_echo(
    tmp_path, number_text
):
    request = acceptance.envelope(
        "open_workspace_request", "denial-1", path=str(tmp_path)
    )
    raw = (
        json.dumps(request)
        .replace('"query_revision": 1', '"query_revision": ' + number_text)
        .encode("utf-8")
    )
    assert number_text.encode() in raw
    with TestClient(
        create_app(static_dir=tmp_path / "unbuilt"), raise_server_exceptions=False
    ) as client:
        response = client.post(
            "/api/workspaces/open",
            content=raw,
            headers={"Content-Type": "application/json"},
        )
    answer = refusal(
        response, "open_workspace", "invalid_request", request, bad_revision=True
    )
    assert answer["query_revision"] is None
    assert (
        list(tmp_path.iterdir()) == []
    ), "A refused request must not create a workspace."


def test_maximum_supported_revision_is_echoed_exactly_on_success(tmp_path):
    request = acceptance.envelope(
        "open_workspace_request", "maximum-1", MAX_SAFE_INTEGER, path=str(tmp_path)
    )
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        answer = acceptance.checked(
            client.post("/api/workspaces/open", json=request),
            "workspace_answer",
            request,
        )
    assert (
        type(answer["query_revision"]) is int
        and answer["query_revision"] == MAX_SAFE_INTEGER
    )


@pytest.mark.parametrize("parameter", ["schema_version", "query_revision"])
def test_oversized_decimal_upload_metadata_is_a_typed_refusal_without_storing_source(
    tmp_path, parameter
):
    open_request = acceptance.envelope(
        "open_workspace_request", "query-denial", path=str(tmp_path)
    )
    with TestClient(
        create_app(static_dir=tmp_path / "unbuilt"), raise_server_exceptions=False
    ) as client:
        workspace = acceptance.checked(
            client.post("/api/workspaces/open", json=open_request),
            "workspace_answer",
            open_request,
        )
        metadata = acceptance.upload_metadata(
            workspace, "synthetic.csv", "query-denial"
        )
        metadata[parameter] = "9" * 5000
        response = client.put(
            "/api/sources",
            params=metadata,
            content=b"Case,Activity,At\nA,Opened,2026-10-01T00:00:00Z\n",
            headers={"Content-Type": "application/octet-stream"},
        )
    assert 400 <= response.status_code < 500, response.text
    answer = json.loads(response.content.decode("utf-8", errors="strict"))
    acceptance.VALIDATOR.validate(answer)
    assert (
        answer["message_type"] == "import_refusal"
        and answer["operation"] == "upload_source"
    )
    assert answer["request_id"] in {None, "query-denial"}
    allowed_revisions = {None} if parameter == "query_revision" else {None, 1}
    assert answer["query_revision"] in allowed_revisions
    assert answer["message"].strip()
    assert not list((tmp_path / "sources").glob("*.csv"))


def test_source_checkout_marker_protects_an_empty_runtime_sibling_without_real_product_writes(
    tmp_path, monkeypatch
):
    # Exercise the production discovery logic with an entirely temporary source checkout.
    checkout = tmp_path / "synthetic-checkout"
    api_file = checkout / "apps" / "api" / "src" / "wise_platform_api" / "workspace.py"
    analytics_file = (
        checkout
        / "packages"
        / "analytics"
        / "src"
        / "wise_platform_analytics"
        / "__init__.py"
    )
    for path in (api_file, analytics_file):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# temporary path marker\n", encoding="utf-8")
    marker = checkout / "pyproject.toml"
    marker.write_text('[project]\nname = "synthetic-checkout"\n', encoding="utf-8")
    runtime_folder = checkout / "analyst-runtime"
    runtime_folder.mkdir()
    monkeypatch.setattr(workspace_module, "__file__", str(api_file))
    monkeypatch.setattr(wise_platform_analytics, "__file__", str(analytics_file))
    request = acceptance.envelope(
        "open_workspace_request", "forbidden-1", path=str(runtime_folder)
    )
    with TestClient(
        create_app(static_dir=tmp_path / "unbuilt"), raise_server_exceptions=False
    ) as client:
        response = client.post("/api/workspaces/open", json=request)
    refusal(response, "open_workspace", "workspace_incompatible", request)
    assert checkout.resolve() in workspace_module.program_folders()
    assert list(runtime_folder.iterdir()) == []
    assert (
        marker.read_text(encoding="utf-8") == '[project]\nname = "synthetic-checkout"\n'
    )


@pytest.mark.parametrize(
    "operation", ["inspect_csv", "open_population", "case_evidence"]
)
@pytest.mark.parametrize("cache_state", ["warm", "cold"])
def test_same_size_changed_authoritative_source_refuses_in_every_cache_state(
    tmp_path, operation, cache_state
):
    folder = tmp_path / "external-synthetic-workspace"
    folder.mkdir()
    open_request = acceptance.envelope(
        "open_workspace_request", "workspace-1", path=str(folder)
    )
    literal, raw, _ = acceptance.read_input("B2")
    with TestClient(
        create_app(static_dir=tmp_path / "unbuilt"), raise_server_exceptions=False
    ) as first:
        workspace = acceptance.checked(
            first.post("/api/workspaces/open", json=open_request),
            "workspace_answer",
            open_request,
        )
        source = acceptance.upload(first, workspace, raw, literal["file"])
        inspect_request = acceptance.envelope(
            "inspect_csv_request",
            "inspect-1",
            workspace_id=workspace["workspace_id"],
            source_id=source["source_id"],
            hints={"encoding": "utf-8-sig", "delimiter": ","},
        )
        acceptance.checked(
            first.post("/api/sources/inspect", json=inspect_request),
            "csv_inspection_answer",
            inspect_request,
        )
        interpretation = acceptance.prepare(
            first, acceptance.mapping_request(workspace, source, "B2")
        )
        population = acceptance.population(first, workspace, interpretation)
        acceptance.evidence(first, workspace, population, "Q-01")
        requests = {
            "inspect_csv": ("/api/sources/inspect", inspect_request),
            "open_population": (
                "/api/investigations/open-population",
                acceptance.envelope(
                    "open_population_request",
                    "population-denial",
                    workspace_id=workspace["workspace_id"],
                    preparation_id=population["identity"]["preparation_id"],
                ),
            ),
            "case_evidence": (
                "/api/investigations/case-evidence",
                acceptance.evidence_request(workspace, population, "Q-01"),
            ),
        }
        digest = hashlib.sha256(raw).hexdigest()
        assert source["source_id"] == "source.v1:sha256:" + digest
        # The documented immutable artifact named by the actual upload receipt.
        stored_source = folder / "sources" / (digest + ".csv")
        assert stored_source.read_bytes() == raw
        changed = raw.replace(b"Q-01", b"R-01")
        assert (
            len(changed) == len(raw) and hashlib.sha256(changed).hexdigest() != digest
        )
        stored_source.write_bytes(changed)
        context = (
            nullcontext(first)
            if cache_state == "warm"
            else TestClient(
                create_app(static_dir=tmp_path / "unbuilt"),
                raise_server_exceptions=False,
            )
        )
        with context as active:
            if cache_state == "cold":
                reopened = acceptance.checked(
                    active.post("/api/workspaces/open", json=open_request),
                    "workspace_answer",
                    open_request,
                )
                assert reopened["workspace_id"] == workspace["workspace_id"]
            route, request = requests[operation]
            response = active.post(route, json=request)
        refusal(response, operation, "source_unavailable", request)
        assert (
            stored_source.read_bytes() == changed
        ), "Refusal must not repair or replace changed bytes silently."
    assert (
        acceptance.read_input("B2")[1] == raw
    ), "The tracked synthetic fixture is never modified."
