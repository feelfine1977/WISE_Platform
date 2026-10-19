"""#127 the separate historical notebook profile, at public HTTP.

Expected values are written from the rows below by hand.
* F29-Raw (four flows, items A-D) plus one singular "Change payment term" on A and a sentinel item S: S starts
  1948-01-01 with Create Purchase Order Item, then Record Goods Receipt and a second Create Purchase Order Item at the
  same 2018-01-02 instant (exact path A, B, A; signature A, B; three events over two distinct parsed times).
* A value literal: X has a goods receipt at 10 and a Change Price at 20; Y has one debit memo at 10. Item maxima 20
  and 10 give the linear P95 19.5, so X's price proxy is min(20/19.5, 1) = 1 and Y's memo proxy is 10/19.5. X's
  net-worth CV is sample SD sqrt(50) over mean 15 = .47140452 (threshold .5, deviation 0); Y's singleton CV is 0.
* A zero-mean literal: Z has values -10 and 10; the mean is clipped at 1e-6, so its CV saturates.
"""

import copy
import csv
import io
import math
import socket

from fastapi.testclient import TestClient

from wise_platform_api import bpic19_method
from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_pipeline_http import start_process
from test_bpic19_scoring_http import given, prepare, raw_source

HEADER = ["case", "case Purchasing Document", "case Item", "case Item Category", "case Goods Receipt", "case GR-Based IV", "case Item Type",
          "case Company", "case Spend area text", "activity", "time", "event org:resource", "event Cumulative net worth (EUR)"]
AFTER = "3-way match, invoice after GR"
PAYMENT = "c_l4_change_payment_terms_repeats"
CORRECTED = "bpic19.notebook.1.0-paper-aligned.corrected.singular_change_payment_term.v1"
VIEWS = ("Finance", "Logistics", "Compliance", "Automation")


def row(case, activity, time, amount, document=None):
    return [case, document or "D" + case, "00010", AFTER, "true", "true", "Standard", "0000", "Packaging", activity, time, "user_1", amount]


# A's added event repeats A's own case attributes (document D, as in F29-Raw).
F29 = raw_source([row("A", "Change payment term", "2018-02-01T00:00:00Z", 10, "D"),
                  row("S", "Create Purchase Order Item", "1948-01-01T00:00:00Z", 10),
                  row("S", "Record Goods Receipt", "2018-01-02T00:00:00Z", 10),
                  row("S", "Create Purchase Order Item", "2018-01-02T00:00:00Z", 10)])


def literal(rows) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(HEADER)
    writer.writerows(rows)
    return output.getvalue().encode()


VALUES = literal([row("X", "Record Goods Receipt", "2018-01-01T00:00:00Z", 10), row("X", "Change Price", "2018-01-02T00:00:00Z", 20),
                  row("Y", "Vendor creates debit memo", "2018-01-01T00:00:00Z", 10)])
ZERO_MEAN = literal([row("Z", "Record Goods Receipt", "2018-01-01T00:00:00Z", -10), row("Z", "Record Invoice Receipt", "2018-01-02T00:00:00Z", 10)])


def historical(client, wid, base, view="Finance", identity=None, **settings):
    request = given(wid, base, profile="historical", view=view, mode="layer_balanced", gamma=20, **settings)
    if identity is not None:
        request["named_population"] = {"name": "Kept items", "identity": identity}
    reply = client.post("/api/investigations/bpic19-score", json=request)
    assert reply.status_code == 200, reply.text
    return reply.json()


def criterion(answer, case_id, key):
    case = next(item for item in answer["report"]["case_page"]["cases"] if item["case_id"] == case_id)
    return next(item for item in case["criteria"] if item["criterion_id"] == key)


def test_t25_frozen_plural_selector_and_a_separately_reviewed_singular_correction(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare(client, workspace, F29)
        frozen = historical(client, wid, base)
        # T25-AC11: the frozen plural selector selects none of A's singular event, and says so.
        assert (criterion(frozen, "A", PAYMENT)["measurement"], criterion(frozen, "A", PAYMENT)["deviation"]) == (0, 0)
        assert frozen["report"]["selector_warnings"][0]["observed_occurrence_count"] == 1
        corrected = historical(client, wid, base, historical_corrections=["singular_change_payment_term"])
        # The reviewed singular correction (allowed count 0, width 2) counts it: deviation 1/2.
        assert (criterion(corrected, "A", PAYMENT)["measurement"], criterion(corrected, "A", PAYMENT)["deviation"]) == (1, .5)
        assert len(criterion(corrected, "A", PAYMENT)["row_ids"]) == 1 and corrected["report"]["selector_warnings"] == []
        # A new norm, profile and run; the frozen catalogue stays as it was and the correction is declared.
        assert (frozen["report"]["profile_id"], corrected["report"]["profile_id"]) == ("bpic19.notebook.1.0-paper-aligned.v1", CORRECTED)
        assert frozen["definition_id"] != corrected["definition_id"] and frozen["run_id"] != corrected["run_id"]
        metadata = corrected["report"]["norm"]["metadata"]
        assert metadata["source_operators"][PAYMENT]["params"]["activity"] == "Change Payment Terms"
        assert metadata["raw_bindings"][PAYMENT]["activities"] == ["Change payment term"]
        assert metadata["corrections"] == [{"correction_id": "singular_change_payment_term", "criterion_id": PAYMENT,
            "frozen_activity": "Change Payment Terms", "corrected_activity": "Change payment term",
            "reason": "The source records the singular label; the frozen plural selector matches none of it."}]
        assert metadata["source_sha256"] == frozen["report"]["norm"]["metadata"]["source_sha256"]
        assert corrected["report"]["settings"]["historical_corrections"] == ["singular_change_payment_term"]
        # 25-E02: a correction outside the historical profile, or an unregistered one, is refused by field.
        refused = client.post("/api/investigations/bpic19-score", json=given(wid, base, historical_corrections=["singular_change_payment_term"]))
        assert (refused.status_code, refused.json()["field"]) == (400, "settings.historical_corrections"), refused.text
        refused = client.post("/api/investigations/bpic19-score", json=given(wid, base, profile="historical", view="Finance", mode="layer_balanced",
                                                                             historical_corrections=["dedupe_ties"]))
        assert refused.status_code == 400 and refused.json()["field"].startswith("settings.historical_corrections"), refused.text
        # T25-AC08: the compatibility artifacts of the 1948 sentinel item, labelled for what they are.
        s = next(item for item in frozen["report"]["case_page"]["cases"] if item["case_id"] == "S")["historical_artifacts"]
        assert (s["start_quarter"], s["start_timestamp"][:10], len(s["start_row_ids"])) == ("1948Q1", "1948-01-01", 1)
        assert (s["representations"]["exact_sequence"], s["representations"]["first_occurrence_signature"]) == (
            ["Create Purchase Order Item", "Record Goods Receipt", "Create Purchase Order Item"], ["Create Purchase Order Item", "Record Goods Receipt"])
        assert (s["replication_proxy"]["value"], s["replication_proxy"]["interpretation"]) == (1.5, "original events divided by distinct parsed timestamps; not a verified duplicate count")


def test_t25_frozen_exposure_cv_and_witnessed_proxies(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare(client, workspace, VALUES)
        answer = historical(client, wid, base)
        # T25-AC05: P95 19.5 over the item maxima 20 and 10; the proxies carry their activity rows and the calibration.
        price, memo = criterion(answer, "X", "c_l6_high_exposure_price_change"), criterion(answer, "Y", "c_l6_high_exposure_memo")
        assert price["measurement"] == 1 and abs(memo["measurement"] - 10 / 19.5) < 1e-12
        assert len(price["row_ids"]) == 1 and len(memo["row_ids"]) == 1
        assert price["measurement_evidence"]["calibration_id"] == memo["measurement_evidence"]["calibration_id"]
        exposure = {item["case_id"]: item["value_evidence"]["exposure"] for item in answer["report"]["case_page"]["cases"]}
        assert (exposure["X"]["value"], exposure["Y"]["value"], exposure["X"]["reducer"]) == (20, 10, "maximum_absolute_event_value")
        assert exposure["X"]["winner_row_ids"] == price["row_ids"]
        # T25-AC06: sample SD (ddof 1) over the mean: sqrt(50)/15 under threshold .5; a singleton is 0.
        cv = criterion(answer, "X", "c_l6_bal_networth_volatility")
        assert abs(cv["measurement"] - math.sqrt(50) / 15) < 1e-12 and cv["deviation"] == 0 and cv["measurement_evidence"]["ddof"] == 1
        assert (criterion(answer, "Y", "c_l6_bal_networth_volatility")["measurement"], criterion(answer, "Y", "c_l6_bal_networth_volatility")["deviation"]) == (0, 0)
        # Subset inspection keeps the frozen parent cutoff: Y alone still reads 10/19.5.
        kept = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
            parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": ["Y"], "negate": False}])).json()
        subset = historical(client, wid, base, identity=kept["identity"])
        assert abs(criterion(subset, "Y", "c_l6_high_exposure_memo")["measurement"] - 10 / 19.5) < 1e-12
        assert subset["snapshot"]["workload_admission"]["includes_calibration_parent"] is True
    zero = tmp_path / "zero"; zero.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare(client, zero, ZERO_MEAN)
        z = criterion(historical(client, wid, base), "Z", "c_l6_bal_networth_volatility")
        # A zero mean uses the declared clipped denominator; it reconciles no amount.
        assert abs(z["measurement"] - math.sqrt(200) / 1e-6) < 1e-3 and z["deviation"] == 1


def test_t25_an_unsupported_criterion_is_a_named_omission_and_a_partial_profile(tmp_path, monkeypatch):
    original = bpic19_method.verified_historical_catalogue

    def with_unsupported():
        catalogue = copy.deepcopy(original())
        # A count criterion of a kind the platform has no qualified raw operator for.
        next(entry for entry in catalogue["source"]["constraints"] if entry["id"] == PAYMENT)["type"] = "unregistered_pattern"
        return catalogue

    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base = prepare(client, workspace, F29)
        monkeypatch.setattr(bpic19_method, "verified_historical_catalogue", with_unsupported)
        partial = historical(client, wid, base)
        report = partial["report"]
        # 25-B04 and T25-AC02: one unsupported meaning is an omission under a distinct partial identity, never full parity.
        assert report["profile_id"] == "bpic19.notebook.1.0-paper-aligned.partial.v1" and report["profile_complete"] is False
        assert (report["requested_criterion_count"], report["admitted_criterion_count"]) == (29, 28)
        assert [entry["reason"] for entry in report["omissions"]] == ["historical_raw_measure_semantics_not_yet_qualified"]
        monkeypatch.setattr(bpic19_method, "verified_historical_catalogue", original)
        full = historical(client, wid, base)
        assert full["report"]["profile_complete"] is True and full["definition_id"] != partial["definition_id"]


def test_t25_each_views_run_and_the_correction_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, base = prepare(client, workspace, F29)
        selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                                 parent_case_ids=None, predicates=[])).json()
        runs = [historical(client, wid, base, view, selected["identity"]) for view in VIEWS]
        runs.append(historical(client, wid, base, "Finance", selected["identity"], historical_corrections=["singular_change_payment_term"]))
        assert len({run["run_id"] for run in runs}) == 5

        def save(answers, notes, previous=None):
            return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
                investigation_id=previous and previous["revision"]["investigation_id"],
                expected_revision_id=previous and previous["revision"]["saved_revision_id"],
                name="T25 historical notebook", base_identity=base, selection_identity=selected["identity"],
                selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": []},
                context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes=notes, bookmarks=[],
                bpic19_pipeline={"schema_version": 1, "actions": [{"operation": "bpic19_score", "identity": selected["identity"], "definition_id": run["definition_id"],
                    "selection_prefix_length": 0, "query": {"run_id": run["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}
                    for run in answers]}))

        a = save(runs, "Four views and the reviewed correction")
        assert a.status_code == 200, a.text
        a = a.json()
        # 25-E07: B (Finance alone) replaces A only with A's revision.
        b = save(runs[:1], "Finance only", a)
        assert b.status_code == 200, b.text
        b = b.json()
        assert (save(runs[:1], "Against A", a).status_code) == 409
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        for saved in (a, b):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert (reopened.json()["revision"], reopened.json()["bpic19_outputs"]) == (saved["revision"], saved["bpic19_outputs"])
        # 25-B05: every view keeps its own run, view and the correction's profile, read from the stored runs, not rescored.
        outputs = [entry["output"] for entry in a["bpic19_outputs"]["outputs"]]
        assert [(o["run_id"], o["report"]["settings"]["view"], o["report"]["profile_id"]) for o in outputs] == \
               [(run["run_id"], run["report"]["settings"]["view"], run["report"]["profile_id"]) for run in runs]
        assert outputs[-1]["report"]["profile_id"] == CORRECTED
    finally:
        second.terminate()
        second.wait(timeout=15)
