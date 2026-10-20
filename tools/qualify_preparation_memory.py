"""macOS/POSIX synthetic HTTP memory qualification; no dataset, scoring or retained answer corpus."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / p) for p in ("apps/api/tests", "packages/analytics/tests")]
from import_requests import envelope
from memory_literal import arguments, cells, source


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, choices=(2000, 4000), default=2000)
    args = parser.parse_args()
    folder = Path(os.environ["ISSUE103_MEMORY_FOLDER"])
    workspace = folder / "workspace"
    workspace.mkdir(mode=0o700)
    env = {**os.environ, "HOME": str(folder), "PYTHONDONTWRITEBYTECODE": "1",
           "PYTHONPATH": os.pathsep.join(str(ROOT / p) for p in ("apps/api/src", "packages/analytics/src"))}
    stages, exits = [], []
    process = client = None

    def start():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        code = ("from pathlib import Path; import uvicorn; from wise_platform_api.app import create_app; "
                f"uvicorn.run(create_app(workspace_path=Path({str(workspace)!r})),host='127.0.0.1',port={port},log_level='error')")
        service = subprocess.Popen([sys.executable, "-B", "-c", code], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        connection = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=60, trust_env=False)
        try:
            for _ in range(200):
                assert service.poll() is None, "service exited during startup"
                try:
                    if connection.get("/api/health").status_code == 200:
                        return service, connection, port
                except httpx.TransportError:
                    pass
                time.sleep(.05)
            raise RuntimeError("service readiness timeout")
        except BaseException:
            stop(service, connection, port)
            raise

    def stop(service, connection, port):
        connection.close()
        if service.poll() is None:
            service.terminate()
        try:
            service.wait(timeout=15)
        except subprocess.TimeoutExpired:
            service.kill()
            service.wait(timeout=5)
        with socket.socket() as sock:
            assert sock.connect_ex(("127.0.0.1", port)) != 0, "service port remains open"
        exits.append({"pid": service.pid, "exit": service.returncode, "port_closed": True})

    def post(route, message, **fields):
        response = client.post("/api/" + route, json=envelope(message, **fields))
        assert response.status_code == 200, (route, response.status_code, response.text[:500])
        return response.json()

    def sample(stage):
        # Public process telemetry, after the response has been discarded. No app-state introspection.
        samples = []
        for _ in range(3):
            time.sleep(.05)
            samples.append(int(subprocess.check_output(["/bin/ps", "-o", "rss=", "-p", str(process.pid)], text=True)) * 1024)
        item = {"stage": stage, "service_pid": process.pid, "current_rss_bytes": sorted(samples)[1],
                "rss_samples": samples, "current_traced_bytes": None, "trace_status": "unavailable: uninstrumented product service"}
        stages.append(item)
        print(json.dumps(item), flush=True)

    def check_evidence(identity, wid):
        witness = hashlib.sha256()
        for index in range(args.rows // 2):
            cid = f"M{index:05d}"
            answer = post("investigations/case-evidence", "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=cid)
            assert answer["coverage"] == {"raw_record_count": 2, "mapped_record_count": 2, "omitted_activity_record_count": 0}
            assert [entry["original_cells"] for entry in answer["records"]] == [cells(index * 2), cells(index * 2 + 1)]
            witness.update(bytes.fromhex(digest({key: value for key, value in answer.items()
                                                if key not in ("workspace_id", "request_id", "query_revision")})))
        return witness.hexdigest()

    result = {"status": "failed", "rows": args.rows, "context_columns": 26, "stages": stages}
    try:
        process, client, port = start()
        sample("startup")
        wid = post("workspaces/open", "open_workspace_request", path=str(workspace))["workspace_id"]
        raw = source(args.rows)
        response = client.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="invented-memory.csv"),
                              content=raw, headers={"Content-Type": "application/octet-stream"})
        assert response.status_code == 200
        sid = response.json()["source"]["source_id"]
        assert sid == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
        del response, raw
        dialect, mapping, policies = arguments()
        preparation = post("preparations", "confirm_mapping_request", workspace_id=wid, source_id=sid,
                           dialect=dialect, mapping=mapping, policies=policies, accept_report_issues=True)
        pid = preparation["preparation"]["preparation_id"]
        del preparation
        sample("import_prepared")
        opened = post("investigations/open-population", "open_population_request", workspace_id=wid, preparation_id=pid)
        base = opened["identity"]
        assert opened["population"]["case_count"] == args.rows // 2
        assert opened["population"]["record_count"] == args.rows
        del opened
        selected = post("investigations/select-cases", "select_cases_request", workspace_id=wid, identity=base, parent_case_ids=None, predicates=[])["identity"]
        query = {"roles": {"source_case": 0, "item_category": 5, "item_type": 6, "goods_receipt": 7,
                           "gr_based_iv": 8, "purchasing_document": 9, "item": 10}, "profile_columns": None,
                 "policy_id": "bpic19.all_raw_case_attributes.v1"}
        profile = post("investigations/bpic19-profile", "bpic19_profile_request", workspace_id=wid, identity=selected, query=query)
        assert [profile["profile"]["population"][key] for key in ("case_count", "record_count", "document_count")] == [args.rows // 2, args.rows, 1], profile["profile"]["population"]
        definition = profile["profile"]["definition_id"]
        profile_hash = digest(profile["profile"])
        del profile
        sample("open_profile")
        evidence_hash = check_evidence(selected, wid)
        sample("complete_evidence")
        saved = post("investigations/save", "save_investigation_request", workspace_id=wid, investigation_id=None, expected_revision_id=None,
                     name="Synthetic memory", base_identity=base, selection_identity=selected,
                     selection_recipe={"parent_case_ids": [f"M{index:05d}" for index in range(args.rows // 2)], "predicates": []}, context_policy="incident.context.first_record_in_declared_order.v1",
                     comparison=None, notes="invented only", bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": [
                         {"operation": "bpic19_profile", "identity": selected, "query": query, "definition_id": definition, "selection_prefix_length": 0}]})
        revision = saved["revision"]["saved_revision_id"]
        saved_hash = digest({key: saved[key] for key in ("revision", "bpic19_outputs")})
        del saved
        sample("save")
        for index in range(3):
            answer = post("investigations/reopen", "reopen_investigation_request", workspace_id=wid, saved_revision_id=revision)
            assert digest({key: answer[key] for key in ("revision", "bpic19_outputs")}) == saved_hash
            del answer
            sample(f"identical_reopen_{index + 1}")
        first_pid = process.pid
        previous_process, previous_client = process, client
        process = client = None
        stop(previous_process, previous_client, port)
        process, client, port = start()
        assert process.pid != first_pid
        assert post("workspaces/open", "open_workspace_request", path=str(workspace))["workspace_id"] == wid
        answer = post("investigations/reopen", "reopen_investigation_request", workspace_id=wid, saved_revision_id=revision)
        assert digest({key: answer[key] for key in ("revision", "bpic19_outputs")}) == saved_hash
        del answer
        reopened = post("investigations/open-population", "open_population_request", workspace_id=wid, preparation_id=pid)
        assert reopened["identity"] == base
        del reopened
        assert check_evidence(selected, wid) == evidence_hash
        sample("distinct_pid_reopen_and_evidence")
        result.update(status="passed", base_identity=base, profile_sha256=profile_hash,
                      saved_payload_sha256=saved_hash, complete_evidence_sha256=evidence_hash)
    finally:
        try:
            if process is not None:
                stop(process, client, port)
        finally:
            result["service_exits"] = exits
            (folder / "stage-result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"status": "passed", "rows": args.rows, "service_exits": exits}), flush=True)


if __name__ == "__main__":
    main()
