"""Independent literal case/record/document witnesses for the beginning BPIC19 journey."""

import csv
import io
from dataclasses import replace

from wise_platform_analytics.bpic19_profiles import profile_bpic19, suggested_roles
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.selection import CaseIdIn, select_cases
from test_csv_preparation_core import ready, choices

HEADERS = ["case_id", "activity", "time", "case Item Category", "case Item Type", "case Goods Receipt",
           "case GR-Based Inv. Verif.", "case Purchasing Document", "case Item", "case concept:name"]
ROLES = {"item_category": 3, "item_type": 4, "goods_receipt": 5, "gr_based_iv": 6,
         "purchasing_document": 7, "item": 8, "source_case": 9}


def source():
    rows = [
        ["D1_1", "Record Invoice Receipt", "2018-01-02T00:00:00", "3-way match, invoice after GR", "Service", "true", "true", "D1", "1", "D1_1"],
        ["D1_1", "Record Goods Receipt", "2018-01-03T00:00:00", "3-way match, invoice after GR", "Service", "true", "true", "D1", "1", "D1_1"],
        ["D1_2", "Create Purchase Order Item", "2018-01-01T00:00:00", "3-way match, invoice before GR", "Standard", "true", "false", "D1", "2", "D1_2"],
        ["D1_2", "Record Goods Receipt", "2018-01-04T00:00:00", "3-way match, invoice before GR", "Standard", "true", "false", "D1", "2", "D1_2"],
        ["D2_1", "Record Goods Receipt", "", "Consignment", "Consignment", "true", "false", "D2", "1", "D2_1"],
        ["D3_1", "Record Invoice Receipt", "2018-01-01T00:00:00", "2-way match", "Limit", "false", "false", "D3", "1", "D3_1"],
        ["M_1", "Observed", "2018-01-01T00:00:00", "", "Standard", "true", "false", "M", "1", "M_1"],
        ["C_1", "Observed", "2018-01-01T00:00:00", "3-way match, invoice after GR", "Standard", "true", "true", "C", "1", "C_1"],
        ["C_1", "Observed", "bad time", "3-way match, invoice before GR", "Standard", "true", "true", "C", "1", "C_1"],
        ["U_1", "Observed", "2018-01-01T00:00:00", "Unknown", "Standard", "true", "false", "U", "1", "U_1"],
        ["F_1", "Observed", "2018-01-01T00:00:00", "3-way match, invoice before GR", "Standard", "true", "true", "F", "1", "F_1"],
        ["B_1", "Observed", "2018-01-01T00:00:00", "3-way match, invoice before GR", "Standard", "", "false", "B", "1", "B_1"],
        ["G_1", "Observed", "2018-01-01T00:00:00", "3-way match, invoice before GR", "Standard", "true", "false", "G", "1", "G_1"],
        ["G_1", "Observed", "2018-01-02T00:00:00", "3-way match, invoice before GR", "Standard", "true", "false", "Other", "1", "G_1"],
    ]
    stream = io.StringIO(); writer = csv.writer(stream); writer.writerow(HEADERS); writer.writerows(rows)
    return stream.getvalue().encode()


def prepared():
    return ready(source(), delimiter=",", policies=choices("wall", "iso8601"),
                 mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": list(range(3,10))})


def keyed(rows, key): return {r[key]: r for r in rows}


def test_literal_four_flows_partition_and_flags_are_separate_from_order_and_missing_clock():
    p = prepared(); answer = profile_bpic19(p, ROLES)
    assert answer["population"] == {"case_count": 10, "record_count": 14, "document_count": 8, "document_unknown_case_count": 1}
    flows = keyed(answer["flows"], "flow_id")
    assert flows["after_gr"]["case_ids"] == ["D1_1"]  # observed invoice-first is still configured after-GR
    assert flows["before_gr"]["case_ids"] == ["B_1", "D1_2", "F_1", "G_1"]
    assert flows["consignment"]["case_ids"] == ["D2_1"]
    assert flows["two_way"]["case_ids"] == ["D3_1"]
    assert not p.sequence_evaluable("D2_1") and flows["consignment"]["record_count"] == 1
    assert keyed(answer["unresolved"], "state")["missing"]["case_ids"] == ["M_1"]
    assert keyed(answer["unresolved"], "state")["conflicting"]["case_ids"] == ["C_1"]
    assert keyed(answer["unresolved"], "state")["unrecognized"]["case_ids"] == ["U_1"]
    checks = keyed(answer["cross_checks"], "state")
    assert checks["flag_disagreement"]["case_ids"] == ["F_1"]
    assert checks["unavailable"]["case_ids"] == ["B_1", "C_1", "M_1", "U_1"]
    assert answer["partition"] == {"classified_case_count": 7, "unresolved_case_count": 3, "is_disjoint": True, "covers_parent": True}
    assert answer["grain"]["mixed_flow_document_count"] == 1
    assert answer["grain"]["mixed_flow_document_examples"] == [{"document": "D1", "flow_ids": ["after_gr", "before_gr"], "case_ids": ["D1_1", "D1_2"]}]
    assert keyed(answer["grain"]["identity_issues"], "state")["conflicting_document_or_item"]["case_ids"] == ["G_1"]


def test_attribute_values_have_original_record_support_overlapping_case_support_and_literal_unknown():
    answer = profile_bpic19(prepared(), ROLES); category = keyed(answer["attributes"], "column_index")[3]
    assert category["invariant_case_count"] == 8 and category["missing_case_count"] == 1 and category["conflicting_case_count"] == 1
    assert category["invariant_document_count"] == 5 and category["missing_document_count"] == 1 and category["conflicting_document_count"] == 2
    assert category["value_membership_overlaps"]
    values = keyed(category["values"], "value")
    assert values["3-way match, invoice before GR"]["record_count"] == 7
    assert values["3-way match, invoice before GR"]["case_count"] == 5
    assert values[None]["case_count"] == 1 and values["Unknown"]["case_count"] == 1
    cell = next(c for c in answer["flow_item_types"] if c["flow_id"] == "before_gr")
    assert cell["item_type_value"] == "Standard" and cell["case_ids"] == ["B_1", "D1_2", "F_1", "G_1"]
    assert cell["record_count"] == 6


def test_kept_flow_uses_existing_complete_case_selection_and_definition_tracks_parent():
    p = prepared(); answer = profile_bpic19(p, ROLES)
    selected = select_cases(p, [CaseIdIn(("D1_1",), False)])
    assert selected.kept.case_ids == ("D1_1",) and selected.kept.record_count == 2
    child = profile_bpic19(p, ROLES, selected.kept.case_ids)
    assert child["population"]["case_count"] == 1 and child["grain"]["mixed_flow_document_count"] == 0
    assert child["definition_id"] != answer["definition_id"]
    changed_order = replace(p, histories={key: tuple(reversed(rows)) for key,rows in p.histories.items()})
    assert profile_bpic19(changed_order, ROLES) == answer


def test_role_suggestions_are_exact_reviewable_and_invalid_bindings_refuse():
    assert suggested_roles(HEADERS) == ROLES
    assert suggested_roles(["source__"+name if name.startswith("case ") else name for name in HEADERS]) == ROLES
    assert suggested_roles(HEADERS+["case Item Category"])["item_category"] is None
    bad = profile_bpic19(prepared(), {**ROLES, "item_type": True})
    assert isinstance(bad, ImportRefusal) and bad.field == "query.roles.item_type"
    duplicate = profile_bpic19(prepared(), {**ROLES, "item_type": 3})
    assert isinstance(duplicate, ImportRefusal)
    unknown = profile_bpic19(prepared(), ROLES, ["not-a-source-case"])
    assert isinstance(unknown, ImportRefusal) and unknown.code == "unknown_case"


def test_missing_and_changing_subtypes_and_duplicate_compound_ids_keep_explicit_support():
    raw = ('case_id,activity,time,case Item Category,case Item Type,case Goods Receipt,case GR-Based Inv. Verif.,case Purchasing Document,case Item,case concept:name\n'
           'X,Observed,2018-01-01T00:00:00,"3-way match, invoice after GR",Service,true,true,D,1,D_1\n'
           'X,Observed,2018-01-02T00:00:00,"3-way match, invoice after GR",Standard,true,true,D,1,D_1\n'
           'Y,Observed,2018-01-01T00:00:00,"3-way match, invoice after GR",,true,true,D,1,D_1\n'
           'Z,Observed,2018-01-01T00:00:00,"3-way match, invoice before GR",Standard,true,false,E,1,wrong\n').encode()
    p = ready(raw, delimiter=",", policies=choices("wall", "iso8601"),
              mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": []})
    a = profile_bpic19(p, ROLES)
    assert [(c["item_type_state"], c["case_ids"]) for c in a["flow_item_types"] if c["flow_id"] == "after_gr"] == [("conflicting", ["X"]), ("missing", ["Y"])]
    issues = keyed(a["grain"]["identity_issues"], "state")
    assert issues["duplicate_document_item"]["case_ids"] == ["X", "Y"]
    assert issues["source_case_mismatch"]["case_ids"] == ["Z"]
    assert keyed(a["cross_checks"], "state")["unavailable"]["case_ids"] == ["X", "Y"]
    assert a["partition"]["classified_case_count"] == 3


def h7_prepared():
    rows = [
        ["A", "Vendor creates invoice", "1948-01-01T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "D", "1", "A"],
        ["A", "Create Purchase Order Item", "2018-01-01T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "D", "1", "A"],
        ["A", "Clear Invoice", "2020-01-02T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "D", "1", "A"],
        ["B", "Create Purchase Order Item", "2018-01-02T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "D", "2", "B"],
        ["B", "Record Goods Receipt", "2018-01-03T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "D", "2", "B"],
        ["C", "Create Purchase Order Item", "2018-01-02T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "E", "1", "C"],
        ["C", "Clear Invoice", "2018-01-04T00:00:00Z", "3-way match, invoice before GR", "Standard", "true", "false", "E", "1", "C"],
    ]
    stream = io.StringIO(); writer = csv.writer(stream); writer.writerow(HEADERS); writer.writerows(rows)
    return ready(stream.getvalue().encode(), delimiter=",", policies=choices("recorded", "iso8601"),
                 mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": list(range(3,10))})


def source_definition(kind="all_source", *, clock="utc_instant", horizon=None, provenance=None):
    return {"profile_name": "Independent synthetic source review", "policy_id": "bpic19.raw_source_interpretation.v1",
            "inclusion": {"kind": kind, "timestamp_kind": clock,
                "start_inclusive": None if kind == "all_source" else "2018-01-01T00:00:00" + ("Z" if clock == "utc_instant" else ""),
                "end_exclusive": "2019-01-01T00:00:00" + ("Z" if clock == "utc_instant" else "") if kind == "record_projection" else None},
            "horizon": {"timestamp_kind": clock, "value": horizon, "provenance": provenance},
            "discrepancies": [{"reference": "Synthetic report claim: reported all cases versus category table", "reported_total": 251734, "reported_subtotal": 251347}]}


def test_h7_whole_document_whole_item_and_named_record_projection_are_distinct_without_raw_trimming():
    p = h7_prepared()
    document = profile_bpic19(p, ROLES, source_interpretation=source_definition("document_start"))
    item = profile_bpic19(p, ROLES, source_interpretation=source_definition("item_start"))
    projected = profile_bpic19(p, ROLES, source_interpretation=source_definition("record_projection"))
    d = document["source_review"]; i = item["source_review"]; r = projected["source_review"]
    assert d["retained"]["case_ids"] == ["C"] and d["excluded"]["case_ids"] == ["A", "B"]
    assert (d["retained"]["record_count"], d["excluded"]["record_count"], d["retained"]["document_count"]) == (2, 5, 1)
    assert i["retained"]["case_ids"] == ["B", "C"] and i["excluded"]["case_ids"] == ["A"]
    assert (i["retained"]["record_count"], i["excluded"]["record_count"], i["retained"]["document_count"], i["excluded"]["document_count"]) == (4, 3, 2, 1)
    assert r["projection"]["record_count"] == 5 and r["projection"]["case_ids"] == ["A", "B", "C"]
    assert set(r["projection"]["row_ids"]) == {row.row_id for row in p.records if row.source_position in {1, 3, 4, 5, 6}}
    assert r["projection"]["raw_histories_preserved"] and len(p.histories["A"]) == 3
    assert len({document["definition_id"], item["definition_id"], projected["definition_id"]}) == 3
    assert all(answer["population"]["record_count"] == 7 for answer in (document, item, projected))
    sibling = next(e for e in d["inclusion_evidence"] if e["case_id"] == "B")
    assert sibling["witness_case_ids"] == ["A"] and sibling["row_ids"] == [p.records[0].row_id]


def test_h7_horizon_is_reviewed_overlay_and_claim_discrepancy_never_rewrites_population():
    p = h7_prepared(); definition = source_definition(horizon="2019-01-28T00:00:00Z", provenance="Synthetic authoritative extraction contract")
    answer = profile_bpic19(p, ROLES, source_interpretation=definition); review = answer["source_review"]
    assert review["horizon_state"] == "reviewed" and review["interpretation"]["horizon"]["value"] == "2019-01-28T00:00:00Z"
    assert review["observed_raw_maximum"] == "2020-01-02T00:00:00Z" and review["parser_cutoff"] == "2027-01-01T00:00:00Z"
    assert review["retained"]["case_ids"] == ["A", "B", "C"] and review["raw_support"]["record_count"] == 7
    anomalies = keyed(review["anomalies"], "state")
    assert anomalies["after_trusted_horizon"]["witnesses"][0]["row_id"] == p.records[2].row_id
    assert anomalies["before_reference_2017"]["witnesses"][0]["raw_timestamp"] == "1948-01-01T00:00:00Z"
    assert review["discrepancies"][0]["difference"] == 387 and review["discrepancies"][0]["measured_parent_case_count"] == 3
    unknown = profile_bpic19(p, ROLES)["source_review"]
    assert unknown["horizon_state"] == "unknown" and unknown["due_assessment"] == "unavailable"
    assert unknown["due_assessment_reason"] == "observation_horizon_unknown"
    changed = source_definition(horizon="2019-01-28T00:00:00Z", provenance="A different reviewed contract")
    assert profile_bpic19(p, ROLES, source_interpretation=changed)["definition_id"] != answer["definition_id"]
    assert definition["horizon"]["value"] == "2019-01-28T00:00:00Z"  # input definition was not mutated


def test_document_policy_keeps_conflicting_relation_local_and_never_uses_first_nonempty():
    p = prepared(); answer = profile_bpic19(p, ROLES, source_interpretation=source_definition("document_start", clock="wall_clock"))
    review = answer["source_review"]
    assert review["unavailable"]["case_ids"] == ["C_1", "D2_1", "G_1"]
    assert review["raw_support"]["case_count"] == 10 and review["raw_support"]["record_count"] == 14
    assert next(row for row in review["inclusion_evidence"] if row["case_id"] == "G_1")["reason"] == "document_relation_missing_or_conflicting"
    field = keyed(answer["attributes"], "column_index")[7]
    witness = field["conflicting_witnesses"][0]
    assert witness["case_id"] == "G_1" and [r["value"] for r in witness["rows"]] == ["G", "Other"]


def test_reviewed_clock_requires_matching_kind_explicit_offset_and_horizon_provenance():
    p = h7_prepared()
    no_provenance = profile_bpic19(p, ROLES, source_interpretation=source_definition(horizon="2019-01-28T00:00:00Z"))
    assert isinstance(no_provenance, ImportRefusal) and no_provenance.field.endswith("horizon.provenance")
    naive = source_definition("item_start"); naive["inclusion"]["start_inclusive"] = "2018-01-01T00:00:00"
    refusal = profile_bpic19(p, ROLES, source_interpretation=naive)
    assert isinstance(refusal, ImportRefusal) and "offset" in refusal.message
    mismatch = profile_bpic19(p, ROLES, source_interpretation=source_definition("item_start", clock="wall_clock"))
    assert isinstance(mismatch, ImportRefusal) and mismatch.field.endswith("inclusion.timestamp_kind")
    refused = source_definition(); refused["inclusion"]["end_exclusive"] = "2020-01-01T00:00:00Z"
    assert isinstance(profile_bpic19(p, ROLES, source_interpretation=refused), ImportRefusal)


def test_blank_and_known_category_is_conflicting_exact_identifiers_and_compound_flags_are_not_repaired():
    rows = [
        ["J", "Observed", "", "3-way match, invoice after GR", "Standard", "true", "true", "001", "1", "001_1"],
        ["J", "Observed", "bad", "", "Standard", "true", "true", "001", "1", "001_1"],
        ["K", "Observed", "", "3-way match, invoice after GR", "Standard", "true", "false", "1", "1", "1_1"],
        ["K", "Observed", "", "3-way match, invoice after GR", "Standard", "false", "true", "1", "1", "1_1"],
    ]
    stream = io.StringIO(); writer = csv.writer(stream); writer.writerow(HEADERS); writer.writerows(rows)
    p = ready(stream.getvalue().encode(), delimiter=",", policies=choices("wall", "iso8601"),
              mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": []})
    answer = profile_bpic19(p, ROLES)
    assert answer["population"]["document_count"] == 2
    assert keyed(answer["unresolved"], "state")["conflicting"]["case_ids"] == ["J"]
    assert keyed(answer["cross_checks"], "state")["unavailable"]["case_ids"] == ["J", "K"]
    assert keyed(answer["flows"], "flow_id")["after_gr"]["case_ids"] == ["K"]
    witnesses = keyed(answer["attributes"], "column_index")[3]["conflicting_witnesses"]
    assert [r["value"] for r in witnesses[0]["rows"]] == ["3-way match, invoice after GR", None]
