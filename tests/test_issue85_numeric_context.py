"""#85: numbers in a context column the analyst declared numeric, against tests/fixtures/numeric-context.

The declaration, with its unit, is part of the preparation and its identity, and is reopened with it; a mapping without
it keeps its earlier identity. Decimal points and commas are read; a cell that is not a number stays in the records
unchanged and is counted, never read as zero. The service supplies the column's range and parent-fixed bins for the
parent and the kept incidents under the first-record, latest-record and any-record projections, and a step keeps the
incidents whose projected number lies in a half-open range, the unevaluable said apart. Both clocks read alike.
"""

import json

import pytest

from test_import_acceptance import envelope, evidence, policies, population, prepare, upload
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

EXPECTED = json.loads((ROOT / "tests/fixtures/numeric-context/expected.json").read_text(encoding="utf-8"))
RAW = (ROOT / "tests/fixtures/numeric-context" / EXPECTED["file"]).read_bytes()


@pytest.fixture
def numbers(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], json.loads(json.dumps(EXPECTED["mapping"])), EXPECTED["cutoff_utc"])


def numeric(client, workspace, identity, column=5, projection="first_record", bin_count=4):  # noqa: F811
    return client.post("/api/investigations/numeric-context", json=envelope("numeric_context_request", "numbers-85", 4, workspace_id=workspace["workspace_id"],
                       identity=identity, column_index=column, projection=projection, bin_count=bin_count))


def answer_of(client, workspace, identity, **options):  # noqa: F811
    response = numeric(client, workspace, identity, **options)
    assert response.status_code == 200, response.text
    return response.json()


def step(oracle):
    return {"kind": "context_number_in_range", "column_index": oracle["column"], "projection": oracle["projection"],
            "minimum": oracle["minimum"], "maximum": oracle["maximum"], "negate": oracle["negate"]}


def test_the_declaration_is_part_of_the_preparation_and_a_mapping_without_it_keeps_its_identity(client, numbers, tmp_path):  # noqa: F811
    workspace, base = numbers
    assert base["preparation"]["mapping"]["numeric_context_columns"] == EXPECTED["mapping"]["numeric_context_columns"]
    without = {key: value for key, value in EXPECTED["mapping"].items() if key != "numeric_context_columns"}
    (tmp_path / "plain").mkdir()
    _, plain = read(client, tmp_path / "plain", RAW, EXPECTED["file"], without, EXPECTED["cutoff_utc"])
    assert "numeric_context_columns" not in plain["preparation"]["mapping"]
    assert plain["identity"]["preparation_id"] != base["identity"]["preparation_id"]
    # The cells are kept as they were written: a comma, outer spaces and text that is not a number alike.
    cells = lambda case: [record["original_cells"][5] for record in evidence(client, workspace, base, case)["records"]]  # noqa: E731
    assert (cells("N-2"), cells("N-6"), cells("N-3")) == (["0,85", "0.95"], [" 0.75 ", "1e3"], ["high", "0.6"])


@pytest.mark.parametrize("change", [
    [{"column_index": 4, "unit": None}, {"column_index": 4, "unit": "EUR"}],
    [{"column_index": 1, "unit": None}],
    [{"column_index": 5, "unit": " kg"}],
    [],
])
def test_a_declaration_that_is_not_one_is_refused(client, tmp_path, change):  # noqa: F811
    folder = tmp_path / "refused"
    folder.mkdir()
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    source = upload(client, workspace, RAW, EXPECTED["file"])
    chosen = policies()
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping={**EXPECTED["mapping"], "numeric_context_columns": change}, policies=chosen, accept_report_issues=True)
    response = client.post("/api/preparations", json=request)
    assert response.status_code >= 400 and "numeric_context_columns" in (response.json().get("field") or ""), response.text


@pytest.mark.parametrize("projection", ["first_record", "latest_record"])
def test_each_projection_reads_the_numbers_of_the_oracle(client, numbers, projection):  # noqa: F811
    workspace, base = numbers
    oracle = EXPECTED["confidence"]
    for case, value in oracle[projection].items():
        kept = select(client, workspace, base, [{"kind": "context_number_in_range", "column_index": 5, "projection": projection, "minimum": value, "maximum": value + 1e-9, "negate": False}])
        assert case in kept["kept"]["case_ids"], (projection, case, value)
    everyone = select(client, workspace, base, [{"kind": "context_number_in_range", "column_index": 5, "projection": projection, "minimum": -1e9, "maximum": None, "negate": False}])
    assert everyone["kept"]["case_ids"] == sorted(oracle[projection])
    assert everyone["unevaluable"]["case_ids"] == sorted(oracle[projection + "_unavailable"])


def test_the_distribution_has_parent_fixed_bins_and_counts_what_has_no_number_by_reason(client, numbers):  # noqa: F811
    workspace, base = numbers
    oracle = EXPECTED["confidence"]
    answer = answer_of(client, workspace, base["identity"])
    assert (answer["column_name"], answer["unit"], answer["projection"], answer["membership_overlaps"]) == ("Confidence", None, "first_record", False)
    bins = oracle["first_record_bins_4"]
    assert [answer["parent_range"]["minimum"], answer["parent_range"]["maximum"]] == bins["parent_range"]
    assert [item["parent_case_count"] for item in answer["bins"]] == bins["parent"]
    assert answer["bins"][-1]["end_exclusive"] is None and answer["bins"][0]["start_inclusive"] == bins["parent_range"][0]
    assert {item["reason"]: item["case_count"] for item in answer["parent"]["unavailable"]} == bins["unavailable"]
    assert answer["parent"]["records"] == oracle["records"]
    # The kept incidents of a step are counted in the same bins; the bins stay those of the parent.
    selection = select(client, workspace, base, [step(EXPECTED["ranges"][0])])
    kept = answer_of(client, workspace, selection["identity"])
    assert [item["start_inclusive"] for item in kept["bins"]] == [item["start_inclusive"] for item in answer["bins"]]
    assert [item["parent_case_count"] for item in kept["bins"]] == bins["parent"]
    assert sum(item["kept_case_count"] for item in kept["bins"]) == len(EXPECTED["ranges"][0]["kept"])
    any_record = answer_of(client, workspace, base["identity"], projection="any_record")
    assert any_record["membership_overlaps"] is True
    assert [any_record["parent_range"]["minimum"], any_record["parent_range"]["maximum"]] == oracle["any_record_range"]
    # Under any record an incident counts in each bin one of its numbers falls into, so the bins may hold more than the incidents.
    assert sum(item["parent_case_count"] for item in any_record["bins"]) >= any_record["parent"]["measured_case_count"]


def test_a_unit_and_numbers_with_a_comma_a_sign_and_text_that_is_no_number(client, numbers):  # noqa: F811
    workspace, base = numbers
    amount = answer_of(client, workspace, base["identity"], column=6)
    assert (amount["unit"], amount["parent"]["records"]) == (EXPECTED["amount"]["unit"], EXPECTED["amount"]["records"])
    for case, value in EXPECTED["amount"]["first_record"].items():
        kept = select(client, workspace, base, [{"kind": "context_number_in_range", "column_index": 6, "projection": "first_record", "minimum": value, "maximum": value + 1e-9, "negate": False}])
        assert kept["kept"]["case_ids"] == [case], (case, value)


@pytest.mark.parametrize("oracle", EXPECTED["ranges"], ids=[oracle["name"] for oracle in EXPECTED["ranges"]])
def test_a_half_open_range_keeps_the_oracles_incidents_and_says_the_unevaluable(client, numbers, oracle):  # noqa: F811
    workspace, base = numbers
    answer = select(client, workspace, base, [step(oracle)])
    assert (answer["kept"]["case_ids"], answer["removed"]["case_ids"], answer["unevaluable"]["case_ids"]) == (oracle["kept"], oracle["removed"], oracle["unevaluable"])
    assert answer["predicate_results"][0]["predicate"] == step(oracle)


@pytest.mark.parametrize(("change", "field"), [
    ({"column_index": 4}, "predicates.0.column_index"),
    ({"minimum": None, "maximum": None}, "predicates.0"),
    ({"minimum": 0.9, "maximum": 0.8}, "predicates.0"),
    ({"projection": "last"}, "predicates.0"),
])
def test_a_range_that_is_not_one_or_a_column_not_declared_numeric_is_refused(client, numbers, change, field):  # noqa: F811
    workspace, base = numbers
    response = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", "select-85", 2, workspace_id=workspace["workspace_id"],
                           identity=base["identity"], parent_case_ids=None, predicates=[{**step(EXPECTED["ranges"][0]), **change}]))
    assert response.status_code in (400, 422) and response.json()["field"].startswith(field), response.text
    refused = numeric(client, workspace, base["identity"], column=4)
    assert (refused.status_code, refused.json()["code"], refused.json()["field"]) == (422, "column_not_numeric", "column_index")


def test_the_wall_clock_reads_the_same_numbers(client, tmp_path):  # noqa: F811
    folder = tmp_path / "wall"
    folder.mkdir()
    workspace = client.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(folder))).json()
    raw = RAW.replace(b"Z,", b",")
    source = upload(client, workspace, raw, EXPECTED["file"])
    request = envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping=EXPECTED["mapping"], policies=policies(wall=True), accept_report_issues=True)
    base = population(client, workspace, prepare(client, request))
    for oracle in EXPECTED["ranges"]:
        answer = select(client, workspace, base, [step(oracle)])
        assert (answer["kept"]["case_ids"], answer["unevaluable"]["case_ids"]) == (oracle["kept"], oracle["unevaluable"]), oracle["name"]


def test_a_saved_range_reopens_with_its_definition(client, numbers):  # noqa: F811
    workspace, base = numbers
    steps = [step(EXPECTED["ranges"][1])]
    selected = select(client, workspace, base, steps)
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=workspace["workspace_id"], investigation_id=None,
        expected_revision_id=None, name="Invented confidence", base_identity=base["identity"], selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": steps},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes="", bookmarks=[]))
    assert saved.status_code == 200, saved.text
    reopened = client.post("/api/investigations/reopen", json=envelope("reopen_investigation_request", workspace_id=workspace["workspace_id"],
                           saved_revision_id=saved.json()["revision"]["saved_revision_id"])).json()
    assert reopened["restored_selection"]["kept"]["case_ids"] == EXPECTED["ranges"][1]["kept"]
    assert reopened["revision"]["content"]["selection_recipe"]["predicates"] == steps
