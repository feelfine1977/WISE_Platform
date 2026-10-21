"""The owner's full-source qualification: admission from recorded readings, and receipts from synthetic sources."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "packages/analytics/tests")]
from bpic_shaped_literal import EVENTS_PER_CASE, MEASURE_ROLES, PREPARED_ROLES, arguments, cells, native_arguments, native_source, source  # noqa: E402
from qualify_full_sources import admit, linux_reading, macos_reading, windows_reading  # noqa: E402

GIB = 1 << 30
# A trusted horizon inside the invented 2018 records, so some records lie after it and must stay in the population.
SOURCE_REVIEW = {"interpretation": {"profile_name": "Synthetic source review", "policy_id": "bpic19.raw_source_interpretation.v1",
                                    "inclusion": {"kind": "all_source", "timestamp_kind": "wall_clock", "start_inclusive": None, "end_exclusive": None},
                                    "horizon": {"timestamp_kind": "wall_clock", "value": "2018-06-01T00:00:00", "provenance": "Invented horizon for the synthetic sources"},
                                    "discrepancies": []},
                 "raw_minimum_prefix": "2018-", "raw_maximum_prefix": "2018-", "witness_states": ["after_trusted_horizon"]}
REQUIRED = 22 * GIB
posix = pytest.mark.skipif(os.name != "posix", reason="The run reads process memory from the POSIX process table.")


def test_a_mac_whose_memory_is_mostly_reclaimable_file_cache_is_admitted():
    # Recorded on a 64 GB Mac with 603,110 free 16 KiB pages (9.8 GB): the old "Pages free" gate refused it.
    reading = macos_reading("1\n", "95\n", "68719476736\n")
    assert reading.available_bytes == 68719476736 * 95 // 100
    assert admit(reading, REQUIRED) == (True, "admitted")


@pytest.mark.parametrize("level,percentage,reason", [
    ("2", "60", "memory pressure is warning"),
    ("4", "60", "memory pressure is critical"),
    ("1", "20", f"{68719476736 * 20 // 100} bytes available, {REQUIRED} required"),
])
def test_a_mac_under_pressure_or_short_of_memory_is_refused(level, percentage, reason):
    assert admit(macos_reading(level, percentage, "68719476736"), REQUIRED) == (False, reason)


def test_linux_admits_on_available_memory_and_refuses_while_reclaim_stalls():
    meminfo = "MemTotal:       65536000 kB\nMemFree:         2048000 kB\nMemAvailable:   40960000 kB\n"
    assert admit(linux_reading(meminfo, None), REQUIRED) == (True, "admitted")
    stalled = "some avg10=4.20 avg60=1.00 avg300=0.20 total=123\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"
    assert admit(linux_reading(meminfo, stalled), REQUIRED) == (False, "memory pressure is warning")


def test_windows_admits_on_available_physical_memory():
    assert admit(windows_reading(30 * GIB, 52, 64 * GIB), REQUIRED)[0]
    assert admit(windows_reading(10 * GIB, 85, 64 * GIB), REQUIRED) == (False, f"{10 * GIB} bytes available, {REQUIRED} required")


def configuration(folder: Path, rows: int = 600) -> Path:
    declared = {}
    for name, raw, (dialect, mapping, policies) in (("native", native_source(rows), native_arguments()), ("prepared", source(rows), arguments())):
        path = folder / f"{name}.csv"
        path.write_bytes(raw)
        declared[name] = {"path": str(path), "sha256": hashlib.sha256(raw).hexdigest(), "dialect": dialect, "mapping": mapping, "policies": policies}
    declared["native"]["hints"] = {"delimiter": ",", "encoding": "windows-1252"}
    declared.update(prepared_roles=PREPARED_ROLES, measure_roles=MEASURE_ROLES, lineage_origin_column=9,
                    expected={"record_count": rows, "case_count": rows // EVENTS_PER_CASE,
                              "document_count": len({cells(position)[12] for position in range(rows)}), "source_review": SOURCE_REVIEW})
    config = folder / "config.json"
    config.write_text(json.dumps(declared))
    return config


def run(folder: Path, *options: str) -> tuple[int, dict]:
    receipt = folder / "receipt.json"
    finished = subprocess.run([sys.executable, "-B", str(ROOT / "tools/qualify_full_sources.py"), "--config", str(configuration(folder)),
                               "--output", str(receipt), "--no-browser", "--no-scoring", *options], capture_output=True, text=True, timeout=300)
    return finished.returncode, json.loads(receipt.read_text())


def recorded(folder: Path, pressure: str) -> str:
    reading = folder / "reading.json"
    reading.write_text(json.dumps({"system": "macos", "available_bytes": 60 * GIB, "pressure": pressure, "detail": {}}))
    return str(reading)


@posix
def test_synthetic_sources_produce_a_passing_receipt_without_paths_or_contents(tmp_path):
    code, receipt = run(tmp_path, "--recorded-reading", recorded(tmp_path, "normal"), "--limit-gib", "2", "--reserve-gib", "1")
    assert code == 0 and receipt["status"] == "passed", receipt.get("reason")
    assert receipt["format"] == "wise.full_source_receipt.v1" and receipt["transport"] == "loopback_tcp"
    assert receipt["admission"]["admitted"] and receipt["browser"] == {"status": "not_run"}
    assert receipt["cleanup"]["surviving_pids"] == [] and receipt["cleanup"]["ports_closed"]
    assert {"prepared_confirmation", "lineage_profile", "cold_reopen"} <= {stage["stage"] for stage in receipt["journey"]["stages"]}
    assert {"profile_documents", "lineage_covers_every_record", "source_review_horizon", "source_review_keeps_every_record",
            "source_review_shows_post_horizon_records"} <= set(receipt["journey"]["checks"])
    assert receipt["journey"]["source_review"]["observed_raw_maximum"].startswith("2018-")
    text = json.dumps(receipt)
    assert str(tmp_path) not in text and "vendor_" not in text and "Create Purchase Order Item" not in text


@posix
def test_a_memory_limit_breach_fails_the_receipt_and_still_cleans_up(tmp_path):
    code, receipt = run(tmp_path, "--recorded-reading", recorded(tmp_path, "normal"), "--limit-gib", "0.03", "--reserve-gib", "0")
    assert code == 1 and receipt["status"] == "failed"
    assert receipt["reason"].startswith("memory_limit") and receipt["journey"]["breach_rss_bytes"] > 0.03 * GIB
    assert receipt["cleanup"]["surviving_pids"] == [] and receipt["cleanup"]["ports_closed"]


def test_a_changed_source_or_memory_pressure_refuses_before_anything_runs(tmp_path):
    code, receipt = run(tmp_path, "--recorded-reading", recorded(tmp_path, "warning"))
    assert code == 1 and receipt["status"] == "refused" and receipt["reason"] == "admission: memory pressure is warning"
    assert "journey" not in receipt
    config = configuration(tmp_path)
    declared = json.loads(config.read_text())
    declared["prepared"]["sha256"] = "0" * 64
    config.write_text(json.dumps(declared))
    finished = subprocess.run([sys.executable, "-B", str(ROOT / "tools/qualify_full_sources.py"), "--config", str(config),
                               "--output", str(tmp_path / "changed.json"), "--no-browser"], capture_output=True, text=True, timeout=120)
    changed = json.loads((tmp_path / "changed.json").read_text())
    assert finished.returncode == 1 and changed["reason"] == "prepared source digest differs from the configuration"
    assert "admission" not in changed
