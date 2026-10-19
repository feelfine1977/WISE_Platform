"""#7: the first recorded observation through the service, against hand-written expectations.

On the invented explorer core file: the value at the first record in declared order, a missing one kept missing
although a later record has a value, the literal text Unknown apart from a missing value in shares and in exact
membership, an incident whose order is not known counted as unavailable, a tie at the first record counted, every
value adding up to the incidents with a readable first record, and a value kept as a step leading to whole incidents
with all their context changes. The same distinction on the packaged S3 example.
"""

import json
from pathlib import Path

import pytest

from test_explorer_core_http import reading, select  # noqa: F401  (reading is a fixture)
from test_import_acceptance import client, envelope, evidence, policies, population, prepare, upload, workspace  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = json.loads((ROOT / "tests/fixtures/selection-journey/opening-context.json").read_text(encoding="utf-8"))
ANCHOR = "incident.context.first_record_in_declared_order.v1"


def opening(client, workspace, identity):  # noqa: F811
    response = client.post("/api/investigations/opening-context", json=envelope("opening_context_request", "open-1", 3,
                           workspace_id=workspace["workspace_id"], identity=identity))
    assert response.status_code == 200, response.text
    return response.json()["opening_context"]


def kept_by(client, workspace, base, column_index, value):  # noqa: F811
    step = {"kind": "opening_attribute_equals", "column_index": column_index, "value": value, "negate": False, "anchor_policy": ANCHOR}
    return select(client, workspace, base, [step])


def test_core_first_recorded_observation_against_the_oracle(client, workspace, reading):  # noqa: F811
    core = EXPECTED["core"]
    context = opening(client, workspace, reading["identity"])
    coverage = context["population"]
    assert (coverage["case_count"], coverage["evaluable_case_count"], coverage["unevaluable_case_ids"]) == (core["incidents"], core["evaluable"], core["unevaluable"])
    assert coverage["tied_first_record_case_count"] == core["tied_first_record"]
    (column,) = context["columns"]
    assert (column["column_index"], column["column_name"]) == (core["column_index"], core["column"])
    counts = {(item["kind"], item["value"]): item["population"]["count"] for item in column["categories"]}
    expected = {("value", value): len(ids) for value, ids in core["values"].items()} | {("missing", None): len(core["missing"])}
    assert counts == expected
    # Every incident with a readable first record has exactly one value: the values add up to them.
    assert sum(counts.values()) + (column["remainder"]["population"]["count"] if column["remainder"] else 0) == core["evaluable"]
    # Kept by value: the text Unknown and a missing value are different memberships.
    for value, ids in core["values"].items():
        assert kept_by(client, workspace, reading, core["column_index"], value)["kept"]["case_ids"] == ids
    missing = kept_by(client, workspace, reading, core["column_index"], None)
    assert missing["kept"]["case_ids"] == core["missing"]
    assert missing["unevaluable"]["case_ids"] == core["unevaluable"]


def test_a_kept_value_leads_to_whole_incidents_with_all_their_context_changes(client, workspace, reading):  # noqa: F811
    core = EXPECTED["core"]
    changes = core["changes_of"]
    first = next(value for value, ids in core["values"].items() if changes["case"] in ids)
    selected = kept_by(client, workspace, reading, core["column_index"], first)
    records = evidence(client, workspace, selected, changes["case"])["records"]
    shown = [next(item["value"] for item in record["context"] if item["column_index"] == core["column_index"]) for record in records]
    assert shown == changes["context"]
    assert selected["parent"]["case_count"] == core["incidents"]


@pytest.fixture
def s3(client, workspace):  # noqa: F811
    raw = (ROOT / EXPECTED["s3"]["source"]).read_bytes()
    source = upload(client, workspace, raw, "Synthetic example S3.csv")
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping={"case_column": 0, "activity_column": 3, "timestamp_column": 4, "sequence_column": 2, "context_columns": [5, 6]},
                       policies=policies(), accept_report_issues=True)
    return population(client, workspace, prepare(client, request))


def test_s3_literal_unknown_and_missing_are_two_values(client, workspace, s3):  # noqa: F811
    expected = EXPECTED["s3"]
    column = next(item for item in opening(client, workspace, s3["identity"])["columns"] if item["column_index"] == expected["column_index"])
    assert {(item["kind"], item["value"]) for item in column["categories"]} == {("value", "Unknown"), ("missing", None)}
    for value, ids in expected["values"].items():
        assert kept_by(client, workspace, s3, expected["column_index"], value)["kept"]["case_ids"] == ids
    assert kept_by(client, workspace, s3, expected["column_index"], None)["kept"]["case_ids"] == expected["missing"]
