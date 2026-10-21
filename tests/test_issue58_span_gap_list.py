"""#58: the kept incidents listed by recorded span, longest gap, record count or first record, against a hand-written oracle.

tests/fixtures/span-gap holds one-record, tied, all-tied, unlabelled, equal-span, long and unknown-order incidents with two
invented context columns. Each row supplies its first and last records, its span, its longest gap with its two records,
their activities, its offset and its share; the context of the gap is that of the chosen context columns only. Sorting
puts equal values in incident order and unavailable values last either way round; the search narrows only the rows. The
answer binds the whole identity and revision; another source's or preparation's identity is refused.
"""

import json

import pytest

from test_import_acceptance import envelope, evidence, policies, population, prepare, upload
from test_issue10_interval_tail import ROOT, client, read, select  # noqa: F401  (client is a fixture)

EXPECTED = json.loads((ROOT / "tests/fixtures/span-gap/expected.json").read_text(encoding="utf-8"))
RAW = (ROOT / "tests/fixtures/span-gap" / EXPECTED["file"]).read_bytes()


@pytest.fixture
def listed(client, tmp_path):  # noqa: F811
    return read(client, tmp_path, RAW, EXPECTED["file"], dict(EXPECTED["mapping"]), EXPECTED["cutoff_utc"])


def ask(client, workspace, identity, field="observed_span_hours", direction="descending", search=None, offset=0, limit=200, revision=5,
        distribution=None):  # noqa: F811
    query = {"search_text": search, "sort": {"field": field, "direction": direction}, "offset": offset, "limit": limit}
    if distribution is not None:
        query["distribution"] = distribution
    return client.post("/api/investigations/case-list", json=envelope("case_list_request", "list-58", revision, workspace_id=workspace["workspace_id"],
                       identity=identity, query=query))


def answer_of(client, workspace, identity, **options):  # noqa: F811
    response = ask(client, workspace, identity, **options)
    assert response.status_code == 200, response.text
    return response.json()


def test_each_row_supplies_first_and_last_records_span_gap_its_two_records_offset_and_share(client, listed):  # noqa: F811
    workspace, base = listed
    rows = {row["case_id"]: row for row in answer_of(client, workspace, base["identity"])["rows"]}
    available = {case: row["time_summary"] for case, row in rows.items() if row["time_summary"]["status"] == "available"}
    assert {case: time["observed_span_hours"] for case, time in available.items()} == EXPECTED["spans"]
    assert {case: time["maximum_adjacent_raw_gap_hours"] for case, time in available.items() if time["maximum_adjacent_raw_gap_hours"] is not None} == EXPECTED["gaps"]
    for case, oracle in EXPECTED["witnesses"].items():
        witness = available[case]["maximum_gap_witness"]
        # The two records of the gap are named by their row ids; their places in the declared order are the oracle's.
        places = {record["row_id"]: place for place, record in enumerate(evidence(client, workspace, base, case)["records"], start=1)}
        assert (places[witness["from_row_id"]], places[witness["to_row_id"]]) == (oracle["from_position"], oracle["to_position"]), case
        assert (witness["from_activity"], witness["to_activity"], witness["from_offset_hours"]) == (oracle["from_activity"], oracle["to_activity"], oracle["from_offset_hours"]), case
        assert witness["share_of_observed_span"] == pytest.approx(oracle["share"]) if oracle["share"] is not None else witness["share_of_observed_span"] is None, case
    assert available["S-ALLTIE"]["maximum_gap_witness"]["share_unavailable_reason"] == "zero_observed_span"
    for case, oracle in EXPECTED["first_last"].items():
        time = available[case]
        assert (time["first_recorded_timestamp"], time["first_recorded_activity"], time["last_recorded_timestamp"], time["last_recorded_activity"]) == (
            oracle["first"], oracle["first_activity"], oracle["last"], oracle["last_activity"])


def test_one_record_spans_zero_without_a_gap_tied_times_are_zero_gaps_and_unlabelled_records_take_part(client, listed):  # noqa: F811
    workspace, base = listed
    rows = {row["case_id"]: row for row in answer_of(client, workspace, base["identity"])["rows"]}
    for case in EXPECTED["one_record"]:
        time = rows[case]["time_summary"]
        assert (time["observed_span_hours"], time["maximum_adjacent_raw_gap_hours"], time["maximum_adjacent_raw_gap_unavailable_reason"], time["maximum_gap_witness"]) == (
            0, None, "fewer_than_two_records", None)
        assert rows[case]["maximum_gap_context"] is None
    assert {case: rows[case]["time_summary"]["tied_timestamp_group_count"] for case in EXPECTED["tied_groups"]} == EXPECTED["tied_groups"]
    assert rows["S-ALLTIE"]["time_summary"]["maximum_adjacent_raw_gap_hours"] == 0
    for case, counts in EXPECTED["unlabelled"].items():
        assert {name: rows[case][name] for name in counts} == counts
    for case in EXPECTED["unknown_order"]:
        assert rows[case]["time_summary"]["status"] == "unavailable" and rows[case]["time_summary"]["reason"] == "order_unknown"
        assert rows[case]["maximum_gap_context"] is None


def test_the_context_of_a_gap_is_that_of_the_chosen_context_columns_only(client, listed):  # noqa: F811
    workspace, base = listed
    answer = answer_of(client, workspace, base["identity"])
    assert [column["name"] for column in answer["context_columns"]] == EXPECTED["context_names"]
    assert [column["column_index"] for column in answer["context_columns"]] == EXPECTED["mapping"]["context_columns"]
    row = next(row for row in answer["rows"] if row["case_id"] == "S-UNLAB")
    columns = EXPECTED["mapping"]["context_columns"]
    values = {side: {item["column_index"]: item["value"] for item in row["maximum_gap_context"][side + "_context"]} for side in ("from", "to")}
    assert {side: [values[side][column] for column in columns] for side in values} == EXPECTED["gap_context"]["S-UNLAB"]
    # Nothing but the chosen columns: no sender or recipient field of its own.
    assert all(set(values[side]) == set(columns) for side in values)


@pytest.mark.parametrize("order", sorted(EXPECTED["orders"]))
def test_equal_values_stand_in_incident_order_and_unavailable_values_last_either_way(client, listed, order):  # noqa: F811
    workspace, base = listed
    field, direction = order.split()
    rows = answer_of(client, workspace, base["identity"], field=field, direction=direction)["rows"]
    assert [row["case_id"] for row in rows] == EXPECTED["orders"][order]


def test_pages_follow_the_order_without_a_gap_or_a_repeat(client, listed):  # noqa: F811
    workspace, base = listed
    pages, offset = [], 0
    while offset is not None:
        answer = answer_of(client, workspace, base["identity"], field="maximum_adjacent_raw_gap_hours", offset=offset, limit=3)
        pages.extend(row["case_id"] for row in answer["rows"])
        offset = answer["next_offset"]
    assert pages == EXPECTED["orders"]["maximum_adjacent_raw_gap_hours descending"]


def test_the_search_narrows_only_the_rows_shown(client, listed):  # noqa: F811
    workspace, base = listed
    whole = answer_of(client, workspace, base["identity"])
    found = answer_of(client, workspace, base["identity"], search=EXPECTED["search"]["text"])
    assert [row["case_id"] for row in found["rows"]] == EXPECTED["search"]["span_descending"]
    assert found["total_matching_case_count"] == len(EXPECTED["search"]["span_descending"])
    # The population, its counts and its distribution are those of every kept incident.
    for name in ("identity", "parent_identity", "population_case_count", "population_record_count", "distribution", "parent_time_range"):
        assert found[name] == whole[name], name


def test_span_bins_are_fixed_by_the_parent_and_say_what_is_unavailable(client, listed):  # noqa: F811
    workspace, base = listed
    span = answer_of(client, workspace, base["identity"])["distribution"]
    assert [item["parent_case_count"] for item in span["bins"]] == EXPECTED["span_bins_default"]
    assert {name: span["unavailable"]["parent_" + name] for name in EXPECTED["span_unavailable"]} == EXPECTED["span_unavailable"]
    gap = answer_of(client, workspace, base["identity"], distribution={"measure": "maximum_adjacent_raw_gap_hours", "edges_hours": [0, 1, 24, 168, 720, 2160]})["distribution"]
    assert [item["parent_case_count"] for item in gap["bins"]] == EXPECTED["gap_bins_default"]
    assert {name: gap["unavailable"]["parent_" + name] for name in EXPECTED["gap_unavailable"]} == EXPECTED["gap_unavailable"]
    selection = select(client, workspace, base, [{"kind": "observed_span_at_least", "hours": 5, "negate": False}])
    assert selection["kept"]["case_ids"] == EXPECTED["kept_span_at_least_5"]["case_ids"]
    kept = answer_of(client, workspace, selection["identity"])
    assert sorted(row["case_id"] for row in kept["rows"]) == EXPECTED["kept_span_at_least_5"]["case_ids"]
    # The bins are the parent's, with the same edges and the same parent counts; the kept counts are within them.
    assert [item["parent_case_count"] for item in kept["distribution"]["bins"]] == EXPECTED["span_bins_default"]
    assert [item["kept_case_count"] for item in kept["distribution"]["bins"]] == EXPECTED["kept_span_at_least_5"]["span_bins_kept"]
    assert kept["distribution"]["parent_case_count"] == len(EXPECTED["orders"]["observed_span_hours descending"])
    assert {name: value for name, value in kept["parent_identity"].items() if name != "population_id"} == {
        name: value for name, value in base["identity"].items() if name != "population_id"}


def reprepared(client, workspace, raw, mapping, filename):  # noqa: F811
    """The source given (uploaded again if it is new) prepared with the mapping given, in the same workspace."""
    source = upload(client, workspace, raw, filename, request_id="upload-58", revision=7)
    chosen = policies()
    chosen["time"]["parameters"]["snapshot_cutoff_utc"] = EXPECTED["cutoff_utc"]
    request = envelope("confirm_mapping_request", "prepare-58", 7, workspace_id=workspace["workspace_id"], source_id=source["source_id"],
                       dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
                       mapping=mapping, policies=chosen, accept_report_issues=True)
    return population(client, workspace, prepare(client, request), revision=7)


def test_the_answer_binds_the_whole_identity_and_revision_and_a_replaced_source_or_preparation_is_refused(client, listed):  # noqa: F811
    workspace, base = listed
    selection = select(client, workspace, base, [{"kind": "observed_span_at_least", "hours": 5, "negate": False}])
    answer = answer_of(client, workspace, selection["identity"], revision=9)
    assert (answer["request_id"], answer["query_revision"], answer["workspace_id"], answer["identity"]) == ("list-58", 9, workspace["workspace_id"], selection["identity"])
    # The same source confirmed again with other context columns is another preparation: the selection does not belong to it.
    other = reprepared(client, workspace, RAW, {**EXPECTED["mapping"], "context_columns": [4]}, EXPECTED["file"])
    assert other["identity"]["preparation_id"] != base["identity"]["preparation_id"]
    stale = ask(client, workspace, {**selection["identity"], "preparation_id": other["identity"]["preparation_id"]})
    assert stale.status_code >= 400 and stale.json()["field"].startswith("identity."), stale.text
    # A replaced source (one more record) is another source: neither its identity nor its preparation answers for the old one.
    replaced = reprepared(client, workspace, RAW + b"S-NEW,Opened,2026-05-11T08:00:00Z,1,East,Ann\n", dict(EXPECTED["mapping"]), "span-gap-2.csv")
    assert replaced["identity"]["source_id"] != base["identity"]["source_id"]
    for name in ("source_id", "preparation_id"):
        refused = ask(client, workspace, {**selection["identity"], name: replaced["identity"][name]})
        assert refused.status_code >= 400 and refused.json()["field"].startswith("identity."), (name, refused.text)
        assert refused.json()["message_type"] == "case_list_refusal"
    # The old selection itself still answers exactly as before: nothing of it was replaced.
    assert answer_of(client, workspace, selection["identity"], revision=9)["rows"] == answer["rows"]
    unknown = ask(client, workspace, {**selection["identity"], "population_id": base["identity"]["population_id"][:-8] + "00000000"})
    assert unknown.status_code >= 400 and unknown.json()["field"] == "identity.population_id", unknown.text
