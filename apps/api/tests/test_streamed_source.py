"""Sources are stored as they stream in and read from their file as they are parsed; changed bytes are refused."""

import hashlib
import os
from pathlib import Path
import sys

import pytest
from import_requests import GERMAN, envelope, german_confirmation
from test_import_operations import GERMAN_ID, OCTETS, answered, client, folder, refused, stored, workspace_id  # noqa: F401 (fixtures)

ROOT = Path(__file__).resolve().parents[3]
STORED = "sources/" + GERMAN_ID.rsplit(":", 1)[1] + ".csv"


def chunked(raw, size=7):
    for start in range(0, len(raw), size):
        yield raw[start:start + size]


def test_a_source_sent_in_chunks_is_stored_once_under_its_digest(client, folder, workspace_id):
    metadata = envelope("upload_source_metadata", "upload-1", workspace_id=workspace_id, filename="events.csv")
    first = answered(client.put("/api/sources", params=metadata, content=chunked(GERMAN), headers=OCTETS))["source"]
    again = answered(client.put("/api/sources", params=metadata, content=chunked(GERMAN, 3), headers=OCTETS))["source"]

    assert first["source_id"] == again["source_id"] == GERMAN_ID and first["byte_count"] == len(GERMAN)
    assert (folder / STORED).read_bytes() == GERMAN
    assert sorted(path.name for path in (folder / "sources").iterdir()) == sorted([Path(STORED).name, Path(STORED).with_suffix(".json").name])


@pytest.mark.parametrize("damage", ["changed", "truncated", "missing"])
def test_stored_bytes_that_no_longer_match_are_refused_for_inspection_and_confirmation(client, folder, workspace_id, damage):
    stored(client, workspace_id, GERMAN)
    target = folder / STORED
    if damage == "missing":
        target.unlink()
    else:
        target.write_bytes(GERMAN.replace(b"A-1", b"A-9", 1) if damage == "changed" else GERMAN[:40])
    inspect = envelope("inspect_csv_request", workspace_id=workspace_id, source_id=GERMAN_ID)
    refused(client.post("/api/sources/inspect", json=inspect), "inspect_csv", "source_unavailable", "source_id")
    refused(client.post("/api/preparations", json=german_confirmation(workspace_id, GERMAN_ID, True)),
            "confirm_mapping", "source_unavailable", "source_id")


def test_a_held_parse_is_not_reused_once_its_stored_bytes_change(client, folder, workspace_id):
    stored(client, workspace_id, GERMAN)
    proposal = german_confirmation(workspace_id, GERMAN_ID)
    answered(client.post("/api/preparations/cutoff-proposal", json=proposal))
    (folder / STORED).write_bytes(GERMAN.replace(b"A-1", b"A-9", 1))

    refused(client.post("/api/preparations", json=german_confirmation(workspace_id, GERMAN_ID, True)),
            "confirm_mapping", "source_unavailable", "source_id")


@pytest.mark.skipif(os.name != "posix", reason="Service memory is read from the POSIX process table.")
def test_uploading_a_large_source_from_a_streaming_client_holds_little_of_it(tmp_path):
    sys.path.insert(0, str(ROOT / "tools"))
    from capacity_journey import MemorySampler, Service

    row = b"4507000000_00010,Record Goods Receipt,2018-01-03T07:15:00,BPIC 2019,12345,wall_clock,22," + b"x" * 120 + b"\r\n"
    path = tmp_path / "large.csv"
    digest = hashlib.sha256()
    with path.open("wb") as handle:
        header = b"case_id,activity,timestamp,source_path,source_record,timestamp_kind,source_field_count,note\r\n"
        handle.write(header)
        digest.update(header)
        block = row * 4096
        while handle.tell() < 200 * 1024 * 1024:
            handle.write(block)
            digest.update(block)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    service = Service(workspace, tmp_path / "service.log")
    service.start()
    sampler = MemorySampler(service.process.pid, interval=0.02)
    sampler.start()
    try:
        wid = service.client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        before = sampler.settled(0.2)[1]
        sampler.mark()
        with path.open("rb") as body:
            response = service.client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="large.csv"),
                                          content=body, headers={"Content-Type": "application/octet-stream"})
        peak, after = sampler.settled(0.2)
    finally:
        sampler.stop()
        sampler.join(timeout=5)
        service.stop()
    assert response.status_code == 200, response.text
    assert response.json()["source"]["source_id"] == "source.v1:sha256:" + digest.hexdigest()
    # A chosen bound: the whole 200 MB body, or a copy of it, would exceed it several times over.
    assert peak - before <= 64 * 1024 * 1024, (before, peak, after)
