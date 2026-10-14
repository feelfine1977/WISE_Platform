"""Two real local CLI launches reuse the initialized workspace and stored bytes."""

from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import sys
import time

import httpx

from test_import_acceptance import (
    VALIDATOR, checked, envelope, evidence, mapping_request, population,
    prepare, read_input, upload,
)
from test_saved_investigation_restart import HEALTH, loopback_port, stop_owned

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def initialized_cli(tmp_path, chosen, attempt, port):
    launch = tmp_path / "Unrelated launch folder"
    launch.mkdir(exist_ok=True)
    log = tmp_path / f"default-workspace-host-{attempt}.log"
    environment = {key: value for key, value in os.environ.items() if key != "PYTHONHOME"}
    environment["PYTHONPATH"] = os.pathsep.join([
        str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src"),
    ])
    with log.open("wb") as stream:
        process = subprocess.Popen(
            [sys.executable, "-m", "wise_platform_api", "--port", str(port), "--workspace", str(chosen)],
            cwd=launch, env=environment, stdout=stream, stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=5) as client:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    assert process.poll() is None, log.read_text(errors="replace")
                    try:
                        response = client.get("/api/health", timeout=1)
                        if response.status_code == 200:
                            HEALTH.validate(response.json())
                            break
                    except httpx.TransportError:
                        pass
                    time.sleep(0.1)
                else:
                    raise AssertionError("Owned CLI did not become ready: " + log.read_text(errors="replace"))
                yield client, process
        finally:
            stop_owned(process)
    assert process.poll() is not None


def default(client, attempt):
    request = envelope("open_default_workspace_request", f"initialize-{attempt}", attempt)
    VALIDATOR.validate(request)
    return checked(client.post("/api/workspaces/open-default", json=request), "workspace_answer", request)


def kept(folder):
    return {path.relative_to(folder): path.read_bytes() for path in folder.rglob("*") if path.is_file()}


def test_cli_override_initializes_once_and_second_process_reuses_full_preparation_and_source(tmp_path):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    chosen = tmp_path / "Owned local workspace"
    port = loopback_port()
    with initialized_cli(tmp_path, chosen, 1, port) as (client, first_process):
        assert not chosen.exists(), "Initialization belongs to bootstrap, not CLI import or health."
        workspace = default(client, 1)
        assert Path(workspace["path"]) == chosen.resolve()
        literal, raw, _ = read_input("B4")
        source = upload(client, workspace, raw, literal["file"])
        interpretation = prepare(client, mapping_request(workspace, source, "B4"))
        original = population(client, workspace, interpretation)
        trace = evidence(client, workspace, original, "T-01")
        protected = kept(chosen)
        first_pid = first_process.pid
    with initialized_cli(tmp_path, chosen, 2, port) as (client, second_process):
        assert second_process.pid != first_pid and first_process.poll() is not None
        restored = default(client, 2)
        assert restored["workspace_id"] == workspace["workspace_id"]
        assert restored["sources"] == [source]
        assert restored["preparations"] == [{key: interpretation["preparation"][key] for key in ("preparation_id", "source_id")}]
        reopened = population(client, restored, interpretation)
        assert reopened["identity"] == original["identity"] and reopened["preparation"] == original["preparation"]
        recovered = evidence(client, restored, reopened, "T-01")
        for key in ("case_id", "columns", "records", "coverage", "mapped_row_ids", "omitted_activity_row_ids", "sequence_evaluable"):
            assert recovered[key] == trace[key]
        assert kept(chosen) == protected
        assert not (tmp_path / "Unrelated launch folder" / "workspace").exists()
