"""Saving/replay validates every native artifact, including undisplayed chunks.

Independent four-item/19-record source; ordinary paged reads remain bounded.
These tests do not constitute full-source browser or OS-process qualification.
"""

from copy import deepcopy
import hashlib
import json

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
import pytest

from import_requests import envelope
from test_bpic19_scoring_http import ROOT, given, prepare, raw_source, read
from wise_platform_api.app import create_app


SAVING_VALIDATOR = Draft202012Validator(
    json.loads((ROOT / "contracts/saving.schema.json").read_text())
)


def tree_digests(folder):
    return {
        str(path.relative_to(folder)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in folder.rglob("*")
        if path.is_file()
    }


@pytest.mark.parametrize(
    "mutation,code",
    [
        ("missing", "artifact_unavailable"),
        ("size", "checksum_mismatch"),
        ("digest", "checksum_mismatch"),
    ],
)
def test_unvisited_native_chunk_blocks_save_and_replay_without_rescore_or_writes(
    tmp_path, monkeypatch, mutation, code
):
    monkeypatch.setattr("wise_platform_api.bpic19_scoring._CHUNK_SIZE", 1)
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, folder)
        scored = client.post(
            "/api/investigations/bpic19-score",
            json={**given(wid, identity), "case_limit": 1},
        )
        assert scored.status_code == 200, scored.text
        native = scored.json()
        assert native["snapshot"]["case_count"] == 4
        assert native["snapshot"]["chunk_size"] == 1
        assert [
            case["case_id"] for case in native["report"]["case_page"]["cases"]
        ] == ["A"]
        refs = [
            ref for ref in native["snapshot"]["artifacts"] if ref["kind"] == "cases"
        ]
        assert [(ref["offset"], ref["count"]) for ref in refs] == [
            (0, 1), (1, 1), (2, 1), (3, 1)
        ]
        source = folder / "sources" / (identity["source_id"].split(":")[-1] + ".csv")
        assert source.read_bytes() == raw_source()
        raw_request = envelope(
            "imported_case_evidence_request",
            workspace_id=wid,
            identity=identity,
            case_id="D",
        )
        evidence = client.post("/api/investigations/case-evidence", json=raw_request)
        assert evidence.status_code == 200, evidence.text
        original_records = evidence.json()["records"]
        assert len(original_records) == 5
        selected = client.post(
            "/api/investigations/select-cases",
            json=envelope(
                "select_cases_request", workspace_id=wid, identity=identity,
                parent_case_ids=None, predicates=[],
            ),
        )
        assert selected.status_code == 200, selected.text
        selected = selected.json()
        assert selected["kept"]["case_count"] == 4
        assert selected["kept"]["record_count"] == 19
        action = {
            "operation": "bpic19_score", "identity": identity,
            "definition_id": native["definition_id"],
            "query": {"run_id": native["run_id"], "case_offset": 0, "case_limit": 1},
        }
        save = envelope(
            "save_investigation_request", workspace_id=wid,
            investigation_id=None, expected_revision_id=None,
            name="Native snapshot with an unvisited later chunk",
            base_identity=identity, selection_identity=selected["identity"],
            selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
            context_policy="incident.context.first_record_in_declared_order.v1",
            comparison=None, notes="Independent saved note; not a restored native output.",
            bookmarks=[{
                "label": "Original D witness", "identity": identity, "case_id": "D",
                "row_ids": [original_records[0]["row_id"]], "note": "Raw evidence remains independent.",
            }],
            bpic19_pipeline={"schema_version": 1, "actions": [action]},
        )
        saved = client.post("/api/investigations/save", json=save)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        assert len(list((folder / "investigations/revisions").glob("*.json"))) == 1

        # Damage only the chunk at offset3, never requested by the saved page.
        artifact = folder / "score-run-artifacts" / refs[3]["filename"]
        original = artifact.read_bytes()
        if mutation == "missing":
            artifact.unlink()
        elif mutation == "size":
            artifact.write_bytes(b"changed")
        else:
            artifact.write_bytes(bytes([original[0] ^ 1]) + original[1:])
        damaged_tree = tree_digests(folder)
        monkeypatch.setattr(
            "wise_platform_api.bpic19_scoring.evaluate_features",
            lambda *args, **kwargs: pytest.fail("Snapshot integrity must never rescore"),
        )

        # Ordinary page0 is intentionally still available without scanning D.
        first_page = {**read(wid, native["run_id"]), "case_limit": 1}
        paged = client.post("/api/investigations/bpic19-read", json=first_page)
        assert paged.status_code == 200, paged.text
        assert [
            case["case_id"] for case in paged.json()["report"]["case_page"]["cases"]
        ] == ["A"]
        late = client.post(
            "/api/investigations/bpic19-read", json={**first_page, "case_offset": 3}
        )
        assert late.status_code == 409 and late.json()["code"] == code, late.text

        reopened = client.post(
            "/api/investigations/reopen",
            json=envelope(
                "reopen_investigation_request", workspace_id=wid,
                saved_revision_id=saved["revision"]["saved_revision_id"],
            ),
        )
        assert reopened.status_code == 409 and reopened.json()["code"] == code, reopened.text[:500]
        SAVING_VALIDATOR.validate(reopened.json())
        assert reopened.json()["field"] == "bpic19_pipeline.actions.0.query.run_id"
        for attempted_save in (
            save,
            {
                **deepcopy(save),
                "investigation_id": saved["revision"]["investigation_id"],
                "expected_revision_id": saved["revision"]["saved_revision_id"],
                "notes": "This revision must not be published",
            },
        ):
            refused = client.post("/api/investigations/save", json=attempted_save)
            assert refused.status_code == 409 and refused.json()["code"] == code, refused.text
            SAVING_VALIDATOR.validate(refused.json())
            assert refused.json()["field"] == "bpic19_pipeline.actions.0.query.run_id"
        assert len(list((folder / "investigations/revisions").glob("*.json"))) == 1

        metadata = client.post(
            "/api/investigations/recover-metadata",
            json=envelope(
                "recover_investigation_metadata_request", workspace_id=wid,
                saved_revision_id=saved["revision"]["saved_revision_id"],
                page={"notes_offset": 0, "bookmarks_offset": 0, "claims_offset": 0},
            ),
        )
        assert metadata.status_code == 200, metadata.text
        recovered = metadata.json()
        SAVING_VALIDATOR.validate(recovered)
        assert recovered["status"] == "historical_metadata_only"
        assert recovered["metadata_integrity"] == "saved_content_hash_verified"
        assert recovered["outputs_restored"] is recovered["selection_restored"] is recovered["source_verified"] is False
        assert recovered["metadata"]["notes"]["text"] == save["notes"]
        assert recovered["metadata"]["bookmarks"]["items"][0]["row_ids"] == [original_records[0]["row_id"]]
        assert "bpic19_outputs" not in recovered
        raw = client.post("/api/investigations/case-evidence", json=raw_request)
        assert raw.status_code == 200 and raw.json()["records"] == original_records
        assert source.read_bytes() == raw_source()
        assert tree_digests(folder) == damaged_tree
