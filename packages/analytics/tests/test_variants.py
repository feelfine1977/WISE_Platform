"""Actual sequences of labelled activities, grouped into variants with their incidents."""

import hashlib
import json

import pytest

from literal_logs import prepared_from
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.variants import variant_id, variants

# V1 and V2 pass Assign twice; V3 once. V4 has a record without a label between Open and Close,
# so its sequence is Open, Close like V5. V6 has a record without a readable time: its order cannot
# be evaluated. V7 has only a record without a label.
LOG = [
    "Ticket;Event;At;Desk;Priority",
    "V1;Open;2026-10-01T08:00:00Z;East;P1",
    "V1;Assign;2026-10-01T09:00:00Z;East;P1",
    "V1;Assign;2026-10-01T10:00:00Z;East;P1",
    "V1;Close;2026-10-01T11:00:00Z;East;P1",
    "V2;Close;2026-10-02T11:00:00Z;East;P1",
    "V2;Assign;2026-10-02T09:00:00Z;East;P1",
    "V2;Open;2026-10-02T08:00:00Z;East;P1",
    "V2;Assign;2026-10-02T10:00:00Z;East;P1",
    "V3;Open;2026-10-03T08:00:00Z;East;P1",
    "V3;Assign;2026-10-03T09:00:00Z;East;P1",
    "V3;Close;2026-10-03T10:00:00Z;East;P1",
    "V4;Open;2026-10-04T08:00:00Z;East;P1",
    "V4;;2026-10-04T09:00:00Z;East;P1",
    "V4;Close;2026-10-04T10:00:00Z;East;P1",
    "V5;Open;2026-10-05T08:00:00Z;East;P1",
    "V5;Close;2026-10-05T10:00:00Z;East;P1",
    "V6;Open;2026-10-06T08:00:00Z;East;P1",
    "V6;;later;East;P1",
    "V6;Close;2026-10-06T10:00:00Z;East;P1",
    "V7;;2026-10-07T08:00:00Z;East;P1",
]
ALL = ["V1", "V2", "V3", "V4", "V5", "V6", "V7"]


def sha(text):
    return "variant.v1:sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def test_incidents_with_the_same_sequence_form_one_variant_including_repeated_activities():
    answer = variants(prepared_from(LOG), ALL).to_dict()
    listed = [(item["activities"], item["case_ids"]) for item in answer["variants"]]
    assert listed == [
        (["Open", "Assign", "Assign", "Close"], ["V1", "V2"]),
        (["Open", "Close"], ["V4", "V5"]),
        ([], ["V7"]),
        (["Open", "Assign", "Close"], ["V3"]),
    ]
    first = answer["variants"][0]
    assert first["case_count"] == 2
    assert first["share"] == 2 / 6
    assert first["denominator"] == 6
    assert first["record_count"] == 8
    assert first["omitted_activity_record_count"] == 0
    assert answer["variant_count"] == 4
    json.dumps(answer, allow_nan=False)


def test_records_without_a_label_are_left_out_of_the_sequence_and_counted():
    answer = variants(prepared_from(LOG), ALL).to_dict()
    open_close = answer["variants"][1]
    assert open_close["record_count"] == 5
    assert open_close["omitted_activity_record_count"] == 1
    only_unlabelled = answer["variants"][2]
    assert only_unlabelled["omitted_activity_record_count"] == 1
    # V4, V7 and the unordered V6 each have one record without a label.
    assert answer["omitted_activity_record_count"] == 3
    assert answer["record_count"] == 20


def test_an_incident_whose_order_cannot_be_evaluated_is_kept_apart_and_in_no_variant():
    answer = variants(prepared_from(LOG), ALL).to_dict()
    assert answer["unevaluable"] == {"case_ids": ["V6"], "case_count": 1, "record_count": 3,
                                     "omitted_activity_record_count": 1}
    assert all("V6" not in item["case_ids"] for item in answer["variants"])
    assert answer["case_count"] == 7
    assert answer["sequence_evaluable_case_count"] == 6
    assert sum(item["case_count"] for item in answer["variants"]) == 6


def test_identities_come_from_the_exact_labels_and_do_not_depend_on_the_incidents():
    assert variant_id(["Open", "Close"]) == sha('["Open","Close"]')
    assert variant_id([]) == sha("[]")
    # A label holding a comma is not the same as two labels.
    assert variant_id(["A,B"]) != variant_id(["A", "B"])
    assert variant_id(["Öffnen"]) == sha('["Öffnen"]')
    whole = {tuple(item["activities"]): item["id"] for item in variants(prepared_from(LOG), ALL).to_dict()["variants"]}
    part = {tuple(item["activities"]): item["id"] for item in variants(prepared_from(LOG), ["V5"]).to_dict()["variants"]}
    assert part[("Open", "Close")] == whole[("Open", "Close")] == sha('["Open","Close"]')


def test_ties_in_support_are_ranked_by_the_sequence_itself():
    lines = ["Ticket;Event;At;Desk;Priority",
             "B1;B;2026-10-01T08:00:00Z;East;P1",
             "A1;A;2026-10-01T08:00:00Z;East;P1"]
    answer = variants(prepared_from(lines), ["A1", "B1"]).to_dict()
    assert [item["activities"] for item in answer["variants"]] == [["A"], ["B"]]
    assert [item["share"] for item in answer["variants"]] == [0.5, 0.5]


def test_an_empty_population_has_no_variant_and_says_so_with_its_counts():
    answer = variants(prepared_from(LOG), []).to_dict()
    assert answer["variants"] == []
    assert answer["case_count"] == 0
    assert answer["sequence_evaluable_case_count"] == 0


def test_a_population_with_only_unordered_incidents_has_no_shares():
    answer = variants(prepared_from(LOG), ["V6"]).to_dict()
    assert answer["variants"] == []
    assert answer["unevaluable"]["case_ids"] == ["V6"]


@pytest.mark.parametrize(("population", "code"), [(["Z"], "unknown_case"), (["V1", "V1"], "invalid_parent")])
def test_cases_outside_the_dictionary_are_refused(population, code):
    refused = variants(prepared_from(LOG), population)
    assert isinstance(refused, ImportRefusal)
    assert refused.code == code
