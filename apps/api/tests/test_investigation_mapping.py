"""The application module: package answers mapped onto the contract, and refusals onto its codes."""

import pytest
from api_requests import (
    HEADER,
    POLICIES,
    VALIDATOR,
    body,
    evidence_request,
    open_request,
    write_example,
)

import wise_platform_analytics
from wise_platform_analytics import Refusal as PackageRefusal
from wise_platform_analytics import RefusalCode
from wise_platform_api import investigations
from wise_platform_api.investigations import Investigations, refusal_from_package

# P1 and P2 form the parent population (P1 kept, P2 removed); Q has service T
# and is outside. P1's second record has no activity label and a timestamp
# with a fraction of a second.
ROWS = (
    "P1,p1-a,1,Opened,2026-10-01T09:00:00Z,S,Desk",
    "Q,q-a,1,Opened,2026-10-01T09:00:00Z,T,App",
    "P2,p2-a,1,Opened,2026-10-01T09:30:00Z,S,Unknown",
    "P1,p1-b,2,,2026-10-01T10:00:00.25Z,S,",
    "P1,p1-c,3,Resolved,2026-10-01T11:00:00Z,S,Desk",
)


@pytest.fixture
def service(tmp_path):
    write_example(tmp_path, "S0", *ROWS)
    return Investigations(tmp_path)


def opened(service: Investigations, request: dict) -> dict:
    reply = service.open_example(body(request))
    answer = reply.body.model_dump(mode="json")
    assert reply.status == 200, answer
    VALIDATOR.validate(answer)
    return answer


def refused(reply, code: str, status: int) -> dict:
    answer = reply.body.model_dump(mode="json")
    assert reply.status == status, answer
    assert answer["message_type"] == "refusal"
    assert answer["code"] == code, answer
    VALIDATOR.validate(answer)
    return answer


def test_the_population_answer_is_filled_from_the_package(service):
    answer = opened(service, open_request("S0", "open-5", 5))

    assert answer["request_id"] == "open-5"
    assert answer["query_revision"] == 5
    assert answer["populations"] == {
        "base": {"case_ids": ["P1", "Q", "P2"], "case_count": 3, "record_count": 5},
        "parent": {"case_ids": ["P1", "P2"], "case_count": 2, "record_count": 4},
        "kept": {"case_ids": ["P1"], "case_count": 1, "record_count": 3},
        "removed": {"case_ids": ["P2"], "case_count": 1, "record_count": 1},
        "unevaluable": {"case_ids": [], "case_count": 0, "record_count": 0},
        "outside": {"case_ids": ["Q"], "case_count": 1, "record_count": 1},
    }
    assert answer["coverage"] == {
        "raw_record_count": 4,
        "mapped_record_count": 3,
        "omitted_activity_record_count": 1,
    }
    assert answer["cases"] == [
        {"case_id": "P1", "record_count": 3, "mapped_record_count": 2, "omitted_activity_record_count": 1, "partition": "kept"},
        {"case_id": "P2", "record_count": 1, "mapped_record_count": 1, "omitted_activity_record_count": 0, "partition": "removed"},
    ]


def test_the_answer_names_the_example_and_echoes_the_applied_policies(service, tmp_path):
    answer = opened(service, open_request())

    assert answer["source"] == {
        "example_id": "S0",
        "synthetic": True,
        "label": answer["source"]["label"],
        "snapshot_cutoff_utc": "2026-10-02T00:00:00Z",
    }
    assert "synthetic" in answer["source"]["label"].lower()
    assert answer["policies"] == POLICIES
    source = (tmp_path / "S0.csv").read_bytes()
    assert answer["identity"] == wise_platform_analytics.open_population(
        source, investigations.selection_of(open_request()["policies"])
    ).identities.to_dict()


def test_the_case_evidence_is_filled_from_the_package_records(service, tmp_path):
    population = opened(service, open_request("S0", "open-2", 2))

    reply = service.case_evidence(body(evidence_request(population, "P1", "case-2")))
    answer = reply.body.model_dump(mode="json")

    assert reply.status == 200, answer
    VALIDATOR.validate(answer)
    assert (answer["request_id"], answer["query_revision"]) == ("case-2", 2)
    assert answer["identity"] == population["identity"]
    records = answer["records"]
    assert [record["source_position"] for record in records] == [0, 3, 4]
    assert [record["timestamp_utc"] for record in records] == [
        "2026-10-01T09:00:00Z",
        "2026-10-01T10:00:00.250000Z",
        "2026-10-01T11:00:00Z",
    ]
    assert [record["activity"] for record in records] == ["Opened", None, "Resolved"]
    assert [record["assignment_group"] for record in records] == ["Desk", None, "Desk"]
    assert [record["source_sequence"] for record in records] == [1, 2, 3]
    assert records[1]["original_values"] == {
        "incident_id": "P1",
        "source_event_id": "p1-b",
        "source_sequence": "2",
        "activity": "",
        "timestamp_utc": "2026-10-01T10:00:00.25Z",
        "service": "S",
        "assignment_group": "",
    }
    assert answer["mapped_row_ids"] == [records[0]["row_id"], records[2]["row_id"]]
    assert answer["omitted_activity_row_ids"] == [records[1]["row_id"]]
    assert answer["coverage"] == {
        "raw_record_count": 3,
        "mapped_record_count": 2,
        "omitted_activity_record_count": 1,
    }


def test_evidence_of_a_population_that_was_never_opened_is_an_identity_mismatch(service):
    population = opened(Investigations(service.examples_dir), open_request())

    answer = refused(
        service.case_evidence(body(evidence_request(population, "P1", "case-3"))),
        "identity_mismatch",
        409,
    )

    assert answer["field"] == "identity.population_id"
    assert (answer["request_id"], answer["query_revision"]) == ("case-3", 1)
    assert answer["retryable"] is False


def test_evidence_after_the_source_changed_is_an_identity_mismatch(service, tmp_path):
    population = opened(service, open_request())
    write_example(tmp_path, "S0", *ROWS, "P2,p2-b,2,Resolved,2026-10-01T12:00:00Z,S,Desk")

    answer = refused(
        service.case_evidence(body(evidence_request(population, "P1"))),
        "identity_mismatch",
        409,
    )

    assert answer["field"] == "identity.source_id"


def test_evidence_after_the_source_disappeared_is_source_unavailable(service, tmp_path):
    population = opened(service, open_request())
    (tmp_path / "S0.csv").unlink()

    answer = refused(
        service.case_evidence(body(evidence_request(population, "P1"))),
        "source_unavailable",
        404,
    )

    assert str(tmp_path) not in answer["message"]
    assert answer["retryable"] is True


@pytest.mark.parametrize(("case_id", "code", "status"), [("Q", "case_not_in_population", 409), ("R", "case_not_found", 404)])
def test_a_case_outside_the_parent_or_not_in_the_source_is_refused(service, case_id, code, status):
    population = opened(service, open_request())

    answer = refused(
        service.case_evidence(body(evidence_request(population, case_id))), code, status
    )

    assert answer["field"] == "case_id"


def test_columns_the_contract_cannot_carry_are_a_malformed_source(tmp_path):
    write_example(
        tmp_path,
        "S0",
        "P1,p1-a,1,Opened,2026-10-01T09:00:00Z,S,Desk,High",
        header=HEADER + ",priority",
    )

    answer = refused(Investigations(tmp_path).open_example(body(open_request())), "malformed_source", 422)

    assert "priority" in answer["message"]


def test_an_incident_id_longer_than_the_contract_carries_is_a_malformed_source(tmp_path):
    # Outside the parent population, so every incident of the base is checked.
    write_example(tmp_path, "S0", "L" * 257 + ",l-a,1,Opened,2026-10-01T09:00:00Z,T,Desk")

    answer = refused(
        Investigations(tmp_path).open_example(body(open_request("S0", "long-1", 2))),
        "malformed_source",
        422,
    )

    assert (answer["request_id"], answer["query_revision"]) == ("long-1", 2)
    assert answer["retryable"] is False
    assert "case id" in answer["message"]
    assert "L" * 257 not in answer["message"]


def test_an_incident_id_of_the_longest_length_the_contract_carries_is_answered(tmp_path):
    write_example(tmp_path, "S0", "M" * 256 + ",m-a,1,Opened,2026-10-01T09:00:00Z,S,Desk")

    answer = opened(Investigations(tmp_path), open_request())

    assert answer["populations"]["parent"]["case_ids"] == ["M" * 256]


def test_a_malformed_source_names_the_row_and_the_reason(tmp_path):
    write_example(tmp_path, "S0", "P1,p1-a,-1,Opened,2026-10-01T09:00:00Z,S,Desk")

    answer = refused(Investigations(tmp_path).open_example(body(open_request())), "malformed_source", 422)

    assert "S0" in answer["message"]
    assert "row 1" in answer["message"]
    assert "source_sequence" in answer["message"]


def test_a_missing_example_is_source_unavailable_without_a_path(tmp_path):
    answer = refused(
        Investigations(tmp_path / "absent").open_example(body(open_request(request_id="m-1", revision=3))),
        "source_unavailable",
        404,
    )

    assert (answer["request_id"], answer["query_revision"]) == ("m-1", 3)
    assert str(tmp_path) not in answer["message"]
    assert "absent" not in answer["message"]


def test_an_unexpected_failure_is_a_typed_refusal(service, monkeypatch):
    def broken(*arguments):
        raise RuntimeError("a defect")

    monkeypatch.setattr(investigations, "open_population", broken)

    answer = refused(service.open_example(body(open_request(request_id="f-1"))), "computation_failed", 500)

    assert answer["request_id"] == "f-1"
    assert answer["retryable"] is True
    assert "defect" not in answer["message"]


@pytest.mark.parametrize(
    ("package_refusal", "code", "field"),
    [
        (PackageRefusal(RefusalCode.MALFORMED_SOURCE, "Bad row.", {"reason": "x"}), "malformed_source", None),
        (PackageRefusal(RefusalCode.UNKNOWN_POLICY, "Unknown.", {"role": "parent", "policy_id": "x"}), "unsupported_policy", "policies.parent.id"),
        (PackageRefusal(RefusalCode.UNKNOWN_POLICY, "Unknown role.", {"reason": "unknown_role", "role": "outcome"}), "unsupported_policy", "policies.outcome"),
        (PackageRefusal(RefusalCode.UNSUPPORTED_PARAMETER, "Bad.", {"role": "clock", "parameter": "unit"}), "invalid_parameter", "policies.clock.parameters.unit"),
        (PackageRefusal(RefusalCode.MISSING_POLICY, "Missing.", {"role": "clock"}), "invalid_request", "policies.clock"),
        (PackageRefusal(RefusalCode.IDENTITY_MISMATCH, "Other.", {"identity": "preparation_id"}), "identity_mismatch", "identity.preparation_id"),
        (PackageRefusal(RefusalCode.UNKNOWN_CASE, "None.", {"case_id": "Z"}), "case_not_found", "case_id"),
        (PackageRefusal(RefusalCode.CASE_NOT_IN_POPULATION, "Outside.", {"case_id": "Z"}), "case_not_in_population", "case_id"),
    ],
)
def test_every_package_refusal_has_its_contract_code(package_refusal, code, field):
    mapped = refusal_from_package("case_evidence", package_refusal, "r-1", 4)

    assert (mapped.code, mapped.field) == (code, field)
    assert mapped.message
    assert (mapped.request_id.root, mapped.query_revision.root) == ("r-1", 4)


def test_every_package_refusal_code_is_mapped():
    for code in RefusalCode:
        mapped = refusal_from_package("open_example", PackageRefusal(code, "Refused.", {}), None, None)
        VALIDATOR.validate(mapped.model_dump(mode="json"))

