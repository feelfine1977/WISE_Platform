"""Native BPIC19 day-month-year clock; literals are synthetic, never executed source code."""
import hashlib
import csv
import io
from datetime import datetime

import pytest
from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import prepare, PreparationResult
from wise_platform_analytics.time_formats import parse_format
from wise_platform_analytics.bpic19_profiles import profile_bpic19
from test_csv_preparation_core import choices, dialect, ready

HEADERS=["eventID ","case Spend area text","case Company","case Document Type","case Sub spend area text","case Purchasing Document","case Purch. Doc. Category name","case Vendor","case Item Type","case Item Category","case Spend classification text","case Source","case Name","case GR-Based Inv. Verif.","case Item","case concept:name","case Goods Receipt","event User","event org:resource","event concept:name","event Cumulative net worth (EUR)","event time:timestamp"]
MAPPING={"case_column":15,"activity_column":19,"timestamp_column":21,"sequence_column":None,"context_columns":[i for i in range(22) if i not in [15,19,21]]}
ROLES={"item_category":9,"item_type":8,"goods_receipt":16,"gr_based_iv":13,"purchasing_document":5,"item":14,"source_case":15}


def native_source():
    # All22 cells are explicit synthetic inputs; original namespaces/values stay intact.
    data=[
      ["1","Sales","companyID_0000","Standard PO","Products","D1","Purchase order","vendor_1","Standard","3-way match, invoice before GR","NPR","system","Müller","false","1","D1_1","true","NONE","NONE","Vendor creates invoice","68.0","26-01-1948 23:59:00.000"],
      ["2","Sales","companyID_0000","Standard PO","Products","D1","Purchase order","vendor_1","Standard","3-way match, invoice before GR","NPR","system","Müller","false","1","D1_1","true","user_1","user_1","Create Purchase Order Item","68.0","01-01-2018 08:00:00.001"],
      ["3","Sales","companyID_0000","Standard PO","Products","D1","Purchase order","vendor_1","Standard","3-way match, invoice before GR","NPR","system","Müller","false","1","D1_1","true","user_1","user_1","Record Invoice Receipt","68.0","02-01-2018 09:00:00.123456"],
      ["4","Sales","companyID_0000","Standard PO","Products","D1","Purchase order","vendor_1","Standard","3-way match, invoice before GR","NPR","system","Müller","false","1","D1_1","true","user_1","user_1","Clear Invoice","68.0","09-04-2020 23:59:00.000"],
      ["5","Logistics","companyID_0000","Standard PO","Services","D2","Purchase order","vendor_2","Service","3-way match, invoice after GR","NPR","system","vendor_2","true","1","D2_1","true","user_1","user_1","Record Goods Receipt","100","29-02-2020 12:01:02.25"],
      ["6","Packaging","companyID_0000","Standard PO","Boxes","D3","Purchase order","vendor_3","Consignment","Consignment","PR","system","vendor_3","false","1","D3_1","true","batch_1","batch_1","Record Goods Receipt","0","03-01-2018 12:00:00"],
      ["7","Real estate","companyID_0003","Framework order","Energy","D4","Purchase order","vendor_4","Limit","2-way match","NPR","system","vendor_4","false","1","D4_1","false","user_1","user_1","Record Invoice Receipt","-5","04-01-2018 12:00:00.000001"],
    ]
    stream=io.StringIO();writer=csv.writer(stream);writer.writerow(HEADERS);writer.writerows(data)
    return stream.getvalue().encode("cp1252")


@pytest.mark.parametrize(("text","expected"),[
 ("26-01-1948 23:59:00.000",datetime(1948,1,26,23,59)),
 ("29-02-2020 12:01:02.25",datetime(2020,2,29,12,1,2,250000)),
 ("1-2-2018 8:5:6.123456",datetime(2018,2,1,8,5,6,123456)),
 ("03-01-2018 12:00:00",datetime(2018,1,3,12)),
])
def test_dash_calendar_and_microseconds_are_literal(text,expected):
    assert parse_format(text,"dmy_dash_second")==expected


@pytest.mark.parametrize("text",[
 "29-02-2019 12:00:00.000","31-04-2020 12:00:00.000","26-01-1948 24:00:00",
 "26-01-1948 23:60:00","26-01-1948 23:59:60","26-01-1948 23:59",
 "26-01-1948 23:59:00.1234567","26-01-1948 23:59:00Z","26-01-1948 23:59:00+02:00",
 "1948-01-26 23:59:00.000","26/01/1948 23:59:00.000","26.01.1948 23:59:00.000"])
def test_invalid_dates_precision_zones_and_other_formats_are_not_guessed(text):
    assert parse_format(text,"dmy_dash_second") is None


def test_native22_is_inspected_and_prepared_without_conversion_or_event_trimming():
    raw=native_source();inspected=inspect_csv(raw)
    matches={m['format']:m['parsed_count'] for m in inspected['role_suggestions'][21]['timestamp_matches']}
    assert matches['dmy_dash_second']==7 and matches['iso8601']==0
    p=ready(raw,encoding="windows-1252",delimiter=",",mapping=MAPPING,policies=choices('wall','dmy_dash_second'))
    assert p.source_id=='source.v1:sha256:'+hashlib.sha256(raw).hexdigest() and not hasattr(p,'source') and list(p.columns)==HEADERS and len(p.records)==7 and len(p.histories)==4
    assert all(r.timestamp_status=='usable' for r in p.records)
    assert p.histories['D1_1'][0].local_timestamp=='1948-01-26T23:59:00'
    assert p.histories['D1_1'][1].local_timestamp=='2018-01-01T08:00:00.001000'
    assert p.histories['D1_1'][1].original_cells[21]=='01-01-2018 08:00:00.001'
    assert p.histories['D1_1'][-1].local_timestamp=='2020-04-09T23:59:00'
    assert all(r.utc_instant is None for r in p.records)
    a=profile_bpic19(p,ROLES)
    assert {g['flow_id']:g['case_count'] for g in a['flows']}=={'after_gr':1,'before_gr':1,'two_way':1,'consignment':1}


def test_utc_requires_an_explicit_fixed_offset_and_never_uses_host_timezone():
    raw=native_source()
    refused=prepare(raw,dialect('windows-1252',','),MAPPING,choices('recorded','dmy_dash_second'),True)
    assert isinstance(refused,ImportRefusal) and refused.code=='timezone_required'
    offset=ready(raw,encoding="windows-1252",delimiter=",",mapping=MAPPING,policies=choices('offset','dmy_dash_second'))
    assert offset.histories['D1_1'][0].utc_instant=='1948-01-26T21:59:00Z'
    assert offset.histories['D1_1'][1].utc_instant=='2018-01-01T06:00:00.001000Z'
    explicit=choices('offset','dmy_dash_second');explicit['time']['parameters']['timezone']['offset_minutes']=0
    zero=ready(raw,encoding='windows-1252',delimiter=',',mapping=MAPPING,policies=explicit)
    assert zero.histories['D1_1'][0].utc_instant=='1948-01-26T23:59:00Z'


def test_bad_native_timestamp_survives_explicit_issue_confirmation():
    raw=native_source().replace(b'29-02-2020 12:01:02.25',b'29-02-2019 12:01:02.25')
    checked=prepare(raw,dialect('windows-1252',','),MAPPING,choices('wall','dmy_dash_second'),False)
    assert isinstance(checked,PreparationResult) and checked.state=='needs_confirmation'
    p=ready(raw,encoding='windows-1252',delimiter=',',mapping=MAPPING,policies=choices('wall','dmy_dash_second'))
    assert p.histories['D2_1'][0].timestamp_status=='invalid'
    assert p.histories['D2_1'][0].original_cells[21]=='29-02-2019 12:01:02.25'
    assert len(p.records)==7 and not p.sequence_evaluable('D2_1')
