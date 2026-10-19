"""#132 the document behind a record, read from the workspace's local document folder, at public HTTP.

The log, documents and attachments are invented (record_document_fixture). Expected states are written from them by hand.
"""

import hashlib
import json
import logging
import socket
import sys
import time

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
import pytest

from wise_platform_api.app import create_app
from wise_platform_api.record_documents import RecordDocuments
from import_requests import ROOT, envelope
from record_document_fixture import ATTACHMENTS, LINKS, MARKER, MAX, prepare, write_folder
from test_bpic19_pipeline_http import start_process

SCHEMA = json.loads((ROOT / "contracts" / "record-documents.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA)
OWN = "http://127.0.0.1:8765"


def client():
    """The platform's own loopback host, as its page reaches it."""
    return TestClient(create_app(), base_url=OWN)


def rows(c, wid, identity, case_id):
    evidence = c.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", workspace_id=wid,
                                                                         identity=identity, case_id=case_id))
    assert evidence.status_code == 200, evidence.text
    return {record["activity"]: record["row_id"] for record in evidence.json()["records"]}


def folder(c, wid, value="unchanged"):
    change = None if value == "unchanged" else {"folder": value}
    reply = c.post("/api/workspaces/document-folder", json=envelope("document_folder_request", workspace_id=wid, change=change))
    VALIDATOR.validate(reply.json())
    return reply


def read(c, wid, identity, case_id, row_id):
    reply = c.post("/api/documents/read", json=envelope("record_document_request", workspace_id=wid, identity=identity, case_id=case_id, row_id=row_id))
    VALIDATOR.validate(reply.json())
    return reply


def open_attachment(c, wid, identity, case_id, row_id, index):
    reply = c.post("/api/documents/open-attachment", json=envelope("attachment_open_request", workspace_id=wid, identity=identity,
                                                                    case_id=case_id, row_id=row_id, attachment_index=index))
    VALIDATOR.validate(reply.json())
    return reply


@pytest.fixture
def opened(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(RecordDocuments, "opener", staticmethod(lambda path: calls.append(path) or True))
    documents = write_folder(tmp_path)
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with client() as c:
        wid, identity, preparation = prepare(c, workspace)
        yield c, wid, identity, preparation, documents, workspace, calls


def test_the_reference_is_a_declared_optional_role_of_the_preparation(tmp_path):
    with client() as c:
        first = tmp_path / "with"; first.mkdir(); second = tmp_path / "without"; second.mkdir()
        _, _, with_reference = prepare(c, first)
        _, _, without = prepare(c, second, reference=False)
        # The role is part of the preparation and its identity; a log without it is prepared as before.
        assert with_reference != without
        third = tmp_path / "third"; third.mkdir()
        wid = c.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(third))).json()["workspace_id"]
        source = c.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="x.csv"), content=b"incident,activity,time,document\nI-1,a,2001-01-01T00:00:00Z,d\n",
                       headers={"Content-Type": "application/octet-stream"}).json()["source"]["source_id"]
        from import_requests import policies
        refused = c.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=source,
            dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
            mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [], "document_reference_column": 3},
            policies=policies("iso8601", offset=None, tolerant=True), accept_report_issues=True))
        assert refused.json()["field"] == "mapping.document_reference_column", refused.text
        # The role is absent or a context column; an explicit null is not a third way of saying "none".
        refused = c.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=source,
            dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
            mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3], "document_reference_column": None},
            policies=policies("iso8601", offset=None, tolerant=True), accept_report_issues=True))
        assert refused.json()["field"] == "mapping.document_reference_column", refused.text


def test_the_document_folder_is_a_workspace_setting_only(opened):
    c, wid, identity, _, documents, workspace, _ = opened
    assert folder(c, wid).json()["state"] == "not_set"
    refused = folder(c, wid, "relative/documents")
    assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "invalid_folder", "change.folder")
    set_ = folder(c, wid, str(documents)).json()
    assert (set_["folder"], set_["state"]) == (str(documents), "available")
    assert folder(c, wid, str(documents / "nowhere")).json()["state"] == "missing"
    assert folder(c, wid, str(documents)).json()["state"] == "available"
    # A saved investigation holds no folder: it reopens elsewhere without documents.
    selected = c.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=identity,
                                                                        parent_case_ids=None, predicates=[])).json()
    saved = c.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid, investigation_id=None,
        expected_revision_id=None, name="Invented documents", base_identity=identity, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    assert str(documents) not in saved.text
    holders = [path for path in workspace.rglob("*") if path.is_file() and str(documents).encode() in path.read_bytes()]
    assert [path.relative_to(workspace).as_posix() for path in holders] == ["settings/document-folder.json"]
    assert folder(c, wid, None).json()["state"] == "not_set"


def test_reading_every_kind_and_every_unavailable_reason(opened):
    c, wid, identity, _, documents, workspace, _ = opened
    one, two, three = (rows(c, wid, identity, case) for case in ("I-1", "I-2", "I-3"))
    assert read(c, wid, identity, "I-1", one["Email received"]).json()["reason"] == "folder_not_set"
    folder(c, wid, str(documents))
    email = read(c, wid, identity, "I-1", one["Email received"]).json()
    assert (email["state"], email["document"]["kind"], email["document"]["masked"], email["document"]["text"].split("\n\n")[0]) == ("available", "email", True, MARKER)
    # Only the stated document types are offered to open: PDF, PNG and DOCX here; a program, script, archive and shortcut never.
    assert email["openable_attachments"] == [True, True, True, False, False, False, True, True, True, True, False, True]
    assert email["max_document_bytes"] == MAX
    # A shared email opens the same document from every incident.
    assert read(c, wid, identity, "I-2", two["Email received"]).json()["document"] == email["document"]
    obj = read(c, wid, identity, "I-2", two["Object updated"]).json()["document"]
    assert (obj["kind"], [change["field"] for change in obj["changes"]]) == ("object", ["Credit limit", "Owner"])
    assert read(c, wid, identity, "I-1", one["Note written"]).json()["document"]["kind"] == "note"
    assert read(c, wid, identity, "I-1", one["Status changed"]).json()["document"]["kind"] == "status"
    assert read(c, wid, identity, "I-1", one["Call logged"]).json()["reason"] == "no_reference"
    reasons = {activity: read(c, wid, identity, "I-3", row).json() for activity, row in three.items()}
    assert {activity: (answer["state"], answer["reason"]) for activity, answer in reasons.items()} == {
        "Path reference": ("unavailable", "not_a_valid_reference"), "Device reference": ("unavailable", "not_a_valid_reference"),
        "Spaced reference": ("unavailable", "not_a_valid_reference"), "Missing file": ("unavailable", "file_missing"),
        "Too large": ("unavailable", "too_large"), "Invalid json": ("unavailable", "invalid_json"),
        "Old version": ("unavailable", "unknown_format_version"),
        "Escaping link": ("unavailable", "outside_folder" if LINKS["escape"] else "file_missing"),
        "Cut document": ("available", None), "Largest allowed": ("available", None), "Markup document": ("available", None),
        "Unreadable file": ("unavailable", "unreadable") if LINKS["locked"] else ("available", None)}
    # Too large is refused with its size, never truncated; the work side's own cut is shown as such.
    assert reasons["Too large"]["size_bytes"] == (documents / "large-0001.json").stat().st_size > MAX and reasons["Too large"]["document"] is None
    assert reasons["Cut document"]["document"]["cut"] is True and reasons["Largest allowed"]["size_bytes"] == MAX
    # A missing folder reads as such; the records stay where they are.
    (documents.parent / "moved").mkdir(); documents.rename(documents.parent / "moved" / "documents")
    assert read(c, wid, identity, "I-1", one["Email received"]).json()["reason"] == "folder_missing"
    # Unknown records are refused, not guessed.
    refused = read(c, wid, identity, "I-1", two["Object updated"])
    assert (refused.status_code, refused.json()["code"]) == (404, "unknown_record")


def test_attachments_open_only_when_every_rule_holds(opened):
    c, wid, identity, _, documents, _, calls = opened
    folder(c, wid, str(documents))
    row = rows(c, wid, identity, "I-1")["Email received"]
    results = [open_attachment(c, wid, identity, "I-1", row, index).json() for index in range(len(ATTACHMENTS) + 1)]
    assert [(result["opened"], result["reason"]) for result in results] == [
        (True, None), (True, None), (True, None), (False, "not_an_allowed_type"), (False, "not_an_allowed_type"),
        (False, "not_an_allowed_type"), (False, "type_mismatch"), (False, "invalid_path"), (False, "file_missing"),
        (False, "outside_folder" if LINKS["linked"] else "file_missing"), (False, "not_an_allowed_type"),
        (False, "outside_folder" if LINKS["junction"] else "file_missing"), (False, "no_such_attachment")]
    # Links and Windows junctions out of the folder are made wherever the system allows one.
    assert LINKS["junction"] or sys.platform == "win32"
    # Only the three checked document files were handed to the operating system, each once, from inside the folder.
    assert [path.relative_to(documents.resolve()).as_posix() for path in calls] == ["files/letter-0001.pdf", "files/photo-0001.png", "files/contract-0001.docx"]
    note = rows(c, wid, identity, "I-3")["Missing file"]
    assert open_attachment(c, wid, identity, "I-3", note, 0).json()["reason"] == "document_unavailable"


def test_nothing_of_a_document_is_written_or_logged(opened, caplog):
    c, wid, identity, _, documents, workspace, _ = opened
    caplog.set_level(logging.DEBUG)
    folder(c, wid, str(documents))
    replies = []
    for case in ("I-1", "I-2", "I-3"):
        for row in rows(c, wid, identity, case).values():
            replies.append(read(c, wid, identity, case, row))
            replies.append(open_attachment(c, wid, identity, case, row, 0))
    secrets = [MARKER, "Invented Sender", "Invented letter.pdf", "letter-0001", "files/", str(documents)]
    logged = caplog.text
    assert not [secret for secret in secrets if secret in logged]
    # Refusals and unavailable states name the rule, never the reference or the content.
    for reply in replies:
        body = reply.json()
        if body.get("state") != "available":
            assert not [secret for secret in [*secrets, "mail-9999", "../outside", "escape-0001"] if secret in reply.text]
    written = b"".join(path.read_bytes() for path in workspace.rglob("*") if path.is_file() and path.name != "document-folder.json")
    assert not [secret for secret in secrets if secret.encode() in written]


def test_only_the_platforms_own_page_is_answered(opened, monkeypatch):
    c, wid, identity, _, documents, _, calls = opened
    folder(c, wid, str(documents))
    row = rows(c, wid, identity, "I-1")["Email received"]
    given = envelope("attachment_open_request", workspace_id=wid, identity=identity, case_id="I-1", row_id=row, attachment_index=0)
    for headers in ({"host": "evil.example"}, {"host": "127.0.0.1:9999"}, {"origin": "http://evil.example"},
                    {"origin": "http://127.0.0.1:5173"}, {"sec-fetch-site": "cross-site"}, {"origin": "null"}):
        refused = c.post("/api/documents/open-attachment", json=given, headers=headers)
        assert (refused.status_code, refused.json()["code"]) == (403, "forbidden_origin"), headers
        assert c.post("/api/documents/read", json={**given, "message_type": "record_document_request"}, headers=headers).status_code == 403
    assert calls == []
    assert c.post("/api/documents/open-attachment", json=given, headers={"origin": OWN, "sec-fetch-site": "same-origin"}).json()["opened"] is True
    # A development server is trusted only when it is named explicitly.
    monkeypatch.setenv("WISE_TRUSTED_WEB_ORIGINS", "http://127.0.0.1:5173")
    assert c.post("/api/documents/open-attachment", json=given, headers={"origin": "http://127.0.0.1:5173"}).json()["opened"] is True


def test_documents_survive_a_restart_and_the_largest_opens_within_a_second(tmp_path, monkeypatch):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    record = tmp_path / "opened.txt"
    monkeypatch.setenv("WISE_ATTACHMENT_OPEN_RECORD", str(record))
    documents = write_folder(tmp_path)
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, c = start_process(port)
    try:
        wid, identity, _ = prepare(c, workspace)
        assert c.post("/api/workspaces/document-folder", json=envelope("document_folder_request", workspace_id=wid,
                                                                       change={"folder": str(documents)})).status_code == 200
        one = rows(c, wid, identity, "I-1")
        before = c.post("/api/documents/read", json=envelope("record_document_request", workspace_id=wid, identity=identity,
                                                              case_id="I-1", row_id=one["Email received"])).json()
    finally:
        first.terminate()
        first.wait(timeout=15)
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        assert fresh.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid,
                                                                                 preparation_id=identity["preparation_id"])).status_code == 200
        state = fresh.post("/api/workspaces/document-folder", json=envelope("document_folder_request", workspace_id=wid, change=None)).json()
        assert (state["folder"], state["state"]) == (str(documents), "available")
        after = fresh.post("/api/documents/read", json=envelope("record_document_request", workspace_id=wid, identity=identity,
                                                                 case_id="I-1", row_id=one["Email received"])).json()
        assert after["document"] == before["document"]
        three = rows(fresh, wid, identity, "I-3")
        started = time.perf_counter()
        largest = fresh.post("/api/documents/read", json=envelope("record_document_request", workspace_id=wid, identity=identity,
                                                                   case_id="I-3", row_id=three["Largest allowed"])).json()
        assert largest["size_bytes"] == MAX and time.perf_counter() - started < 1.0
        opened = fresh.post("/api/documents/open-attachment", json=envelope("attachment_open_request", workspace_id=wid, identity=identity,
                                                                             case_id="I-1", row_id=one["Email received"], attachment_index=0)).json()
        assert opened["opened"] is True
        # The recorder holds a digest per request, never a path or a name.
        assert record.read_text().splitlines() == [hashlib.sha256(str((documents / "files" / "letter-0001.pdf").resolve()).encode()).hexdigest()]
    finally:
        second.terminate()
        second.wait(timeout=15)
