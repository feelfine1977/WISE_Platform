"""Qualify a reviewed local preparation catalogue (#99) through the product, and write one receipt and a local report.

    python tools/qualify_preparation_catalogue.py --catalogue CATALOGUE.json --collection FOLDER --views VIEWS_FOLDER \\
        --output receipt.json [--node NODE --playwright PLAYWRIGHT_INDEX_MJS --chrome CHROME]

The catalogue (tools/preparation-catalogue.schema.json) is checked against the collection folder: every file and
archive member has one record and every record a file, identical bytes are declared copies, supplied subsets hold only
their original's records, and only event logs become views. Each view is written into VIEWS_FOLDER as the CSV the
import accepts, with its side files, a pilot of complete incidents and a readable report (catalogue-report.md). Then,
each through the service as its own process:

- workloads: every whole view is stored, inspected, prepared and opened, then mapped and its variants listed, in a
  fresh workspace and process, measured (records, incidents, columns, versions, and the elapsed time and peak memory
  of the process tree for the import and for the investigation) apart from the pilots; its preparation report is
  compared with an independent reading of the same bytes, fault by fault. No capacity tier is claimed from these;
- pilots: every pilot is stored, inspected, prepared and opened, and its map, variants and every incident's complete
  evidence are compared with the independent reading, raw cell by raw cell, record by record, in order;
- reopening: after a real restart of the process, every pilot preparation reopens with the same identities, map,
  variants and evidence;
- screens, when the browser is named: the built screens open each pilot reading and a complete history before and
  after the restart. Without the browser, the receipt says the screens were not checked and calls nothing qualified
  for them.

The receipt holds digests, counts, timings and checks by the views' places in the catalogue: no path, file or
column name, identifier or value. The report and the views stay in VIEWS_FOLDER on this computer.
"""

from __future__ import annotations

import argparse
from importlib.metadata import PackageNotFoundError, version as installed
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools"), str(ROOT / "apps/api/src"), str(ROOT / "packages/analytics/src")]

from capacity_journey import MemorySampler, Service  # noqa: E402
import preparation_catalogue as catalogue_  # noqa: E402
from qualify_full_sources import build_is_current, keep_awake, provenance  # noqa: E402

RECEIPT_FORMAT = "wise.preparation_catalogue_receipt.v1"


def envelope(kind: str, **fields) -> dict:
    return {"schema_version": 1, "message_type": kind, "request_id": f"{kind}-1", "query_revision": 1, **fields}


def versions() -> dict:
    from wise_platform_analytics import IMPLEMENTATION_VERSION
    from wise_platform_api import __version__ as api
    def package(name: str) -> str | None:
        try:
            return installed(name)
        except PackageNotFoundError:
            return None
    return {"python": platform.python_version(), "api": api, "analytics": IMPLEMENTATION_VERSION, "fastapi": package("fastapi"),
            "uvicorn": package("uvicorn"), "wise_pm": package("wise-pm")}


def numbers(value):
    """Only the counts of a structure: its strings, which may name the analyst's columns or objects, are left out."""
    if isinstance(value, dict):
        kept = {key: numbers(item) for key, item in value.items()}
        return {key: item for key, item in kept.items() if item is not None and item != {} and item != []}
    if isinstance(value, list):
        return [item for item in (numbers(item) for item in value) if item is not None]
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


class Run:
    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.checks: list[dict] = []

    def check(self, name: str, passed: bool, detail=None) -> bool:
        self.checks.append({"check": name, "passed": bool(passed), **({} if passed else {"detail": numbers(detail) if not isinstance(detail, (int, float)) else detail})})
        return bool(passed)

    def service(self, workspace: Path, name: str) -> Service:
        service = Service(workspace, self.folder / f"{name}.log")
        service.start()
        return service


def open_workspace(client, workspace: Path) -> str:
    return client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).json()["workspace_id"]


def store(client, wid: str, content: bytes, filename: str) -> dict:
    metadata = envelope("upload_source_metadata", workspace_id=wid, filename=filename)
    return client.put("/api/sources", params=metadata, content=content, headers={"Content-Type": "application/octet-stream"}).json()


def prepare(client, wid: str, source_id: str, view: dict, header: list[str]) -> dict:
    return client.post("/api/preparations", json=envelope(
        "confirm_mapping_request", workspace_id=wid, source_id=source_id, dialect=view["dialect"],
        mapping=catalogue_.mapping(view, header), policies=catalogue_.policies(view), accept_report_issues=True)).json()


def inspect(client, wid: str, source_id: str, view: dict) -> dict:
    hints = {"encoding": view["dialect"]["encoding"], "delimiter": view["dialect"]["delimiter"]}
    return client.post("/api/sources/inspect", json=envelope("inspect_csv_request", workspace_id=wid, source_id=source_id, hints=hints)).json()


def report_matches(report: dict, reading: catalogue_.Reading) -> dict:
    """The preparation's own counts of every fault, beside the independent reading's."""
    usable = [record.time for records in reading.cases.values() for record in records if record.time is not None]
    written = lambda moment: None if moment is None else (moment.isoformat().replace("+00:00", "Z") if moment.tzinfo else moment.isoformat())
    pairs = {
        "records": (report.get("raw_record_count"), reading.records - reading.blank),
        "blank_records": (report.get("blank_record_count", 0), reading.blank),
        "ragged_records": (report.get("ragged_record_count", 0), len(reading.ragged)),
        "records_without_incident": (report.get("unassigned_record_count"), len(reading.missing_case) + len(reading.ragged)),
        "excluded_positions": ([item["source_position"] for item in report.get("excluded_source_records", [])], sorted(reading.missing_case + reading.ragged)),
        "incidents": (report.get("case_count"), len(reading.cases)),
        "records_without_activity": (report.get("omitted_activity_record_count"), reading.missing_activity),
        "records_with_unavailable_time": (report.get("unavailable_timestamp_record_count"), reading.unread_times),
        "repeated_observations": (report.get("duplicate_candidate_record_count"), reading.duplicates),
        "tied_time_groups": (report.get("tied_timestamp_groups"), reading.tie_groups),
        "tied_time_records": (report.get("tied_timestamp_record_count"), reading.tied_records),
        "incidents_in_known_order": (report.get("sequence_evaluable_case_count"), sum(reading.evaluable(case) for case in reading.cases)),
        "first_usable_time": (report.get("first_usable_utc_instant") or report.get("first_usable_local_timestamp"), written(min(usable, default=None))),
        "last_usable_time": (report.get("last_usable_utc_instant") or report.get("last_usable_local_timestamp"), written(max(usable, default=None))),
    }
    return {name: {"product": product, "independent": independent, "same": product == independent} for name, (product, independent) in pairs.items()}


def workload(run: Run, ordinal: int, view: dict, content: bytes, reading: catalogue_.Reading) -> dict:
    """The whole view through a fresh process and workspace, measured; its faults compared with the independent reading."""
    workspace = run.folder / f"workload-{ordinal}"
    workspace.mkdir()
    service = run.service(workspace, f"workload-{ordinal}")
    sampler = MemorySampler(service.process.pid)
    sampler.start()
    try:
        client = service.client
        wid = open_workspace(client, workspace)
        started = time.monotonic()
        stored = store(client, wid, content, f"view-{ordinal}.csv")["source"]
        inspected = inspect(client, wid, stored["source_id"], view)
        prepared = prepare(client, wid, stored["source_id"], view, reading.header)
        ready = prepared.get("state") == "ready"
        opened = client.post("/api/investigations/open-population", json=envelope(
            "open_population_request", workspace_id=wid, preparation_id=prepared["preparation"]["preparation_id"])).json() if ready else {}
        elapsed = time.monotonic() - started
        peak_import, _ = sampler.settled(0.2)
        sampler.mark()
        started = time.monotonic()
        investigated = {}
        if ready:
            identity = opened["identity"]
            investigated["graph"] = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=wid, identity=identity)).json()
            investigated["variants"] = client.post("/api/investigations/variants", json=envelope("variants_request", workspace_id=wid, identity=identity)).json()
        investigation = time.monotonic() - started
        peak_investigation, _ = sampler.settled(0.2)
    finally:
        sampler.stop()
        exit_ = service.stop()
    name = f"view {ordinal}"
    run.check(f"{name}: the whole view is prepared", ready, {"state": 0 if ready else 1})
    matches = report_matches(prepared.get("report", {}), reading) if ready else {}
    run.check(f"{name}: every fault the preparation counts matches the independent reading", ready and all(entry["same"] for entry in matches.values()),
              {key: [value["product"], value["independent"]] for key, value in matches.items() if not value["same"] and not isinstance(value["product"], str)})
    run.check(f"{name}: the whole population is every identified incident", opened.get("population", {}).get("case_count") == len(reading.cases)
              and opened.get("population", {}).get("record_count") == sum(len(records) for records in reading.cases.values()), None)
    run.check(f"{name}: the inspection reads the declared columns", len(inspected.get("columns", [])) == len(reading.header), None)
    variants = investigated.get("variants", {}).get("variants", {})
    run.check(f"{name}: the whole population's variants are the independent reading's", {tuple(item["activities"]): len(item["case_ids"]) for item in variants.get("variants", [])}
              == {activities: len(members) for activities, members in reading.variants().items()}, None)
    return {"records": reading.records - reading.blank, "incidents": len(reading.cases), "columns": len(reading.header), "bytes": len(content),
            "import": {"operations": "store, inspect, prepare, open the population", "elapsed_seconds": round(elapsed, 3), "peak_resident_bytes": peak_import},
            "investigation": {"operations": "map and variants of the whole population", "elapsed_seconds": round(investigation, 3), "peak_resident_bytes": peak_investigation},
            "service_stopped": exit_.get("port_closed"),
            "reconciliation": {key: value["product"] for key, value in matches.items() if isinstance(value["product"], int)}}


def answers(client, wid: str, preparation_id: str, cases: list[str]) -> dict:
    population = client.post("/api/investigations/open-population", json=envelope(
        "open_population_request", workspace_id=wid, preparation_id=preparation_id)).json()
    identity = population["identity"]
    graph = client.post("/api/investigations/process-graph", json=envelope("process_graph_request", workspace_id=wid, identity=identity)).json()
    variants = client.post("/api/investigations/variants", json=envelope("variants_request", workspace_id=wid, identity=identity)).json()
    evidence = {case: client.post("/api/investigations/case-evidence", json=envelope(
        "imported_case_evidence_request", workspace_id=wid, identity=identity, case_id=case)).json() for case in cases}
    def plain(answer: dict) -> dict:
        return {key: value for key, value in answer.items() if key not in {"request_id", "query_revision"}}
    return {"population": plain(population), "graph": plain(graph), "variants": plain(variants), "evidence": {case: plain(item) for case, item in evidence.items()}}


def compare_pilot(run: Run, ordinal: int, got: dict, reading: catalogue_.Reading, cases: list[str]) -> None:
    name = f"view {ordinal} pilot"
    population = got["population"]["population"]
    run.check(f"{name}: the population is the pilot's incidents and records", population["case_ids"] == sorted(cases)
              and population["record_count"] == sum(len(reading.cases[case]) for case in cases), None)
    activity = reading.columns["activity"]
    wrong = 0
    for case in cases:
        answer = got["evidence"][case]
        expected = reading.ordered(case)
        records = answer.get("records", [])
        same = ([record["source_position"] for record in records] == [record.position for record in expected]
                and [record["original_cells"] for record in records] == [record.cells for record in expected]
                and [record["timestamp_status"] == "usable" for record in records] == [record.time is not None for record in expected]
                and [record["activity"] for record in records] == [record.cells[activity] or None for record in expected]
                and answer.get("sequence_evaluable") == reading.evaluable(case))
        wrong += not same
    run.check(f"{name}: every incident's complete evidence has every raw cell, record and place of the independent reading", wrong == 0, {"incidents_differing": wrong})
    expected_variants = {activities: sorted(members) for activities, members in reading.variants().items()}
    shown = {tuple(item["activities"]): sorted(item["case_ids"]) for item in got["variants"]["variants"]["variants"]}
    run.check(f"{name}: the variants are the independent reading's sequences and incidents", shown == expected_variants,
              {"shown": len(shown), "expected": len(expected_variants)})
    edges = {(edge["payload"]["source_activity"], edge["payload"]["target_activity"]): {"count": edge["metrics"]["count"], "cases": sorted(edge["payload"]["case_ids"])}
             for edge in got["graph"]["graph"]["edges"] if edge.get("kind") == "follows"}
    expected_edges = {pair: {"count": entry["count"], "cases": sorted(entry["cases"])} for pair, entry in reading.follows().items()}
    run.check(f"{name}: the map's paths are the independent reading's directly-follows pairs", edges == expected_edges,
              {"shown": len(edges), "expected": len(expected_edges)})


def browse(run: Run, args, port: int, phase: str, pilots: list[dict]) -> dict:
    config = run.folder / f"browser-{phase}.json"
    output = run.folder / f"browser-{phase}-out.json"
    config.write_text(json.dumps({"pilots": pilots}))
    with (run.folder / f"browser-{phase}.log").open("wb") as log:
        code = subprocess.call([args.node, str(ROOT / "tools/qualify_preparation_catalogue.mjs"), f"http://127.0.0.1:{port}", str(output),
                                args.playwright, args.chrome, str(config)], stdout=log, stderr=subprocess.STDOUT, timeout=900)
    run.check(f"screens ({phase}): every pilot reading and a complete history open in the built browser", code == 0,
              {"exit": code})
    return {"exit": code, **(json.loads(output.read_text()) if code == 0 else {})}


def write_report(path: Path, catalogue: dict, found, views: list[dict], overlaps: dict, problems: list[str]) -> None:
    """The readable account of the collection, for the analyst's own folder: names and all."""
    lines = [f"# {catalogue['title']}", "", "Written by tools/qualify_preparation_catalogue.py. The originals stay authoritative; every view is a declared reading of them.", ""]
    if problems:
        lines += ["## Refused", "", *[f"- {problem}" for problem in problems], ""]
    if found is not None:
        lines += ["## Sources", "", "| Id | Kind | Role | Alias | SHA-256 | Bytes |", "| --- | --- | --- | --- | --- | --- |"]
        for item in found.items.values():
            alias = {"original": "original", "byte_identical_copy": "byte-identical copy of", "subset_of": "supplied subset of",
                     "derived_from": "derived from"}[item.alias["classification"]] + (f" {item.alias['of']}" if "of" in item.alias else "")
            lines.append(f"| {item.id}{' (in ' + item.archive + ')' if item.archive else ''} | {item.kind} | {item.role} | {alias} | `{item.sha256[:16]}…` | {item.bytes} |")
        lines += ["", "Only event logs are read as views. Static master data joins a view only as a dated snapshot; earlier scores, caches and old workspaces are recorded and never read as event logs.", ""]
        for source in catalogue["sources"]:
            for entry in [source, *source.get("members", [])]:
                provenance_ = entry.get("provenance") or source["provenance"]
                lines.append(f"- **{entry['id']}**{'' if entry is source else ' (as recorded for its archive)'}: {provenance_['origin']}; licence: {provenance_['licence']}; obtained {provenance_['obtained']}."
                             + (f" Snapshot as of {entry['snapshot']['as_of']}: {entry['snapshot']['meaning']}." if "snapshot" in entry else "")
                             + (f" Selection: {entry['alias']['selection']}." if "selection" in entry["alias"] else ""))
        lines.append("")
    for view, result in zip(catalogue["views"], views):
        lines += [f"## View {view['id']}", "", f"- Case grain: {view['case_grain']}", f"- Source: {view['source']}, read by {view['conversion']['kind']}"
                  + (f" ({view['conversion']['object_type']})" if "object_type" in view["conversion"] else ""),
                  f"- Columns: incident {view['mapping']['case']}, activity {view['mapping']['activity']}, time {view['mapping']['time']}"
                  + (f", sequence {view['mapping']['sequence']}" if view["mapping"]["sequence"] else ""),
                  "- Context: " + (", ".join(f"{column} ({origin.replace('_', ' ')})" for column, origin in view["context_origin"].items()) or "none"),
                  f"- Time: {view['time']['format']}, {view['time']['clock'].replace('_', ' ')}, snapshot cutoff {view['time']['snapshot_cutoff']}",
                  f"- Lifecycle: {view['lifecycle']['reading'].replace('_', ' ')}; source order: {view['source_order'].replace('_', ' ')}",
                  f"- Proposed observation horizon: {view['observation_horizon']['start']} to {view['observation_horizon']['end']} ({view['observation_horizon']['basis']})",
                  "- Shares records with: " + (", ".join(overlaps[view["id"]]) or "no other view") + ". Overlapping views are never added up as one population.", ""]
        if result:
            lines += ["```json", json.dumps({"conversion": result["conversion"], "independent_reading": result["reading"], "pilot": result.get("pilot"),
                                             "workload": result.get("workload")}, indent=1, ensure_ascii=False), "```", ""]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--catalogue", type=Path, required=True)
    parser.add_argument("--collection", type=Path, required=True)
    parser.add_argument("--views", type=Path, required=True, help="a local folder for the views, the pilots and the report")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--node")
    parser.add_argument("--playwright")
    parser.add_argument("--chrome")
    args = parser.parse_args()
    browser = bool(args.node and args.playwright and args.chrome)
    if browser and not build_is_current():
        print(json.dumps({"status": "refused", "reason": "the browser build is older than the web sources; run npm run build"}))
        return 1
    keep_awake()
    folder = Path(tempfile.mkdtemp(prefix="wise-catalogue-")).resolve()
    run = Run(folder)
    raw_catalogue = args.catalogue.read_bytes()
    receipt: dict = {"format": RECEIPT_FORMAT, "provenance": provenance(), "versions": versions(),
                     "catalogue_sha256": catalogue_.sha256(raw_catalogue), "checks": run.checks}
    args.views.mkdir(parents=True, exist_ok=True)
    catalogue, found, problems = None, None, []
    try:
        catalogue = json.loads(raw_catalogue)
        catalogue_.check_declaration(catalogue)
        found = catalogue_.inventory(catalogue, args.collection.resolve())
    except catalogue_.Refused as refused:
        problems = refused.problems
    run.check("the catalogue is valid and records every file and archive member of the collection", not problems, {"problems": len(problems)})
    results: list[dict] = []
    if not problems:
        roles: dict = {}
        for item in found.items.values():
            roles[item.role] = roles.get(item.role, 0) + 1
        aliases: dict = {}
        for item in found.items.values():
            aliases[item.alias["classification"]] = aliases.get(item.alias["classification"], 0) + 1
        receipt["collection"] = {"records": len(found.items), "archive_members": sum(1 for item in found.items.values() if item.archive),
                                 "folders": sum(1 for item in found.items.values() if item.kind == "directory"),
                                 "by_role": dict(sorted(roles.items())), "by_alias": dict(sorted(aliases.items())),
                                 "ignored_system_files": found.ignored_system_files, "supplied_subsets": list(found.subsets.values())}
        overlaps = catalogue_.overlaps(catalogue, found)
        ordinal_of = {view["id"]: index for index, view in enumerate(catalogue["views"], 1)}
        prepared_views = []
        for ordinal, view in enumerate(catalogue["views"], 1):
            files = catalogue_.materialise(view, found, catalogue)
            reading = catalogue_.read_view(files.csv, view)
            cases, pilot_bytes = catalogue_.pilot(reading, view)
            pilot_reading = catalogue_.read_view(pilot_bytes, view)
            target = args.views / view["id"]
            target.mkdir(parents=True, exist_ok=True)
            (target / "view.csv").write_bytes(files.csv)
            (target / "pilot.csv").write_bytes(pilot_bytes)
            for name, content in files.side_files.items():
                (target / name).write_bytes(content)
            run.check(f"view {ordinal}: the pilot holds every record of each chosen incident", all(
                [record.cells for record in pilot_reading.cases[case]] == [record.cells for record in reading.cases[case]] for case in cases), None)
            run.check(f"view {ordinal}: every usable time lies within the proposed observation horizon", not any(reading.outside_horizon.values()), reading.outside_horizon)
            independent = {"records": reading.records - reading.blank, "blank_records": reading.blank, "ragged_records": len(reading.ragged),
                           "records_without_incident": len(reading.missing_case), "incidents": len(reading.cases),
                           "records_without_activity": reading.missing_activity, "records_with_unavailable_time": reading.unread_times,
                           "repeated_observations": reading.duplicates, "tied_time_groups": reading.tie_groups, "tied_time_records": reading.tied_records,
                           "outside_horizon": reading.outside_horizon}
            results.append({"ordinal": ordinal, "view_sha256": catalogue_.sha256(files.csv),
                            "side_files_sha256": sorted(catalogue_.sha256(content) for content in files.side_files.values()),
                            "conversion": files.reconciliation, "reading": independent,
                            "shares_records_with": [ordinal_of[name] for name in overlaps[view["id"]]],
                            "pilot": {"incidents": len(cases), "records": pilot_reading.records, "sha256": catalogue_.sha256(pilot_bytes)}})
            prepared_views.append((ordinal, view, files, reading, cases, pilot_bytes, pilot_reading))
        # Workloads: each whole view in its own process and workspace, measured apart from the pilots.
        for (ordinal, view, files, reading, *_), result in zip(prepared_views, results):
            result["workload"] = workload(run, ordinal, view, files.csv, reading)
        # Pilots, then the same workspace after a real restart.
        workspace = folder / "pilots"
        workspace.mkdir()
        first = run.service(workspace, "pilots-first")
        before, pilots_for_screens = {}, []
        try:
            client = first.client
            wid = open_workspace(client, workspace)
            for ordinal, view, files, reading, cases, pilot_bytes, pilot_reading in prepared_views:
                stored = store(client, wid, pilot_bytes, f"pilot-{ordinal}.csv")
                run.check(f"view {ordinal} pilot: stored under the digest of its bytes",
                          stored.get("source", {}).get("source_id") == "source.v1:sha256:" + catalogue_.sha256(pilot_bytes), None)
                inspected = inspect(client, wid, stored["source"]["source_id"], view)
                run.check(f"view {ordinal} pilot: the inspection reads the view's header", [column["name"] for column in inspected.get("columns", [])] == pilot_reading.header, None)
                prepared = prepare(client, wid, stored["source"]["source_id"], view, pilot_reading.header)
                if not run.check(f"view {ordinal} pilot: prepared", prepared.get("state") == "ready", None):
                    continue
                matches = report_matches(prepared["report"], pilot_reading)
                run.check(f"view {ordinal} pilot: every fault the preparation counts matches the independent reading", all(entry["same"] for entry in matches.values()),
                          {key: [value["product"], value["independent"]] for key, value in matches.items() if not value["same"] and not isinstance(value["product"], str)})
                preparation_id = prepared["preparation"]["preparation_id"]
                got = answers(client, wid, preparation_id, cases)
                compare_pilot(run, ordinal, got, pilot_reading, cases)
                before[ordinal] = (preparation_id, cases, got)
                pilots_for_screens.append({"preparation_id": preparation_id, "incidents": len(cases), "case_id": cases[0],
                                           "records": len(got["evidence"][cases[0]]["records"])})
            if browser:
                receipt["screens_before_restart"] = browse(run, args, first.port, "first", pilots_for_screens)
        finally:
            receipt["first_process"] = first.stop()
        second = run.service(workspace, "pilots-second")
        try:
            client = second.client
            run.check("restart: a new process", second.process.pid != receipt["first_process"].get("pid"), None)
            again = open_workspace(client, workspace)
            run.check("restart: the same workspace reopens", again == wid, None)
            for ordinal, (preparation_id, cases, got) in before.items():
                after = answers(client, again, preparation_id, cases)
                run.check(f"view {ordinal} pilot after restart: the same identity, population, map, variants and evidence", after == got,
                          {part: int(after[part] != got[part]) for part in got})
            if browser:
                receipt["screens_after_restart"] = browse(run, args, second.port, "reopen", pilots_for_screens)
        finally:
            receipt["second_process"] = second.stop()
    receipt["views"] = [{**result, "conversion": numbers(result["conversion"]), "workload": result.get("workload")} for result in results]
    write_report(args.views / "catalogue-report.md", catalogue or {"title": "Refused catalogue", "views": [], "sources": []}, found,
                 results, catalogue_.overlaps(catalogue, found) if found is not None else {}, problems)
    http = all(entry["passed"] for entry in run.checks if not entry["check"].startswith("screens"))
    receipt["layers"] = {"http_operations": "passed" if http and run.checks else "failed",
                         "real_restart": "passed" if http and "second_process" in receipt else "failed",
                         "built_screens": ("passed" if all(entry["passed"] for entry in run.checks if entry["check"].startswith("screens")) else "failed")
                         if browser else "not checked: no browser was named, so the screens are not qualified by this receipt"}
    receipt["status"] = "passed" if run.checks and all(entry["passed"] for entry in run.checks) else "failed"
    text = json.dumps(receipt, indent=1)
    for secret, name in ((str(folder), "<temporary folder>"), (str(ROOT), "<repository>")):
        text = text.replace(json.dumps(secret)[1:-1], name)
    private = [str(args.collection.resolve()), str(args.views.resolve()), str(args.catalogue.resolve())]
    assert not any(value in text for value in private + [str(folder)]), "the receipt must not hold a path"
    args.output.write_text(text + "\n")
    print(json.dumps({"status": receipt["status"], "receipt": str(args.output), "report": str(args.views / "catalogue-report.md")}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
