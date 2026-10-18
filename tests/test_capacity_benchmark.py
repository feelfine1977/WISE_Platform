"""The benchmark CLI measures real HTTP operations and restores its synthetic workspace."""

import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMMAND = [sys.executable, str(ROOT / "tools/benchmark_capacity.py")]


@pytest.mark.parametrize(
    ("records", "parent_records", "kept_records", "hours", "method_value"),
    [(3, 12, 6, 2, 0), (6, 24, 12, 5, 0.5), (10, 40, 20, 9, 1)],
)
def test_benchmark_cli_reports_checked_operations_and_stopped_workspace_restoration(
    tmp_path,
    records,
    parent_records,
    kept_records,
    hours,
    method_value,
):
    output = tmp_path / "capacity.json"
    result = subprocess.run(
        [
            *COMMAND,
            "--cases",
            "4",
            "--records-per-case",
            str(records),
            "--repeats",
            "2",
            "--output",
            str(output),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    receipt = json.loads(output.read_text(encoding="utf-8"))
    assert receipt["schema_version"] == 1
    assert receipt["qualification"] == "synthetic_measurement_not_supported_capacity"
    assert receipt["dataset"]["case_count"] == 4
    assert receipt["dataset"]["record_count"] == parent_records
    assert receipt["checks"] == {
        "parent_case_count": 4,
        "kept_case_ids": ["C000000", "C000002"],
        "kept_record_count": kept_records,
        "restored_selection_matches": True,
        "restored_evidence_matches": True,
        "restored_score_run_matches": True,
        "backup_files_match": True,
        "owned_hosts_stopped": True,
    }
    assert receipt["verified_semantics"] == {
        "activity_presence": [
            {"present": False, "case_count": 0, "record_count": 0},
            {"present": True, "case_count": 2, "record_count": kept_records},
        ],
        "scoring": {
            "case_count": 4,
            "measurement_hours": hours,
            "method_value": method_value,
        },
    }
    expected = {
        "startup",
        "upload",
        "inspect",
        "prepare",
        "open_population",
        "select",
        "graph",
        "case_list_first",
        "case_list_next",
        "rule_groups",
        "compare",
        "validate",
        "score",
        "read_run",
        "save",
        "backup_copy",
        "restore_copy",
        "restart",
        "reopen",
        "evidence",
    }
    assert set(receipt["timings"]) == expected
    for name, measurement in receipt["timings"].items():
        assert len(measurement["seconds"]) == (
            2
            if name
            in {
                "select",
                "graph",
                "case_list_first",
                "case_list_next",
                "rule_groups",
                "compare",
                "read_run",
            }
            else 1
        )
        assert all(value >= 0 for value in measurement["seconds"])
        assert measurement["max_seconds"] >= measurement["median_seconds"] >= 0
    assert receipt["workspace_bytes"] > receipt["dataset"]["byte_count"] > 0
    assert receipt["environment"]["python"]
    assert receipt["environment"]["application_version"] == "0.1.0"
    assert receipt["host_memory"]["scope"] == "owned_cli_processes_high_water"
    assert (
        receipt["host_memory"]["peak_rss_bytes"] is None
        or receipt["host_memory"]["peak_rss_bytes"] > 0
    )
    assert list(tmp_path.iterdir()) == [
        output
    ], "Temporary runtime state must be cleaned up."


@pytest.mark.parametrize(
    "arguments",
    [
        ["--cases", "0"],
        ["--records-per-case", "1"],
        ["--repeats", "0"],
        ["--timeout", "0"],
    ],
)
def test_invalid_measurement_parameters_publish_no_receipt(tmp_path, arguments):
    output = tmp_path / "capacity.json"
    result = subprocess.run(
        [*COMMAND, *arguments, "--output", str(output)],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 2
    assert not output.exists()
    assert list(tmp_path.iterdir()) == []


def test_existing_receipt_is_never_overwritten(tmp_path):
    output = tmp_path / "capacity.json"
    output.write_bytes(b"prior measurement")
    result = subprocess.run(
        [*COMMAND, "--output", str(output)], capture_output=True, text=True, timeout=10
    )
    assert result.returncode == 2
    assert output.read_bytes() == b"prior measurement"


def test_receipts_inside_program_folders_are_refused():
    result = subprocess.run(
        [*COMMAND, "--output", str(ROOT / "capacity-must-not-be-written.json")],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 2
    assert "outside program files" in result.stderr
    assert not (ROOT / "capacity-must-not-be-written.json").exists()
