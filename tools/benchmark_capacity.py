"""Measure synthetic capacity through owned local CLI processes, never a user's workspace."""

import argparse
from contextlib import contextmanager
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from qualify_installed_bundle import b_policies, CONTEXT

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class Journey:
    def __init__(self, timeout):
        self.timeout = timeout
        self.timings = {}
        self.sequence = 0
        self.base = ""

    def measure(self, name, operation):
        before = time.perf_counter()
        result = operation()
        self.timings.setdefault(name, []).append(time.perf_counter() - before)
        return result

    def message(self, kind, **fields):
        self.sequence += 1
        return {
            "schema_version": 1,
            "message_type": kind,
            "request_id": f"capacity-{self.sequence}",
            "query_revision": self.sequence,
            **fields,
        }

    def ask(self, route, message, kind, raw=None):
        url = self.base + route
        if raw is not None:
            url += "?" + urllib.parse.urlencode(message)
        request = urllib.request.Request(
            url,
            data=(
                raw
                if raw is not None
                else json.dumps(message, allow_nan=False).encode()
            ),
            method="PUT" if raw is not None else "POST",
            headers={
                "Content-Type": (
                    "application/octet-stream"
                    if raw is not None
                    else "application/json"
                )
            },
        )
        try:
            with OPENER.open(request, timeout=self.timeout) as response:
                answer = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"{route}: HTTP {error.code}: {error.read().decode(errors='replace')}"
            ) from error
        require(answer.get("message_type") == kind, f"{route}: unexpected answer kind")
        for field in ("request_id", "query_revision", "workspace_id"):
            if field in message:
                require(
                    answer.get(field) == message[field], f"{route}: mismatched {field}"
                )
        return answer

    @contextmanager
    def host(self, work, workspace, name):
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        self.base = f"http://127.0.0.1:{port}"
        env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"PYTHONPATH", "PYTHONHOME"}
        }
        with (work / f"{name}.log").open("wb") as stream:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-I",
                    "-m",
                    "wise_platform_api",
                    "--port",
                    str(port),
                    "--workspace",
                    str(workspace),
                ],
                cwd=work,
                env=env,
                stdout=stream,
                stderr=subprocess.STDOUT,
            )
            try:
                self.measure(name, lambda: self.wait_ready(process))
                yield
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)

    def wait_ready(self, process):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            require(process.poll() is None, "Owned CLI exited before becoming ready")
            try:
                with OPENER.open(
                    self.base + "/api/health", timeout=min(1, self.timeout)
                ) as response:
                    require(json.load(response)["status"] == "ok", "Unhealthy CLI")
                    require(
                        process.poll() is None,
                        "Readiness did not belong to the owned CLI",
                    )
                    return
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                time.sleep(0.05)
        raise RuntimeError("Owned CLI startup timed out")


def synthetic_csv(cases, records):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(["case", "activity", "at", "sequence", "Desk"])
    for case in range(cases):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=case % 28)
        for record in range(records):
            activity = (
                "Opened"
                if record == 0
                else "Resolved" if record == records - 1 else "Work"
            )
            stamp = (start + timedelta(hours=record)).isoformat().replace("+00:00", "Z")
            writer.writerow(
                [
                    f"C{case:06d}",
                    activity,
                    stamp,
                    record,
                    "East" if case % 2 == 0 else "West",
                ]
            )
    return stream.getvalue().encode("utf-8")


def file_hashes(folder):
    return {
        path.relative_to(folder)
        .as_posix(): hashlib.sha256(path.read_bytes())
        .hexdigest()
        for path in folder.rglob("*")
        if path.is_file()
    }


def run(args):
    from wise_platform_api import __version__
    from wise_platform_api.method import METHOD_ARTIFACT
    from wise_platform_analytics import IMPLEMENTATION_VERSION

    raw = synthetic_csv(args.cases, args.records_per_case)
    journey = Journey(args.timeout)
    with tempfile.TemporaryDirectory(prefix="wise-capacity-") as temporary:
        work = Path(temporary)
        workspace, backup, restored = (
            work / name for name in ("workspace", "backup", "restored")
        )
        with journey.host(work, workspace, "startup"):
            opened = journey.ask(
                "/api/workspaces/open-default",
                journey.message("open_default_workspace_request"),
                "workspace_answer",
            )
            workspace_id = opened["workspace_id"]

            def message(kind, **fields):
                return journey.message(kind, workspace_id=workspace_id, **fields)

            def ask(measurement, route, kind, answer_kind, **fields):
                return journey.measure(
                    measurement,
                    lambda: journey.ask(route, message(kind, **fields), answer_kind),
                )

            uploaded = journey.measure(
                "upload",
                lambda: journey.ask(
                    "/api/sources",
                    message(
                        "upload_source_metadata", filename="synthetic-capacity.csv"
                    ),
                    "source_answer",
                    raw,
                ),
            )
            source_id = uploaded["source"]["source_id"]
            require(
                source_id == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest(),
                "Source bytes changed",
            )
            ask(
                "inspect",
                "/api/sources/inspect",
                "inspect_csv_request",
                "csv_inspection_answer",
                source_id=source_id,
                hints={"encoding": "utf-8", "delimiter": ","},
            )
            cutoff = (
                (
                    datetime(2026, 2, 1, tzinfo=timezone.utc)
                    + timedelta(hours=args.records_per_case)
                )
                .isoformat()
                .replace("+00:00", "Z")
            )
            prepared = ask(
                "prepare",
                "/api/preparations",
                "confirm_mapping_request",
                "interpretation_answer",
                source_id=source_id,
                dialect={
                    "encoding": "utf-8",
                    "delimiter": ",",
                    "quotechar": '"',
                    "header": "first_record",
                },
                mapping={
                    "case_column": 0,
                    "activity_column": 1,
                    "timestamp_column": 2,
                    "sequence_column": 3,
                    "context_columns": [4],
                },
                policies=b_policies(cutoff),
                accept_report_issues=True,
            )
            require(prepared["state"] == "ready", "Synthetic preparation is not ready")
            population = ask(
                "open_population",
                "/api/investigations/open-population",
                "open_population_request",
                "imported_population_answer",
                preparation_id=prepared["preparation"]["preparation_id"],
            )
            identity = population["identity"]
            parent_ids = [f"C{case:06d}" for case in range(args.cases)]
            require(
                population["population"]["case_ids"] == parent_ids,
                "Wrong parent membership",
            )
            require(
                population["population"]["case_count"] == args.cases,
                "Wrong parent support",
            )
            require(
                population["population"]["record_count"]
                == args.cases * args.records_per_case,
                "Incomplete parent histories",
            )
            predicates = [
                {
                    "kind": "opening_attribute_equals",
                    "column_index": 4,
                    "value": "East",
                    "negate": False,
                    "anchor_policy": CONTEXT,
                }
            ]
            expected_ids = [f"C{case:06d}" for case in range(0, args.cases, 2)]
            for _ in range(args.repeats):
                selected = ask(
                    "select",
                    "/api/investigations/select-cases",
                    "select_cases_request",
                    "selection_answer",
                    identity=identity,
                    parent_case_ids=None,
                    predicates=predicates,
                )
                require(
                    selected["kept"]["case_ids"] == expected_ids,
                    "Wrong selected membership",
                )
                require(
                    selected["kept"]["record_count"]
                    == len(expected_ids) * args.records_per_case,
                    "Selection trimmed histories",
                )
                chosen = selected["identity"]
                graph = ask(
                    "graph",
                    "/api/investigations/process-graph",
                    "process_graph_request",
                    "process_graph_answer",
                    identity=chosen,
                )
                require(
                    graph["graph"]["meta"]["selected_case_ids"] == expected_ids,
                    "Graph population mismatch",
                )
                for name, offset in (("case_list_first", 0), ("case_list_next", 1)):
                    listed = ask(
                        name,
                        "/api/investigations/case-list",
                        "case_list_request",
                        "case_list_answer",
                        identity=chosen,
                        query={
                            "search_text": None,
                            "sort": {
                                "field": "observed_span_hours",
                                "direction": "descending",
                            },
                            "offset": offset,
                            "limit": 1,
                        },
                    )
                    require(
                        [row["case_id"] for row in listed["rows"]]
                        == expected_ids[offset : offset + 1],
                        "List page mismatch",
                    )
                groups = ask(
                    "rule_groups",
                    "/api/investigations/rule-groups",
                    "rule_groups_request",
                    "rule_groups_answer",
                    identity=chosen,
                    query={
                        "rule": {"kind": "activity_presence", "activity": "Opened"},
                        "distribution_edges_hours": [0, 1, 24, 168],
                        "offset": 0,
                        "limit": 50,
                    },
                )
                require(
                    groups["population_coverage"]["total"]["case_count"]
                    == len(expected_ids),
                    "Group support mismatch",
                )
                require(
                    groups["group_count"] == len(groups["groups"]) == 2
                    and groups["next_offset"] is None,
                    "Presence catalogue is incomplete",
                )
                group_summary = []
                ordered_groups = sorted(
                    groups["groups"], key=lambda group: group["key"]["present"]
                )
                for group, present in zip(ordered_groups, (False, True)):
                    require(
                        group["key"]
                        == {
                            "kind": "activity_presence",
                            "activity": "Opened",
                            "present": present,
                        },
                        "Wrong presence rule outcome",
                    )
                    cases = group["population"]["cases"]
                    members = expected_ids if present else []
                    require(
                        cases
                        == {
                            "case_ids": members,
                            "case_count": len(members),
                            "record_count": len(members) * args.records_per_case,
                            "omitted_activity_record_count": 0,
                        },
                        "Presence group membership or histories changed",
                    )
                    group_summary.append(
                        {
                            "present": group["key"]["present"],
                            "case_count": cases["case_count"],
                            "record_count": cases["record_count"],
                        }
                    )
                comparison = ask(
                    "compare",
                    "/api/investigations/compare-groups",
                    "compare_groups_request",
                    "group_comparison_answer",
                    identity=identity,
                    parent_case_ids=None,
                    context_column_index=4,
                    context_policy=CONTEXT,
                    definition={
                        "mode": "selection_partition",
                        "target_name": "East",
                        "reference_name": "Not East",
                        "predicates": predicates,
                        "target_side": "kept",
                    },
                )
                require(
                    comparison["target"]["included"]["case_ids"] == expected_ids,
                    "Comparison population mismatch",
                )
                require(
                    comparison["reference"]["included"]["case_ids"]
                    == [f"C{case:06d}" for case in range(1, args.cases, 2)],
                    "Comparison reference mismatch",
                )
            definition = {
                "kind": "resolution_first_after.v1",
                "name": "Synthetic capacity target",
                "definition_revision": 1,
                "review_state": "reviewed",
                "role": "negotiable_target",
                "scope": {"kind": "all_cases"},
                "provenance": {
                    "kind": "locally_entered",
                    "owner_label": "Capacity benchmark",
                    "source_label": "Invented data",
                    "rationale": "Not a business expectation.",
                },
                "endpoints": {
                    "activation_activity": "Opened",
                    "response_activity": "Resolved",
                    "activation": "first",
                    "response": "first_after",
                    "response_time_comparison": "at_or_after",
                },
                "clock_kind": "utc_instant",
                "target": 4,
                "width": 2,
                "unit": "hours",
                "missing_activation": "skip",
                "missing_response": "skip",
                "calibration": "fixed_threshold",
            }
            scoring = {
                "base_identity": identity,
                "named_population": {"name": "Synthetic parent", "identity": identity},
            }
            validation = ask(
                "validate",
                "/api/expectations/validate",
                "validate_expectation_request",
                "expectation_validation_answer",
                **scoring,
                definition=definition,
            )
            require(
                validation["state"] == "ready", "Synthetic expectation is not ready"
            )
            run = ask(
                "score",
                "/api/expectations/score",
                "score_expectation_request",
                "score_run_answer",
                **scoring,
                definition_version_id=validation["definition_version"][
                    "definition_version_id"
                ],
            )["run"]
            require(
                [case["case_id"] for case in run["cases"]] == parent_ids,
                "Score run population mismatch",
            )
            # Whole hourly intervals: <=4h -> 0, 5h -> 0.5, >=6h -> 1
            # for the explicitly authored 4h target and 2h width above.
            expected_value = (
                0
                if args.records_per_case <= 5
                else 0.5 if args.records_per_case == 6 else 1
            )
            for case in run["cases"]:
                require(
                    case["in_scope"] is True
                    and case["reason"] == "evaluated"
                    and case["value"] == expected_value
                    and case["measurement"]
                    == {
                        "status": "observed",
                        "value": args.records_per_case - 1,
                        "unit": "hours",
                        "activation_known": True,
                        "response_known": True,
                        "censor_age": None,
                    },
                    "Unexpected synthetic elapsed hours, applicability or Method value",
                )
            score_summary = {
                "case_count": len(run["cases"]),
                "measurement_hours": run["cases"][0]["measurement"]["value"],
                "method_value": run["cases"][0]["value"],
            }
            run_id = run["identity"]["run_id"]
            for _ in range(args.repeats):
                read = ask(
                    "read_run",
                    "/api/expectations/read-run",
                    "read_score_run_request",
                    "score_run_answer",
                    run_id=run_id,
                )
                require(read["run"] == run, "Stored run changed")
            saved = ask(
                "save",
                "/api/investigations/save",
                "save_investigation_request",
                "save_investigation_answer",
                investigation_id=None,
                expected_revision_id=None,
                name="Synthetic capacity question",
                base_identity=identity,
                selection_identity=chosen,
                selection_recipe={
                    "parent_case_ids": population["population"]["case_ids"],
                    "predicates": predicates,
                },
                context_policy=CONTEXT,
                comparison=None,
                notes="Synthetic benchmark only",
                bookmarks=[],
                score_run_ref={
                    "score_run_id": run_id,
                    "scored_population_id": identity["population_id"],
                    "calibration_id": run["identity"]["calibration_id"],
                },
            )["revision"]
            evidence_request = {"identity": chosen, "case_id": expected_ids[0]}
            trace = journey.ask(
                "/api/investigations/case-evidence",
                message("imported_case_evidence_request", **evidence_request),
                "imported_case_evidence_answer",
            )
            require(
                len(trace["records"]) == args.records_per_case,
                "Evidence trimmed histories",
            )
        # No writer is alive while either copy is made. The original stays untouched.
        before = file_hashes(workspace)
        workspace_bytes = sum(
            path.stat().st_size for path in workspace.rglob("*") if path.is_file()
        )
        journey.measure("backup_copy", lambda: shutil.copytree(workspace, backup))
        journey.measure("restore_copy", lambda: shutil.copytree(backup, restored))
        require(
            file_hashes(backup) == file_hashes(restored) == before,
            "Backup/restore bytes changed",
        )
        with journey.host(work, restored, "restart"):
            reopened_workspace = journey.ask(
                "/api/workspaces/open-default",
                journey.message("open_default_workspace_request"),
                "workspace_answer",
            )
            require(
                reopened_workspace["workspace_id"] == workspace_id,
                "Restored workspace identity changed",
            )
            reopened = ask(
                "reopen",
                "/api/investigations/reopen",
                "reopen_investigation_request",
                "reopen_investigation_answer",
                saved_revision_id=saved["saved_revision_id"],
            )
            require(reopened["revision"] == saved, "Restored revision changed")
            require(
                reopened["restored_selection"]["identity"] == chosen,
                "Restored selection identity changed",
            )
            require(
                reopened["restored_selection"]["kept"] == selected["kept"],
                "Restored selection changed",
            )
            after_trace = ask(
                "evidence",
                "/api/investigations/case-evidence",
                "imported_case_evidence_request",
                "imported_case_evidence_answer",
                **evidence_request,
            )
            require(
                after_trace["records"] == trace["records"]
                and after_trace["incident_time"] == trace["incident_time"],
                "Restored evidence changed",
            )
            after_run = journey.ask(
                "/api/expectations/read-run",
                message("read_score_run_request", run_id=run_id),
                "score_run_answer",
            )
            require(after_run["run"] == run, "Restored score run changed")
        require(
            file_hashes(workspace) == before, "Restore modified the original workspace"
        )
    peak_rss = None
    memory_note = "Unavailable on this platform; measure host RSS separately."
    if sys.platform != "win32":
        import resource

        peak_rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        peak_rss *= 1 if sys.platform == "darwin" else 1024
        memory_note = "OS child-process high-water RSS across both owned hosts, not per-operation allocation."
    return {
        "schema_version": 1,
        "qualification": "synthetic_measurement_not_supported_capacity",
        "measured_utc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "python": platform.python_version(),
            "os": platform.platform(),
            "machine": platform.machine(),
            "logical_cpu_count": os.cpu_count(),
            "application_version": __version__,
            "analytics_version": IMPLEMENTATION_VERSION,
            "method_artifact": METHOD_ARTIFACT,
        },
        "dataset": {
            "case_count": args.cases,
            "record_count": args.cases * args.records_per_case,
            "records_per_case": args.records_per_case,
            "byte_count": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "shape": "UTC hourly records; Opened, repeated Work, Resolved; alternating opening Desk; 28 start days",
        },
        "repeats": args.repeats,
        "request_timeout_seconds": args.timeout,
        "timings": {
            name: {
                "seconds": values,
                "median_seconds": statistics.median(values),
                "max_seconds": max(values),
            }
            for name, values in journey.timings.items()
        },
        "host_memory": {
            "scope": "owned_cli_processes_high_water",
            "peak_rss_bytes": peak_rss,
            "note": memory_note,
        },
        "workspace_bytes": workspace_bytes,
        "verified_semantics": {
            "activity_presence": group_summary,
            "scoring": score_summary,
        },
        "checks": {
            "parent_case_count": args.cases,
            "kept_case_ids": expected_ids,
            "kept_record_count": len(expected_ids) * args.records_per_case,
            "restored_selection_matches": True,
            "restored_evidence_matches": True,
            "restored_score_run_matches": True,
            "backup_files_match": True,
            "owned_hosts_stopped": True,
        },
        "limits": [
            "No browser rendering, Windows installer, or human usability qualification.",
            "One simple synthetic shape; not a supported capacity tier or a production-data benchmark.",
            "Repeated queries include the first call, reuse preparations and OS caches, and still include source integrity checks.",
            "Score timing is one fresh run; read_run times stored-run retrieval, not rescoring.",
            "Receipt is written only after all checks pass; errors and timeouts fail the command.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=int, default=1000)
    parser.add_argument("--records-per-case", type=int, default=10)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Per-request and startup timeout in seconds",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="New JSON receipt in an existing external folder",
    )
    args = parser.parse_args()
    if (
        args.cases < 2
        or not 2 <= args.records_per_case <= 10000
        or args.repeats < 1
        or args.timeout < 1
    ):
        parser.error(
            "Use at least two cases, two to 10000 records per case, and positive repeats and timeout."
        )
    from wise_platform_api.workspace import program_folders

    output = args.output.absolute()
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        parser.error("Output must be a new file in an existing folder.")
    resolved = output.resolve()
    if any(resolved.is_relative_to(folder) for folder in program_folders()):
        parser.error(
            "Keep benchmark receipts outside program files and the source checkout."
        )
    try:
        receipt = run(args)
        with output.open("x", encoding="utf-8") as stream:
            json.dump(receipt, stream, indent=2, allow_nan=False)
            stream.write("\n")
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Capacity measurement failed; no successful receipt: {error}\n")
    print(f"Synthetic measurement completed: {output}")


if __name__ == "__main__":
    main()
