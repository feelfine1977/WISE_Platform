"""Independent literal completion/inclusion decisions, not reducer-generated expectations."""
import csv
import io
from copy import deepcopy
from dataclasses import replace

from wise_platform_analytics.bpic19_cohorts import cohort_bpic19, default_query
from wise_platform_analytics.mapping import ImportRefusal
from test_csv_preparation_core import ready, choices

BEFORE = "3-way match, invoice before GR"
AFTER = "3-way match, invoice after GR"
CON = "Consignment"
TWO = "2-way match"
ROLES = {"item_category": 3, "purchasing_document": 4}


def prepared(rows):
    f = io.StringIO(); writer = csv.writer(f)
    writer.writerow(["case", "activity", "time", "category", "document"]); writer.writerows(rows)
    return ready(f.getvalue().encode(), delimiter=",", policies=choices("wall", "iso8601"), mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None, "context_columns": [3,4]})


def q(): return default_query(ROLES, "wall_clock")
def group(a, state): return next(g for g in a["completion_groups"] if g["state"] == state)
def item(a, cid): return next(i for i in a["page"]["items"] if i["case_id"] == cid)


def literal():
    return prepared([
        ["K", "Create Purchase Order Item", "2018-01-01T00:00:00", CON,"DK"],
        ["K", "Record Goods Receipt", "", CON,"DK"],
        ["L", "Record Invoice Receipt", "2018-01-01T00:00:00", TWO,"DL"],
        ["L", "Clear Invoice", "2018-01-02T00:00:00", TWO,"DL"],
        ["P", "Clear Invoice", "2018-01-01T00:00:00", BEFORE,"DP"],
        ["P", "Change Quantity", "2018-01-02T00:00:00", BEFORE,"DP"],
        ["Q", "Delete Purchase Order Item", "2018-01-01T00:00:00", BEFORE,"DQ"],
        ["R", "Record Goods Receipt", "2018-01-01T00:00:00", BEFORE,"DR"],
        ["S", "Record Invoice Receipt", "2018-01-01T00:00:00", BEFORE,"DS"],
        ["U", "Clear Invoice", "2018-01-01T00:00:00", "Unknown","DU"],
        ["T", "Clear Invoice", "2018-01-01T00:00:00", BEFORE,"DT"],
        ["T", "Change Quantity", "2018-01-01T00:00:00", BEFORE,"DT"],
        ["Missing", "", "2018-01-01T00:00:00", BEFORE,"DM"],
    ])


def test_all_items_and_presence_ignore_bad_clock_and_keep_unknown_categories():
    p = literal(); a = cohort_bpic19(p,q())
    assert a["original"] == {"case_count":9,"record_count":13,"document_count":9,"document_unknown_case_count":0}
    assert a["retention"]["retained"]["case_ids"] == ["K","L","Missing","P","Q","R","S","T","U"]
    assert group(a,"observed_closed")["case_ids"] == ["K","L","P","T"]
    assert group(a,"open_recorded")["case_ids"] == ["Q","R","S"]
    assert group(a,"unknown")["case_ids"] == ["Missing","U"]
    assert item(a,"K")["required_activity_sets"] == [["Record Goods Receipt"]]
    assert item(a,"L")["required_activity_sets"] == [["Clear Invoice"]]
    assert all(x["due_state"]=="unavailable" for x in a["page"]["items"])
    chosen=q();chosen["retain"]="observed_closed";b=cohort_bpic19(p,chosen)
    assert b["retention"]["retained"]["record_count"]==8
    assert b["definition_id"]!=a["definition_id"] and len(p.records)==13
    assert cohort_bpic19(replace(p,histories={c:tuple(reversed(r)) for c,r in p.histories.items()}),q()) == a


def test_last_ending_is_distinct_and_tie_optin_is_identity_bearing():
    p=literal();query=q();query["completion"]["recipe"]="kpmg_last_ending"
    a=cohort_bpic19(p,query)
    assert group(a,"observed_closed")["case_ids"]==["L","Q"]
    assert group(a,"open_recorded")["case_ids"]==["P","R","S"]
    assert group(a,"unknown")["case_ids"]==["K","Missing","T","U"]
    assert item(a,"T")["reasons"]==["equal_time_ending_unordered"]
    assert len(item(a,"T")["witness_row_ids"])==2
    query["completion"]["tie_policy"]="source_position";b=cohort_bpic19(p,query)
    assert item(b,"T")["completion_state"]=="open_recorded"
    assert len(item(b,"T")["witness_row_ids"])==1 and a["definition_id"]!=b["definition_id"]


def test_whole_document_h7_excludes_sibling_and_retains_all_rows():
    p=prepared([
        ["A","Vendor creates invoice","1948-01-01T00:00:00",BEFORE,"D"],
        ["A","Create Purchase Order Item","2018-01-01T00:00:00",BEFORE,"D"],
        ["A","Clear Invoice","2020-01-02T00:00:00",BEFORE,"D"],
        ["B","Create Purchase Order Item","2018-01-02T00:00:00",BEFORE,"D"],
        ["B","Record Goods Receipt","2018-01-03T00:00:00",BEFORE,"D"],
        ["C","Create Purchase Order Item","2018-01-02T00:00:00",BEFORE,"E"],
        ["C","Clear Invoice","2018-01-04T00:00:00",BEFORE,"E"]])
    query=q();query["inclusion"].update(kind="document_start_window",start_inclusive="2018-01-01T00:00:00")
    a=cohort_bpic19(p,query)
    assert a["inclusion"]["retained"]["case_ids"]==["C"] and a["inclusion"]["excluded"]["case_ids"]==["A","B"]
    assert a["retention"]["retained"]["record_count"]==2 and a["inclusion"]["excluded"]["record_count"]==5
    assert item(a,"B")["inclusion_witnesses"]==[{"case_id":"A","row_ids":[p.histories['A'][0].row_id]}]
    query["inclusion"]["kind"]="item_start_window";b=cohort_bpic19(p,query)
    assert b["retention"]["retained"]["case_ids"]==["B","C"] and b["retention"]["retained"]["record_count"]==4
    query["inclusion"]["kind"]="item_any_event_window";c=cohort_bpic19(p,query)
    assert c["retention"]["retained"]["case_ids"]==["A","B","C"] and c["retention"]["retained"]["record_count"]==7
    assert len(p.records)==7


def test_mandatory_presence_is_unordered_and_service_is_explicit_alternative():
    rows=[["M",a,f"2018-01-0{i+1}T00:00:00",BEFORE,"D"] for i,a in enumerate(["Clear Invoice","Record Invoice Receipt","Vendor creates invoice","Record Goods Receipt","Create Purchase Order Item"])]
    rows += [["Service","Record Service Entry Sheet","",CON,"DS"]]
    p=prepared(rows);query=q();query["completion"]["recipe"]="botti_mandatory_presence"
    a=cohort_bpic19(p,query);assert item(a,"M")["completion_state"]=="observed_closed"
    query=q();assert item(cohort_bpic19(p,query),"Service")["completion_state"]=="open_recorded"
    query["completion"]["receipt"]="goods_or_service";assert item(cohort_bpic19(p,query),"Service")["completion_state"]=="observed_closed"


def test_f10_f11_whole_items_page_identity_and_conflicting_document():
    from test_bpic19_profiles import prepared as f10, source
    p=f10();query=default_query({"item_category":3,"purchasing_document":7},"wall_clock")
    a=cohort_bpic19(p,query)
    assert a["original"]["case_count"]==10 and a["original"]["record_count"]==14 and a["original"]["document_count"]==8
    assert a["original"]["document_unknown_case_count"]==1 and group(a,"observed_closed")["case_ids"]==["D2_1"]
    assert group(a,"unknown")["case_ids"]==["C_1","M_1","U_1"]
    query["page"]={"offset":1,"limit":2};b=cohort_bpic19(p,query)
    assert b["definition_id"]==a["definition_id"] and len(b["page"]["items"])==2
    query["inclusion"].update(kind="document_start_window",start_inclusive="2018-01-01T00:00:00")
    c=cohort_bpic19(p,query);assert "G_1" in c["inclusion"]["unknown"]["case_ids"]
    # F11 adds one independently specified after×Standard item; no clearing is invented.
    raw=source()+b'D4_1,Record Invoice Receipt,2018-01-01T00:00:00,"3-way match, invoice after GR",Standard,true,true,D4,1,D4_1\r\n'
    p11=ready(raw,delimiter=",",policies=choices("wall","iso8601"),mapping={"case_column":0,"activity_column":1,"timestamp_column":2,"sequence_column":None,"context_columns":list(range(3,10))})
    a11=cohort_bpic19(p11,default_query({"item_category":3,"purchasing_document":7},"wall_clock"))
    assert a11["original"]=={"case_count":11,"record_count":15,"document_count":9,"document_unknown_case_count":1}
    assert "D4_1" in group(a11,"open_recorded")["case_ids"]


def test_invalid_clock_horizon_financial_recipe_and_empty_parent_refuse_explicitly():
    p=literal();query=q();query["completion"]["recipe"]="undefined_net_balance"
    assert isinstance(cohort_bpic19(p,query),ImportRefusal)
    query=q();query["horizon"].update(value="2019-01-01T00:00:00",provenance="")
    assert isinstance(cohort_bpic19(p,query),ImportRefusal)
    query["horizon"]["provenance"]="Reviewed source extraction statement"
    assert not isinstance(cohort_bpic19(p,query),ImportRefusal)
    empty=cohort_bpic19(p,q(),[]);assert empty["original"]["case_count"]==0 and empty["selection"]["case_ids"]==[]
