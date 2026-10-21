"""#93: the local service supplies, for the steps of a selection, the incidents and records kept after each step.

Against tests/fixtures/span-gap/trail.json: "kept after step k" is what every step up to k keeps, in the order the steps
were taken, a false step dominating an unknown one; it ends at the selection's kept incidents. The same steps in another
order are the same selection with another trail. It is part of the selection's answer, under its request and revision,
and of a reopened saved selection.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)
from test_issue58_span_gap_list import EXPECTED, RAW

TRAIL = json.loads((ROOT / "tests/fixtures/span-gap/trail.json").read_text(encoding="utf-8"))


@pytest.fixture
def listed(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def trail(answer):
    return [result["kept_after_step"] for result in answer["predicate_results"]]


def test_each_step_says_the_incidents_and_records_kept_after_it(client, listed):  # noqa: F811
    workspace, base = listed
    answer = select(client, workspace, base, TRAIL["steps"])
    assert trail(answer) == [{"case_count": len(step["case_ids"]), "record_count": step["record_count"]} for step in TRAIL["kept_after"]]
    # After the last step, the trail is the selection's kept incidents.
    assert answer["kept"]["case_ids"] == TRAIL["kept_after"][-1]["case_ids"]
    assert (answer["kept"]["case_count"], answer["kept"]["record_count"]) == tuple(trail(answer)[-1].values())
    # Each prefix of the steps, asked as a selection of its own, keeps what the trail says it keeps after that step.
    for count, wanted in enumerate(TRAIL["kept_after"], start=1):
        prefix = select(client, workspace, base, TRAIL["steps"][:count])
        assert (prefix["kept"]["case_ids"], prefix["kept"]["record_count"]) == (wanted["case_ids"], wanted["record_count"])
    assert (answer["parent"]["case_count"], answer["parent"]["record_count"]) == (TRAIL["parent"]["case_count"], TRAIL["parent"]["record_count"])


def test_the_same_steps_in_another_order_are_the_same_selection_with_another_trail(client, listed):  # noqa: F811
    workspace, base = listed
    forward = select(client, workspace, base, TRAIL["steps"])
    backward = select(client, workspace, base, list(reversed(TRAIL["steps"])))
    assert backward["identity"] == forward["identity"]
    assert trail(backward) == TRAIL["reversed_kept_after"]


def test_the_trail_is_answered_under_the_selections_request_and_revision_and_reopens_with_it(client, listed):  # noqa: F811
    workspace, base = listed
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "trail-93", 12, workspace_id=workspace["workspace_id"],
                           identity=base["identity"], parent_case_ids=None, predicates=TRAIL["steps"]))
    answer = response.json()
    assert (answer["request_id"], answer["query_revision"]) == ("trail-93", 12)
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented trail", base_identity=base["identity"], selection_identity=answer["identity"],
        selection_recipe={"parent_case_ids": answer["parent"]["case_ids"], "predicates": TRAIL["steps"]},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert trail(reopened["restored_selection"]) == trail(answer)


def test_the_browser_trail_of_the_oracle(client, listed):  # noqa: F811
    workspace, base = listed
    browser = TRAIL["browser"]
    for count, wanted in enumerate(browser["kept_after"], start=1):
        answer = select(client, workspace, base, browser["steps"][:count])
        assert (answer["kept"]["case_ids"], answer["kept"]["record_count"]) == (wanted["case_ids"], wanted["record_count"])
        assert trail(answer)[-1] == {"case_count": len(wanted["case_ids"]), "record_count": wanted["record_count"]}


def test_no_step_has_no_trail(client, listed):  # noqa: F811
    workspace, base = listed
    assert select(client, workspace, base, [])["predicate_results"] == []
