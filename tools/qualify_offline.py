"""Qualify #27 in the built browser: a local investigation with networking unavailable.

The service runs as its own process over an empty temporary workspace, under a guard (a sitecustomize written into the
temporary folder, never into the application) that refuses and records every connection and name lookup that is not to
this computer; the browser resolves no host but this computer's and refuses and records every request elsewhere. The
invented tests/fixtures/requests file is imported through the Data area, queried, shown as map, paths, matrix, variants,
context and times, a complete history is opened, the investigation is saved and the workspace backed up after a preview
of its local folder and content. After an actual restart the investigation reopens; after another restart without the
method library, scoring is refused in words and everything else works. The receipt holds checks and a bounded privacy
summary (hosts, request counts by method and path, refused connections): no identity, value or path.

    python tools/qualify_offline.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools")]

from capacity_journey import Service  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/requests"

GUARD = """\
import builtins, importlib.abc, json, os, socket, sys
_log = os.environ["WISE_NETWORK_GUARD_LOG"]


def _record(kind, target):
    with open(_log, "a", encoding="utf-8") as file:
        file.write(json.dumps({"kind": kind, "target": str(target)}) + "\\n")


def _local(host):
    return host in (None, "localhost", "::1", "0.0.0.0") or str(host).startswith("127.")


_connect, _connect_ex, _lookup = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo


def connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _local(address[0]):
        _record("connect", address[0])
        raise OSError("networking is unavailable")
    return _connect(self, address)


def connect_ex(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _local(address[0]):
        _record("connect", address[0])
        return 101
    return _connect_ex(self, address)


def getaddrinfo(host, *args, **kwargs):
    if not _local(host):
        _record("lookup", host)
        raise socket.gaierror("networking is unavailable")
    return _lookup(host, *args, **kwargs)


socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = connect, connect_ex, getaddrinfo

if os.environ.get("WISE_GUARD_BLOCK_METHOD") == "1":
    class _NoMethod(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path=None, target=None):
            if name == "wise" or name.startswith("wise."):
                raise ImportError("the method library is not installed in this run")
            return None
    sys.meta_path.insert(0, _NoMethod())
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--playwright", required=True)
    parser.add_argument("--chrome", required=True)
    args = parser.parse_args()
    if not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-offline-")).resolve()
    workspace = folder / "workspace"
    workspace.mkdir()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    guard = folder / "guard"
    guard.mkdir()
    (guard / "sitecustomize.py").write_text(GUARD, encoding="utf-8")
    log = folder / "network-guard.log"
    log.touch()
    backup = folder / "backup"

    def guarded(**extra) -> dict:
        return {"PYTHONPATH": os.pathsep.join([str(guard), str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src")]), "WISE_NETWORK_GUARD_LOG": str(log),
                "HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9", **extra}

    def browse(phase: str, **extra) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"expected": expected, "file": str(FIXTURES / expected["file"]), "backup": str(backup),
                                      "kept_after_step": ["R-1", "R-2", "R-3", "R-5", "R-6"], **extra}))
        output = folder / f"browser-{phase}.json"
        with (folder / f"browser-{phase}.log").open("wb") as stream:
            code = subprocess.call([args.node, str(ROOT / "tools/qualify_offline.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                    args.playwright, args.chrome, str(config), phase], stdout=stream, stderr=subprocess.STDOUT, timeout=900)
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-3000:])
        return {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}

    receipt = {"format": "wise.offline_receipt.v1", "provenance": provenance(), "checks": checks,
               "fixtures_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(FIXTURES.iterdir())}}
    service = Service(workspace, folder / "service.log")
    service.start(env=guarded())
    try:
        offline = browse("offline")
        check("backup_written_in_the_local_folder", (backup / "wise-platform-backup.json").is_file(), sorted(path.name for path in backup.glob("*"))[:5])
        service.stop()
        service.start(env=guarded())
        reopen = browse("reopen", kept_identity=offline.get("kept_identity"))
        service.stop()
        service.start(env=guarded(WISE_GUARD_BLOCK_METHOD="1"))
        unavailable = browse("unavailable")
        attempts = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]
        check("service_made_no_connection_elsewhere", attempts == [], attempts[:5])
        receipt["browser"] = {phase: {key: value for key, value in result.items() if key in ("exit", "checks", "privacy")}
                              for phase, result in (("offline", offline), ("reopen", reopen), ("unavailable", unavailable))}
        for phase in ("offline", "reopen", "unavailable"):
            privacy = receipt["browser"][phase].get("privacy") or {}
            check(f"{phase}_browser_requests_stay_on_this_computer", privacy.get("hosts") == ["127.0.0.1:<port>"] and privacy.get("refused_hosts") == [], privacy.get("hosts"))
        receipt["service_guard"] = {"refused_connections": len(attempts)}
    finally:
        receipt["service_exit"] = service.stop()
    receipt["status"] = "passed" if checks and all(entry["passed"] for entry in checks) else "failed"
    # A failure's detail quotes the browser's log, which may name the temporary folder or this checkout; both are named generically.
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>").replace(json.dumps(str(ROOT))[1:-1], "<repository>")
    assert str(folder) not in text and str(ROOT) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
