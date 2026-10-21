"""An invented log and document folder for #132. Every email, note, name and file is invented; dates are 2001.

Incident I-1: an email (mail-0001, masked, with attachments), a note, a record without a document and a status change.
Incident I-2: the same email (mail-0001, shared) and an object card with field changes.
Incident I-3: one record per refused or unavailable reference.
"""

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

from import_requests import envelope, policies

MARKER = "Invented body text for the record document fixture"
HEADER = "incident,activity,time,document"
ROWS = [
    ("I-1", "Email received", "2001-01-01T08:00:00Z", "mail-0001"),
    ("I-1", "Note written", "2001-01-01T09:00:00Z", "note-0001"),
    ("I-1", "Call logged", "2001-01-01T10:00:00Z", ""),
    ("I-1", "Status changed", "2001-01-01T11:00:00Z", "status-0001"),
    ("I-2", "Email received", "2001-01-02T08:00:00Z", "mail-0001"),
    ("I-2", "Object updated", "2001-01-02T09:00:00Z", "object-0001"),
    ("I-3", "Path reference", "2001-01-03T08:00:00Z", "../outside"),
    ("I-3", "Device reference", "2001-01-03T08:01:00Z", "CON"),
    ("I-3", "Spaced reference", "2001-01-03T08:02:00Z", "two words"),
    ("I-3", "Missing file", "2001-01-03T08:03:00Z", "mail-9999"),
    ("I-3", "Too large", "2001-01-03T08:04:00Z", "large-0001"),
    ("I-3", "Invalid json", "2001-01-03T08:05:00Z", "broken-0001"),
    ("I-3", "Old version", "2001-01-03T08:06:00Z", "old-0001"),
    ("I-3", "Escaping link", "2001-01-03T08:07:00Z", "escape-0001"),
    ("I-3", "Cut document", "2001-01-03T08:08:00Z", "cut-0001"),
    ("I-3", "Largest allowed", "2001-01-03T08:09:00Z", "full-0001"),
    ("I-3", "Markup document", "2001-01-03T08:10:00Z", "markup-0001"),
    ("I-3", "Unreadable file", "2001-01-03T08:11:00Z", "locked-0001"),
]
# Text that would be markup, a script, a link and a remote image if it were ever rendered as HTML; it must stay text.
MARKUP = "<b>Invented bold</b> <script>alert(1)</script> <a href=\"http://example.invalid/\">Invented link</a> <img src=\"http://example.invalid/x.png\">"
RAW = (HEADER + "\n" + "".join(",".join(row) + "\n" for row in ROWS)).encode("utf-8")
MAX = 1_048_576
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def document(kind, title, text, masked=False, attachments=(), changes=(), fields=(), **extra):
    return {"format": "wise.record_document.v1", "kind": kind, "title": title, "fields": [{"label": a, "value": b} for a, b in fields],
            "text": text, "masked": masked, "attachments": list(attachments), "changes": list(changes), **extra}


def docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", "<document/>")
    return buffer.getvalue()


def attachment(name, kind, size, path):
    return {"name": name, "type": kind, "size": size, "path": path}


ATTACHMENTS = [
    attachment("Invented letter.pdf", "application/pdf", len(PDF), "files/letter-0001.pdf"),        # 0 opens
    attachment("Invented photo.png", "image/png", len(PNG), "files/photo-0001.png"),               # 1 opens
    attachment("Invented contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 0, "files/contract-0001.docx"),  # 2 opens
    attachment("Invented tool.exe", "application/x-msdownload", 2, "files/tool-0001.exe"),         # 3 never a program
    attachment("Invented script.sh", "text/x-shellscript", 9, "files/script-0001.sh"),             # 4 never a script
    attachment("Invented bundle.zip", "application/zip", 22, "files/bundle-0001.zip"),             # 5 never an archive
    attachment("Invented fake.pdf", "application/pdf", len(PNG), "files/fake-0001.pdf"),           # 6 PNG bytes named .pdf
    attachment("Invented parent.txt", "text/plain", 5, "../parent-0001.txt"),                      # 7 leaves the folder
    attachment("Invented gone.pdf", "application/pdf", 10, "files/gone-0001.pdf"),                 # 8 no such file
    attachment("Invented linked.txt", "text/plain", 5, "files/linked-0001.txt"),                   # 9 a link out of the folder
    attachment("Invented shortcut.lnk", "application/x-ms-shortcut", 4, "files/shortcut-0001.lnk"),  # 10 never a shortcut
    attachment("Invented junction.txt", "text/plain", 7, "files/junction-0001/parent-0001.txt"),  # 11 a folder link or Windows junction out
]


def link(target: Path, place: Path, folder: bool = False) -> bool:
    """A link out of the document folder: a symbolic link, or on Windows a junction for a folder. False where neither can be made."""
    try:
        os.symlink(target, place, target_is_directory=folder)
        return True
    except OSError:
        if folder and sys.platform == "win32":
            return subprocess.run(["cmd", "/c", "mklink", "/J", str(place), str(target)], capture_output=True).returncode == 0
        return False


LINKS: dict[str, bool] = {}
"""Which links write_folder could make on this system; where none could be made, the file is simply missing."""


def write_folder(root: Path) -> Path:
    """The document folder, beside an outside file that links and parent steps would reach."""
    folder = root / "documents"
    (folder / "files").mkdir(parents=True)
    (root / "parent-0001.txt").write_text("outside")
    (root / "outside-0001.json").write_text(json.dumps(document("note", "Outside", "outside the folder")))
    write = lambda name, value: (folder / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    write("mail-0001", document("email", "Invented question about an invented invoice", MARKER + "\n\nSecond paragraph of the invented email.",
                                masked=True, attachments=ATTACHMENTS, fields=[("From", "Invented Sender"), ("Subject", "Invented question")]))
    write("note-0001", document("note", "Invented internal note", "An invented note."))
    write("status-0001", document("status", "Invented status change", "Opened to waiting.", fields=[("From", "open"), ("To", "waiting")]))
    write("object-0001", document("object", "Invented customer card", "", changes=[
        {"field": "Credit limit", "old": "100", "new": "200", "time": "2001-01-02T09:30:00Z"},
        {"field": "Owner", "old": None, "new": "Invented Owner", "time": "2001-01-02T09:00:00Z"}], fields=[("Number", "C-0001")]))
    write("markup-0001", document("email", "<i>Invented markup title</i>", MARKUP, fields=[("From", "<u>Invented</u>")]))
    write("cut-0001", document("email", "Invented long email", "The beginning of an invented email.", cut=True))
    write("old-0001", {**document("note", "Old", "x"), "format": "wise.record_document.v0"})
    (folder / "broken-0001.json").write_text("{not json")
    filler = document("note", "Invented large note", "")
    filler["text"] = "x" * (MAX + 10 - len(json.dumps(filler)))
    write("large-0001", filler)
    full = document("note", "Invented largest note", "")
    full["text"] = "y" * (MAX - len(json.dumps(full)))
    write("full-0001", full)
    assert (folder / "full-0001.json").stat().st_size == MAX and (folder / "large-0001.json").stat().st_size > MAX
    LINKS["escape"] = link(root / "outside-0001.json", folder / "escape-0001.json")
    write("locked-0001", document("note", "Invented locked note", "Never read."))
    # Where the system honours it, the file cannot be read by its owner; elsewhere it stays readable.
    LINKS["locked"] = os.name == "posix" and os.geteuid() != 0
    if LINKS["locked"]:
        os.chmod(folder / "locked-0001.json", 0)
    (folder / "files" / "letter-0001.pdf").write_bytes(PDF)
    (folder / "files" / "photo-0001.png").write_bytes(PNG)
    (folder / "files" / "contract-0001.docx").write_bytes(docx())
    (folder / "files" / "tool-0001.exe").write_bytes(b"MZ")
    (folder / "files" / "script-0001.sh").write_text("#!/bin/sh\n")
    (folder / "files" / "bundle-0001.zip").write_bytes(b"PK\x05\x06" + b"\x00" * 18)
    (folder / "files" / "fake-0001.pdf").write_bytes(PNG)
    (folder / "files" / "shortcut-0001.lnk").write_bytes(b"L\x00\x00\x00")
    LINKS["linked"] = link(root / "parent-0001.txt", folder / "files" / "linked-0001.txt")
    (root / "outside-folder").mkdir()
    (root / "outside-folder" / "parent-0001.txt").write_text("outside")
    LINKS["junction"] = link(root / "outside-folder", folder / "files" / "junction-0001", folder=True)
    return folder


def prepare(client, workspace: Path, reference: bool = True):
    """Open the workspace, import the invented log and open its population; the document column is optional."""
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
    assert opened.status_code == 200, opened.text
    wid = opened.json()["workspace_id"]
    stored = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="invented-documents.csv"),
                        content=RAW, headers={"Content-Type": "application/octet-stream"})
    assert stored.status_code == 200, stored.text
    mapping = {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3],
               **({"document_reference_column": 3} if reference else {})}
    ready = client.post("/api/preparations", json=envelope("confirm_mapping_request", workspace_id=wid, source_id=stored.json()["source"]["source_id"],
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}, mapping=mapping,
        policies=policies("iso8601", offset=None, tolerant=True), accept_report_issues=True))
    assert ready.status_code == 200 and ready.json()["state"] == "ready", ready.text
    population = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid,
                                                                                 preparation_id=ready.json()["preparation"]["preparation_id"]))
    assert population.status_code == 200, population.text
    return wid, population.json()["identity"], ready.json()["preparation"]["preparation_id"]
