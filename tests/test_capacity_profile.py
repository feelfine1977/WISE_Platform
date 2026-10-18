"""The capacity measurement drives the whole journey through the real service and refuses a projection over budget."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from qualify_capacity import project  # noqa: E402


def test_each_stage_is_projected_along_its_measured_line():
    projected = project(1_000, 3_000, {"import": 1_200_000, "idle": 900}, {"import": 3_200_000, "idle": 900, "extra": 5}, 101_000)
    assert projected == {"import": {"bytes_per_record": 1000.0, "intercept_bytes": 200_000, "projected_bytes": 101_200_000},
                         "idle": {"bytes_per_record": 0.0, "intercept_bytes": 900, "projected_bytes": 900}}


@pytest.mark.skipif(os.name != "posix", reason="The measurement reads the service's memory from the POSIX process table.")
def test_a_journey_that_passes_every_check_still_fails_over_its_declared_budget(tmp_path):
    folder, output = tmp_path / "capacity", tmp_path / "profile.json"
    finished = subprocess.run([sys.executable, "-B", str(ROOT / "tools/qualify_capacity.py"), "--rows", "1200", "--small-rows", "600",
                               "--budget-gib", "0.01", "--no-scoring", "--folder", str(folder), "--output", str(output)],
                              capture_output=True, text=True, timeout=300)
    profile = json.loads(output.read_text())
    assert finished.returncode == 1, finished.stdout + finished.stderr
    assert profile["status"] == "over_budget" and profile["budget_bytes"] == round(0.01 * (1 << 30))
    assert profile["projected_journey_peak_bytes"] > profile["budget_bytes"]
    for rows, run in profile["runs"].items():
        assert run["status"] == "passed" and run["cleanup_verified"], (rows, run.get("reason"))
        stages = {stage["stage"] for stage in run["stages"]}
        assert {"native_confirmation", "prepared_confirmation", "lineage_profile", "default_measures", "process_graph",
                "variants", "save", "cold_reopen"} <= stages
        assert "selection_keeps_all" in run["checks"] and "reopen_identical" in run["checks"]
        assert len(run["service_exits"]) == 2
    assert {"physical_memory_bytes", "platform", "python"} <= set(profile["machine"])
