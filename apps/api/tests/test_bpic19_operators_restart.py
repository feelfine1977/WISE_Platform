"""Five declarative operators survive a real HTTP server exit and a distinct fresh PID.

This is a synthetic literal fixture. It qualifies the save/replay seam, not a
full BPIC19 browser workload or human source-method reproduction.
"""

import hashlib
import json
import os
import socket
import subprocess
import sys
import time

import httpx
from import_requests import envelope
from test_bpic19_operators_http import (
    CANCELLATION,
    FIFO,
    ORDINAL,
    RULE,
    WAITING,
    prepare,
    request,
    ROUTE,
    VALIDATOR,
    original_ids,
)


def start(port):
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "wise_platform_api.app:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "error",
        ],
        env=os.environ.copy(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=20)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(process.stderr.read().decode())
        try:
            if client.get("/api/health").status_code == 200:
                return process, client
        except httpx.TransportError:
            pass
        time.sleep(0.05)
    process.terminate()
    process.wait(timeout=15)
    client.close()
    raise AssertionError("Real operator server did not become ready")


def stop(process, client):
    client.close()
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    assert process.returncode is not None
    process.stderr.close()


def test_all_five_saved_operators_real_http_pid_exit_restart_and_exact_witnesses(
    tmp_path,
):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    workspace = tmp_path / "operators"
    workspace.mkdir()
    first, client = start(port)
    try:
        wid, identity = prepare(client, workspace)
        actions = []
        receipts = {}
        for recipe in [ORDINAL, FIFO, CANCELLATION, RULE, WAITING]:
            given = request(wid, identity, recipe)
            response = client.post(ROUTE, json=given)
            assert response.status_code == 200, response.text
            answer = response.json()
            VALIDATOR.validate(answer)
            receipts[answer["operation"]] = answer
            actions.append(
                {
                    "operation": answer["operation"],
                    "identity": identity,
                    "query": given["query"],
                    "definition_id": answer["definition_id"],
                }
            )
        selected = client.post(
            "/api/investigations/select-cases",
            json=envelope(
                "select_cases_request",
                workspace_id=wid,
                identity=identity,
                parent_case_ids=None,
                predicates=[{"kind": "case_id_in", "case_ids": ["c"], "negate": False}],
            ),
        )
        assert selected.status_code == 200, selected.text
        given = envelope(
            "save_investigation_request",
            workspace_id=wid,
            investigation_id=None,
            expected_revision_id=None,
            name="Five reviewed finite operators",
            base_identity=identity,
            selection_identity=selected.json()["identity"],
            selection_recipe={
                "parent_case_ids": ["a", "b", "c", "d", "e", "f", "g"],
                "predicates": [
                    {"kind": "case_id_in", "case_ids": ["c"], "negate": False}
                ],
            },
            context_policy="incident.context.first_record_in_declared_order.v1",
            comparison=None,
            notes="Independent synthetic literal source; reviewed operator definitions and complete counterexample item",
            bookmarks=[],
            bpic19_pipeline={"schema_version": 1, "actions": actions},
        )
        saved = client.post("/api/investigations/save", json=given)
        assert saved.status_code == 200, saved.text
        saved = saved.json()
        export = workspace / "literal-operator-receipt.json"
        export.write_text(json.dumps(saved, sort_keys=True, allow_nan=False))
        assert [out["operation"] for out in saved["bpic19_outputs"]["outputs"]] == [
            "bpic19_ordinal",
            "bpic19_fifo",
            "bpic19_cancellation",
            "bpic19_rule",
            "bpic19_waiting",
        ]
        for output in saved["bpic19_outputs"]["outputs"]:
            assert (
                hashlib.sha256(
                    json.dumps(
                        output["output"],
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                        allow_nan=False,
                    ).encode()
                ).hexdigest()
                == output["sha256"]
            )
    finally:
        stop(first, client)
    assert first.poll() is not None
    second, fresh = start(port)
    try:
        assert first.pid != second.pid
        opened = fresh.post(
            "/api/workspaces/open",
            json=envelope("open_workspace_request", path=str(workspace)),
        )
        assert opened.status_code == 200, opened.text
        reopened = fresh.post(
            "/api/investigations/reopen",
            json=envelope(
                "reopen_investigation_request",
                workspace_id=wid,
                saved_revision_id=saved["revision"]["saved_revision_id"],
            ),
        )
        assert reopened.status_code == 200, reopened.text
        replay = reopened.json()
        exported = json.loads(export.read_text())
        assert (
            replay["revision"] == exported["revision"]
            and replay["bpic19_outputs"] == exported["bpic19_outputs"]
        )
        assert (
            replay["restored_selection"]["kept"]["case_count"] == 1
            and replay["restored_selection"]["kept"]["record_count"] == 4
        )
        for recipe in [ORDINAL, FIFO, CANCELLATION, RULE, WAITING]:
            response = fresh.post(ROUTE, json=request(wid, identity, recipe))
            assert response.status_code == 200, response.text
            answer = response.json()
            VALIDATOR.validate(answer)
            original = receipts[answer["operation"]]
            assert (
                answer["result_id"] == original["result_id"]
                and answer["definition_id"] == original["definition_id"]
            )
            assert (
                answer["cases"] == original["cases"]
                and answer["summary"] == original["summary"]
                and answer["selection_groups"] == original["selection_groups"]
            )
        rule_output = next(
            out["output"]
            for out in replay["bpic19_outputs"]["outputs"]
            if out["operation"] == "bpic19_rule"
        )
        c = next(case for case in rule_output["cases"] if case["case_id"] == "c")
        rows = original_ids()
        assert (
            c["record_row_ids"] == [rows[10], rows[11], rows[12], rows[13]]
            and c["truth"] == "false"
        )
    finally:
        stop(second, fresh)
