"""#99: a reviewed local preparation catalogue over the invented collection of tests/fixtures/catalogue.

The collection is written by tools/make_catalogue_fixture.py. These tests check the declaration against the folder,
the conversions and joins, the independent reading, and the whole qualification over the service as its own process
before and after a real restart (the built screens are qualified separately, with the browser named)."""

from __future__ import annotations

import copy
import csv
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "tools")]

import make_catalogue_fixture  # noqa: E402
import preparation_catalogue as catalogue_  # noqa: E402

FIXTURE = ROOT / "tests/fixtures/catalogue"
COLLECTION = FIXTURE / "collection"


def declared() -> dict:
    return json.loads((FIXTURE / "catalogue.json").read_text(encoding="utf-8"))


def rows(content: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(content.decode("utf-8"), newline="")))


@pytest.fixture
def collection(tmp_path: Path) -> Path:
    target = tmp_path / "collection"
    shutil.copytree(COLLECTION, target)
    return target


def refused(catalogue: dict, folder: Path = COLLECTION) -> list[str]:
    with pytest.raises(catalogue_.Refused) as caught:
        catalogue_.check_declaration(catalogue)
        catalogue_.inventory(catalogue, folder)
    return caught.value.problems


def test_the_committed_collection_is_what_its_generator_writes():
    written = make_catalogue_fixture.collection()
    on_disk = {path.relative_to(COLLECTION).as_posix(): path.read_bytes() for path in COLLECTION.rglob("*") if path.is_file()}
    assert on_disk == written


def test_every_file_and_member_has_a_record_with_identity_alias_and_role():
    found = catalogue_.inventory(declared(), COLLECTION)
    assert set(found.items) == {"note", "tickets", "teams", "exports", "tickets-copy", "tickets-september", "earlier-scores",
                                "visits", "orders", "cache", "old-workspace"}
    assert found.items["tickets-copy"].sha256 == found.items["tickets"].sha256
    assert found.items["tickets-copy"].archive == "exports" and found.items["old-workspace"].files == 2
    assert found.subsets == {"tickets-september": {"records": 127, "original_records": 172}}
    roles = {item.id: item.role for item in found.items.values()}
    assert roles["earlier-scores"] == "earlier_analysis_state" and roles["cache"] == "cache" and roles["old-workspace"] == "earlier_workspace"


def test_a_file_without_a_record_or_a_record_without_a_file_is_refused(collection: Path):
    (collection / "desk" / "unlisted.csv").write_text("a,b\r\n")
    (collection / "service" / "visits.xes").unlink()
    (collection / ".DS_Store").write_bytes(b"\0")
    problems = refused(declared(), collection)
    assert "the file desk/unlisted.csv has no record" in problems
    assert "visits: no file at service/visits.xes" in problems
    assert not any(".DS_Store" in problem for problem in problems)


def test_an_unlisted_archive_member_is_refused(collection: Path):
    with zipfile.ZipFile(collection / "desk" / "exports.zip", "a") as bundle:
        bundle.writestr("extra/old.csv", "a\r\n")
    assert refused(declared(), collection) == ["exports: the member extra/old.csv has no record"]


def test_identical_bytes_are_declared_copies_and_a_declared_copy_is_identical(collection: Path):
    shutil.copy(collection / "desk" / "teams.csv", collection / "desk" / "teams-again.csv")
    catalogue = declared()
    catalogue["sources"].append({**copy.deepcopy(catalogue["sources"][2]), "id": "teams-again", "path": "desk/teams-again.csv"})
    assert refused(catalogue, collection) == ["identical bytes in teams, teams-again are not declared as copies of one of them"]
    catalogue["sources"][-1]["alias"] = {"classification": "byte_identical_copy", "of": "tickets"}
    assert refused(catalogue, collection) == ["teams-again is declared a byte-identical copy of tickets but its bytes differ"]
    catalogue["sources"][-1]["alias"] = {"classification": "byte_identical_copy", "of": "teams"}
    catalogue_.inventory(catalogue, collection)


def test_a_supplied_subset_holds_only_records_of_its_original():
    catalogue = declared()
    catalogue["sources"][3]["members"][1]["alias"]["of"] = "teams"
    with pytest.raises(catalogue_.Refused, match="tickets-september is declared a subset but holds records its original does not"):
        catalogue_.inventory(catalogue, COLLECTION)


def test_scores_caches_master_data_and_old_workspaces_are_never_read_as_event_logs():
    for source in ("earlier-scores", "cache", "teams", "old-workspace"):
        catalogue = declared()
        catalogue["views"][0]["source"] = source
        assert any(f"{source} is" in problem and "not an event log" in problem for problem in refused(catalogue))
    catalogue = declared()
    catalogue["views"][0]["joins"][0]["master"] = "tickets"
    assert "tickets-by-ticket: a join reads a declared static master data CSV, not tickets" in refused(catalogue)
    catalogue = declared()
    del catalogue["sources"][2]["snapshot"]
    assert "tickets-by-ticket: teams says when its snapshot was taken" in refused(catalogue)


def test_every_context_column_declares_where_it_comes_from_and_a_snapshot_is_never_event_history():
    catalogue = declared()
    del catalogue["views"][0]["context_origin"]["Channel"]
    assert "tickets-by-ticket: every context column, and only those, has a declared origin" in refused(catalogue)
    catalogue = declared()
    catalogue["views"][0]["context_origin"]["teams:Region"] = "event_attribute"
    assert "tickets-by-ticket: teams:Region comes from a static snapshot exactly when a join supplies it" in refused(catalogue)
    catalogue = declared()
    catalogue["views"][2]["context_origin"]["event:lifecycle:transition"] = "event_attribute"
    assert "visits-by-case: a lifecycle read as context names its column" in refused(catalogue)


def test_an_object_centric_log_is_read_only_through_one_named_object_type():
    catalogue = declared()
    catalogue["views"][3]["conversion"] = {"kind": "csv_as_is"}
    problems = refused(catalogue)
    assert "orders-by-order: csv_as_is reads a csv source, not ocel2_json" in problems
    assert "orders-by-order: an object-centric log is read only through one named object type" in problems


def test_the_join_appends_a_snapshot_only_where_one_row_matches_and_keeps_every_record_in_place():
    catalogue = declared()
    found = catalogue_.inventory(catalogue, COLLECTION)
    view = catalogue["views"][0]
    files = catalogue_.materialise(view, found, catalogue)
    original, joined = rows(found.contents["tickets"]), rows(files.csv)
    assert joined[0] == original[0] + ["teams:Team name", "teams:Region", "join:teams"]
    assert len(joined) == len(original)
    for before, after in zip(original[1:], joined[1:]):
        assert after[: len(before)] == before
        if before:
            status = after[-1]
            assert status == {"D1": "matched", "D2": "matched", "D4": "matched", "D3": "ambiguous", "D9": "unmatched"}[before[3]]
            assert (after[-3:-1] != ["", ""]) == (status == "matched")
    assert files.reconciliation["joins"][0]["records"] == {"ambiguous": 28, "matched": 135, "unmatched": 9}
    ragged = [row for row in joined[1:] if row and len(row) != len(joined[0])]
    assert len(ragged) == 1 and ragged[0][5] == "left over"


def test_xes_keeps_every_transition_attribute_and_nested_value_without_pairing():
    found = catalogue_.inventory(declared(), COLLECTION)
    files = catalogue_.xes_to_csv(found.contents["visits"])
    table = rows(files.csv)
    header = table[0]
    assert header[:4] == ["trace:concept:name", "event:concept:name", "event:time:timestamp", "event:lifecycle:transition"]
    assert {"event:org:resource", "event:cost", "trace:channel", "trace:priority", "xes:trace_position", "xes:event_position"} <= set(header)
    records = [dict(zip(header, row)) for row in table[1:]]
    assert len(records) == 40 and Counter_of(records, "event:lifecycle:transition") == {"start": 20, "complete": 20}
    assert all(record["trace:channel"] in {"Phone", "Portal"} for record in records)
    assert sum(record["event:concept:name"] == "" for record in records) == 1
    assert sum(record["event:time:timestamp"] == "" for record in records) == 1
    nested = [json.loads(line) for line in files.side_files["xes-nested-attributes.jsonl"].decode().splitlines()]
    assert nested == [{"trace_position": 1, "event_position": 3, "type": "list", "key": "parts", "value": None, "children": [
        {"type": "values", "key": None, "value": None, "children": [
            {"type": "string", "key": "part", "value": "Valve", "children": []}, {"type": "string", "key": "part", "value": "Seal", "children": []}]}]}]
    log = json.loads(files.side_files["xes-log.json"])
    assert log["attributes"] == {"concept:name": "Invented service visits"} and len(log["extensions"]) == 4 and log["classifiers"][0]["name"] == "Activity"
    assert files.reconciliation["events_without"] == {"event:concept:name": 1, "event:time:timestamp": 1, "event:lifecycle:transition": 0}


def Counter_of(records: list[dict], key: str) -> dict:
    counts: dict = {}
    for record in records:
        counts[record[key]] = counts.get(record[key], 0) + 1
    return counts


def test_an_object_type_perspective_keeps_shared_events_qualifiers_attributes_and_relations():
    found = catalogue_.inventory(declared(), COLLECTION)
    document = json.loads(found.contents["orders"])
    files = catalogue_.ocel_to_csv(found.contents["orders"], "item")
    table = rows(files.csv)
    records = [dict(zip(table[0], row)) for row in table[1:]]
    by_event: dict = {}
    for record in records:
        by_event.setdefault(record["event:id"], []).append(record["object:id"])
    place = next(event for event in document["events"] if event["type"] == "place order" and len(event["relationships"]) == 3)
    assert by_event[place["id"]] == [relation["objectId"] for relation in place["relationships"] if relation["qualifier"] == "part"]
    assert all(record["e2o:qualifier"] in {"part", "picked", "packed"} for record in records)
    assert files.reconciliation["events_with_no_object_of_this_type"] == 4  # the stock check and the three shipments
    attributes = rows(files.side_files["ocel-item-attributes.csv"])
    assert attributes[0] == ["object:id", "attribute", "time", "value_json"] and len(attributes) == 8
    assert "weight" not in "".join(table[0])
    relations = rows(files.side_files["ocel-object-relations.csv"])
    assert {row[4] for row in relations[1:]} == {"contains", "carries"}
    others = rows(files.side_files["ocel-item-other-event-objects.csv"])
    assert {row[2] for row in others[1:]} == {"order", "package"}


def test_overlapping_views_are_named_and_never_added_up():
    catalogue = declared()
    found = catalogue_.inventory(catalogue, COLLECTION)
    assert catalogue_.overlaps(catalogue, found) == {"tickets-by-ticket": ["september-export"], "september-export": ["tickets-by-ticket"],
                                                     "visits-by-case": [], "orders-by-order": ["orders-by-item"], "orders-by-item": ["orders-by-order"]}
    files = catalogue_.materialise(catalogue["views"][1], found, catalogue)
    assert files.reconciliation["supplied_subset"] == {"incidents": 30, "incidents_with_cropped_history": 1, "records_not_in_this_subset": 1}


def test_the_independent_reading_counts_each_fault_and_the_pilot_holds_complete_incidents():
    catalogue = declared()
    found = catalogue_.inventory(catalogue, COLLECTION)
    view = catalogue["views"][0]
    reading = catalogue_.read_view(catalogue_.materialise(view, found, catalogue).csv, view)
    assert (reading.blank, len(reading.ragged), len(reading.missing_case), reading.missing_activity, reading.unavailable_time,
            reading.unread_times, reading.duplicates, reading.tie_groups, reading.tied_records, len(reading.cases)) == (1, 1, 1, 1, 1, 2, 1, 2, 4, 40)
    cases, content = catalogue_.pilot(reading, view)
    assert cases == ["T-001", "T-002", "T-005", "T-007", "T-010", "T-012"]
    piloted = catalogue_.read_view(content, view)
    assert sorted(piloted.cases) == cases
    for case in cases:
        assert [record.cells for record in piloted.cases[case]] == [record.cells for record in reading.cases[case]]
    assert not piloted.evaluable("T-007") and piloted.sequence("T-005") == ["Opened", "Asked customer", "Customer replied", "Resolved", "Closed"]


def test_the_catalogue_qualifies_over_the_service_before_and_after_a_real_restart(tmp_path: Path):
    receipt, views = tmp_path / "receipt.json", tmp_path / "views"
    completed = subprocess.run([sys.executable, str(ROOT / "tools/qualify_preparation_catalogue.py"), "--catalogue", str(FIXTURE / "catalogue.json"),
                                "--collection", str(COLLECTION), "--views", str(views), "--output", str(receipt)],
                               capture_output=True, text=True, timeout=600)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    result = json.loads(receipt.read_text())
    assert result["status"] == "passed" and all(entry["passed"] for entry in result["checks"])
    assert result["layers"]["http_operations"] == "passed" and result["layers"]["real_restart"] == "passed"
    assert result["layers"]["built_screens"].startswith("not checked")
    assert [view["shares_records_with"] for view in result["views"]] == [[2], [1], [], [5], [4]]
    assert all({"import", "investigation", "records", "incidents", "columns"} <= set(view["workload"])
               and view["workload"]["investigation"]["peak_resident_bytes"] > 0 for view in result["views"])
    text = receipt.read_text()
    for private in (str(COLLECTION), str(tmp_path), "Ticket", "T-001", "Status", "teams", "O-1", "Engineer", "Invented"):
        assert private not in text
    assert "total" not in text
    report = (views / "catalogue-report.md").read_text()
    assert "supplied subset of tickets" in report and "Overlapping views are never added up as one population." in report
    assert (views / "visits-by-case" / "xes-nested-attributes.jsonl").exists()
