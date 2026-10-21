"""#132 the record document contract names the stated limits the service enforces."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator

from wise_platform_api import record_documents

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "contracts" / "record-documents.schema.json").read_text(encoding="utf-8"))


def test_the_contract_is_valid_and_names_the_enforced_limits():
    Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA["$defs"]["MaxDocumentBytes"]["const"] == record_documents.MAX_DOCUMENT_BYTES == 1_048_576
    named = {(entry["properties"]["extension"]["const"], entry["properties"]["media_type"]["const"])
             for entry in SCHEMA["$defs"]["OpenableAttachmentType"]["oneOf"]}
    assert named == {(extension, media_type) for extension, (media_type, _) in record_documents.OPENABLE.items()}


def test_no_program_script_shortcut_or_archive_is_on_the_list():
    never = {"exe", "com", "bat", "cmd", "msi", "ps1", "vbs", "js", "sh", "app", "lnk", "url", "scr", "jar", "zip", "7z", "rar",
             "tar", "gz", "docm", "xlsm", "pptm", "html", "htm", "svg"}
    assert not never & set(record_documents.OPENABLE)


def test_references_are_plain_names():
    for reference in ("mail-0001", "Note_2.v1", "a.b-c"):
        assert record_documents.valid_reference(reference)
    for reference in ("../x", "a/b", "a\\b", "C:x", "/abs", "..", ".", "CON", "nul.json", "COM1", "LPT9.txt", "two words", "", "x" * 201, "a..b"):
        assert not record_documents.valid_reference(reference), reference


def test_only_the_own_loopback_page_is_allowed(monkeypatch):
    allowed = record_documents.allowed_request
    assert allowed({"host": "127.0.0.1:8765"}, 8765) and allowed({"host": "localhost:8765", "origin": "http://localhost:8765"}, 8765)
    assert not allowed({"host": "127.0.0.1:8765", "origin": "http://evil.example"}, 8765)
    assert not allowed({"host": "evil.example:8765"}, 8765) and not allowed({"host": "127.0.0.1:9999"}, 8765)
    assert not allowed({"host": "127.0.0.1:8765", "sec-fetch-site": "cross-site"}, 8765)
    assert not allowed({"host": "127.0.0.1:8765", "origin": "https://127.0.0.1:8765"}, 8765)
    monkeypatch.setenv(record_documents.TRUSTED_ORIGINS_ENVIRONMENT, "http://127.0.0.1:5173, https://evil.example")
    assert allowed({"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"}, 8765)
    assert not allowed({"host": "evil.example", "origin": "https://evil.example"}, 8765)
