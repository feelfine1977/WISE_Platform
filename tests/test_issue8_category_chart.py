"""#8: the categories of the first recorded observation and the membership they select, through the service.

Against the hand-written oracle of tests/fixtures/categories: the profile's values, missing apart from the text
Unknown and never replaced by a later value, a long value, an incident whose order is not known, a column fixed in the
parent; chosen values joined by OR select exactly their incidents with every later record; the any-record membership
may match overlapping values without a new aggregate; an anchor that is not supported is refused.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from test_import_acceptance import envelope, evidence, policies, population, prepare, upload
from wise_platform_api.app import create_app

FIXTURES = Path(__file__).resolve().parent / "fixtures/categories"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
ANCHOR = "incident.context.first_record_in_declared_order.v1"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def base(client, tmp_path):
    folder = tmp_path / "workspace"
    folder.mkdir()
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    source = upload(client, workspace, (FIXTURES / EXPECTED["file"]).read_bytes(), EXPECTED["file"])
    chosen = policies()
    chosen["time"]["parameters"]["snapshot_cutoff_utc"] = EXPECTED["cutoff_utc"]
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping=dict(EXPECTED["mapping"]), policies=chosen, accept_report_issues=True)
    return workspace, population(client, workspace, prepare(client, request))


def select(client, workspace, reading, predicates):
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-1", 2,
                           workspace_id=workspace["workspace_id"], identity=reading["identity"], parent_case_ids=None, predicates=predicates))
    return response


def test_the_profile_names_each_value_once_with_its_support(client, base):
    workspace, reading = base
    context = client.post("/api/investigations/opening-context", json=envelope("opening_context_request", "open-1", 3,
                          workspace_id=workspace["workspace_id"], identity=reading["identity"])).json()["opening_context"]
    assert (context["population"]["case_count"], context["population"]["evaluable_case_count"], context["population"]["unevaluable_case_ids"]) == (
        EXPECTED["parent"], EXPECTED["evaluable"], EXPECTED["unevaluable"])
    columns = {column["column_index"]: column for column in context["columns"]}
    team = EXPECTED["team"]
    counts = {(item["kind"], item["value"]): item["population"]["count"] for item in columns[team["column_index"]]["categories"]}
    assert counts == {("value", value): len(ids) for value, ids in team["values"].items()} | {("missing", None): len(team["missing"])}
    assert sum(counts.values()) == EXPECTED["evaluable"]
    (fixed,) = columns[EXPECTED["tenant"]["column_index"]]["categories"]
    assert (fixed["kind"], fixed["value"], fixed["parent"]["share"]) == ("value", EXPECTED["tenant"]["fixed"], 1)


def test_chosen_values_select_their_incidents_with_every_later_record(client, base):
    workspace, reading = base
    team = EXPECTED["team"]
    for value, ids in [*team["values"].items(), (None, team["missing"])]:
        step = {"kind": "opening_attribute_in", "column_index": team["column_index"], "values": [value], "negate": False, "anchor_policy": ANCHOR}
        assert select(client, workspace, reading, [step]).json()["kept"]["case_ids"] == ids
    chosen = {"kind": "opening_attribute_in", "column_index": team["column_index"], "values": team["chosen"]["values"], "negate": False, "anchor_policy": ANCHOR}
    selected = select(client, workspace, reading, [chosen]).json()
    assert (selected["kept"]["case_ids"], selected["unevaluable"]["case_ids"]) == (team["chosen"]["kept"], team["chosen"]["unevaluable"])
    # K-2 is kept by its missing first value; its later Service Desk is in its evidence, not in its category.
    changes = team["changes_of"]
    records = evidence(client, workspace, selected, changes["case"])["records"]
    assert [next(item["value"] for item in record["context"] if item["column_index"] == team["column_index"]) for record in records] == changes["context"]


def test_any_record_membership_may_overlap_and_an_unsupported_anchor_is_refused(client, base):
    workspace, reading = base
    team = EXPECTED["team"]
    overlap = {"kind": "record_attribute_in", "column_index": team["column_index"], "values": team["any_record_overlap"]["values"], "negate": False}
    assert select(client, workspace, reading, [overlap]).json()["kept"]["case_ids"] == team["any_record_overlap"]["kept"]
    latest = {"kind": "opening_attribute_in", "column_index": team["column_index"], "values": ["Service Desk"], "negate": False,
              "anchor_policy": "incident.context.latest_record_in_declared_order.v1"}
    refused = select(client, workspace, reading, [latest])
    assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (400, "unsupported_policy", "predicates.0.anchor_policy"), refused.text
