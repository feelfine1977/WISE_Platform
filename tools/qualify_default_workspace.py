"""Qualify #47 in the built browser: the application's own workspace, created, reused, overridden and refused.

Every launch is an actual service process started without a workspace folder, over a synthetic user whose home lies
in a temporary folder, so the service chooses the per-user default as an installed application does. Phases, each in
a fresh browser:

- create: the first launch creates the default workspace outside the program and shows the packaged example S0;
- reuse: a second launch reuses it, with the same identities, without reading the example again;
- launch-override: a launch with an explicit folder uses that folder and leaves the default untouched;
- data-override: a folder holding other files is refused in the Data area with its bytes kept, another (empty)
  folder is used instead, and the way back leads to the default;
- unwritable: a default that cannot be created is refused before anything is read; Try again succeeds once it can;
- corrupt: a default with a damaged manifest is refused with its bytes kept; another folder chosen in the Data area
  recovers.

The receipt holds checks and identities only: no path.

    python tools/qualify_default_workspace.py --output receipt.json --node node --playwright .../index.mjs --chrome ...
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src")]

from capacity_journey import Service  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402
from wise_platform_api.default_workspace import default_workspace_path  # noqa: E402

FIXTURES = ROOT / "tests/fixtures/incidents"
MANIFEST = "wise-platform-workspace.json"


def user(home: Path) -> dict:
    """The environment of a synthetic user whose data folders all lie under ``home``."""
    return {"HOME": str(home), "USERPROFILE": str(home), "XDG_DATA_HOME": str(home / ".local/share"), "LOCALAPPDATA": str(home / "AppData/Local")}


def files(folder: Path) -> dict:
    return {str(path.relative_to(folder)): path.read_bytes() for path in folder.rglob("*") if path.is_file()} if folder.exists() else {}


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
    folder = Path(tempfile.mkdtemp(prefix="wise-default-workspace-")).resolve()
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))["fixtures"]["S0"]
    checks: list[dict] = []
    phases: dict[str, dict] = {}

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    def default_of(home: Path) -> Path:
        return default_workspace_path(environment=user(home), home=home)

    def launch(phase: str, home: Path, workspace: Path | None = None, **paths: Path) -> dict:
        config = folder / f"config-{phase}.json"
        config.write_text(json.dumps({"cases": expected["base_cases"], "records": expected["base_records"],
                                      "default": str(default_of(home)), **{key: str(value) for key, value in paths.items()}}))
        service = Service(workspace, folder / f"service-{phase}.log")
        service.start(env=user(home))
        try:
            output = folder / f"browser-{phase}.json"
            with (folder / f"browser-{phase}.log").open("wb") as log:
                code = subprocess.call([args.node, str(ROOT / "tools/qualify_default_workspace.mjs"), f"http://127.0.0.1:{service.port}", str(output),
                                        args.playwright, args.chrome, str(config), phase], stdout=log, stderr=subprocess.STDOUT, timeout=600)
            result = {"exit": code, "pid": service.process.pid, **(json.loads(output.read_text()) if code == 0 else {})}
        finally:
            result_exit = service.stop()
        check(f"browser_{phase}", code == 0, (folder / f"browser-{phase}.log").read_text()[-2000:])
        phases[phase] = {**result, "service_exit": result_exit}
        return result

    home = folder / "Synthetic user"
    default = default_of(home)
    check("default_is_outside_the_program_and_launch_folder", ROOT not in default.parents and Path.cwd() not in default.parents and not default.exists())
    created = launch("create", home)
    check("default_created_with_its_manifest", (default / MANIFEST).is_file())
    stored = files(default)
    again = launch("reuse", home)
    check("reuse_has_the_same_identity", again.get("identity") is not None and again.get("identity") == created.get("identity"))
    check("reuse_is_another_process", again.get("pid") != created.get("pid"))
    check("reuse_keeps_the_stored_files", {key: value for key, value in files(default).items() if key in stored} == stored)

    override = folder / "Launch override" / "workspace"
    before = files(default)
    launch("launch-override", home, override, override=override)
    check("launch_override_created_there", (override / MANIFEST).is_file())
    check("launch_override_leaves_the_default_untouched", files(default) == before)

    foreign = folder / "Foreign folder"
    foreign.mkdir()
    (foreign / "unrelated-synthetic-note.txt").write_bytes(b"Unrelated synthetic content")
    kept = files(foreign)
    # A folder chosen in the Data area must exist and be empty (an absent one is refused, see test_workspace.py).
    (folder / "Chosen in the Data area").mkdir()
    launch("data-override", home, chosen=folder / "Chosen in the Data area", foreign=foreign)
    check("foreign_folder_bytes_kept", files(foreign) == kept)
    check("chosen_folder_is_a_workspace", (folder / "Chosen in the Data area" / MANIFEST).is_file())

    locked_home = folder / "Synthetic user without a writable data folder"
    locked = default_of(locked_home).parent
    locked.mkdir(parents=True)
    locked.chmod(0o500)
    try:
        launch("unwritable", locked_home, unlock=locked)
    finally:
        locked.chmod(0o700)
    check("unwritable_default_created_after_try_again", (default_of(locked_home) / MANIFEST).is_file())

    damaged_home = folder / "Synthetic user with a damaged workspace"
    damaged = default_of(damaged_home)
    damaged.mkdir(parents=True)
    (damaged / MANIFEST).write_bytes(b"{ damaged synthetic manifest")
    damaged_bytes = files(damaged)
    (folder / "Chosen after a damaged workspace").mkdir()
    launch("corrupt", damaged_home, chosen=folder / "Chosen after a damaged workspace")
    check("damaged_workspace_bytes_kept", files(damaged) == damaged_bytes)

    receipt = {"format": "wise.default_workspace_receipt.v1", "provenance": provenance(), "checks": checks,
               "phases": phases, "status": "passed" if checks and all(entry["passed"] for entry in checks) else "failed"}
    # A failure's detail quotes the browser's log, which may name the temporary folders; they are named generically.
    text = json.dumps(receipt, indent=1).replace(json.dumps(str(folder))[1:-1], "<temporary folder>")
    assert str(folder) not in text and str(home) not in text, "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
