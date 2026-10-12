"""The two investigation routes over HTTP: thin handlers around the application module."""

import pytest
from api_requests import EVIDENCE_ROUTE, OPEN_ROUTE, VALIDATOR, evidence_request, open_request
from fastapi.testclient import TestClient

from wise_platform_api.app import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


def test_the_packaged_example_is_opened_and_one_of_its_cases_read(client):
    response = client.post(OPEN_ROUTE, json=open_request("S3", "open-1", 2))
    population = response.json()

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    VALIDATOR.validate(population)
    assert population["source"]["example_id"] == "S3"

    evidence = client.post(EVIDENCE_ROUTE, json=evidence_request(population, "S3B")).json()

    VALIDATOR.validate(evidence)
    assert evidence["message_type"] == "case_evidence_answer"
    assert [record["assignment_group"] for record in evidence["records"]] == [None]


@pytest.mark.parametrize("route", [OPEN_ROUTE, EVIDENCE_ROUTE])
@pytest.mark.parametrize("content", [b"", b"not json", b"[1]", b"[" * 100_000 + b"]" * 100_000])
def test_a_body_that_is_not_a_json_object_is_a_typed_refusal(client, route, content):
    response = client.post(route, content=content, headers={"content-type": "application/json"})

    assert response.status_code == 400
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["code"] == "invalid_request"
    assert answer["operation"] == ("open_example" if route == OPEN_ROUTE else "case_evidence")


def test_the_operations_answer_only_post(client):
    assert client.get(OPEN_ROUTE).status_code in (404, 405)
    assert client.get(EVIDENCE_ROUTE).status_code in (404, 405)


def test_other_api_routes_are_still_not_found(client):
    assert client.post("/api/investigations/other", json={}).status_code == 404
    assert client.get("/api/health").json()["status"] == "ok"


def test_each_application_answers_from_its_own_opened_populations(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as first:
        population = first.post(OPEN_ROUTE, json=open_request("S0")).json()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as second:
        response = second.post(EVIDENCE_ROUTE, json=evidence_request(population, "INC05"))

    assert response.status_code == 409
    assert response.json()["code"] == "identity_mismatch"
