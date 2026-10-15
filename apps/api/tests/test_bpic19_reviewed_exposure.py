"""Literal original events and server-reviewed value units through actual Method.

Finite fixtures establish native arithmetic/provenance, not the supplied source,
full-source capacity or a built-browser/restart receipt.
"""
from copy import deepcopy
import csv
import io
import json
import hashlib

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from wise_platform_api import bpic19_scoring as scoring
from test_bpic19_scoring_http import prepare, given, ROLES, VALIDATOR, read
from import_requests import envelope

HEADERS = ["case concept:name", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt",
           "case GR-Based Inv. Verif.", "case Item Type", "case Company", "case Spend area text", "event concept:name",
           "event time:timestamp", "event org:resource", "event Cumulative net worth (EUR)"]
EVENTS = {
    "A": [("Create Purchase Order Item", "2018-01-01"), ("Record Goods Receipt", "2018-01-02"),
          ("Record Invoice Receipt", "2018-01-03"), ("Clear Invoice", "2018-01-04"), ("Cancel Invoice Receipt", "2018-01-05")],
    "B": [("Create Purchase Order Item", "2018-01-01"), ("Record Goods Receipt", "2018-01-02"),
          ("Record Invoice Receipt", "2018-01-03"), ("Clear Invoice", "2018-03-04")],
    "C": [("Create Purchase Order Item", "2018-01-01"), ("Record Goods Receipt", "2018-01-02"),
          ("Record Invoice Receipt", "2018-01-03"), ("Clear Invoice", "2018-01-04")],
}

def original_csv(amounts, documents=None):
    out = io.StringIO(newline=""); writer = csv.writer(out); writer.writerow(HEADERS)
    documents = documents or {case: case for case in amounts}
    for case, amount in amounts.items():
        for activity, date in EVENTS[case]:
            writer.writerow([case, documents[case], "00020" if case == "B" else "00010", "3-way match, invoice after GR", "TRUE", "TRUE", "Standard", case,
                             "Fixture", activity, date + "T00:00:00Z", "batch_1", amount])
    return out.getvalue().encode()


def review(client, wid, identity, reducer="unique_creation_value", unit="EUR", fit="parent", roles=None, profile="paper_v1"):
    query = {"policy_id": "bpic19.source_witnessed_measures.v1", "measure_profile": profile, "roles": deepcopy(ROLES if roles is None else roles),
             "offset": 0, "limit": 1, "value_reducer": reducer, "value_unit": unit, "calibration_population": fit}
    reply = client.post("/api/investigations/bpic19-measures", json=envelope("bpic19_measures_request", workspace_id=wid,
                         identity=identity, query=query))
    assert reply.status_code == 200, reply.text
    return {"definition_id": reply.json()["definition_id"], "identity": identity, "query": query}


def selected(client, wid, identity, ids, parent_case_ids=None):
    reply = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=identity,
        parent_case_ids=parent_case_ids, predicates=[] if ids is None else [{"kind": "case_id_in", "case_ids": ids, "negate": False}]))
    assert reply.status_code == 200, reply.text
    return reply.json()["identity"]


def score(client, wid, base, population=None, reference=None, **settings):
    request = given(wid, base, **settings)
    if population is not None: request["named_population"]["identity"] = population
    if reference is not None: request["exposure_review"] = reference
    reply = client.post("/api/investigations/bpic19-score", json=request)
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json()


def graded_cases(answer):
    return [{"case_id": c["case_id"], "score": c["score"], "coverage": c["coverage"], "criteria": c["criteria"]}
            for c in answer["report"]["case_page"]["cases"]]


def group(answer, case):
    return next(row for row in answer["report"]["groups"] if row["company"] == case)


def tree(folder):
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.rglob("*") if p.is_file()}


def test_literal_count_and_EUR_priorities_point_025_and_point_25_have_identical_native_grades(tmp_path):
    with TestClient(create_app()) as client:
        wid, base = prepare(client, tmp_path, original_csv({"A": 10, "B": 90}))
        reference = review(client, wid, base)
        count = score(client, wid, base)
        exposure = score(client, wid, base, reference=reference, volume="exposure", exposure_policy="creation_unique_value")
        assert count["report"]["mean_score"] == pytest.approx(.925)
        assert group(count, "A")["PI"] == pytest.approx(.025)
        assert group(exposure, "A")["PI"] == pytest.approx(.25)
        assert group(exposure, "A")["volume"] == 10
        assert graded_cases(exposure) == graded_cases(count)
        receipt = exposure["report"]["exposure_calibration"]
        assert receipt["source_field"] == 12 and receipt["source_column_name"] == HEADERS[12]
        assert receipt["source_unit"] == receipt["unit"] == "EUR"
        assert receipt["priority_unit"] == "EUR-score units"
        assert receipt["reviewed_measure_definition_id"] == reference["definition_id"]
        assert receipt["reviewed_population_identity"] == base
        assert receipt["value_reducer"] == "unique_creation_value"
        assert receipt["source_record_basis"] == "complete_original_item_histories"
        assert exposure["definition"]["exposure_review"] == reference
        assert exposure["definition_id"] != count["definition_id"] and exposure["run_id"] != count["run_id"]
        generic = score(client, wid, base, volume="exposure", exposure_policy="creation_unique_value")
        assert generic["report"]["exposure_calibration"]["unit"] == "source_value_units"
        assert "source_unit" not in generic["report"]["exposure_calibration"]
        assert group(generic, "A")["PI"] == pytest.approx(.25)


def test_literal_document_count_05_exposure_75_reduces_each_item_once(tmp_path):
    with TestClient(create_app()) as client:
        wid, base = prepare(client, tmp_path, original_csv({"A": 10, "B": 20, "C": 90}, {"A": "D", "B": "D", "C": "E"}))
        count = score(client, wid, base)
        exposure = score(client, wid, base, reference=review(client, wid, base), volume="exposure", exposure_policy="creation_unique_value")
        doc = lambda answer: next(row for row in answer["report"]["documents"] if row["document"] == "D")
        assert count["report"]["mean_score"] == pytest.approx(.95)
        assert doc(count)["mean_score"] == pytest.approx(.925)
        assert doc(count)["volume"] == 2 and doc(count)["PI"] == pytest.approx(.05)
        assert doc(exposure)["volume"] == 30 and doc(exposure)["PI"] == pytest.approx(.75)
        assert doc(exposure)["member_count"] == doc(exposure)["n_cases"] == 2
        assert graded_cases(exposure) == graded_cases(count)


def test_exact_parent_p95_19_5_alias_column_12_remains_frozen_after_child_keep(tmp_path):
    with TestClient(create_app()) as client:
        wid, base = prepare(client, tmp_path, original_csv({"A": 10, "B": 20}))
        parent = selected(client, wid, base, None)
        assert parent != base # Exact declared population is significant despite equal members.
        aliases = {**ROLES, "net_worth": None, "value": 12}
        reference = review(client, wid, parent, "maximum_absolute_event_value", fit="selected", roles=aliases)
        outer = given(wid, base, volume="exposure", exposure_policy="max_absolute_p95")
        outer["roles"] = aliases; outer["named_population"]["identity"] = parent; outer["exposure_review"] = reference
        full = client.post("/api/investigations/bpic19-score", json=outer)
        assert full.status_code == 200, full.text
        child = selected(client, wid, base, ["A"], ["A", "B"])
        outer["named_population"]["identity"] = child
        kept = client.post("/api/investigations/bpic19-score", json=outer)
        assert kept.status_code == 200, kept.text
        for answer in (full.json(), kept.json()):
            receipt = answer["report"]["exposure_calibration"]
            assert receipt["cutoff"] == pytest.approx(19.5)
            assert receipt["source_field"] == 12 and receipt["source_unit"] == "EUR"
            assert receipt["population_case_ids"] == ["A", "B"] and receipt["population_identity"] == parent
            assert receipt["fit_population_identity"] == parent
            assert receipt["priority_unit"] == "normalized exposure-score units"
            assert group(answer, "A")["volume"] == pytest.approx(10/19.5)
        assert group(full.json(), "B")["volume"] == 1
        assert full.json()["report"]["exposure_calibration"]["calibration_id"] == kept.json()["report"]["exposure_calibration"]["calibration_id"]
        page = client.post("/api/investigations/bpic19-read", json={**read(wid, full.json()["run_id"]), "case_limit": 1})
        assert page.status_code == 200 and page.json()["report"]["mean_score"] == pytest.approx(.925)


@pytest.mark.parametrize("change", ["definition", "unit", "reducer", "field", "equal_membership_identity", "transported_amount"])
def test_refuses_wrong_review_without_native_publication(tmp_path, change):
    with TestClient(create_app()) as client:
        wid, base = prepare(client, tmp_path, original_csv({"A": 10, "B": 90}))
        reference = review(client, wid, base)
        request = given(wid, base, volume="exposure", exposure_policy="creation_unique_value"); request["exposure_review"] = deepcopy(reference)
        bad = request["exposure_review"]
        if change == "definition": bad["definition_id"] = "bpic19-measure-definition.v1:sha256:" + "a"*64
        if change == "unit": bad["query"]["value_unit"] = "USD"
        if change == "reducer": bad["query"]["value_reducer"] = "maximum_absolute_event_value"
        if change == "field": bad["query"]["roles"]["value"] = bad["query"]["roles"]["net_worth"] = 8
        if change == "equal_membership_identity": bad["identity"] = selected(client, wid, base, None)
        if change == "transported_amount": bad["amounts"] = {"A": 10}
        before = tree(tmp_path)
        reply = client.post("/api/investigations/bpic19-score", json=request)
        assert reply.status_code in {400, 409}, reply.text
        assert reply.json()["code"] in {"identity_mismatch", "invalid_request", "unsupported_policy"}
        assert tree(tmp_path) == before


def test_verified_review_stored_lookup_precedes_lowered_cap_and_never_refits(tmp_path, monkeypatch):
    with TestClient(create_app()) as client:
        wid, base = prepare(client, tmp_path, original_csv({"A": 10, "B": 20}))
        reference = review(client, wid, base, "maximum_absolute_event_value")
        answer = score(client, wid, base, reference=reference, volume="exposure")
        # Only this future service is locally constrained; recorded native output remains authoritative.
        # Obtain the actual Imports through the registered route's closure is not a public test seam.
        # Instead a strict evaluator/measurement failure proves the same actual mounted route reads its stored run.
        def forbidden(*args, **kwargs): pytest.fail("Stored reviewed native read must not remeasure/refit/evaluate")
        monkeypatch.setattr(scoring.Bpic19Scoring, "_admit_workload", forbidden)
        monkeypatch.setattr(scoring.Bpic19Scoring, "_verify_exposure_reference", forbidden)
        monkeypatch.setattr(scoring, "evaluate_features", forbidden)
        before = tree(tmp_path)
        repeated = score(client, wid, base, reference=reference, volume="exposure")
        assert repeated == answer and tree(tmp_path) == before


def test_changed_reviewed_unit_versions_the_native_definition_without_conversion_or_grade_changes(tmp_path):
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":10,"B":90}))
        eur=score(client,wid,base,reference=review(client,wid,base),volume="exposure",exposure_policy="creation_unique_value")
        usd=score(client,wid,base,reference=review(client,wid,base,unit="USD"),volume="exposure",exposure_policy="creation_unique_value")
        assert eur["definition_id"]!=usd["definition_id"] and eur["run_id"]!=usd["run_id"]
        assert graded_cases(eur)==graded_cases(usd)
        assert group(eur,"A")["PI"]==group(usd,"A")["PI"]==pytest.approx(.25)
        assert usd["report"]["exposure_calibration"]["unit"]=="USD"
        assert usd["report"]["case_page"]["cases"][0]["value_evidence"]["creation_value"]["unit"]=="USD"
        before=tree(tmp_path)
        old=client.post("/api/investigations/bpic19-read",json=read(wid,eur["run_id"]))
        assert old.status_code==200 and old.json()["report"]==eur["report"] and tree(tmp_path)==before


@pytest.mark.parametrize("amount",["", "nan", "inf", -10])
def test_reviewed_creation_refuses_missing_nonfinite_negative_without_zero_fallback(tmp_path,amount):
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":amount,"B":20}))
        reference=review(client,wid,base)
        request=given(wid,base,volume="exposure",exposure_policy="creation_unique_value");request["exposure_review"]=reference
        response=client.post("/api/investigations/bpic19-score",json=request)
        assert response.status_code==400 and response.json()["code"]=="invalid_parameter",response.text
        assert "unavailable values cannot become zero" in response.json()["message"]
        assert not list((tmp_path/"score-runs").glob("*.json"))
        # Count-only remains usable over independently evaluable native criteria.
        count=score(client,wid,base);assert count["report"]["scored_case_count"]==2


def test_reviewed_maxabs_preserves_negative_source_witness_and_explicit_historical_missing_fill(tmp_path):
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":-10,"B":20}))
        ref=review(client,wid,base,"maximum_absolute_event_value")
        answer=score(client,wid,base,reference=ref,volume="exposure")
        receipt=answer["report"]["exposure_calibration"]
        assert receipt["source_value_negative_policy"]=="absolute_before_max"
        assert receipt["cutoff"]==19.5 and group(answer,"A")["volume"]==pytest.approx(10/19.5)
        evidence=client.post("/api/investigations/case-evidence",json=envelope("imported_case_evidence_request",workspace_id=wid,identity=base,case_id="A"))
        assert all(row["original_cells"][12]=="-10" for row in evidence.json()["records"])
    missing=tmp_path/"historical";missing.mkdir()
    with TestClient(create_app()) as client:
        wid,base=prepare(client,missing,original_csv({"A":"","B":20}))
        ref=review(client,wid,base,"maximum_absolute_event_value")
        answer=score(client,wid,base,reference=ref,profile="historical",view="Finance",mode="layer_balanced",volume="exposure")
        receipt=answer["report"]["exposure_calibration"]
        assert receipt["missing_policy"]==receipt["source_value_missing_policy"]=="source_compatible_fill_zero"
        assert receipt["missing_case_count"]==1 and receipt["quantile"]==19
        assert receipt["measurement_calibration_id"] and receipt["source_unit"]=="EUR"
        assert group(answer,"A")["volume"]==0


def test_reference_original_histories_are_capacity_admitted_before_boundary_replay_or_native_publication(tmp_path,monkeypatch):
    original=scoring.Bpic19Scoring
    monkeypatch.setattr(scoring,"Bpic19Scoring",lambda imports:original(imports,max_cases=1,max_retained_records=5))
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":10,"B":90}))
        parent=selected(client,wid,base,None)
        ref=review(client,wid,parent,fit="selected")
        child=selected(client,wid,base,["A"],["A","B"])
        def forbidden(*args,**kwargs):pytest.fail("Over-limit review must refuse before any measure, feature, native evaluation or publication")
        monkeypatch.setattr(scoring.Bpic19Measures,"measures",forbidden)
        monkeypatch.setattr(scoring,"evaluate_features",forbidden)
        monkeypatch.setattr(scoring,"derive_case_measures",forbidden)
        request=given(wid,base,volume="exposure",exposure_policy="creation_unique_value")
        request["named_population"]["identity"]=child;request["exposure_review"]=ref
        before=tree(tmp_path);response=client.post("/api/investigations/bpic19-score",json=request)
        assert response.status_code==400 and response.json()["code"]=="unsupported_policy",response.text
        assert "2 complete items and 9 retained original records" in response.json()["message"]
        assert tree(tmp_path)==before


def test_scoring_reference_reuses_exact_measure_query_schema_without_arbitrary_amounts():
    import pathlib
    root=pathlib.Path(__file__).resolve().parents[3]
    native=json.loads((root/"contracts/bpic19-scoring.schema.json").read_text())
    raw=json.loads((root/"contracts/bpic19-measures.schema.json").read_text())
    assert native["$defs"]["MeasureQuery"]==raw["$defs"]["MeasureQuery"]
    assert native["$defs"]["MeasureRoles"]==raw["$defs"]["MeasureRoles"]
    assert native["$defs"]["ExposureReview"]["additionalProperties"] is False


def test_reviewed_unique_event_is_distinct_from_unique_value_and_first_is_not_admitted(tmp_path):
    rows=list(csv.reader(io.StringIO(original_csv({"A":10,"B":90}).decode())))
    rows.insert(2,deepcopy(rows[1])) # two complete finite equal-valued original creation events
    output=io.StringIO();csv.writer(output).writerows(rows)
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,output.getvalue().encode())
        event=review(client,wid,base,"unique_creation_event")
        request=given(wid,base,volume="exposure",exposure_policy="creation_unique_event");request["exposure_review"]=event
        refused=client.post("/api/investigations/bpic19-score",json=request)
        assert refused.status_code==400 and refused.json()["code"]=="invalid_parameter",refused.text
        value=review(client,wid,base,"unique_creation_value")
        answer=score(client,wid,base,reference=value,volume="exposure",exposure_policy="creation_unique_value")
        assert group(answer,"A")["volume"]==10
        evidence=answer["report"]["case_page"]["cases"][0]["value_evidence"]["creation_value"]
        assert evidence["candidate_count"]==2 and len(evidence["row_ids"])==2
        rejected=deepcopy(value);rejected["query"]["value_reducer"]="first_creation"
        request["settings"]["exposure_policy"]="creation_unique_value";request["exposure_review"]=rejected
        before=tree(tmp_path);refused=client.post("/api/investigations/bpic19-score",json=request)
        assert refused.status_code==409 and refused.json()["code"]=="unsupported_definition",refused.text
        assert tree(tmp_path)==before


@pytest.mark.parametrize("volume",["cases","exposure"])
def test_historical_raw_review_fit_is_admitted_even_under_outer_paper_creation_or_count(tmp_path,monkeypatch,volume):
    original=scoring.Bpic19Scoring
    monkeypatch.setattr(scoring,"Bpic19Scoring",lambda imports:original(imports,max_cases=1,max_retained_records=5))
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":10,"B":90}))
        selected(client,wid,base,None)
        child=selected(client,wid,base,["A"],["A","B"])
        ref=review(client,wid,child,fit="parent",profile="historical_v1")
        def forbidden(*args,**kwargs):pytest.fail("A referenced historical raw fit must be capped before replay even if native creation/count does not itself fit P95")
        monkeypatch.setattr(scoring.Bpic19Measures,"measures",forbidden)
        monkeypatch.setattr(scoring,"evaluate_features",forbidden)
        request=given(wid,base,volume=volume,exposure_policy="creation_unique_value")
        request["named_population"]["identity"]=child;request["exposure_review"]=ref
        before=tree(tmp_path);response=client.post("/api/investigations/bpic19-score",json=request)
        assert response.status_code==400 and response.json()["code"]=="unsupported_policy",response.text
        assert "2 complete items and 9 retained original records" in response.json()["message"]
        assert tree(tmp_path)==before


def test_optional_reference_is_absent_or_closed_object_never_explicit_null(tmp_path):
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":10,"B":90}))
        request=given(wid,base);request["exposure_review"]=None
        before=tree(tmp_path);response=client.post("/api/investigations/bpic19-score",json=request)
        assert response.status_code==400 and response.json()["code"]=="invalid_request",response.text
        assert response.json()["field"]=="exposure_review" and tree(tmp_path)==before
        generic=score(client,wid,base,volume="exposure",exposure_policy="creation_unique_value")
        assert generic["report"]["exposure_calibration"]["source_field"]==12
        assert generic["report"]["exposure_calibration"]["source_column_name"]==HEADERS[12]
        assert generic["report"]["exposure_calibration"]["unit_provenance"]=="unconfirmed_generic_source_value_units"
        assert all(case["value_evidence"]["creation_value"]["unit"]=="source_value_units" for case in generic["report"]["case_page"]["cases"])


@pytest.mark.parametrize("field",["calibration_population","activity_selector","interval_source","interval_target","activity_operator",
                                "interval_policy","value_reducer","representation_policy","value_unit","value_band_edges"])
def test_copied_optional_nonnullable_recipe_fields_never_silently_default_null(tmp_path,field):
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":10,"B":90}))
        reference=review(client,wid,base);reference["query"][field]=None
        request=given(wid,base,volume="exposure",exposure_policy="creation_unique_value");request["exposure_review"]=reference
        before=tree(tmp_path);response=client.post("/api/investigations/bpic19-score",json=request)
        assert response.status_code==400 and response.json()["code"]=="invalid_request",response.text
        assert response.json()["field"]=="exposure_review.query."+field
        assert tree(tmp_path)==before


def test_nullable_roles_and_nullable_value_alias_remain_valid_reference_choices(tmp_path):
    with TestClient(create_app()) as client:
        wid,base=prepare(client,tmp_path,original_csv({"A":10,"B":90}))
        reference=review(client,wid,base)
        reference["query"]["roles"]=None
        raw=client.post("/api/investigations/bpic19-measures",json=envelope("bpic19_measures_request",workspace_id=wid,identity=base,query=reference["query"]))
        assert raw.status_code==200,raw.text
        reference["definition_id"]=raw.json()["definition_id"]
        answer=score(client,wid,base,reference=reference,volume="exposure",exposure_policy="creation_unique_value")
        assert group(answer,"A")["PI"]==pytest.approx(.25)
