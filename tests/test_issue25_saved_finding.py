"""#25: a finding saved with its whole meaning, reopened exactly in a second process, refused when misdescribed, refreshed.

On tests/fixtures/frozen-parent, the question keeps the incidents that begin with Opened and contain Resolved; its
comparison splits the parent frozen after the eligibility step by the clause; the outcome "no recorded Resolved" is read
by Team; a supporting and a contrary witness are pinned with structured notes. Saved in one process, it reopens in a
second process with the same identities, comparison, parent description, outcome, bookmarks and notes. A description of
the parent that does not give its incidents, and an outcome on an unmapped column, are refused. A refreshed source (one
incident appended) is saved as a new revision of the same investigation; the earlier revision reopens as it was.
"""

import json
from pathlib import Path

from test_import_acceptance import envelope, population, prepare, upload
from test_saved_investigation_restart import cli_host, loopback_port, open_workspace

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/frozen-parent"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
POLICY = "incident.context.first_record_in_declared_order.v1"
RETAINED = EXPECTED["retained"]
CLAUSE = EXPECTED["resolution"]["clause"]
OUTCOME = {"policy": "incident.outcome.recorded_activity_presence_at_snapshot.v1", "activity": "Resolved", "counted": "absence", "context_column_index": 3}
NOTES = ("Question: Do the incidents with a recorded resolution differ by team?\n\nObservation: Team A is more often resolved.\n\n"
         "Counterexample: F04 at Team B has no recorded resolution.\n\nLimitation: Seven invented incidents.\n\nNext check: Read a longer export.")


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def read(client, workspace, raw, name, request_id):  # noqa: F811
    source = upload(client, workspace, raw, name, request_id)
    policies = json.loads(json.dumps(__import__("test_import_acceptance").policies()))
    policies["time"]["parameters"]["snapshot_cutoff_utc"] = EXPECTED["cutoff_utc"]
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping=dict(EXPECTED["mapping"]), policies=policies, accept_report_issues=True)
    return population(client, workspace, prepare(client, request))


def question(client, workspace, base, label):  # noqa: F811
    """The selection, its frozen comparison parent, the comparison, two witnesses and the save request."""
    def select(predicates, request_id):
        return ok(client.post("/api/investigations/select-cases", json=envelope("select_cases_request", request_id, 2, workspace_id=workspace["workspace_id"],
                              identity=base["identity"], parent_case_ids=None, predicates=predicates)))
    selected = select([RETAINED, CLAUSE], f"{label}-select")
    parent = select([RETAINED], f"{label}-parent")["kept"]["case_ids"]
    definition = {"mode": "selection_partition", "target_name": "Recorded “Resolved”", "reference_name": "No recorded “Resolved”", "predicates": [CLAUSE], "target_side": "kept"}
    compared = ok(client.post("/api/investigations/compare-groups", json=envelope("compare_groups_request", workspace_id=workspace["workspace_id"], identity=base["identity"],
                  parent_case_ids=parent, context_column_index=3, context_policy=POLICY, definition=definition)))

    def rows(identity, case_id):
        return [record["row_id"] for record in ok(client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "evidence", 3,
                workspace_id=workspace["workspace_id"], identity=identity, case_id=case_id)))["records"]]
    bookmarks = [
        {"label": "Supporting: F01", "identity": selected["identity"], "case_id": "F01", "row_ids": rows(selected["identity"], "F01"),
         "note": "Role: supporting\nObservation: Resolved within two hours."},
        {"label": "Contrary: F04", "identity": selected["parent_identity"], "case_id": "F04", "row_ids": rows(selected["parent_identity"], "F04"),
         "note": "Role: contrary\nLimitation: The export may end before a resolution."},
    ]
    comparison = {"kind": "group", "comparison_id": compared["comparison_id"], "parent_case_ids": parent, "context_column_index": 3, "context_policy": POLICY,
                  "definition": definition}
    request = dict(workspace_id=workspace["workspace_id"], investigation_id=None, expected_revision_id=None, name="Resolution by team",
                   base_identity=base["identity"], selection_identity=selected["identity"],
                   selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": [RETAINED, CLAUSE]}, context_policy=POLICY,
                   comparison=comparison, notes=NOTES, bookmarks=bookmarks, comparison_parent={"retained_predicates": [RETAINED], "label": None}, outcome=OUTCOME)
    return selected, compared, request


def save(client, request, request_id="save-1"):  # noqa: F811
    return client.post("/api/investigations/save", json=envelope("save_investigation_request", request_id, 5, **request))


def reopen(client, workspace, revision_id):  # noqa: F811
    return ok(client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"], saved_revision_id=revision_id)))


def test_a_finding_reopens_exactly_in_a_second_process_and_a_refresh_keeps_the_earlier_revision(tmp_path):
    path = tmp_path / "saved finding"
    path.mkdir()
    port = loopback_port()
    raw = (FIXTURES / EXPECTED["file"]).read_bytes()
    with cli_host(tmp_path, 1, port) as (client, _):
        workspace = open_workspace(client, path, "workspace-1")
        base = read(client, workspace, raw, EXPECTED["file"], "upload-1")
        selected, compared, request = question(client, workspace, base, "first")
        answer = ok(save(client, request))
        revision = answer["revision"]
        # Misdescribed: a parent description that does not give the parent, an outcome on an unmapped column.
        wrong = save(client, {**request, "comparison_parent": {"retained_predicates": [CLAUSE], "label": None}}, "save-wrong")
        assert (wrong.status_code, wrong.json()["code"], wrong.json()["field"]) == (409, "comparison_mismatch", "comparison_parent.retained_predicates"), wrong.text
        unmapped = save(client, {**request, "outcome": {**OUTCOME, "context_column_index": 2}}, "save-unmapped")
        assert unmapped.json()["code"] == "invalid_parameter" and unmapped.json()["field"] == "outcome.context_column_index", unmapped.text
    with cli_host(tmp_path, 2, port) as (client, _):
        workspace = open_workspace(client, path, "workspace-2")
        reopened = reopen(client, workspace, revision["saved_revision_id"])
        content = reopened["revision"]["content"]
        assert (content["notes"], content["bookmarks"], content["outcome"], content["comparison_parent"]) == (NOTES, request["bookmarks"], OUTCOME, request["comparison_parent"])
        assert content["comparison"]["comparison_id"] == compared["comparison_id"]
        assert reopened["restored_selection"]["identity"] == selected["identity"]
        assert reopened["restored_selection"]["kept"]["case_ids"] == selected["kept"]["case_ids"]
        # A refreshed source: one incident appended. Saved as a new revision of the same investigation.
        appended = raw + b"F08,Opened,2026-08-08T08:00:00Z,A,North\nF08,Resolved,2026-08-08T09:00:00Z,A,North\n"
        fresh = read(client, workspace, appended, EXPECTED["file"], "upload-2")
        assert fresh["identity"]["source_id"] != base["identity"]["source_id"]
        _, _, refreshed = question(client, workspace, fresh, "fresh")
        second = ok(save(client, {**refreshed, "investigation_id": revision["investigation_id"], "expected_revision_id": revision["saved_revision_id"]}, "save-2"))
        assert second["created_investigation"] is False
        [row] = ok(client.post("/api/investigations/list-saved", json=envelope("list_saved_request", workspace_id=workspace["workspace_id"])))["investigations"]
        assert [(item["saved_revision_id"], item["source_id"]) for item in row["revisions"]] == [
            (second["revision"]["saved_revision_id"], fresh["identity"]["source_id"]), (revision["saved_revision_id"], base["identity"]["source_id"])]
        # The earlier finding stays as it was: its source, identities and incidents.
        earlier = reopen(client, workspace, revision["saved_revision_id"])
        assert earlier["revision"]["content"]["base_identity"] == base["identity"]
        assert earlier["restored_selection"]["kept"]["case_ids"] == selected["kept"]["case_ids"]
        assert "F08" in reopen(client, workspace, second["revision"]["saved_revision_id"])["restored_selection"]["kept"]["case_ids"]


def test_a_refresh_applies_the_saved_question_to_another_reading_and_says_what_changed(tmp_path):
    from fastapi.testclient import TestClient
    from wise_platform_api.app import create_app
    folder = tmp_path / "workspace"
    folder.mkdir()
    raw = (FIXTURES / EXPECTED["file"]).read_bytes()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        workspace = ok(client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))))
        base = read(client, workspace, raw, EXPECTED["file"], "upload-1")
        selected, _, request = question(client, workspace, base, "first")
        revision = ok(save(client, request))["revision"]
        appended = raw + b"F08,Opened,2026-08-08T08:00:00Z,A,North\nF08,Resolved,2026-08-08T09:00:00Z,A,North\n"
        fresh = read(client, workspace, appended, EXPECTED["file"], "upload-2")
        refreshed = ok(client.post("/api/investigations/refresh", json=envelope("refresh_investigation_request", workspace_id=workspace["workspace_id"],
                       saved_revision_id=revision["saved_revision_id"], preparation_id=fresh["identity"]["preparation_id"])))
        review = {item["aspect"]: item["status"] for item in refreshed["review"]}
        assert review == {"source": "changed", "binding": "unchanged", "clock": "unchanged", "parent": "changed", "selection": "changed", "comparison": "to_review"}
        assert refreshed["parent_case_ids"] is None
        assert refreshed["restored_selection"]["kept"]["case_ids"] == selected["kept"]["case_ids"] + ["F08"]
        # The refreshed selection is held, so the question can be saved as a new revision on the new reading.
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request", "evidence", 3,
                               workspace_id=workspace["workspace_id"], identity=refreshed["restored_selection"]["identity"], case_id="F08"))
        assert evidence.status_code == 200, evidence.text
        # Nothing was saved by refreshing: the investigation still has one revision.
        [row] = ok(client.post("/api/investigations/list-saved", json=envelope("list_saved_request", workspace_id=workspace["workspace_id"])))["investigations"]
        assert [item["saved_revision_id"] for item in row["revisions"]] == [revision["saved_revision_id"]]
