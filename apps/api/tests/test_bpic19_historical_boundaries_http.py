"""Independent original-record endpoints for every historical criterion family.

Literal activities, counts, days, actor strings and sample-CV values are authored
here. No norm/config or production binding is used to construct the oracle.
"""
from datetime import datetime,timedelta,timezone
import math
from fastapi.testclient import TestClient
import pytest
from test_bpic19_scoring_http import app,prepare,given,raw_source,SETTINGS,criterion


def test_all_29_historical_raw_boundary_families_through_real_http(tmp_path):
    extra=[];expected={}
    def row(cid,label,day=0,actor="batch_1",value=100,category="3-way match, invoice after GR"):
        extra.append([cid,"BOUNDARY",cid,category,"true","true","Standard","0000","Independent historical endpoints",label,(datetime(2018,1,1,tzinfo=timezone.utc)+timedelta(days=day)).isoformat(),actor,value])
    def expected_case(cid,key,value):expected[cid]=(key,value)
    # Known presence/absence: literal exact selectors and separate source scopes.
    binary=[("c_l1_invoice_present","Vendor creates invoice",0,1,0),
      ("c_l1_clear_invoice_present","Clear Invoice",0,1,0),
      ("c_l1_goods_or_ses_present","Record Service Entry Sheet",0,1,0),
      ("c_l2_2way_no_goods_expected","Record Goods Receipt",1,0,1),
      ("c_l2_consignment_no_clear_invoice","Clear Invoice",1,0,1),
      ("c_l5_cancel_invoice_receipt","Cancel Invoice Receipt",1,0,1),
      ("c_l5_cancel_goods_receipt","Cancel Goods Receipt",1,0,1),
      ("c_l5_delete_item","Delete Purchase Order Item",1,0,1),
      ("c_l5_debit_memo","Vendor creates debit memo",1,0,1),
      ("c_l5_credit_memo","Vendor creates credit memo",1,0,1)]
    for index,(key,label,_,absent,present) in enumerate(binary):
        category="2-way match" if key=="c_l2_2way_no_goods_expected" else "Consignment" if key=="c_l2_consignment_no_clear_invoice" else "3-way match, invoice after GR"
        for count,deviation in ((0,absent),(1,present)):
            cid=f"bin-{index}-{count}";row(cid,"Fixture observation",category=category)
            if count:row(cid,label,category=category)
            expected_case(cid,key,deviation)
    # Within-layer excess counts: all event counts are integers, including the
    # exact frozen plural Payment Terms selector (synthetic source, no alias).
    counts=[("c_l4_goods_fragmentation","Record Goods Receipt",(2,3,5),(0,1/3,1)),
      ("c_l4_change_approval_repeats","Change Approval for Purchase Order",(0,1,2),(0,.5,1)),
      ("c_l4_repeated_invoice_receipt","Record Invoice Receipt",(1,2,3),(0,.5,1)),
      ("c_l4_change_payment_terms_repeats","Change Payment Terms",(0,1,2),(0,.5,1)),
      ("c_l6_change_price","Change Price",(0,1,2),(0,.5,1)),
      ("c_l6_change_quantity","Change Quantity",(0,1,2),(0,.5,1))]
    for index,(key,label,values,deviations) in enumerate(counts):
        for count,deviation in zip(values,deviations):
            cid=f"count-{index}-{count}";row(cid,"Fixture observation")
            for occurrence in range(count):row(cid,label,occurrence+1)
            expected_case(cid,key,deviation)
    # Ordered independent minima: strict reversed observations and ties.
    for key,a,b,category in (("c_l2_df1_invoice_after_goods","Record Goods Receipt","Vendor creates invoice","3-way match, invoice after GR"),("c_l2_df2_release_after_goods","Record Goods Receipt","Remove Payment Block","3-way match, invoice before GR")):
        for offset,deviation in ((-1,1),(0,0),(1,0)):
            cid=key+str(offset);row(cid,a,2,category=category);row(cid,b,2+offset,category=category);expected_case(cid,key,deviation)
    # Every duration threshold, midpoint and saturation endpoint, in raw days.
    for index,(key,a,b,days,category) in enumerate([
      ("c_l3_df1_goods_to_invoice_days","Record Goods Receipt","Vendor creates invoice",(10,20,30),"3-way match, invoice after GR"),
      ("c_l3_invoice_to_clear_days","Vendor creates invoice","Clear Invoice",(30,60,90),"3-way match, invoice after GR"),
      ("c_l3_df2_goods_to_rpb_days","Record Goods Receipt","Remove Payment Block",(2,7,12),"3-way match, invoice before GR"),
      ("c_l3_df2_rpb_to_clear_days","Remove Payment Block","Clear Invoice",(5,15,25),"3-way match, invoice before GR")]):
        for lag,deviation in zip(days,(0,.5,1)):
            cid=f"lag-{index}-{lag}";row(cid,a,category=category);row(cid,b,lag,category=category);expected_case(cid,key,deviation)
    for count,deviation in ((4,0),(7,.5),(10,1)):
        cid=f"manual-{count}"
        for i in range(count):row(cid,"Fixture observation",i,"source_human")
        expected_case(cid,"c_l7_manual_touches",deviation)
    for count,deviation in ((2,0),(4,.5),(6,1)):
        cid=f"actors-{count}"
        for i in range(count):row(cid,"Fixture observation",i,f"source_human_{i}")
        expected_case(cid,"c_l7_distinct_human_resources",deviation)
    for count,deviation in ((10,0),(17,7/15),(25,1)):
        cid=f"events-{count}"
        for i in range(count):row(cid,"Fixture observation",i)
        expected_case(cid,"c_l7_total_events",deviation)
    for human,deviation in ((2,0),(3,.5),(4,1)):
        cid=f"share-{human}"
        for i in range(4):row(cid,"Fixture observation",i,"source_human" if i<human else "batch_1")
        expected_case(cid,"c_l7_manual_share",deviation)
    # Every calibration case participates. Both item maxima bracketing the
    # linear P95 position are 100, so its independently expected value is 100.
    # Products are raw
    # reviewed normalized-exposure proxies, never verified invoice errors.
    for key,label in (("c_l6_high_exposure_memo","Vendor creates debit memo"),("c_l6_high_exposure_price_change","Change Price")):
        for value,deviation in ((0,0),(50,.5),(100,1)):
            cid=key+str(value);row(cid,label,value=value);expected_case(cid,key,deviation)
    for cv,deviation in ((.5,0),(1,.5),(1.5,1)):
        cid=f"cv-{cv}";row(cid,"Fixture observation",value=1-cv/math.sqrt(2));row(cid,"Fixture observation",1,value=1+cv/math.sqrt(2));expected_case(cid,"c_l6_bal_networth_volatility",deviation)
    workspace=tmp_path/"workspace";workspace.mkdir()
    with TestClient(app()) as client:
        wid,identity=prepare(client,workspace,raw_source(extra))
        response=client.post("/api/investigations/bpic19-score",json=given(wid,identity,profile="historical",mode="layer_balanced",view="Finance"))
        assert response.status_code==200,response.text
        result=response.json();cases={item["case_id"]:item for item in result["report"]["case_page"]["cases"]}
        assert len({key for key,_ in expected.values()})==29
        for cid,(key,deviation) in expected.items():
            verdict=criterion(cases[cid],key)
            assert verdict["reason"]=="evaluated",(cid,key,verdict)
            assert verdict["deviation"]==pytest.approx(deviation,abs=1e-12),(cid,key,verdict)
            assert verdict["effective_weight"]>0
        for key in ("c_l6_high_exposure_memo","c_l6_high_exposure_price_change"):
            assert criterion(cases[key+"50"],key)["measurement_evidence"]["calibration_id"]==criterion(cases[key+"100"],key)["measurement_evidence"]["calibration_id"]
