"""Check a local year-first slash export (#52) on the owner's own computer; the receipt holds counts and digests only.

The owner names a local CSV of their own, for example a public helpdesk benchmark sample, and its three role columns
by header. The file is read through the product's own operations in a temporary workspace: the inspection's per-format
reads of the time column, a recorded-wall reading with the year-first format and the named cutoff, the population,
its paths and its variants; then, for comparison, the same reading with every time unreadable. Nothing of the file is
written into the receipt but its SHA-256 and counts: no path, header, value, identifier or activity.

    python tools/qualify_local_ymd_sample.py --source PATH --case "Case ID" --activity Activity \\
        --time "Complete Timestamp" --cutoff-local 2014-01-01T00:00:00 --output receipt.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src"), str(ROOT / "tools")]

from fastapi.testclient import TestClient  # noqa: E402

from qualify_full_sources import provenance  # noqa: E402
from wise_platform_api.app import create_app  # noqa: E402

FORMAT = "ymd_slash_second"


def envelope(kind: str, **fields) -> dict:
    return {"schema_version": 1, "message_type": kind, "request_id": f"{kind}-1", "query_revision": 1, **fields}


def policies(format_name: str, cutoff: str) -> dict:
    return {
        "time": {"id": "incident.time.wall_clock_as_recorded.v1",
                 "parameters": {"format": format_name, "timezone": "none_as_recorded", "snapshot_cutoff_local": cutoff}},
        "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {
            "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
            "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position",
            "unavailable_timestamp_case_sequence": "unevaluable"}},
        "rows": {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": {
            "missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
            "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}},
        "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1", "parameters": {"empty_activity_context": "missing", "literal_values": "preserve"}},
        "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1", "parameters": {"normalization": "trim_outer_whitespace_preserve_raw"}},
        "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {
            "missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
        "parent": {"id": "incident.parent.all_identified_cases.v1", "parameters": {"eligibility": "nonempty_normalized_case_identifier"}},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--case", required=True, help="header of the incident id column")
    parser.add_argument("--activity", required=True, help="header of the activity column")
    parser.add_argument("--time", required=True, help="header of the time column")
    parser.add_argument("--cutoff-local", required=True, help="when the export was taken, as recorded: YYYY-MM-DDTHH:MM:SS")
    parser.add_argument("--wrong-format", default="dmy_slash_second", help="a format that reads none of the times, for the comparison")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw = args.source.read_bytes()
    checks: list[dict] = []

    def check(name: str, passed: bool, detail=None) -> None:
        checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": detail})})

    receipt: dict = {"format": "wise.local_ymd_sample_receipt.v1", "provenance": provenance(), "source_sha256": hashlib.sha256(raw).hexdigest(),
                     "source_bytes": len(raw), "checks": checks}
    with tempfile.TemporaryDirectory(prefix="wise-local-ymd-") as folder, TestClient(create_app(static_dir=Path(folder) / "unbuilt")) as client:
        workspace = Path(folder) / "workspace"
        workspace.mkdir()
        wid = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]
        metadata = envelope("upload_source_metadata", workspace_id=wid, filename="local-sample.csv")
        source = client.put("/api/sources", params=metadata, content=raw, headers={"Content-Type": "application/octet-stream"}).json()["source"]
        inspected = client.post("/api/sources/inspect", json=envelope("inspect_csv_request", workspace_id=wid, source_id=source["source_id"], hints=None)).json()
        names = {column["name"].strip(): column["index"] for column in inspected["columns"]}
        mapping = {"case_column": names[args.case], "activity_column": names[args.activity], "timestamp_column": names[args.time],
                   "sequence_column": None, "context_columns": []}
        reads = {match["format"]: match["parsed_count"] for suggestion in inspected["role_suggestions"]
                 if suggestion["column_index"] == mapping["timestamp_column"] for match in suggestion["timestamp_matches"]}
        # The first candidate is the inspection's own reading of the file; it is taken as it is proposed.
        dialect = inspected["dialect_candidates"][0]
        receipt["inspection"] = {"records": inspected["record_count"], "reads_by_format": reads, "dialect": dialect}
        check("year_first_format_reads_the_most_values", reads.get(FORMAT, 0) > 0 and reads.get(FORMAT, 0) == max(reads.values()), reads)

        def reading(format_name: str) -> dict:
            request = envelope("confirm_mapping_request", workspace_id=wid, source_id=source["source_id"], dialect=dialect, mapping=mapping,
                               policies=policies(format_name, args.cutoff_local), accept_report_issues=True)
            prepared = client.post("/api/preparations", json=request).json()
            if prepared.get("state") != "ready":
                return {"state": prepared.get("state", prepared.get("code"))}
            population = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=wid,
                                     preparation_id=prepared["preparation"]["preparation_id"])).json()
            identity = population["identity"]
            graph = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=wid, identity=identity)).json()
            variants = client.post("/api/investigations/variants", json=envelope("variants_request", workspace_id=wid, identity=identity)).json()
            report = prepared["report"]
            return {"state": "ready", "records": report["raw_record_count"], "usable_times": report["usable_timestamp_record_count"],
                    "unusable_times": report["unavailable_timestamp_record_count"], "incidents": report["case_count"],
                    "incidents_in_known_order": report["sequence_evaluable_case_count"], "paths": len(graph["graph"]["edges"]),
                    "variants": variants["variants"]["variant_count"]}

        right, wrong = reading(FORMAT), reading(args.wrong_format)
        receipt.update(year_first=right, wrong_format={"format": args.wrong_format, **wrong})
        check("year_first_reading_is_ready", right.get("state") == "ready", right.get("state"))
        check("year_first_gives_known_orders_paths_and_variants", right.get("incidents_in_known_order", 0) > 0 and right.get("paths", 0) > 0
              and right.get("variants", 0) > 0, right)
        check("unreadable_times_give_no_known_order", wrong.get("state") == "ready" and wrong.get("usable_times") == 0
              and wrong.get("incidents_in_known_order") == 0, wrong)
        check("every_record_kept_either_way", right.get("records") == wrong.get("records") == inspected["record_count"], [right.get("records"), wrong.get("records")])
    receipt["status"] = "passed" if all(entry["passed"] for entry in checks) else "failed"
    text = json.dumps(receipt, indent=1)
    assert str(args.source) not in text and args.case not in text and args.activity not in text and args.time not in text, "the receipt must not hold a path or a header"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output)}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
