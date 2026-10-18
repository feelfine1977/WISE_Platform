"""A cutoff proposal and the confirmations after it parse their source once, and answer as if each had read it."""

import hashlib

from fastapi.testclient import TestClient
import pytest
from wise_platform_analytics import preparation
from wise_platform_api.app import create_app
from import_requests import GERMAN, ORPHANED, envelope, german_confirmation, orphaned_confirmation, policies
from test_import_operations import GERMAN_ID, ORPHANED_ID, answered, client, folder, stored, workspace_id  # noqa: F401 (fixtures)

PROPOSAL = "/api/preparations/cutoff-proposal"
CONFIRMATION = "/api/preparations"
# The German shape with a record that has no incident id, so a confirmation waits for row issues to be accepted.
PENDING = (
    "Vorgang;Aktivität;Zeitpunkt;Gruppe\r\n"
    "A-1;Eröffnet;09.10.2026 08:00;Büro\r\n"
    ";Eröffnet;09.10.2026 08:30;Büro\r\n"
    "A-1;Geschlossen;09.10.2026 09:30;\r\n"
).encode("cp1252")
PENDING_ID = "source.v1:sha256:" + hashlib.sha256(PENDING).hexdigest()


@pytest.fixture
def reads(monkeypatch):
    counted = []
    original = preparation.read_csv

    def counting(raw, *args, **kwargs):
        counted.append(preparation.source_id(raw))
        return original(raw, *args, **kwargs)

    monkeypatch.setattr(preparation, "read_csv", counting)
    return counted


def confirmation(workspace_id, cutoff, context, accept, source_id=GERMAN_ID):
    request = german_confirmation(workspace_id, source_id, accept)
    request["mapping"]["context_columns"] = context
    request["policies"] = policies(cutoff=cutoff)
    return request


def test_a_proposal_and_its_confirmations_read_the_source_once(client, folder, workspace_id, reads, tmp_path):
    stored(client, workspace_id, PENDING)
    proposal = confirmation(workspace_id, "9999-12-31T23:59:59Z", [], False, PENDING_ID)
    proposed = answered(client.post(PROPOSAL, json=proposal))["proposed_cutoff"]
    pending = answered(client.post(CONFIRMATION, json=confirmation(workspace_id, proposed, [3], False, PENDING_ID)))
    final = confirmation(workspace_id, proposed, [3], True, PENDING_ID)
    ready = answered(client.post(CONFIRMATION, json=final))

    assert reads == [PENDING_ID]
    assert pending["state"] == "needs_confirmation" and ready["state"] == "ready"
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as fresh:
        answered(fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))
        assert answered(fresh.post(CONFIRMATION, json=final)) == ready
    assert reads == [PENDING_ID, PENDING_ID]


def test_a_cutoff_before_the_data_is_refused_from_the_held_reading(client, workspace_id, reads):
    stored(client, workspace_id, GERMAN)
    answered(client.post(PROPOSAL, json=confirmation(workspace_id, "9999-12-31T23:59:59Z", [], False)))
    refused = client.post(CONFIRMATION, json=confirmation(workspace_id, "2026-10-09T00:00:00Z", [3], True))

    assert refused.status_code == 422 and refused.json()["code"] == "cutoff_before_records", refused.text
    assert reads == [GERMAN_ID]


def test_a_ready_confirmation_or_another_source_releases_the_reading(client, workspace_id, reads):
    stored(client, workspace_id, GERMAN)
    stored(client, workspace_id, ORPHANED)
    later = "9999-12-31T23:59:59Z"
    answered(client.post(PROPOSAL, json=confirmation(workspace_id, later, [3], True)))
    answered(client.post(CONFIRMATION, json=confirmation(workspace_id, later, [3], True)))
    answered(client.post(PROPOSAL, json=confirmation(workspace_id, later, [3], True)))
    assert reads == [GERMAN_ID, GERMAN_ID]

    answered(client.post(CONFIRMATION, json=orphaned_confirmation(workspace_id, ORPHANED_ID)))
    answered(client.post(PROPOSAL, json=confirmation(workspace_id, later, [3], True)))
    assert reads == [GERMAN_ID, GERMAN_ID, ORPHANED_ID, GERMAN_ID]


def test_changed_shaping_choices_read_the_source_again(client, workspace_id, reads):
    stored(client, workspace_id, GERMAN)
    later = "9999-12-31T23:59:59Z"
    answered(client.post(PROPOSAL, json=confirmation(workspace_id, later, [], False)))
    changed = confirmation(workspace_id, later, [], False)
    changed["policies"] = policies(offset=60, cutoff=later)
    answered(client.post(PROPOSAL, json=changed))

    assert reads == [GERMAN_ID, GERMAN_ID]
