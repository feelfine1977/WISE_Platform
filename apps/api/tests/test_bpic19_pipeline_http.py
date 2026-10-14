"""The saved foundation pipeline uses the existing immutable investigation store."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fastapi.testclient import TestClient
from import_requests import envelope
from wise_platform_api.app import create_app
from test_bpic19_profile_http import prepare_source, request as profile_request
from test_bpic19_profiles import source, ROLES


def save_request(client, folder):
    wid, identity = prepare_source(client, folder)
    request = profile_request(wid, identity)
    profile = client.post("/api/investigations/bpic19-profile", json=request).json()
    measures_query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": "paper_v1",
                      "roles": None, "offset": 0, "limit": 10, "calibration_population": "parent"}
    measures = client.post("/api/investigations/bpic19-measures", json=envelope(
        "bpic19_measures_request", workspace_id=wid, identity=identity, query=measures_query)).json()
    assert profile["profile"]["population"]["case_count"] == 10
    assert measures["population_record_count"] == 14
    pipeline = {"schema_version": 1, "actions": [
        {"operation": "bpic19_profile", "identity": identity, "query": request["query"], "definition_id": profile["profile"]["definition_id"]},
        {"operation": "bpic19_measures", "identity": identity, "query": measures_query, "definition_id": measures["definition_id"]},
    ]}
    population = client.post("/api/investigations/open-population", json=envelope(
        "open_population_request", workspace_id=wid, preparation_id=identity["preparation_id"])).json()
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request",
        workspace_id=wid, identity=identity, parent_case_ids=None, predicates=[])).json()
    return envelope("save_investigation_request", workspace_id=wid, investigation_id=None,
        expected_revision_id=None, name="Reviewed purchasing foundation", base_identity=identity, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": population["population"]["case_ids"], "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="Synthetic literal, not BPIC data",
        bookmarks=[], bpic19_pipeline=pipeline)


def test_pipeline_persists_definitions_witness_outputs_and_refuses_changed_or_unknown_action(tmp_path):
    folder = tmp_path / "workspace"; folder.mkdir()
    with TestClient(create_app()) as client:
        given = save_request(client, folder)
        saved = client.post("/api/investigations/save", json=given)
        assert saved.status_code == 200, saved.text
        answer = saved.json()
        assert answer["revision"]["content"]["bpic19_pipeline"] == given["bpic19_pipeline"]
        manifest = answer["bpic19_outputs"]
        assert [output["operation"] for output in manifest["outputs"]] == ["bpic19_profile", "bpic19_measures"]
        for output in manifest["outputs"]:
            assert hashlib.sha256(json.dumps(output["output"], ensure_ascii=False, sort_keys=True,
                separators=(",", ":"), allow_nan=False).encode()).hexdigest() == output["sha256"]
        changed = deepcopy(given); changed["bpic19_pipeline"]["actions"][0]["definition_id"] = "foreign-definition"
        refusal = client.post("/api/investigations/save", json=changed)
        assert refusal.status_code == 409 and refusal.json()["code"] == "identity_mismatch"
        changed = deepcopy(given); changed["bpic19_pipeline"]["actions"][0]["operation"] = "python"
        refusal = client.post("/api/investigations/save", json=changed)
        assert refusal.status_code == 400
        changed = deepcopy(given); changed["bpic19_pipeline"]["actions"][0]["query"]["execute"] = "anything"
        refusal = client.post("/api/investigations/save", json=changed)
        assert refusal.status_code == 400 and refusal.json()["code"] == "invalid_parameter"
        assert len(list((folder / "investigations/revisions").glob("*.json"))) == 1
        revision = next((folder / "investigations/revisions").glob("*.json"))
        artifact = json.loads(revision.read_text())
        artifact["results"]["bpic19_pipeline"]["outputs"][0]["output"]["profile"]["population"]["case_count"] = 999
        revision.write_text(json.dumps(artifact))
        reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=given["workspace_id"], saved_revision_id=answer["revision"]["saved_revision_id"]))
        assert reopened.status_code == 409 and reopened.json()["code"] == "identity_mismatch"


class RealHttp:
    def __init__(self, base): self.base = base
    def post(self, path, json): return self.send(path, "POST", __import__("json").dumps(json).encode(), {})
    def put(self, path, params, content, headers):
        from urllib.parse import urlencode
        return self.send(path + "?" + urlencode(params), "PUT", content, headers)
    def send(self, path, method, data, headers):
        try: response = urlopen(Request(self.base + path, data=data, method=method,
            headers={"Content-Type": "application/json", **headers}), timeout=20)
        except HTTPError as error: response = error
        raw = response.read()
        class Reply:
            status_code = response.code
            text = raw.decode()
            def json(self): return json.loads(raw)
        return Reply()


def start_process(port):
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "wise_platform_api.app:create_app", "--factory",
        "--host", "127.0.0.1", "--port", str(port), "--log-level", "error"],
        env=os.environ.copy(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    for _ in range(200):
        if process.poll() is not None: raise AssertionError(process.stderr.read().decode())
        try:
            with urlopen(base + "/api/health", timeout=.2) as response:
                if response.code == 200: return process, RealHttp(base)
        except OSError: time.sleep(.05)
    process.terminate(); process.wait(timeout=10)
    raise AssertionError("Candidate server did not become ready")


def test_real_http_actual_os_process_exit_and_new_pid_reopens_exact_pipeline(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    folder = tmp_path / "workspace"; folder.mkdir()
    first, client = start_process(port)
    try:
        given = save_request(client, folder)
        response = client.post("/api/investigations/save", json=given)
        assert response.status_code == 200, response.text
        saved = response.json()
    finally:
        first.terminate(); first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert first.pid != second.pid
        opened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder)))
        assert opened.status_code == 200
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=given["workspace_id"], saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()["revision"] == saved["revision"]
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        assert reopened.json()["restored_selection"]["kept"]["case_count"] == 10
    finally:
        second.terminate(); second.wait(timeout=15)
