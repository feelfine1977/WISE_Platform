"""#62: a window of first records keeps its exact bounds and clock through refusal, comparison, Save and reopen.

The window must use the clock of the preparation; the kept and removed incidents compare as the oracle of
tests/fixtures/starts names them; saved and reopened, the step keeps its bounds and clock and its incidents.
"""

import json
from pathlib import Path

from test_import_acceptance import envelope
from test_issue10_interval_tail import client, read, select  # noqa: F401  (client is a fixture)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests/fixtures/starts"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
STEP = {"kind": "case_start_in_window", "window": EXPECTED["window"], "negate": False}


def test_a_window_on_another_clock_is_refused(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    wall = {"kind": "case_start_in_window", "negate": False, "window": {"timestamp_kind": "wall_clock", "start_inclusive": "2026-03-02T00:00:00",
            "end_exclusive": "2026-03-09T00:00:00"}}
    refused = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-x", 2, workspace_id=workspace["workspace_id"],
                          identity=base["identity"], parent_case_ids=None, predicates=[wall]))
    assert refused.status_code == 422 and refused.json()["field"] == "predicates.0.window.timestamp_kind", refused.text


def test_comparison_save_and_reopen_keep_the_exact_window(client, tmp_path):  # noqa: F811
    workspace, base = read(client, tmp_path, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])
    selected = select(client, workspace, base, [STEP])
    assert selected["predicate_results"][0]["predicate"] == STEP
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented start window", base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": [STEP]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["revision"]["content"]["selection_recipe"]["predicates"] == [STEP]
    restored = reopened["restored_selection"]
    assert (restored["identity"], restored["kept"]["case_ids"], restored["unevaluable"]["case_ids"]) == (
        selected["identity"], EXPECTED["in_window"]["kept"], EXPECTED["in_window"]["unevaluable"])
