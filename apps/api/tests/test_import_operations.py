"""The import operations through their routes: validation, refusals and what is kept."""

import hashlib
import json
from typing import get_args

import pytest
from fastapi.testclient import TestClient
from import_requests import (
    GERMAN,
    ORPHANED,
    VALIDATOR,
    envelope,
    german_confirmation,
    orphaned_confirmation,
    policies,
)

from wise_platform_api import imports as imports_module
from wise_platform_api.app import create_app
from wise_platform_api.generated.imports import ImportRefusal
from wise_platform_api.import_boundary import STATUS

GERMAN_ID = "source.v1:sha256:" + hashlib.sha256(GERMAN).hexdigest()
ORPHANED_ID = "source.v1:sha256:" + hashlib.sha256(ORPHANED).hexdigest()
OCTETS = {"Content-Type": "application/octet-stream"}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def folder(tmp_path):
    path = tmp_path / "Arbeitsbereich"
    path.mkdir()
    return path


@pytest.fixture
def workspace_id(client, folder):
    return answered(client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))[
        "workspace_id"
    ]


def answered(response, status=200) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    VALIDATOR.validate(body)
    return body


def refused(response, operation, code, field=None, request=None) -> dict:
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == "import_refusal", body
    assert (body["operation"], body["code"]) == (operation, code), body
    assert response.status_code == STATUS[code]
    assert body["message"].strip()
    if field is not None:
        assert body["field"] == field, body
    if request is not None:
        assert (body["request_id"], body["query_revision"]) == (request["request_id"], request["query_revision"])
        assert body["workspace_id"] == request.get("workspace_id")
    return body


def upload(client, workspace_id, raw, filename="events.csv", **headers) -> dict:
    metadata = envelope("upload_source_metadata", "upload-1", workspace_id=workspace_id, filename=filename)
    return client.put("/api/sources", params=metadata, content=raw, headers=headers or OCTETS)


def stored(client, workspace_id, raw, filename="events.csv") -> dict:
    return answered(upload(client, workspace_id, raw, filename))["source"]


# Opening a workspace ---------------------------------------------------------------------


def test_a_refused_folder_names_its_reason_and_echoes_the_request(client, tmp_path):
    request = envelope("open_workspace_request", "open-7", 3, path=str(tmp_path / "missing"))

    refused(client.post("/api/workspaces/open", json=request), "open_workspace", "workspace_unavailable", "path", request)


def test_a_foreign_folder_is_refused_as_incompatible(client, tmp_path):
    (tmp_path / "notes.txt").write_text("private", encoding="utf-8")
    request = envelope("open_workspace_request", path=str(tmp_path))

    refused(client.post("/api/workspaces/open", json=request), "open_workspace", "workspace_incompatible", "path")
    assert [path.name for path in tmp_path.iterdir()] == ["notes.txt"]


def test_a_folder_of_the_program_is_refused(client):
    from wise_platform_api.workspace import program_folders

    request = envelope("open_workspace_request", path=str(program_folders()[0]))

    refused(client.post("/api/workspaces/open", json=request), "open_workspace", "workspace_incompatible", "path")


@pytest.mark.parametrize(
    ("change", "code", "field"),
    [
        ({"schema_version": 2}, "unsupported_schema", "schema_version"),
        ({"schema_version": True}, "invalid_request", "schema_version"),
        ({"query_revision": 0}, "invalid_request", "query_revision"),
        ({"path": ""}, "invalid_request", "path"),
        ({"create": True}, "invalid_request", "create"),
    ],
)
def test_an_open_request_outside_the_contract_is_refused(client, folder, change, code, field):
    request = envelope("open_workspace_request", path=str(folder)) | change

    refused(client.post("/api/workspaces/open", json=request), "open_workspace", code, field)
    assert list(folder.iterdir()) == []


def test_the_answer_lists_what_the_workspace_holds(client, folder, workspace_id):
    stored(client, workspace_id, GERMAN, "Vorgänge.csv")
    ready = answered(client.post("/api/preparations", json=german_confirmation(workspace_id, GERMAN_ID)))
    request = envelope("open_workspace_request", "open-2", 2, path=str(folder))

    answer = answered(client.post("/api/workspaces/open", json=request))

    assert answer["workspace_id"] == workspace_id
    assert (answer["request_id"], answer["query_revision"]) == ("open-2", 2)
    assert answer["sources"] == [{"source_id": GERMAN_ID, "filename": "Vorgänge.csv", "byte_count": len(GERMAN)}]
    assert answer["preparations"] == [
        {"preparation_id": ready["preparation"]["preparation_id"], "source_id": GERMAN_ID}
    ]


# Storing source bytes --------------------------------------------------------------------


def test_source_bytes_are_kept_unchanged_in_the_workspace(client, folder, workspace_id):
    answer = answered(upload(client, workspace_id, GERMAN, "Vorgänge März.csv"))

    assert answer["source"] == {"source_id": GERMAN_ID, "filename": "Vorgänge März.csv", "byte_count": len(GERMAN)}
    assert answer["workspace_id"] == workspace_id
    assert (folder / "sources" / f"{hashlib.sha256(GERMAN).hexdigest()}.csv").read_bytes() == GERMAN


def test_bytes_sent_as_another_content_type_are_refused(client, folder, workspace_id):
    response = upload(client, workspace_id, GERMAN, **{"Content-Type": "text/csv"})

    refused(response, "upload_source", "invalid_request", "Content-Type")
    assert list((folder / "sources").iterdir()) == []


@pytest.mark.parametrize("revision", ["01", "+1", "1e0", "١"])
def test_a_revision_not_written_as_a_plain_decimal_is_refused(client, workspace_id, revision):
    metadata = envelope("upload_source_metadata", workspace_id=workspace_id, filename="events.csv")
    metadata["query_revision"] = revision

    refused(client.put("/api/sources", params=metadata, content=GERMAN, headers=OCTETS),
            "upload_source", "invalid_request", "query_revision")


def test_a_metadata_key_given_twice_is_refused(client, workspace_id):
    query = list(envelope("upload_source_metadata", workspace_id=workspace_id, filename="a.csv").items())
    query.append(("filename", "b.csv"))

    refused(client.put("/api/sources", params=query, content=GERMAN, headers=OCTETS), "upload_source", "invalid_request")


def test_a_workspace_not_opened_in_this_run_is_unavailable(client):
    response = upload(client, "workspace.v1:0123456789abcdef", GERMAN)

    body = refused(response, "upload_source", "workspace_unavailable", "workspace_id")
    assert body["workspace_id"] == "workspace.v1:0123456789abcdef"
    assert body["retryable"] is True


def test_a_workspace_that_cannot_be_written_any_more_is_refused(client, workspace_id, monkeypatch):
    from wise_platform_api import workspace as workspace_module

    def no_writing(*args, **kwargs):
        raise PermissionError("denied")

    monkeypatch.setattr(workspace_module.tempfile, "mkstemp", no_writing)

    refused(upload(client, workspace_id, GERMAN), "upload_source", "workspace_not_writable")


# Inspecting ------------------------------------------------------------------------------


def test_an_inspection_is_the_package_answer_in_the_contract_envelope(client, workspace_id):
    stored(client, workspace_id, GERMAN)
    request = envelope("inspect_csv_request", "inspect-4", 4, workspace_id=workspace_id, source_id=GERMAN_ID)

    answer = answered(client.post("/api/sources/inspect", json=request))

    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"]) == ("inspect-4", 4, workspace_id)
    assert answer["source_id"] == GERMAN_ID
    assert {"encoding": "windows-1252", "delimiter": ";", "quotechar": '"', "header": "first_record"} in answer[
        "dialect_candidates"
    ]
    assert answer["columns"] == [
        {"index": 0, "name": "Vorgang"}, {"index": 1, "name": "Aktivität"},
        {"index": 2, "name": "Zeitpunkt"}, {"index": 3, "name": "Gruppe"},
    ]
    assert answer["record_count"] == 3
    assert answer["sample_rows"][2] == {"source_position": 2, "cells": ["B-2", "Eröffnet", "10.10.2026 07:15", "Größe & Maß"]}


def test_an_inspection_is_computed_once_per_source_and_hints(client, workspace_id, monkeypatch):
    stored(client, workspace_id, GERMAN)
    calls = []
    original = imports_module.inspect_csv
    monkeypatch.setattr(imports_module, "inspect_csv", lambda raw, hints: (calls.append(hints), original(raw, hints))[1])
    request = envelope("inspect_csv_request", workspace_id=workspace_id, source_id=GERMAN_ID)
    hinted = dict(request, hints={"delimiter": ";"})

    first = answered(client.post("/api/sources/inspect", json=request))
    second = answered(client.post("/api/sources/inspect", json=dict(request, request_id="again", query_revision=2)))
    answered(client.post("/api/sources/inspect", json=hinted))

    assert calls == [None, {"delimiter": ";"}]
    assert (second["request_id"], second["query_revision"]) == ("again", 2)
    assert {key: value for key, value in second.items() if key not in ("request_id", "query_revision")} == {
        key: value for key, value in first.items() if key not in ("request_id", "query_revision")
    }


@pytest.mark.parametrize(
    ("hints", "field"),
    [({"encoding": "latin-1"}, "hints.encoding"), ({"delimiter": ":"}, "hints.delimiter"), ({"quote": "'"}, "hints.quote")],
)
def test_a_hint_the_contract_does_not_allow_is_an_invalid_dialect(client, workspace_id, hints, field):
    stored(client, workspace_id, GERMAN)
    request = envelope("inspect_csv_request", workspace_id=workspace_id, source_id=GERMAN_ID, hints=hints)

    refused(client.post("/api/sources/inspect", json=request), "inspect_csv", "invalid_dialect", field, request)


def test_a_source_of_another_workspace_is_unavailable(client, tmp_path, workspace_id):
    other_folder = tmp_path / "other"
    other_folder.mkdir()
    other = answered(client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(other_folder))))
    stored(client, workspace_id, GERMAN)
    request = envelope("inspect_csv_request", workspace_id=other["workspace_id"], source_id=GERMAN_ID)

    refused(client.post("/api/sources/inspect", json=request), "inspect_csv", "source_unavailable", "source_id", request)


# Confirming an interpretation ------------------------------------------------------------


def test_a_ready_preparation_is_kept_with_its_identities_and_report(client, folder, workspace_id):
    stored(client, workspace_id, GERMAN)
    request = german_confirmation(workspace_id, GERMAN_ID)

    answer = answered(client.post("/api/preparations", json=request))

    assert answer["state"] == "ready"
    report = answer["report"]
    assert (report["raw_record_count"], report["case_count"], report["issues"]) == (3, 2, [])
    assert report["first_usable_utc_instant"] == "2026-10-09T06:00:00Z"
    assert report["last_usable_utc_instant"] == "2026-10-10T05:15:00Z"
    assert report["missing_cells"][-1] == {"column_index": 3, "record_count": 1}
    kept = json.loads(
        (folder / "preparations" / (answer["preparation"]["preparation_id"].rsplit(":", 1)[1] + ".json")).read_text(
            encoding="utf-8"
        )
    )
    assert kept["preparation"] == answer["preparation"]
    assert kept["report"] == report
    assert kept["identity"]["preparation_id"] == answer["preparation"]["preparation_id"]
    assert kept["identity"]["source_id"] == GERMAN_ID


def test_rows_with_issues_need_confirmation_and_nothing_is_kept_until_then(client, folder, workspace_id):
    stored(client, workspace_id, ORPHANED)
    request = orphaned_confirmation(workspace_id, ORPHANED_ID)

    pending = answered(client.post("/api/preparations", json=request))

    assert (pending["state"], pending["preparation"]) == ("needs_confirmation", None)
    assert [(issue["source_position"], issue["code"]) for issue in pending["report"]["issues"]] == [(1, "missing_case_id")]
    assert list((folder / "preparations").iterdir()) == []

    confirmed = answered(client.post("/api/preparations", json=dict(request, accept_report_issues=True)))

    assert confirmed["state"] == "ready"
    assert (confirmed["report"]["raw_record_count"], confirmed["report"]["unassigned_record_count"]) == (3, 1)
    assert len(list((folder / "preparations").iterdir())) == 1


def test_a_blocked_interpretation_is_not_kept(client, folder, workspace_id):
    raw = b"Ticket,Activity,At,Seq\r\nX-1,Opened,2026-10-09T08:00:00Z,first\r\n"
    source = stored(client, workspace_id, raw)
    request = orphaned_confirmation(workspace_id, source["source_id"], accept=True)
    request["mapping"]["sequence_column"] = 3

    blocked = answered(client.post("/api/preparations", json=request))

    assert (blocked["state"], blocked["preparation"]) == ("blocked", None)
    assert list((folder / "preparations").iterdir()) == []


@pytest.mark.parametrize(
    ("change", "code", "field"),
    [
        (lambda r: r["dialect"].update(encoding="latin-1"), "invalid_dialect", "dialect.encoding"),
        (lambda r: r["mapping"].update(case_column=-1), "invalid_mapping", "mapping.case_column"),
        (lambda r: r["mapping"].update(case_column="Vorgang"), "invalid_mapping", "mapping.case_column"),
        (lambda r: r["mapping"].update(activity_column=0), "invalid_mapping", None),
        (lambda r: r["policies"]["time"].update(id="incident.time.local.v1"), "unsupported_policy", "policies.time.id"),
        (lambda r: r["policies"]["time"]["parameters"].update(format="yyyy"), "invalid_parameter",
         "policies.time.parameters.format"),
        (lambda r: r["policies"]["time"]["parameters"].update(timezone={"mode": "iana", "name": "Europe/Berlin"}),
         "unsupported_timezone", "policies.time.parameters.timezone"),
        (lambda r: r["policies"]["time"]["parameters"]["timezone"].update(offset_minutes=900), "invalid_parameter", None),
        (lambda r: r["policies"]["time"]["parameters"].update(snapshot_cutoff_utc="2027-01-01T00:00:00+01:00"),
         "invalid_parameter", None),
        (lambda r: r["policies"]["rows"].update(id="incident.rows.drop_bad_rows.v1"), "unsupported_policy",
         "policies.rows.id"),
        (lambda r: r["policies"].pop("parent"), "invalid_request", "policies.parent"),
        (lambda r: r.update(accept_report_issues="yes"), "invalid_request", "accept_report_issues"),
        (lambda r: r.update(accept_report_issues=1), "invalid_request", "accept_report_issues"),
    ],
)
def test_a_confirmation_outside_what_is_supported_is_refused_with_its_place(client, folder, workspace_id, change, code, field):
    stored(client, workspace_id, GERMAN)
    request = german_confirmation(workspace_id, GERMAN_ID)
    change(request)

    refused(client.post("/api/preparations", json=request), "confirm_mapping", code, field, request)
    assert list((folder / "preparations").iterdir()) == []


def test_bytes_that_the_confirmed_encoding_cannot_read_are_a_malformed_source(client, workspace_id):
    stored(client, workspace_id, GERMAN)
    request = german_confirmation(workspace_id, GERMAN_ID)
    request["dialect"]["encoding"] = "utf-8"

    refused(client.post("/api/preparations", json=request), "confirm_mapping", "malformed_source", "dialect.encoding", request)


def test_unzoned_times_need_an_explicit_zone(client, workspace_id):
    stored(client, workspace_id, GERMAN)
    request = german_confirmation(workspace_id, GERMAN_ID)
    request["policies"] = policies("dmy_dot_minute", None)

    refused(client.post("/api/preparations", json=request), "confirm_mapping", "timezone_required", None, request)


# Opening the population and the evidence of an incident ----------------------------------


def ready_population(client, workspace_id) -> dict:
    stored(client, workspace_id, GERMAN)
    preparation = answered(client.post("/api/preparations", json=german_confirmation(workspace_id, GERMAN_ID)))
    request = envelope("open_population_request", "population-3", 3, workspace_id=workspace_id,
                       preparation_id=preparation["preparation"]["preparation_id"])
    return answered(client.post("/api/investigations/open-population", json=request))


def test_the_population_is_every_identified_incident_with_its_stored_source(client, workspace_id):
    answer = ready_population(client, workspace_id)

    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"]) == ("population-3", 3, workspace_id)
    assert answer["source"] == {"source_id": GERMAN_ID, "filename": "events.csv", "byte_count": len(GERMAN)}
    assert answer["population"] == {"case_ids": ["A-1", "B-2"], "case_count": 2, "record_count": 3}
    assert [(case["case_id"], case["record_count"]) for case in answer["cases"]] == [("A-1", 2), ("B-2", 1)]


def test_a_kept_preparation_is_prepared_again_in_a_new_run(tmp_path, folder):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as first:
        workspace_id = answered(first.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))[
            "workspace_id"
        ]
        before = ready_population(first, workspace_id)
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as second:
        request = envelope("open_population_request", "population-3", 3, workspace_id=workspace_id,
                           preparation_id=before["identity"]["preparation_id"])
        refused(second.post("/api/investigations/open-population", json=request), "open_population",
                "workspace_unavailable", "workspace_id", request)
        answered(second.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))

        after = answered(second.post("/api/investigations/open-population", json=request))

    assert after == before


def test_a_preparation_that_no_longer_reproduces_its_identity_is_unavailable(client, folder, workspace_id):
    answer = ready_population(client, workspace_id)
    preparation_id = answer["identity"]["preparation_id"]
    kept = folder / "preparations" / (preparation_id.rsplit(":", 1)[1] + ".json")
    record = json.loads(kept.read_text(encoding="utf-8"))
    record["preparation"]["policies"]["time"]["parameters"]["timezone"]["offset_minutes"] = 60
    kept.write_text(json.dumps(record), encoding="utf-8")
    fresh_client = TestClient(create_app(static_dir=folder / "unbuilt"))
    answered(fresh_client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))
    request = envelope("open_population_request", workspace_id=workspace_id, preparation_id=preparation_id)

    refused(fresh_client.post("/api/investigations/open-population", json=request), "open_population",
            "preparation_unavailable", "preparation_id", request)


def test_a_preparation_whose_source_was_removed_is_unavailable(client, folder, workspace_id):
    answer = ready_population(client, workspace_id)
    for path in (folder / "sources").iterdir():
        path.unlink()
    request = envelope("open_population_request", workspace_id=workspace_id,
                       preparation_id=answer["identity"]["preparation_id"])

    refused(client.post("/api/investigations/open-population", json=request), "open_population", "source_unavailable")


def test_a_source_changed_outside_the_application_is_refused_by_the_running_application_too(client, folder, workspace_id):
    answer = ready_population(client, workspace_id)
    source_id = answer["identity"]["source_id"]
    inspect = envelope("inspect_csv_request", workspace_id=workspace_id, source_id=source_id, hints={})
    answered(client.post("/api/sources/inspect", json=inspect))
    stored_file = next(path for path in (folder / "sources").iterdir() if path.suffix == ".csv")
    original = stored_file.read_bytes()
    stored_file.write_bytes(original.replace(b"A-1", b"A-9"))
    assert len(stored_file.read_bytes()) == len(original) and stored_file.read_bytes() != original

    population = envelope("open_population_request", workspace_id=workspace_id,
                          preparation_id=answer["identity"]["preparation_id"])
    evidence = envelope("imported_case_evidence_request", "case-1", 3, workspace_id=workspace_id,
                        identity=answer["identity"], case_id="A-1")

    refused(client.post("/api/sources/inspect", json=inspect), "inspect_csv", "source_unavailable")
    refused(client.post("/api/investigations/open-population", json=population), "open_population", "source_unavailable")
    refused(client.post("/api/investigations/case-evidence", json=evidence), "case_evidence", "source_unavailable")

    stored_file.write_bytes(original)
    answered(client.post("/api/sources/inspect", json=inspect))
    answered(client.post("/api/investigations/open-population", json=population))


@pytest.mark.parametrize("revision", [b"9007199254740992", b"1e400"])
def test_a_revision_no_reader_carries_is_a_typed_refusal_and_is_not_echoed(client, folder, revision):
    raw = json.dumps(envelope("open_workspace_request", path=str(folder))).encode().replace(
        b'"query_revision": 1', b'"query_revision": ' + revision
    )
    assert revision in raw

    body = refused(client.post("/api/workspaces/open", content=raw, headers={"Content-Type": "application/json"}),
                   "open_workspace", "invalid_request")

    assert body["query_revision"] is None


def test_imported_evidence_answers_on_the_shared_evidence_route(client, workspace_id):
    answer = ready_population(client, workspace_id)
    request = envelope("imported_case_evidence_request", "case-1", 3, workspace_id=workspace_id,
                       identity=answer["identity"], case_id="A-1")

    evidence = answered(client.post("/api/investigations/case-evidence", json=request))

    assert evidence["message_type"] == "imported_case_evidence_answer"
    assert [record["utc_instant"] for record in evidence["records"]] == ["2026-10-09T06:00:00Z", "2026-10-09T07:30:00Z"]
    assert [record["context"] for record in evidence["records"]] == [
        [{"column_index": 3, "value": "Büro"}], [{"column_index": 3, "value": None}]
    ]


def test_evidence_of_a_preparation_not_kept_is_unavailable(client, workspace_id):
    answer = ready_population(client, workspace_id)
    identity = dict(answer["identity"], preparation_id="preparation.v1:sha256:" + "0" * 64)
    request = envelope("imported_case_evidence_request", workspace_id=workspace_id, identity=identity, case_id="A-1")

    refused(client.post("/api/investigations/case-evidence", json=request), "case_evidence",
            "preparation_unavailable", "identity.preparation_id", request)


def test_an_evidence_request_outside_the_import_contract_is_an_import_refusal(client, workspace_id):
    request = envelope("imported_case_evidence_request", workspace_id=workspace_id, identity={}, case_id="A-1")

    refused(client.post("/api/investigations/case-evidence", json=request), "case_evidence", "invalid_request")


# Failures and codes ----------------------------------------------------------------------


def test_an_unexpected_failure_is_a_typed_refusal(client, workspace_id, monkeypatch):
    stored(client, workspace_id, GERMAN)

    def broken(*args, **kwargs):
        raise RuntimeError("defect")

    monkeypatch.setattr(imports_module, "prepare", broken)
    request = german_confirmation(workspace_id, GERMAN_ID)

    body = refused(client.post("/api/preparations", json=request), "confirm_mapping", "computation_failed", None, request)
    assert body["retryable"] is True


def test_every_contract_refusal_code_has_a_status():
    codes = get_args(ImportRefusal.model_fields["code"].annotation)

    assert set(STATUS) == set(codes)
    assert all(400 <= status < 600 for status in STATUS.values())
