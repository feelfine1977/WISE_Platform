"""#67: many timelines with their records, from a bounded batch projection.

Against the invented tests/fixtures/timelines file and its hand-written oracle: for a page of at most 100 kept incidents the
local service gives every record of each, placed at its elapsed time from the incident's earliest usable time, records at
the same time counted together as one mark, and records without a usable time counted apart; an incident not among those
shown, or a page beyond the bound, is refused.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

FIXTURES = ROOT / "tests/fixtures/timelines"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def ask(client, workspace, identity, case_ids):  # noqa: F811
    return client.post("/api/investigations/record-marks", json=envelope("record_marks_request", "marks-67", 5, workspace_id=workspace["workspace_id"],
                       identity=identity, case_ids=case_ids))


def test_every_record_of_a_page_is_placed_or_counted_as_the_oracle(client, opened):  # noqa: F811
    workspace, base = opened
    response = ask(client, workspace, base["identity"], list(EXPECTED["cases"]))
    assert response.status_code == 200, response.text
    answer = response.json()
    assert (answer["request_id"], answer["query_revision"], answer["identity"]) == ("marks-67", 5, base["identity"])
    assert answer["policy"] == "incident.records.elapsed_from_first_record.v1"
    got = {item["case_id"]: {"record_count": item["record_count"], "order_known": item["order_known"], "span_microseconds": item["span_microseconds"],
                             "marks": [[mark["offset_microseconds"], mark["record_count"]] for mark in item["marks"]], "untimed_record_count": item["untimed_record_count"]}
           for item in answer["cases"]}
    assert got == EXPECTED["cases"]
    # Nothing is dropped: every record is a mark's count or an untimed one.
    for item in answer["cases"]:
        assert sum(mark["record_count"] for mark in item["marks"]) + item["untimed_record_count"] == item["record_count"]


def test_only_incidents_shown_are_read_and_a_page_is_bounded(client, opened):  # noqa: F811
    workspace, base = opened
    kept = select(client, workspace, base, [{"kind": "case_id_in", "case_ids": ["T-1", "T-2"], "negate": False}])
    refused = ask(client, workspace, kept["identity"], ["T-1", "T-3"])
    assert refused.status_code == 422 and (refused.json()["code"], refused.json()["field"]) == ("case_not_in_population", "case_ids")
    too_many = ask(client, workspace, base["identity"], [f"X-{n}" for n in range(101)])
    assert too_many.status_code == 400
