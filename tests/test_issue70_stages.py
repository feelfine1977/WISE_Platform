"""#70: stages of a log set by the analyst.

Against the invented tests/fixtures/stage-proposal file and its hand-written expected.json:
- the local service counts the values of a mapped context column on every raw record of each labelled activity of the
  kept incidents, with its records, incidents and missing cells, and proposes nothing on a tie;
- stages saved with an investigation are presentation, bound to the preparation they were defined for: saved with
  another reading's, or inconsistent, they are refused; reopened, they come back as saved, and stages that cannot belong
  to the reading are left out with a warning rather than applied; they change no incident, step or count.
"""

import json

import pytest

from test_import_acceptance import envelope
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)
from wise_platform_api.saving import _recovery

FIXTURES = ROOT / "tests/fixtures/stage-proposal"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
RAW = (FIXTURES / EXPECTED["file"]).read_bytes()
PHASE = EXPECTED["phase_column"]


@pytest.fixture
def opened(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def propose(client, workspace, identity, column=PHASE, limit=10):  # noqa: F811
    return client.post("/api/investigations/stage-proposal", json=envelope("stage_proposal_request", "proposal-70", 3, workspace_id=workspace["workspace_id"],
                       identity=identity, column_index=column, value_limit=limit))


def plain(activities):
    return [{"activity": item["activity"], "record_count": item["record_count"], "incident_count": item["incident_count"],
             "missing_record_count": item["missing_record_count"], "values": [[value["value"], value["record_count"]] for value in item["values"]],
             "mixed": item["mixed"], "leading": None if item["leading"] is None else [item["leading"]["value"], item["leading"]["record_count"]]}
            for item in activities]


def test_every_record_of_each_labelled_activity_counts_under_its_value(client, opened):  # noqa: F811
    workspace, base = opened
    response = propose(client, workspace, base["identity"])
    assert response.status_code == 200, response.text
    answer = response.json()
    assert (answer["request_id"], answer["query_revision"], answer["identity"]) == ("proposal-70", 3, base["identity"])
    assert answer["policy"] == "incident.stage.proposal.every_record_value_counts.v1"
    assert (answer["column_index"], answer["column_name"]) == (PHASE, "Phase")
    assert answer["kept"] == EXPECTED["every_incident"]["kept"]
    assert plain(answer["activities"]) == EXPECTED["every_incident"]["activities"]
    # The values listed and the missing cells add up to the activity's records; nothing is left over at this limit.
    for item in answer["activities"]:
        assert sum(value["record_count"] for value in item["values"]) + item["missing_record_count"] == item["record_count"]
        assert (item["values_truncated"], item["other_record_count"], item["value_count"]) == (False, 0, len(item["values"]))


def test_only_the_kept_incidents_are_counted(client, opened):  # noqa: F811
    workspace, base = opened
    kept = select(client, workspace, base, [{"kind": "contains_activity", "activity": "Work", "negate": False}])
    assert kept["kept"]["case_ids"] == EXPECTED["with_work"]["kept"]
    answer = propose(client, workspace, kept["identity"]).json()
    assert answer["identity"] == kept["identity"]
    assert plain(answer["activities"]) == EXPECTED["with_work"]["activities"]


def test_values_beyond_the_limit_are_counted_together(client, opened):  # noqa: F811
    workspace, base = opened
    assign = next(item for item in propose(client, workspace, base["identity"], limit=1).json()["activities"] if item["activity"] == "Assign")
    assert [[value["value"], value["record_count"]] for value in assign["values"]] == [["Handling", 2]]
    assert (assign["values_truncated"], assign["other_record_count"], assign["value_count"], assign["mixed"]) == (True, 2, 2, True)


def test_a_column_that_is_not_mapped_as_context_is_refused(client, opened):  # noqa: F811
    workspace, base = opened
    response = propose(client, workspace, base["identity"], column=EXPECTED["mapping"]["sequence_column"])
    assert response.status_code == 422
    assert (response.json()["code"], response.json()["field"]) == ("column_not_context", "column_index")


def stages_for(preparation_id, assignments=None):
    return {"preparation_id": preparation_id, "phase_column_index": PHASE,
            "stages": [{"id": "stage:1", "name": "Intake"}, {"id": "stage:2", "name": "Closure"}],
            "assignments": assignments if assignments is not None else [
                {"activity": "Open", "stage_id": "stage:1", "origin": {"kind": "proposed", "column_index": PHASE, "value": "Intake"}},
                {"activity": "Assign", "stage_id": "stage:1", "origin": {"kind": "manual"}},
                {"activity": "Close", "stage_id": "stage:2", "origin": {"kind": "proposed", "column_index": PHASE, "value": "Closure"}}]}


def save(client, workspace, base, answer, stages, investigation=None):  # noqa: F811
    presentation = {"active_view": "process_map", "table_sorts": [], "flow_artifact_sha256": None, "graph_positions": None,
                    **({"stages": stages} if stages is not None else {})}
    return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"],
        investigation_id=investigation and investigation[0], expected_revision_id=investigation and investigation[1], name="Invented stages",
        base_identity=base["identity"], selection_identity=answer["identity"],
        selection_recipe={"parent_case_ids": answer["parent"]["case_ids"], "predicates": []},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[], presentation_state=presentation))


def test_stages_are_saved_with_the_investigation_and_reopened_as_saved(client, opened):  # noqa: F811
    workspace, base = opened
    answer = select(client, workspace, base, [])
    stages = stages_for(base["identity"]["preparation_id"])
    saved = save(client, workspace, base, answer, stages)
    assert saved.status_code == 200, saved.text
    assert saved.json()["recovery"]["presentation_state"]["stages"] == stages
    revision = saved.json()["revision"]
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=revision["saved_revision_id"])).json()
    assert reopened["recovery"] == {"presentation_state": saved.json()["recovery"]["presentation_state"], "warnings": []}
    # Presentation only: the question, its incidents and counts are those of the same investigation without stages.
    plain_save = save(client, workspace, base, answer, None, (revision["investigation_id"], revision["saved_revision_id"])).json()
    assert plain_save["semantic_change"] is False
    assert plain_save["revision"]["content"] == revision["content"]
    assert reopened["restored_selection"]["kept"] == answer["kept"] and reopened["restored_selection"]["identity"] == answer["identity"]


@pytest.mark.parametrize("change, field", [
    (lambda stages: {**stages, "preparation_id": "preparation.v1:sha256:" + "0" * 64}, "presentation_state.stages.preparation_id"),
    (lambda stages: {**stages, "assignments": [{"activity": "Open", "stage_id": "stage:9", "origin": {"kind": "manual"}}]}, "presentation_state.stages.assignments"),
    (lambda stages: {**stages, "assignments": stages["assignments"] + [{"activity": "Open", "stage_id": "stage:2", "origin": {"kind": "manual"}}]},
     "presentation_state.stages.assignments"),
    (lambda stages: {**stages, "stages": stages["stages"] + [{"id": "stage:3", "name": "intake"}]}, "presentation_state.stages.stages"),
])
def test_stages_that_cannot_belong_to_the_reading_are_refused(client, opened, change, field):  # noqa: F811
    workspace, base = opened
    answer = select(client, workspace, base, [])
    refused = save(client, workspace, base, answer, change(stages_for(base["identity"]["preparation_id"])))
    assert refused.status_code == 400, refused.text
    assert (refused.json()["code"], refused.json()["field"]) == ("invalid_request", field)
    assert refused.json()["message"].endswith("Nothing was saved.")


def test_stages_of_another_reading_are_left_out_when_reopened_and_said_to_be():
    base = {"preparation_id": "preparation.v1:sha256:" + "1" * 64}
    stored = {"active_view": "process_map", "table_sorts": [], "flow_artifact_sha256": None, "graph_positions": None,
              "stages": stages_for("preparation.v1:sha256:" + "2" * 64)}
    recovered = _recovery(stored, base)
    assert recovered["presentation_state"] == {key: value for key, value in stored.items() if key != "stages"}
    assert [warning["code"] for warning in recovered["warnings"]] == ["stages_not_applied"]
    assert recovered["warnings"][0]["message"].startswith("The stages saved with this investigation were not applied: the stages were defined for another reading")
    # Stages of this reading come back as saved.
    assert _recovery({**stored, "stages": stages_for(base["preparation_id"])}, base)["warnings"] == []
