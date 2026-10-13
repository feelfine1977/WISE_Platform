"""The cutoff proposed from the data: the latest usable time under the analyst's choices, nothing kept."""

import pytest
from wise_platform_api import imports
from import_requests import GERMAN, german_confirmation, policies, wall_policies
from test_import_operations import (  # noqa: F401 (fixtures)
    GERMAN_ID,
    answered,
    client,
    folder,
    refused,
    stored,
    workspace_id,
)

ROUTE = "/api/preparations/cutoff-proposal"
LATEST_UTC = "9999-12-31T23:59:59Z"
LATEST_LOCAL = "9999-12-31T23:59:59"

# Day-first dotted times with seconds; the last usable one has a fraction and lies just before a new year.
SECONDS = (
    "Vorgang;Aktivität;Zeitpunkt\r\n"
    "A-1;Eröffnet;30.12.2026 17:45:10\r\n"
    "A-1;Geschlossen;31.12.2026 23:59:30.25\r\n"
    "B-2;Eröffnet;xx\r\n"
).encode("cp1252")
UNREADABLE = "Vorgang;Aktivität;Zeitpunkt\r\nA-1;Eröffnet;xx\r\n".encode("cp1252")


def proposal_request(workspace_id, source_id, chosen) -> dict:
    request = german_confirmation(workspace_id, source_id)
    request["mapping"]["context_columns"] = []
    request["policies"] = chosen
    return dict(request, request_id="proposal-4", query_revision=4)


def proposal(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


def test_the_proposal_is_the_last_usable_instant_when_it_is_a_full_minute(client, folder, workspace_id):
    stored(client, workspace_id, GERMAN)
    request = proposal_request(workspace_id, GERMAN_ID, policies(cutoff=LATEST_UTC, tolerant=True))
    request["mapping"]["context_columns"] = [3]

    answer = proposal(client.post(ROUTE, json=request))

    assert answer == {
        "schema_version": 1, "message_type": "cutoff_proposal_answer", "request_id": "proposal-4", "query_revision": 4,
        "workspace_id": workspace_id, "source_id": GERMAN_ID, "timestamp_kind": "utc_instant",
        # 10.10.2026 07:15 at UTC+02:00.
        "last_usable_time": "2026-10-10T05:15:00Z", "proposed_cutoff": "2026-10-10T05:15:00Z",
    }
    assert list((folder / "preparations").iterdir()) == []


def test_a_wall_clock_proposal_rounds_seconds_and_fractions_up_into_the_next_year(client, folder, workspace_id):
    source = stored(client, workspace_id, SECONDS)
    request = proposal_request(workspace_id, source["source_id"], wall_policies("dmy_dot_second", LATEST_LOCAL))

    answer = proposal(client.post(ROUTE, json=request))

    assert answer["timestamp_kind"] == "wall_clock"
    assert answer["last_usable_time"] == "2026-12-31T23:59:30.250000"
    assert answer["proposed_cutoff"] == "2027-01-01T00:00:00"
    assert list((folder / "preparations").iterdir()) == []


def test_a_fixed_offset_proposal_is_on_the_utc_clock(client, workspace_id):
    source = stored(client, workspace_id, SECONDS)
    request = proposal_request(workspace_id, source["source_id"],
                               policies("dmy_dot_second", -60, tolerant=True, cutoff=LATEST_UTC))

    answer = proposal(client.post(ROUTE, json=request))

    # 31.12.2026 23:59:30.25 at UTC−01:00.
    assert answer["last_usable_time"] == "2027-01-01T00:59:30.250000Z"
    assert answer["proposed_cutoff"] == "2027-01-01T01:00:00Z"


def test_without_a_usable_time_nothing_is_proposed(client, workspace_id):
    source = stored(client, workspace_id, UNREADABLE)
    request = proposal_request(workspace_id, source["source_id"], wall_policies("dmy_dot_second", LATEST_LOCAL))

    answer = proposal(client.post(ROUTE, json=request))

    assert (answer["last_usable_time"], answer["proposed_cutoff"]) == (None, None)


@pytest.mark.parametrize(
    ("chosen", "code"),
    [
        (policies("dmy_dot_minute", None, tolerant=True, cutoff=LATEST_UTC), "timezone_required"),
        (policies("dmy_dot_minute", 120, tolerant=True, cutoff="2026-10-10T05:14:59Z"), "cutoff_before_records"),
    ],
)
def test_choices_that_cannot_be_read_are_the_refusal_of_a_confirmation(client, folder, workspace_id, chosen, code):
    stored(client, workspace_id, GERMAN)
    request = proposal_request(workspace_id, GERMAN_ID, chosen)

    refused(client.post(ROUTE, json=request), "confirm_mapping", code, request=request)
    assert list((folder / "preparations").iterdir()) == []


def test_a_request_outside_the_confirmation_contract_is_refused(client, workspace_id):
    stored(client, workspace_id, GERMAN)
    request = proposal_request(workspace_id, GERMAN_ID, policies(cutoff=LATEST_UTC))
    request["accept_report_issues"] = "no"

    refused(client.post(ROUTE, json=request), "confirm_mapping", "invalid_request", "accept_report_issues", request)


def test_a_workspace_not_opened_is_unavailable(client):
    request = proposal_request("workspace.v1:0123456789abcdef", GERMAN_ID, policies(cutoff=LATEST_UTC))

    refused(client.post(ROUTE, json=request), "confirm_mapping", "workspace_unavailable", "workspace_id", request)



@pytest.mark.parametrize("written", ["2026-10-10T05:15:00+00:00", "2026-10-10T05:15:00.1234567Z", "2026-10-10T05:15:00"])
def test_a_proposal_not_written_as_a_utc_instant_is_not_sent(client, workspace_id, monkeypatch, written):
    monkeypatch.setattr(imports, "_full_minute_at_or_after", lambda text: written)
    stored(client, workspace_id, GERMAN)
    request = proposal_request(workspace_id, GERMAN_ID, policies(cutoff=LATEST_UTC, tolerant=True))

    body = refused(client.post(ROUTE, json=request), "confirm_mapping", "computation_failed")

    assert body["request_id"] == "proposal-4"


def test_the_cutoff_proposal_is_the_generated_message():
    from wise_platform_api.generated import imports as generated

    assert imports.CutoffProposalAnswer is generated.CutoffProposalAnswer
