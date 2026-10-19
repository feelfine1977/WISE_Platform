"""Qualify the BPIC19 descriptive journey on the complete local sources, as the owner runs it, and write one receipt.

    python tools/qualify_full_sources.py --config ~/wise-full-sources.json --output receipt.json \\
        --node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME

The configuration is a local, untracked JSON file naming both sources, their SHA-256 digests, their confirmed
interpretations and the counts the owner expects; see docs/capacity.md. The sources are hashed before anything
starts and must match. The run is admitted only when the system can provide the memory limit plus the reserve
without pressure. The service runs on loopback under that limit and a deadline, both enforced by killing it, and
every owned process is confirmed gone afterwards. The receipt holds counts, digests, timings, memory and the
result, never source paths or record contents.

POSIX only for the run itself: process-tree memory is read from ps.
"""
from __future__ import annotations

import argparse
import ctypes
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from capacity_journey import Expectations, Journey, Origin, tree_rss  # noqa: E402

GIB = 1 << 30
RECEIPT_FORMAT = "wise.full_source_receipt.v1"
BROWSER_VIEWS = ("population", "profile", "evidence")


# Admission -----------------------------------------------------------------------------------

@dataclass(frozen=True)
class MemoryReading:
    """What the system says it can provide now, and how it was read."""

    system: str
    available_bytes: int | None
    pressure: str
    """normal, warning, critical or unknown."""
    detail: dict


def admit(reading: MemoryReading, required: int) -> tuple[bool, str]:
    """Admit only without memory pressure and with the required bytes available."""
    if reading.pressure != "normal":
        return False, f"memory pressure is {reading.pressure}"
    if reading.available_bytes is None:
        return False, "available memory is unknown"
    if reading.available_bytes < required:
        return False, f"{reading.available_bytes} bytes available, {required} required"
    return True, "admitted"


def macos_reading(pressure_level: str, free_percentage: str, physical: str) -> MemoryReading:
    """From sysctl kern.memorystatus_vm_pressure_level, kern.memorystatus_level and hw.memsize.

    The free percentage is the kernel's own estimate, the one memory_pressure reports. It counts file cache the
    system reclaims on demand and leaves out inactive anonymous memory that would have to be compressed first."""
    level = {"1": "normal", "2": "warning", "4": "critical"}.get(pressure_level.strip(), "unknown")
    percentage, total = int(free_percentage), int(physical)
    return MemoryReading("macos", total * percentage // 100, level,
                         {"pressure_level": int(pressure_level), "free_percentage": percentage, "physical_bytes": total})


def linux_reading(meminfo: str, pressure: str | None) -> MemoryReading:
    """From /proc/meminfo MemAvailable and, when present, /proc/pressure/memory."""
    fields = {line.split(":")[0]: int(line.split()[1]) * 1024 for line in meminfo.splitlines() if line.strip().endswith("kB")}
    stalled = None
    if pressure:
        some = next((line for line in pressure.splitlines() if line.startswith("some")), "")
        stalled = float(dict(part.split("=") for part in some.split()[1:]).get("avg10", 0))
    # Any recent stall waiting for memory means the system is reclaiming under pressure.
    level = "unknown" if "MemAvailable" not in fields else "warning" if stalled and stalled >= 1.0 else "normal"
    return MemoryReading("linux", fields.get("MemAvailable"), level,
                         {"mem_available_bytes": fields.get("MemAvailable"), "mem_total_bytes": fields.get("MemTotal"), "some_avg10": stalled})


def windows_reading(available_physical: int, memory_load: int, total_physical: int) -> MemoryReading:
    """From GlobalMemoryStatusEx: available physical memory, which includes the standby list Windows reclaims."""
    return MemoryReading("windows", available_physical, "normal",
                         {"available_physical_bytes": available_physical, "memory_load_percent": memory_load, "total_physical_bytes": total_physical})


def read_memory() -> MemoryReading:
    if sys.platform == "darwin":
        def sysctl(name: str) -> str:
            return subprocess.check_output(["sysctl", "-n", name], text=True, timeout=5)
        return macos_reading(sysctl("kern.memorystatus_vm_pressure_level"), sysctl("kern.memorystatus_level"), sysctl("hw.memsize"))
    if sys.platform.startswith("linux"):
        pressure = Path("/proc/pressure/memory")
        return linux_reading(Path("/proc/meminfo").read_text(), pressure.read_text() if pressure.exists() else None)
    if os.name == "nt":
        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong), ("available", ctypes.c_ulonglong),
                        ("page_total", ctypes.c_ulonglong), ("page_available", ctypes.c_ulonglong), ("virtual_total", ctypes.c_ulonglong),
                        ("virtual_available", ctypes.c_ulonglong), ("extended", ctypes.c_ulonglong)]
        status = Status(length=ctypes.sizeof(Status))
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
        return windows_reading(status.available, status.load, status.total)
    return MemoryReading(sys.platform, None, "unknown", {})


# Configuration and sources -------------------------------------------------------------------

def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_origin(name: str, declared: dict) -> Origin:
    return Origin(name, Path(declared["path"]).expanduser(), declared["dialect"], declared["mapping"], declared["policies"], declared.get("hints"))


# Browser -------------------------------------------------------------------------------------

def browser_expectations(expected: dict, native_source_id: str) -> dict:
    """The texts the profile view must show, written as the browser writes them, and the witnesses to open."""
    texts = [f"{expected['case_count']:,} PO items", f"{expected['record_count']:,} original records",
             f"{expected['record_count']:,} original records checked across the entire source", native_source_id]
    if expected.get("document_count") is not None:
        texts.append(f"{expected['document_count']:,} purchasing documents")
    review = expected.get("source_review")
    states = []
    if review is not None:
        horizon = review["interpretation"]["horizon"]["value"]
        texts += [f"Raw parsed range: {review['raw_minimum_prefix']}", f"Observation horizon: {'unknown' if horizon is None else horizon}"]
        texts += [f"Source discrepancy: {entry['reported_total'] - entry['reported_subtotal']:,} items" for entry in review["interpretation"]["discrepancies"]]
        states = list(review.get("witness_states", []))
    return {"texts": texts, "witness_states": states}


def browse(args, folder: Path, journey: Journey, case_id: str, phase: str, expected: Path) -> dict:
    """Open the reopened investigation's population, profile and evidence views in the built browser.

    The browser's process tree is sampled throughout; each view's peak is read from the samples taken between
    the moments the script reports for it."""
    samples: list[tuple[float, int]] = []
    output = folder / f"browser-{phase}.json"
    command = [args.node, str(ROOT / "tools/qualify_full_sources.mjs"), f"http://127.0.0.1:{journey.service.port}", str(journey.workspace),
               journey.saved_name, case_id, str(output), args.playwright, args.chrome, phase, str(expected)]
    with (folder / f"browser-{phase}.log").open("wb") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    done = threading.Event()

    def sample() -> None:
        while not done.is_set():
            try:
                samples.append((time.time(), tree_rss(process.pid)))
            except (OSError, subprocess.SubprocessError, ValueError):
                pass
            done.wait(0.1)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    try:
        code = process.wait(timeout=args.browser_timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, 9)
        code = process.wait(timeout=10)
    finally:
        done.set()
        sampler.join(timeout=5)
        try:
            os.killpg(process.pid, 9)
        except ProcessLookupError:
            pass
    result = {"exit": code, "pid": process.pid, "views": {}, "downloads": [], "witnesses": []}
    if code == 0 and output.exists():
        reported = json.loads(output.read_text())
        for view, moments in reported["views"].items():
            within = [value for moment, value in samples if moments["start"] <= moment <= moments["end"] + 0.1]
            result["views"][view] = {"seconds": round(moments["end"] - moments["start"], 3), "peak_browser_rss_bytes": max(within, default=None)}
        result["downloads"], result["witnesses"] = reported["downloads"], reported["witnesses"]
    result["peak_browser_rss_bytes"] = max((value for _, value in samples), default=None)
    return result


# Cleanup -------------------------------------------------------------------------------------

def surviving(pids: list[int]) -> list[int]:
    """Owned processes still present: alive, or not yet reaped."""
    alive = []
    for pid in pids:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            continue
        except PermissionError:
            pass
        alive.append(pid)
    return alive


def build_is_current(web: Path = ROOT / "apps/web", built: Path = ROOT / "apps/api/src/wise_platform_api/static") -> bool:
    """Whether every built browser file is newer than every web source it is built from."""
    sources = [path for folder in ("src", "public") for path in (web / folder).rglob("*") if path.is_file()]
    sources += [path for name in ("index.html", "package.json", "vite.config.ts") if (path := web / name).is_file()]
    outputs = [path for path in built.rglob("*") if path.is_file()]
    return bool(outputs) and (not sources or min(path.stat().st_mtime for path in outputs) >= max(path.stat().st_mtime for path in sources))


def provenance() -> dict:
    def git(*command: str) -> str:
        return subprocess.check_output(["git", *command], cwd=ROOT, text=True).strip()
    built = sorted((ROOT / "apps/api/src/wise_platform_api/static").rglob("*"))
    assets = hashlib.sha256()
    for path in built:
        if path.is_file():
            assets.update(str(path.relative_to(ROOT)).encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return {"head": git("rev-parse", "HEAD"), "uncommitted_changes": bool(git("status", "--porcelain", "--untracked-files=no")),
            "python": platform.python_version(), "platform": platform.platform(),
            "built_assets_sha256": assets.hexdigest() if any(path.is_file() for path in built) else None,
            "build_is_current": build_is_current()}


# Command -------------------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--config", type=Path, required=True, help="local, untracked JSON naming both sources and their interpretations")
    parser.add_argument("--output", type=Path, required=True, help="where to write the receipt")
    parser.add_argument("--limit-gib", type=float, default=14, help="owned memory limit for the service's process tree")
    parser.add_argument("--reserve-gib", type=float, default=8, help="memory left for the rest of the system, required at admission")
    parser.add_argument("--deadline-minutes", type=float, default=30)
    parser.add_argument("--node")
    parser.add_argument("--playwright", help="path of Playwright's index.mjs")
    parser.add_argument("--chrome")
    parser.add_argument("--browser-timeout", type=float, default=600)
    parser.add_argument("--no-browser", action="store_true", help="run the service journey only; the receipt says the browser did not run")
    parser.add_argument("--no-scoring", action="store_true")
    parser.add_argument("--recorded-reading", type=Path, help="a recorded memory reading to admit against, instead of reading this system")
    args = parser.parse_args()
    if not args.no_browser and not all([args.node, args.playwright, args.chrome]):
        parser.error("--node, --playwright and --chrome are required unless --no-browser is given")
    config = json.loads(args.config.read_text())
    limit, reserve = round(args.limit_gib * GIB), round(args.reserve_gib * GIB)
    receipt: dict = {"format": RECEIPT_FORMAT, "status": "refused", "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                     "provenance": provenance(), "memory_limit_bytes": limit, "reserve_bytes": reserve, "transport": "loopback_tcp"}

    def finish(status: str, **fields) -> int:
        receipt.update(status=status, **fields)
        args.output.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps({"status": status, "reason": receipt.get("reason"), "receipt": str(args.output)}), flush=True)
        return 0 if status == "passed" else 1

    digests = {}
    for name in ("native", "prepared"):
        declared = config[name]
        actual = file_sha256(Path(declared["path"]).expanduser())
        digests[name] = actual
        if actual != declared["sha256"]:
            return finish("refused", reason=f"{name} source digest differs from the configuration", source_sha256=digests)
    receipt["source_sha256"] = digests
    if not args.no_browser and receipt["provenance"]["built_assets_sha256"] is None:
        return finish("refused", reason="the browser build is missing; run npm run build")
    if not args.no_browser and not receipt["provenance"]["build_is_current"]:
        return finish("refused", reason="the browser build is older than the web sources; run npm run build")
    reading = MemoryReading(**json.loads(args.recorded_reading.read_text())) if args.recorded_reading else read_memory()
    admitted, why = admit(reading, limit + reserve)
    receipt["admission"] = {"admitted": admitted, "reason": why, "required_bytes": limit + reserve, "reading": reading.__dict__}
    if not admitted:
        return finish("refused", reason=f"admission: {why}")
    if os.name != "posix":
        return finish("refused", reason="the run reads process memory with ps and needs a POSIX system")

    folder = Path(tempfile.mkdtemp(prefix="wise-full-sources-"))
    native, prepared = load_origin("native", config["native"]), load_origin("prepared", config["prepared"])
    expected = config["expected"]
    browser: dict = {"status": "not_run"}

    def after_reopen(journey: Journey, wid: str, revision: str, case_id: str) -> None:
        """Review, save and export in the browser; then reopen in a new service process and a fresh browser."""
        if args.no_browser:
            return
        texts = folder / "browser-expected.json"
        texts.write_text(json.dumps(browser_expectations(expected, "source.v1:sha256:" + config["native"]["sha256"])))
        review = browse(args, folder, journey, case_id, "review", texts)
        browser.update(review=review, pid=review["pid"])
        journey.check("browser_review", review["exit"] == 0 and set(BROWSER_VIEWS) <= set(review["views"]), review["exit"])
        journey.restart()
        reopen = browse(args, folder, journey, case_id, "reopen", texts)
        browser.update(reopen=reopen, pids=[review["pid"], reopen["pid"]])
        journey.check("browser_reopen", reopen["exit"] == 0, reopen["exit"])
        journey.check("browser_exports_identical_after_restart", reopen["downloads"] == review["downloads"]
                      and len(review["downloads"]) == 2, (review["downloads"], reopen["downloads"]))
        browser.update(status="passed", views=review["views"], downloads=review["downloads"],
                       peak_browser_rss_bytes=max(review["peak_browser_rss_bytes"] or 0, reopen["peak_browser_rss_bytes"] or 0))

    journey = Journey(folder, native, prepared, config["prepared_roles"], config["measure_roles"], config["lineage_origin_column"],
                      Expectations(expected["case_count"], expected["record_count"], document_count=expected.get("document_count"),
                                   source_review=expected.get("source_review"),
                                   timing_exemplar=expected.get("timing_exemplar")), limit=limit,
                      deadline=args.deadline_minutes * 60, score=not args.no_scoring, after_reopen=after_reopen)
    started = time.monotonic()
    result = journey.run()
    owned = result["service_pids"] + browser.get("pids", [browser["pid"]] if "pid" in browser else [])
    left = surviving(owned)
    cleanup = {"owned_pids": owned, "surviving_pids": left, "ports_closed": all(e.get("port_closed") for e in result["service_exits"])}
    status = "passed" if result["status"] == "passed" and not left and cleanup["ports_closed"] else "failed"
    for key in ("identities", "saved_payload_sha256"):
        result.pop(key, None)
    if browser["status"] != "not_run" and result["status"] != "passed":
        browser["status"] = "failed"
    return finish(status, reason=result.get("reason") or (None if status == "passed" else "cleanup incomplete"),
                  elapsed_seconds=round(time.monotonic() - started, 1), journey=result, browser=browser, cleanup=cleanup,
                  counts={"records_per_source": expected["record_count"], "cases": expected["case_count"],
                          "documents": expected.get("document_count")})


if __name__ == "__main__":
    sys.exit(main())
