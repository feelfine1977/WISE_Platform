"""A packaged example taken into a workspace: its exact bytes, then the ordinary import operations."""

import hashlib

from fastapi.testclient import TestClient
from import_requests import envelope, policies
from test_import_operations import answered, client, folder, stored, workspace_id  # noqa: F401 (fixtures)

from wise_platform_api.app import create_app
from wise_platform_api.examples import PACKAGED_EXAMPLES


def test_the_bytes_of_a_packaged_example_are_sent_unchanged(client):
    response = client.get("/api/examples/S3/source")

    assert response.status_code == 200
    assert response.content == (PACKAGED_EXAMPLES / "S3.csv").read_bytes()
    assert response.headers["content-type"] == "text/csv; charset=utf-8"


def test_an_example_the_application_does_not_ship_is_not_found(client):
    assert client.get("/api/examples/S9/source").status_code == 404
    assert client.get("/api/examples/s3/source").status_code == 404


def test_an_example_whose_bytes_cannot_be_read_is_unavailable(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt", examples_dir=tmp_path / "empty")) as active:
        response = active.get("/api/examples/S3/source")

    assert response.status_code == 503
    assert "S3" in response.json()["detail"]


def test_an_example_is_prepared_through_the_ordinary_operations(client, workspace_id):
    raw = client.get("/api/examples/S3/source").content
    source = stored(client, workspace_id, raw, "Synthetic example S3.csv")
    chosen = policies("iso8601", None, tolerant=True, cutoff="2026-10-02T00:00:00Z")
    request = envelope(
        "confirm_mapping_request", workspace_id=workspace_id, source_id=source["source_id"],
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 3, "timestamp_column": 4, "sequence_column": 2,
                 "context_columns": [5, 6]},
        policies=chosen, accept_report_issues=False)

    ready = answered(client.post("/api/preparations", json=request))
    population = answered(client.post("/api/investigations/open-population", json=envelope(
        "open_population_request", workspace_id=workspace_id, preparation_id=ready["preparation"]["preparation_id"])))
    evidence = answered(client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", workspace_id=workspace_id, identity=population["identity"], case_id="S3B")))

    assert source["source_id"] == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    assert ready["state"] == "ready"
    assert (ready["report"]["raw_record_count"], ready["report"]["case_count"]) == (2, 2)
    assert population["population"]["case_ids"] == ["S3A", "S3B"]
    assert population["source"]["filename"] == "Synthetic example S3.csv"
    # S3B has no assignment group; it stays missing beside S3A's literal Unknown.
    assert evidence["records"][0]["context"] == [{"column_index": 5, "value": "S"}, {"column_index": 6, "value": None}]
