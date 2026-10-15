"""Complete evidence survives native case-chunk publication and frozen reads."""
import gzip
import hashlib
import io
import json
import zipfile
import pytest

from fastapi.testclient import TestClient

from import_requests import envelope
from test_bpic19_scoring_http import criterion, given, prepare, raw_source, read
from wise_platform_api.app import create_app


@pytest.mark.parametrize("family", ["completion", "completion_timing", "completion_rework_effort", "full"])
@pytest.mark.parametrize("mode", ["flat", "layer_balanced"])
def test_case_volume_ignores_unused_exposure_recipe_without_changing_any_native_artifact(tmp_path, family, mode):
    extra = [["X", "G", "1", "3-way match, invoice after GR", "true", "true", "Standard", "0000", "Missing labels",
              activity, f"2018-01-{day:02}T00:00:00Z", "batch_1", 10]
             for activity, day in (("Record Invoice Receipt", 1), ("Record Goods Receipt", 1), ("", 2), ("Cancel Invoice Receipt", 3))]
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, raw_source(extra))
        answers = []
        for policy in ("max_absolute_p95", "creation_unique_value"):
            response = client.post("/api/investigations/bpic19-score", json=given(
                wid, identity, criteria_family=family, mode=mode, exposure_policy=policy))
            assert response.status_code == 200, response.text
            answers.append(response.json())
        assert answers[0]["run_id"] != answers[1]["run_id"]
        assert answers[0]["snapshot"]["artifacts"] == answers[1]["snapshot"]["artifacts"]
        for answer in answers:
            x = next(case for case in answer["report"]["case_page"]["cases"] if case["case_id"] == "X")
            assert criterion(x, "C01")["deviation"] == criterion(x, "C03")["deviation"] == 0
            assert criterion(x, "C02")["deviation"] is None
            if family in {"completion_timing", "full"}:
                assert criterion(x, "C05")["measurement"] is None
                assert criterion(x, "C05")["measurement_reason"] == "missing_activity_label"


def test_complete_case_evidence_across_chunk_boundary_and_fresh_reopen(tmp_path):
    extra = []
    for item in range(496):
        for day, activity in enumerate(("Create Purchase Order Item", "Record Goods Receipt",
                                        "Record Invoice Receipt", "Clear Invoice"), 1):
            extra.append([f"T{item:03}", f"T{item:03}", "1", "3-way match, invoice after GR",
                          "true", "true", "Standard", "0000", "Synthetic", activity,
                          f"2018-01-{day:02}T00:00:00Z", "user_1", 100])
    for activity, day in (("Record Invoice Receipt", 1), ("Record Goods Receipt", 1), ("", 2), ("Cancel Invoice Receipt", 3)):
        extra.append(["X", "G", "1", "3-way match, invoice after GR", "true", "true", "Standard",
                      "0000", "Missing labels", activity, f"2018-01-{day:02}T00:00:00Z", "batch_1", 10])
    raw = raw_source(extra)
    source_id = "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()

    def row_id(position):
        encoded = json.dumps({"format_version": 1, "source_id": source_id, "source_position": position},
                             sort_keys=True, separators=(",", ":")).encode()
        return "row.v1:sha256:" + hashlib.sha256(encoded).hexdigest()

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, identity = prepare(client, workspace, raw)
        response = client.post("/api/investigations/bpic19-score", json=given(wid, identity, criteria_family="completion"))
        assert response.status_code == 200, response.text
        answer = response.json()
        assert answer["report"]["population_case_count"] == 501
        assert answer["report"]["scored_case_count"] == 500
        assert answer["report"]["mean_score"] == 1
        chunks = [ref for ref in answer["snapshot"]["artifacts"] if ref["kind"] == "cases"]
        assert [(ref["offset"], ref["count"]) for ref in chunks] == [(0, 500), (500, 1)]
        request = {**read(wid, answer["run_id"]), "case_offset": 500, "case_limit": 1}
        tail = client.post("/api/investigations/bpic19-read", json=request)
        assert tail.status_code == 200, tail.text
        tail = tail.json()
        x = tail["report"]["case_page"]["cases"][0]
        assert x["case_id"] == "X" and x["score"] == 1 and x["coverage"] == 2 / 3
        assert x["scores"] == {"Balanced": 1, "Completion": 1, "Operations": 1}
        assert x["record_row_ids"] == [row_id(i) for i in range(2003, 2007)]
        for key, position in (("C01", 2003), ("C03", 2004)):
            result = criterion(x, key)
            assert result["deviation"] == 0 and result["reason"] == "evaluated"
            assert result["row_ids"] == [row_id(position)]
            assert result["measurement_evidence"]["unknown_row_ids"] == [row_id(2005)]
        assert criterion(x, "C02")["deviation"] is None
        assert criterion(x, "C02")["measurement_reason"] == "missing_activity_label"
        assert x["context_evidence"]["purchasing_document"] == {
            "value": "G", "available": True, "reason": None, "row_ids": [row_id(2003)]}
        assert x["value_evidence"]["creation_value"]["available"] is False
        assert x["value_evidence"]["creation_value"]["reason"] == "missing_activity_label"
        assert x["value_evidence"]["exposure"]["value"] == 10
        assert x["value_evidence"]["exposure"]["row_ids"] == [row_id(i) for i in range(2003, 2007)]
        exported = client.post("/api/investigations/bpic19-export", json={
            **read(wid, answer["run_id"]), "message_type": "bpic19_export_request"})
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            artifact_bytes = {name: archive.read(name) for name in archive.namelist()}
            manifest = json.loads(artifact_bytes["manifest.json"])
            assert manifest["snapshot"]["case_count"] == 501
            complete = [case for ref in chunks for case in json.loads(gzip.decompress(
                artifact_bytes["artifacts/" + ref["filename"]]))["cases"]]
            assert [case["case_id"] for case in complete] == list("ABCD") + [f"T{i:03}" for i in range(496)] + ["X"]
            assert sum(len(case["record_row_ids"]) for case in complete) == 2007
            assert complete[-1] == x
    with TestClient(create_app()) as fresh:
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        reopened = fresh.post("/api/investigations/bpic19-read", json=request)
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["report"] == tail["report"]
        exported = fresh.post("/api/investigations/bpic19-export", json={
            **read(wid, answer["run_id"]), "message_type": "bpic19_export_request"})
        assert exported.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert {name: archive.read(name) for name in archive.namelist()} == artifact_bytes
