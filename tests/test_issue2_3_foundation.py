"""#2 and #3: the synthetic examples against their independent fixture, and the workspace's stored sources.

Every expected value is read from the independent fixture files (tests/fixtures/incidents/expected.json and
threshold_expected.json), which are never read by product code
the answers come from the product's public routes.
"""

import csv
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sys

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from test_analytics_acceptance import case_evidence, open_example
from test_import_acceptance import envelope, policies, population, prepare, upload

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/incidents"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))["fixtures"]
THRESHOLD = json.loads((FIXTURES / "threshold_expected.json").read_text(encoding="utf-8"))
sys.path.insert(0, str(ROOT / "apps/api/tests"))


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.mark.parametrize("example", ["S0", "S1", "S2", "S3"])
def test_each_synthetic_example_answers_its_independent_fixture(client, example):
    expected = EXPECTED[example]
    answer = open_example(client, example)
    groups = answer["populations"]
    # #2: exact unique incident and record counts, the parent and outside incidents and the two predicate groups,
    # as far as each fixture states them independently.
    base = (expected.get("base_cases", expected.get("cases")), expected.get("base_records", expected.get("raw_records", expected.get("records"))))
    assert (groups["base"]["case_count"], groups["base"]["record_count"]) == base
    if "parent_cases" in expected:
        assert (groups["parent"]["case_count"], groups["parent"]["record_count"]) == (expected["parent_cases"], expected["parent_records"])
    if "parent_ids" in expected:
        assert (groups["parent"]["case_ids"], groups["outside"]["case_ids"]) == (expected["parent_ids"], expected["outside_ids"])
    if "A_ids" in expected:
        assert (groups["kept"]["case_ids"], groups["kept"]["record_count"]) == (expected["A_ids"], expected["A_records"])
        assert (groups["removed"]["case_ids"], groups["removed"]["record_count"]) == (expected["B_ids"], expected["B_records"])
    if "mapped_records" in expected:
        assert (answer["coverage"]["mapped_record_count"], answer["coverage"]["omitted_activity_record_count"]) == (
            expected["mapped_records"], expected["omitted_activity_records"])
    # Every incident's complete records come back, each source row once, under the population's identity; their
    # declared order is checked against the same files in test_analytics_acceptance.py.
    rows = list(csv.DictReader(io.StringIO((FIXTURES / f"{example}.csv").read_text(encoding="utf-8"))))
    for case_id in groups["parent"]["case_ids"]:
        evidence = case_evidence(client, answer, case_id)
        assert evidence["identity"] == answer["identity"]
        assert sorted(record["source_event_id"] for record in evidence["records"]) == \
               sorted(row["source_event_id"] for row in rows if row["incident_id"] == case_id)
        assert len({record["row_id"] for record in evidence["records"]}) == len(evidence["records"])


def test_the_exact_four_hour_threshold_is_strict_in_the_product_and_inclusive_by_name(tmp_path):
    from test_scoring_acceptance import definition, ready, score
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        opened = active.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
        source = upload(active, opened, (FIXTURES / THRESHOLD["fixture"]).read_bytes(), THRESHOLD["fixture"])
        chosen = policies()
        chosen["time"]["parameters"]["snapshot_cutoff_utc"] = "2026-10-02T00:00:00Z"
        request = envelope("confirm_mapping_request", workspace_id=opened["workspace_id"], source_id=source["source_id"],
                           dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                           mapping={"case_column": 0, "activity_column": 3, "timestamp_column": 4, "sequence_column": 2, "context_columns": [5, 6]},
                           policies=chosen, accept_report_issues=True)
        base = population(active, opened, prepare(active, request))
        run = score(active, opened, base, base, ready(active, opened, base, base, definition(target=THRESHOLD["strict"]["hours"], width=0, unit="hours")))
    cases = {case["case_id"]: case for case in run["cases"]}
    assert (run["population"]["case_ids"], run["population"]["record_count"]) == (THRESHOLD["case_ids"], THRESHOLD["records"])
    assert {key: case["measurement"]["value"] for key, case in cases.items()} == THRESHOLD["measured_hours"]
    # The product's threshold is the fixture's strict reading: only 5 hours exceeds 4; exactly 4 does not; missing is unevaluable.
    strict = THRESHOLD["strict"]
    assert sorted(key for key, case in cases.items() if case["value"] is not None and case["value"] > 0) == strict["true_ids"]
    assert sorted(key for key, case in cases.items() if case["value"] == 0) == strict["false_ids"]
    assert sorted(key for key, case in cases.items() if case["value"] is None) == strict["unevaluable_ids"]
    # The inclusive reading differs at exactly four hours, and is a separately named operator of the fixture.
    inclusive = THRESHOLD["inclusive"]
    assert (strict["operator"], inclusive["operator"]) == ("gt", "ge") and set(inclusive["true_ids"]) - set(strict["true_ids"]) == {"BOUNDARY4"}
    measured = {key: case["measurement"]["value"] for key, case in cases.items()}
    assert sorted(key for key, hours in measured.items() if hours is not None and hours >= inclusive["hours"]) == inclusive["true_ids"]


def store(client, workspace, raw, filename):
    return upload(client, workspace, raw, filename)


def test_a_different_source_under_the_same_name_is_a_different_source(client, tmp_path):
    folder = tmp_path / "workspace"
    folder.mkdir()
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    first = store(client, workspace, (FIXTURES / "S0.csv").read_bytes(), "incidents.csv")
    second = store(client, workspace, (FIXTURES / "S1.csv").read_bytes(), "incidents.csv")
    # #3: same name, different bytes: detected as another source, never treated as the earlier import.
    assert first["source_id"] != second["source_id"]
    listed = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()["sources"]
    assert sorted(entry["source_id"] for entry in listed) == sorted([first["source_id"], second["source_id"]])


def test_changing_the_program_examples_does_not_change_a_stored_source(tmp_path):
    examples = tmp_path / "examples"
    shutil.copytree(ROOT / "apps/api/src/wise_platform_api/examples", examples)
    folder = tmp_path / "workspace"
    folder.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt", examples_dir=examples)) as active:
        workspace = active.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
        raw = active.get("/api/examples/S0/source").content
        stored = store(active, workspace, raw, "Synthetic example S0.csv")
        before = {path.relative_to(folder): path.read_bytes() for path in (folder / "sources").rglob("*") if path.is_file()}
        # The program's packaged example changes (an update); the stored source and its identity stay as they were.
        (examples / "S0.csv").write_bytes(raw.replace(b"Desktop", b"Changed", 1))
        after = {path.relative_to(folder): path.read_bytes() for path in (folder / "sources").rglob("*") if path.is_file()}
        assert after == before
        listed = active.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()["sources"]
        assert [entry["source_id"] for entry in listed] == [stored["source_id"]]
        changed = store(active, workspace, active.get("/api/examples/S0/source").content, "Synthetic example S0.csv")
        assert changed["source_id"] != stored["source_id"]


@pytest.mark.skipif(os.name != "posix" or os.geteuid() == 0, reason="needs a system that honours folder permissions for its owner")
def test_a_read_only_and_a_locked_location_are_refused_without_a_workspace(client, tmp_path):
    read_only = tmp_path / "read-only"
    read_only.mkdir()
    read_only.chmod(0o500)
    try:
        refused = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(read_only)))
        assert refused.json()["code"] == "workspace_not_writable", refused.text
        assert list(read_only.iterdir()) == []
    finally:
        read_only.chmod(0o700)
    # A workspace whose manifest another process holds unreadable: refused by name; nothing is recreated over it.
    locked = tmp_path / "locked"
    locked.mkdir()
    opened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(locked))).json()
    manifest = locked / "wise-platform-workspace.json"
    before = manifest.read_bytes()
    manifest.chmod(0)
    try:
        refused = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(locked)))
        assert refused.status_code >= 400 and refused.json()["code"].startswith("workspace_"), refused.text
        assert refused.json()["message"].strip()
    finally:
        manifest.chmod(0o600)
    assert manifest.read_bytes() == before and opened["workspace_id"].startswith("workspace.v1:")


def prepared_example(client, folder, example):
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    source = store(client, workspace, (FIXTURES / f"{example}.csv").read_bytes(), f"Synthetic example {example}.csv")
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping={"case_column": 0, "activity_column": 3, "timestamp_column": 4, "sequence_column": 2, "context_columns": [5, 6]},
                       policies=policies(), accept_report_issues=True)
    return workspace, population(client, workspace, prepare(client, request))


def test_a_copied_workspace_resolves_its_relative_references(client, tmp_path):
    folder = tmp_path / "workspace"
    folder.mkdir()
    workspace, base = prepared_example(client, folder, "S2")
    listed = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    moved = tmp_path / "elsewhere" / "workspace"
    shutil.copytree(folder, moved)
    shutil.rmtree(folder)
    reopened = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(moved))).json()
    # #3: every stored artifact is found from its relative place; identities and counts are unchanged.
    assert reopened["workspace_id"] == workspace["workspace_id"]
    assert (reopened["sources"], reopened["preparations"]) == (listed["sources"], listed["preparations"]) and len(listed["sources"]) == 1
    again = client.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=reopened["workspace_id"],
                                                                              preparation_id=base["identity"]["preparation_id"])).json()
    assert (again["identity"], again["population"]) == (base["identity"], base["population"])


def test_the_synthetic_examples_survive_a_second_process(tmp_path):
    from test_bpic19_pipeline_http import start_process
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    folder = tmp_path / "workspace"
    folder.mkdir()
    first, client = start_process(port)
    try:
        answers = {example: prepared_example(client, folder, example) for example in ("S0", "S1", "S2", "S3")}
        records = {example: {case: client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
                       workspace_id=workspace["workspace_id"], identity=base["identity"], case_id=case)).json()["records"]
                       for case in base["population"]["case_ids"]} for example, (workspace, base) in answers.items()}
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).status_code == 200
        for example, (workspace, base) in answers.items():
            again = fresh.post("/api/investigations/open-population", json=envelope("open_population_request", workspace_id=workspace["workspace_id"],
                                                                                    preparation_id=base["identity"]["preparation_id"])).json()
            # #3: the same source, preparation, population, counts and every record's identity in a second process.
            assert (again["identity"], again["population"]) == (base["identity"], base["population"])
            assert again["population"]["case_count"] == EXPECTED[example].get("base_cases", EXPECTED[example].get("cases"))
            for case, before in records[example].items():
                after = fresh.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
                    workspace_id=workspace["workspace_id"], identity=base["identity"], case_id=case)).json()["records"]
                assert after == before
    finally:
        second.terminate()
        second.wait(timeout=15)


def test_the_golden_answers_and_the_reference_counter_cannot_serve_as_the_engine():
    # #2: the product ships the example sources only; nothing it runs reads the expected answers, the threshold
    # expectations or the independent reference counter, so an answer can only come from the product's own logic.
    shipped = sorted(path.name for path in (ROOT / "apps/api/src/wise_platform_api/examples").iterdir())
    assert shipped == [".gitattributes", "README.md", "S0.csv", "S1.csv", "S2.csv", "S3.csv"]
    forbidden = ("expected.json", "threshold_expected", "fixture_reference", "tests/fixtures", "policies.v1.json", "policy_ids.json")
    product = [path for folder in ("apps/api/src", "packages/analytics/src", "apps/web/src") for path in (ROOT / folder).rglob("*")
               if path.is_file() and path.suffix in {".py", ".ts", ".tsx", ".json"} and ".test." not in path.name and "/test/" not in path.as_posix()]
    assert product
    assert [str(path.relative_to(ROOT)) for path in product if any(name in path.read_text(encoding="utf-8") for name in forbidden)] == []
