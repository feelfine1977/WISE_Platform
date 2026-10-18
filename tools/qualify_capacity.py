"""Measure the BPIC19 descriptive journey's memory and time on this machine, and project it to the full sources.

Runs the journey through the real service on invented native-shaped and prepared-shaped sources at two sizes. Each
stage's peak and retained service memory is fitted as a line in the number of records per source and projected to
the full BPIC19 size. The command fails if the projected journey peak exceeds the declared budget.

    python tools/qualify_capacity.py --rows 100000 --output capacity-profile.json

No dataset is read. POSIX only.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / part) for part in ("tools", "apps/api/src", "packages/analytics/src", "packages/analytics/tests")]
from bpic_shaped_literal import (  # noqa: E402
    EVENTS_PER_CASE, MEASURE_ROLES, PREPARED_ROLES, arguments, cells, native_arguments, native_source, source,
)
from capacity_journey import Expectations, Journey, Origin  # noqa: E402

FULL_RECORDS = 1_595_923
GIB = 1 << 30
DEFAULT_BUDGET_GIB = 14
# The native export's "case Item Category"; the prepared copy holds it at column 16.
NATIVE_CATEGORY_COLUMN = 9


def expectations(rows: int) -> Expectations:
    cases = rows // EVENTS_PER_CASE
    case_ids = [cells(case * EVENTS_PER_CASE)[0] for case in range(cases)]
    witnesses = {0, cases // 2, cases - 1}
    evidence = {case_ids[case]: [cells(position) for position in range(case * EVENTS_PER_CASE, (case + 1) * EVENTS_PER_CASE)]
                for case in sorted(witnesses)}
    return Expectations(case_ids, rows, evidence)


def origins(rows: int) -> tuple[Origin, Origin]:
    native_dialect, native_mapping, native_policies = native_arguments()
    prepared_dialect, prepared_mapping, prepared_policies = arguments()
    return (Origin("native", native_source(rows), native_dialect, native_mapping, native_policies, {"delimiter": ",", "encoding": "windows-1252"}),
            Origin("prepared", source(rows), prepared_dialect, prepared_mapping, prepared_policies))


def traced_retained_per_record(rows: int) -> float:
    """tracemalloc's retained bytes per prepared record, measured in a fresh interpreter."""
    code = f"""
import gc, sys, tracemalloc
sys.path[:0] = {[str(ROOT / part) for part in ("apps/api/src", "packages/analytics/src", "packages/analytics/tests")]!r}
from bpic_shaped_literal import arguments, source
from wise_platform_analytics.preparation import prepare
raw = source({rows}); prepare(source(12), *arguments(), True); gc.collect()
tracemalloc.start(); before = tracemalloc.get_traced_memory()[0]
kept = prepare(raw, *arguments(), True); gc.collect()
print((tracemalloc.get_traced_memory()[0] - before) / {rows})
"""
    return float(subprocess.check_output([sys.executable, "-I", "-c", code], text=True).strip())


def machine() -> dict:
    described = {"platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(),
                 "cpu_count": os.cpu_count()}
    try:
        if sys.platform == "darwin":
            described["physical_memory_bytes"] = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True))
            described["cpu"] = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
        else:
            with open("/proc/meminfo") as meminfo:
                described["physical_memory_bytes"] = int(meminfo.readline().split()[1]) * 1024
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    return described


def by_stage(result: dict, key: str) -> dict[str, int]:
    values: dict[str, int] = {}
    for stage in result["stages"]:
        values[stage["stage"]] = max(values.get(stage["stage"], 0), stage[key])
    return values


def project(small: int, large: int, at_small: dict[str, int], at_large: dict[str, int], target: int) -> dict[str, dict]:
    """Fit each stage as intercept + slope × records and evaluate it at the target size."""
    projected = {}
    for name in at_large:
        if name not in at_small:
            continue
        slope = (at_large[name] - at_small[name]) / (large - small)
        intercept = at_small[name] - slope * small
        projected[name] = {"bytes_per_record": round(slope, 1), "intercept_bytes": round(intercept),
                           "projected_bytes": round(intercept + slope * target)}
    return projected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--rows", type=int, default=100_000, help="records per source at the larger size")
    parser.add_argument("--small-rows", type=int, help="records per source at the smaller size; half of --rows by default")
    parser.add_argument("--budget-gib", type=float, default=DEFAULT_BUDGET_GIB, help="declared peak service memory for the full journey")
    parser.add_argument("--target-records", type=int, default=FULL_RECORDS)
    parser.add_argument("--no-scoring", action="store_true", help="skip the separate Method scoring measurement")
    parser.add_argument("--folder", type=Path, help="where to keep workspaces and logs; a new temporary folder by default")
    parser.add_argument("--output", type=Path, help="profile path; capacity-profile.json in the folder by default")
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("this measurement reads the process table with ps and runs on POSIX systems only")
    large = args.rows - args.rows % EVENTS_PER_CASE
    small = (args.small_rows or large // 2)
    small -= small % EVENTS_PER_CASE
    if not 0 < small < large:
        parser.error("--small-rows must be positive and below --rows")
    folder = args.folder or Path(tempfile.mkdtemp(prefix="wise-capacity-"))
    folder.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    runs = {}
    for rows in (small, large):
        run_folder = folder / f"rows-{rows}"
        run_folder.mkdir()
        native, prepared = origins(rows)
        journey = Journey(run_folder, native, prepared, PREPARED_ROLES, MEASURE_ROLES, NATIVE_CATEGORY_COLUMN, expectations(rows),
                          score=not args.no_scoring)
        runs[rows] = journey.run()
        print(json.dumps({"rows": rows, "status": runs[rows]["status"], "peak_rss_bytes": runs[rows]["peak_rss_bytes"],
                          "reason": runs[rows].get("reason")}), flush=True)
    budget = round(args.budget_gib * GIB)
    profile: dict = {"workload": "BPIC19 descriptive journey, invented native22 and prepared29 sources", "machine": machine(),
                     "sizes": [small, large], "target_records_per_source": args.target_records, "budget_bytes": budget, "runs": runs,
                     "elapsed_seconds": round(time.monotonic() - started, 1)}
    if all(run["status"] == "passed" for run in runs.values()):
        peaks = project(small, large, by_stage(runs[small], "peak_rss_bytes"), by_stage(runs[large], "peak_rss_bytes"), args.target_records)
        retained = project(small, large, by_stage(runs[small], "retained_rss_bytes"), by_stage(runs[large], "retained_rss_bytes"), args.target_records)
        journey_peak = max((value["projected_bytes"] for name, value in peaks.items() if name != "method_scoring"), default=0)
        traced = traced_retained_per_record(large)
        prepared_growth = (by_stage(runs[large], "retained_rss_bytes")["prepared_population"]
                           - by_stage(runs[large], "retained_rss_bytes")["native_population"]) / large
        profile.update(projected_peak=peaks, projected_retained=retained, projected_journey_peak_bytes=journey_peak,
                       projected_scoring_peak_bytes=peaks.get("method_scoring", {}).get("projected_bytes"),
                       tracemalloc_retained_bytes_per_prepared_record=round(traced, 1),
                       service_rss_growth_bytes_per_prepared_record=round(prepared_growth, 1),
                       rss_per_traced_byte=round(prepared_growth / traced, 3) if traced else None,
                       assumptions=[
                           "Each stage's peak and retained service memory grow linearly in records per source between and beyond the two sizes.",
                           "Both sources have the target number of records, as the native and prepared BPIC19 sources do.",
                           "The invented sources have the full sources' repetition: about six events per case, repeated case attributes, small event vocabularies.",
                           "Peaks are sampled every 50 ms from the process table; a shorter spike can be missed.",
                           "Method scoring is projected separately and is not part of the journey peak.",
                       ])
        profile["status"] = "passed" if journey_peak <= budget else "over_budget"
    else:
        profile["status"] = "failed"
    output = args.output or folder / "capacity-profile.json"
    output.write_text(json.dumps(profile, indent=2) + "\n")
    summary = {key: profile.get(key) for key in ("status", "projected_journey_peak_bytes", "projected_scoring_peak_bytes", "budget_bytes")}
    print(json.dumps({**summary, "profile": str(output)}), flush=True)
    return 0 if profile["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
