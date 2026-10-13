"""Literal raw-time diagnostics, witness policy and fixed-parent distributions."""
from dataclasses import replace
from pathlib import Path

import pytest

from wise_platform_analytics.case_profiles import case_list_projection, validate_case_list_query
from wise_platform_analytics.case_time import CaseTimeError, case_time_summary
from wise_platform_analytics.preparation import prepare
from test_csv_preparation_core import choices, dialect

ROOT = Path(__file__).resolve().parents[3]
RAW = (ROOT / "tests/fixtures/case-list-v1.csv").read_bytes()


def prepared(raw=RAW, wall=False):
    policy = choices("wall" if wall else "recorded", "iso8601")
    policy["time"]["parameters"]["snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"] = "2026-10-06T00:00:00" + ("" if wall else "Z")
    result = prepare(raw, dialect("utf-8", ","), {"case_column":0,"activity_column":1,"timestamp_column":2,"sequence_column":3,"context_columns":[4]}, policy, True)
    assert result.state == "ready"
    return result.preparation


def query(field="observed_span_hours", direction="descending", offset=0, limit=2, search=None, distribution=None):
    q={"search_text":search,"sort":{"field":field,"direction":direction},"offset":offset,"limit":limit}
    if distribution is not None:q["distribution"]=distribution
    return q


def test_literal_summaries_and_first_raw_pair_maximum_witness():
    p=prepared()
    a=case_time_summary(p,"A")
    assert (a["observed_span_hours"],a["maximum_adjacent_raw_gap_hours"],a["usable_gap_count"])==(48,47,2)
    assert (a["first_recorded_activity"],a["last_recorded_activity"])==("Request","Reminder")
    assert a["maximum_gap_witness"]=={"from_row_id":p.histories["A"][1].row_id,"to_row_id":p.histories["A"][2].row_id,
        "from_activity":"Ack","to_activity":"Reminder","from_offset_hours":1,"share_of_observed_span":47/48,"share_unavailable_reason":None}
    c=case_time_summary(p,"C")
    assert (c["observed_span_hours"],c["maximum_adjacent_raw_gap_hours"],c["tied_timestamp_group_count"])==(0,0,1)
    assert c["maximum_gap_witness"]["from_row_id"]==p.histories["C"][0].row_id
    assert c["maximum_gap_witness"]["to_row_id"]==p.histories["C"][1].row_id
    assert c["maximum_gap_witness"]["to_activity"] is None
    assert c["maximum_gap_witness"]["share_of_observed_span"] is None
    assert c["maximum_gap_witness"]["share_unavailable_reason"]=="zero_observed_span"
    for cid in ("D","F"):
        s=case_time_summary(p,cid)
        assert s["observed_span_hours"]==0 and s["maximum_adjacent_raw_gap_hours"] is None and s["maximum_gap_witness"] is None
        assert s["maximum_adjacent_raw_gap_unavailable_reason"]=="fewer_than_two_records"
    assert case_time_summary(p,"F")["first_recorded_activity"] is None
    e=case_time_summary(p,"E")
    assert e["status"]=="unavailable" and e["unavailable_timestamp_record_count"]==1
    assert e["first_recorded_activity"] is e["last_recorded_activity"] is e["maximum_gap_witness"] is None


def test_missing_activity_raw_gap_is_not_the_mapped_bridge():
    p=prepared(RAW.replace(b"A,Ack,",b"A,,"))
    s=case_time_summary(p,"A")
    assert s["maximum_adjacent_raw_gap_hours"]==47
    assert s["maximum_gap_witness"]["from_activity"] is None
    assert s["maximum_gap_witness"]["from_row_id"]==p.histories["A"][1].row_id


def test_positive_equal_maximum_keeps_first_raw_pair_and_generic_duplicate_headers():
    raw=b'case,activity,time,sequence,Group,Group\nH,,2026-10-01T00:00:00Z,1,First,Other\nH,Review,2026-10-01T10:00:00Z,2,Later,Again\nH,Reply,2026-10-01T20:00:00Z,3,Last,Final\n'
    policy=choices("recorded","iso8601")
    p=prepare(raw,dialect("utf-8",","),{"case_column":0,"activity_column":1,"timestamp_column":2,"sequence_column":3,"context_columns":[4,5]},policy,True).preparation
    r=case_list_projection(p,["H"],["H"],query(limit=200))
    s=r["rows"][0]["time_summary"]
    assert s["first_recorded_activity"] is None and s["last_recorded_activity"]=="Reply"
    assert s["maximum_gap_witness"]["from_row_id"]==p.histories["H"][0].row_id
    assert s["maximum_gap_witness"]["share_of_observed_span"]==.5
    assert r["context_columns"]==[{"column_index":4,"name":"Group"},{"column_index":5,"name":"Group"}]
    assert r["rows"][0]["maximum_gap_context"]["from_context"]==[{"column_index":4,"value":"First"},{"column_index":5,"value":"Other"}]


def test_unknown_declared_order_has_truthful_zero_bad_timestamps_and_observed_parent_range():
    p=prepared()
    class Unordered:
        histories=p.histories;policies=p.policies;mapping=p.mapping;columns=p.columns
        def sequence_evaluable(self,case_id):return False
    u=Unordered()
    assert case_time_summary(u,"A")["unavailable_timestamp_record_count"]==0
    r=case_list_projection(u,["A"],["A"],query())
    assert r["rows"][0]["time_summary"]["first_recorded_timestamp"] is None
    assert r["parent_time_range"]=={"timestamp_kind":"utc_instant","earliest_recorded_timestamp":"2026-10-01T00:00:00Z","latest_recorded_timestamp":"2026-10-03T00:00:00Z"}


def test_paging_search_and_refinement_preserve_parent_distribution():
    p=prepared();parent=list("ABCDEF")
    pages=[case_list_projection(p,parent,parent,query(offset=o)) for o in (0,2,4)]
    assert [row["case_id"] for page in pages for row in page["rows"]]==list("ABCDFE")
    assert [r["next_offset"] for r in pages]==[2,4,None]
    assert all(page["distribution"]==pages[0]["distribution"] for page in pages)
    assert [b["parent_case_count"] for b in pages[0]["distribution"]["bins"]]==[3,1,1,0,0,0]
    narrowed=case_list_projection(p,["A","C","F"],parent,query(search="A"))
    assert narrowed["population_case_count"]==3 and narrowed["total_matching_case_count"]==1
    assert [b["parent_case_count"] for b in narrowed["distribution"]["bins"]]==[3,1,1,0,0,0]
    assert [b["kept_case_count"] for b in narrowed["distribution"]["bins"]]==[2,0,1,0,0,0]
    gap=case_list_projection(p,["A","C","F"],parent,query(distribution={"measure":"maximum_adjacent_raw_gap_hours","edges_hours":[0,1,24,168]}))
    assert [b["parent_case_count"] for b in gap["distribution"]["bins"]]==[1,1,1,0]
    assert gap["distribution"]["unavailable"]=={"parent_case_count":3,"kept_case_count":1,"parent_order_unknown_case_count":1,"kept_order_unknown_case_count":0,"parent_fewer_than_two_records_case_count":2,"kept_fewer_than_two_records_case_count":1}


def test_small_empty_parent_and_native_first_timestamp_sort_do_not_expand_or_use_lexical_time():
    p=prepared()
    r=case_list_projection(p,["A"],["A","E"],query(offset=20))
    assert r["rows"]==[] and r["next_offset"] is None
    assert r["distribution"]["parent_case_count"]==2 and r["distribution"]["kept_case_count"]==1
    assert r["parent_time_range"]["latest_recorded_timestamp"]=="2026-10-03T00:00:00Z"
    empty=case_list_projection(p,[],[],query())
    assert empty["parent_time_range"] is None and empty["distribution"]["parent_case_count"]==0
    raw=b'case,activity,time,sequence,context\nN2,R,2026-10-01T00:00:00.100000Z,1,X\nN1,R,2026-10-01T00:00:00Z,1,X\n'
    r=case_list_projection(prepared(raw),["N2","N1"],["N2","N1"],query(field="first_recorded_time",direction="ascending"))
    assert [row["case_id"] for row in r["rows"]]==["N1","N2"]


def test_wall_summary_and_range_never_append_z():
    p=prepared(RAW.replace(b"Z,",b","),wall=True)
    r=case_list_projection(p,["A"],["A","E"],query())
    assert r["rows"][0]["time_summary"]["timestamp_kind"]=="wall_clock"
    assert r["rows"][0]["time_summary"]["observed_span_hours"]==48
    assert r["parent_time_range"]["earliest_recorded_timestamp"]=="2026-10-01T00:00:00"


def test_unknown_summary_returns_before_unsupported_clock_and_kind_checks():
    p = prepared()

    class UnknownOrder:
        histories = {"A": tuple(replace(row, timestamp_kind="unsupported") for row in p.histories["A"])}
        policies = {"time": {"id": "unsupported"}}

        def sequence_evaluable(self, case_id):
            return False

    summary = case_time_summary(UnknownOrder(), "A")
    assert summary["status"] == "unavailable"
    assert summary["unavailable_timestamp_record_count"] == 0
    assert "timestamp_kind" not in summary and "records" not in summary


@pytest.mark.parametrize("edges",[[],[1],[0,0],[0,24,1],[0,True],[0,float("inf")],[0,float("nan")],[0,10**400],list(range(33))],ids=["empty","nonzero-first","duplicate","descending","bool","infinite","nan","overflow-int","too-many"])
def test_invalid_distribution_edges_are_explicit_denials(edges):
    result=validate_case_list_query(query(distribution={"measure":"observed_span_hours","edges_hours":edges}))
    assert result.code=="invalid_parameter" and result.field=="query.distribution.edges_hours"
