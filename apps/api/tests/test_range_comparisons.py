"""Prepared range comparisons and saved comparison replay, through real routes.

The shared literal CSV's hand-counted parent is A..H (19 full raw records).
A has Open→Close lags4h and1h, B4h, G4h across an unlabelled row;
D has unknown order, C/H no passage, E a zero passage and F a1h passage.
"""
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from wise_platform_api.app import create_app
from import_requests import envelope, policies, wall_policies
from test_range_conditions import RAW, PARENT, PATH, post, selection, snapshot

POLICY = "incident.context.first_record_in_declared_order.v1"
CASES = [
    ({"kind": "raw_record_count_between", "minimum_records": 2, "maximum_records": 3, "negate": False}, (["B", "D", "E", "F", "G"], ["A", "C", "H"], [])),
    ({"kind": "observed_span_between", "minimum_hours": 4, "maximum_hours": 6, "negate": False}, (["A", "B", "G"], ["C", "E", "F", "H"], ["D"])),
    ({"kind": "max_raw_gap_between", "minimum_hours": 0, "maximum_hours": 0, "negate": False}, (["E"], ["A", "B", "F", "G"], ["C", "D", "H"])),
    (PATH, (["A", "B", "G"], ["C", "E", "F", "H"], ["D"])),
    ({**PATH, "quantifier": "every"}, (["B", "G"], ["A", "C", "E", "F", "H"], ["D"])),
]
COUNTS = {"A": 5, "B": 2, "C": 1, "D": 2, "E": 2, "F": 3, "G": 3, "H": 1}


def opened(c, folder, wall):
    folder.mkdir()
    wid = post(c, "/api/workspaces/open", envelope("open_workspace_request", path=str(folder)))["workspace_id"]
    lines = RAW.splitlines()
    raw = b"\n".join([lines[0] + b",Desk", *[line + b",East" for line in lines[1:]]]) + b"\n"
    if wall:
        raw = raw.replace(b"Z,", b",")
    uploaded = c.put("/api/sources", params=envelope("upload_source_metadata", workspace_id=wid, filename="range-comparisons.csv"), content=raw, headers={"Content-Type": "application/octet-stream"})
    assert uploaded.status_code == 200
    pol = wall_policies("iso8601", "2026-10-02T00:00:00") if wall else policies("iso8601", None, True, "2026-10-02T00:00:00Z")
    prepared = post(c, "/api/preparations", envelope("confirm_mapping_request", workspace_id=wid, source_id=uploaded.json()["source"]["source_id"], dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"}, mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": 3, "context_columns": [4]}, policies=pol, accept_report_issues=True))
    assert prepared["state"] == "ready"
    base = post(c, "/api/investigations/open-population", envelope("open_population_request", workspace_id=wid, preparation_id=prepared["preparation"]["preparation_id"]))
    return wid, base


def compared(c, wid, base, definition):
    return post(c, "/api/investigations/compare-groups", envelope("compare_groups_request", "prepared-range-comparison", 2, workspace_id=wid, identity=base["identity"], parent_case_ids=PARENT, context_column_index=4, context_policy=POLICY, definition=definition), "comparison")


def assert_support(support, expected):
    assert support == {"case_ids": expected, "case_count": len(expected), "record_count": sum(COUNTS[c] for c in expected)}


@pytest.mark.parametrize("wall", [False, True])
@pytest.mark.parametrize("negate", [False, True])
@pytest.mark.parametrize("predicate,expected", CASES)
def test_every_new_range_compares_and_saved_groups_replay_after_fresh_application(tmp_path, wall, negate, predicate, expected):
    folder = tmp_path / "workspace"
    p = {**predicate, "negate": negate}
    kept, removed, unknown = (expected[1], expected[0], expected[2]) if negate else expected
    definition = {"mode": "two_named_groups", "target": {"name": "Matching range", "definition": {"kind": "predicates", "predicates": [p]}}, "reference": {"name": "Known complement", "definition": {"kind": "predicates", "predicates": [{**p, "negate": not negate}]}}}
    with TestClient(create_app()) as c:
        wid, base = opened(c, folder, wall)
        before = snapshot(folder)
        answer = compared(c, wid, base, definition)
        assert answer["definition"] == definition
        for role, included, excluded in (("target", kept, removed), ("reference", removed, kept)):
            assert_support(answer[role]["included"], included)
            assert_support(answer[role]["excluded"], excluded)
            assert_support(answer[role]["unevaluable"], unknown)
        assert answer["parent"]["case_ids"] == PARENT
        assert snapshot(folder) == before
        chosen = selection(c, wid, base, [p])
        assert chosen["kept"]["case_ids"] == kept
        saved_comparison = {"kind": "group", "comparison_id": answer["comparison_id"], "parent_case_ids": PARENT, "context_column_index": 4, "context_policy": POLICY, "definition": definition}
        saved = post(c, "/api/investigations/save", envelope("save_investigation_request", "save-range-comparison", 3, workspace_id=wid, investigation_id=None, expected_revision_id=None, name="Typed range comparison", base_identity=base["identity"], selection_identity=chosen["identity"], selection_recipe={"parent_case_ids": PARENT, "predicates": [p]}, context_policy=POLICY, comparison=saved_comparison, notes="", bookmarks=[]), "saving")
        revision = saved["revision"]["saved_revision_id"]
        after_save = snapshot(folder)
    # This is a fresh application, not a claimed OS/socket restart.
    with TestClient(create_app()) as fresh:
        assert post(fresh, "/api/workspaces/open", envelope("open_workspace_request", path=str(folder)))["workspace_id"] == wid
        reopened = post(fresh, "/api/investigations/reopen", envelope("reopen_investigation_request", "reopen-range-comparison", 4, workspace_id=wid, saved_revision_id=revision), "saving")
        assert reopened["restored_comparison_id"] == answer["comparison_id"]
        assert reopened["revision"]["content"]["comparison"] == saved_comparison
        restored = reopened["restored_selection"]
        assert restored["identity"] == chosen["identity"]
        for name, expected_ids in (("kept", kept), ("removed", removed), ("unevaluable", unknown)):
            assert_support(restored[name], expected_ids)
        replay = compared(fresh, wid, base, definition)
        assert replay["comparison_id"] == answer["comparison_id"]
        assert replay["target"] == answer["target"] and replay["reference"] == answer["reference"]
        # Every compared incident retains its complete raw history, including missing labels.
        case = kept[0]
        evidence = post(fresh, "/api/investigations/case-evidence", envelope("imported_case_evidence_request", "replayed-range-evidence", 4, workspace_id=wid, identity=answer["target"]["identity"], case_id=case))
        assert len(evidence["records"]) == COUNTS[case]
        assert snapshot(folder) == after_save
