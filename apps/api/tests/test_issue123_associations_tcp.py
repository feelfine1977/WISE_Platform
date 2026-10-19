"""#123 criterion associations over a frozen native run, at public HTTP.

The native run is the actual packed Method scoring an explicit two-metric norm over literal raw numeric fields
(A weight .75, B .25; deviation is the value above 0, width 1). The API admits only the reviewed BPIC19 norms,
so the run is stored through the workspace's own store, as in test_bpic19_associations.py; every association
action below goes through public HTTP. Expected values are written from these values by hand:
target t1..t5 with A=[.5, 0, NA, 1, 0], B=[1, NA, .5, 0, 0]; comparator c1, c2 with A=[.25, 0], B=[0, 0].
"""

import io
import json
import socket
import zipfile
from copy import deepcopy

from fastapi.testclient import TestClient
import httpx
import pytest

from wise_platform_api import method
from wise_platform_api.app import create_app
from wise_platform_api.bpic19_method import Bpic19Assessment, _transport
from wise_platform_api.bpic19_scoring import _store_artifact
from wise_platform_api.imports import Imports
from wise_platform_analytics.preparation import content_identity
from import_requests import envelope
from test_bpic19_associations import VALUES, original_source
from test_bpic19_scoring_http import SETTINGS, prepare
from test_bpic19_pipeline_http import start_process

ASSOCIATE, READ = "/api/investigations/bpic19-associate", "/api/investigations/bpic19-read"
PROFILE_ROLES = {"item_category": 3, "item_type": 6, "goods_receipt": 4, "gr_based_iv": 5, "purchasing_document": 1, "item": 2, "source_case": 0}
# The purchasing view adds the context and amount roles it finds by header name.
VIEW_ROLES = {**PROFILE_ROLES, "company": 7, "spend_area": 8, "resource": 11, "value": 12, "net_worth": 12}
METRIC = {"layer": "Measurements", "type": "metric"}
PLAIN = [("A", "A", 0), ("B", "B", 0)]


def native_run(workspace, wid, base, population, constraints=PLAIN, weights=None, roles=None):
    """Score literal columns 13 (A) and 14 (B) with the packed Method and store the frozen run for `population`.

    `roles` records the reviewed purchasing roles the run was made under, as a run from the score route does."""
    imports = Imports(forbidden=())
    imports.open_workspace(json.dumps(envelope("open_workspace_request", path=str(workspace))).encode())
    prepared = imports.prepared(wid, base["preparation_id"])[0]
    features = []
    for cid in sorted(prepared.histories):
        original = prepared.histories[cid][0]
        measurements = {}
        for key, column in (("A", 13), ("B", 14)):
            cell = original.original_cells[column]
            value = float(cell) if cell else None
            measurements[key] = {"value": value, "available": value is not None, "reason": None if value is not None else "empty_original_numeric_cell",
                                 "row_ids": [original.row_id], "unit": "normalized_fixture_measurement", "raw": cell, "source_column": column}
        features.append({"case_id": cid, "flow": "DF1", "document": cid, "company": "target" if cid.startswith("t") else "comparator",
                         "spend_area": "Literal", "record_count": 1, "record_row_ids": [original.row_id], "measures": measurements,
                         "representations": {"available": True, "exact_sequence": [original.activity], "first_occurrence_signature": [original.activity]}})
    ids = [key for key, _, _ in constraints]
    norm = {"schema_version": 3, "missing_values": "three_valued", "name": "independent.association.raw-numeric-fields.v1", "version": "1",
            "scoring_mode": "flat", "layers": [{"id": "Measurements"}],
            "views": [{"name": "Balanced", "constraint_weights": weights or {"A": .75, "B": .25}}],
            "constraints": [{"id": key, **METRIC, "params": {"attribute": attribute, "threshold": threshold, "width": 1, "direction": "high"}}
                            for key, attribute, threshold in constraints]}
    wise = method._wise()
    native_norm = wise.Norm.from_dict(norm)
    native_norm.validate()
    result = wise.score(_transport(features, None), native_norm, mode="flat", derive=False)
    result.check_decomposition()
    assessment = Bpic19Assessment({f["case_id"]: f for f in features}, result, norm, "Balanced", 0, ["company", "spend_area"], 1, "cases", None, [])
    report = assessment.report(case_limit=1, group_limit=100000)
    report["requested_criterion_count"] = len(ids)
    report["case_page"]["cases"] = []
    store = imports.opened_workspace(wid)
    definition = {"kind": "bpic19.native-snapshot.v3", "norm": norm, "settings": SETTINGS, "roles": roles or {}, "base_identity": base,
                  "source_recipe": "literal original raw numeric columns 13/14; native metrics only"}
    did = content_identity("definition-version", definition)
    definition["definition_version_id"] = did
    store.store_definition(definition)
    cases = sorted(prepared.histories)
    index = {"case_ids": cases, "parent_case_ids": cases,
             "contexts": {f["case_id"]: {key: f[key] for key in ("company", "spend_area", "document")} for f in features},
             "criterion_members": {key: {"evaluated": result.violations.index[result.violations[key].notna()].tolist(),
                                         "positive": result.violations.index[result.violations[key].gt(0)].tolist(),
                                         "unavailable": result.violations.index[result.violations[key].isna()].tolist()} for key in ids}}
    refs = [_store_artifact(store, report, "report"), _store_artifact(store, index, "membership")]
    for chunk in assessment.case_chunks(500):
        refs.append({**_store_artifact(store, chunk, "cases"), "offset": chunk["offset"], "count": len(chunk["cases"])})
    rid = content_identity("score-run", {"fixture": "literal T21", "definition": did, "identity": population})
    store.store_run({"identity": {"run_id": rid, "format": "bpic19.native-snapshot.v3", "definition_version_id": did, "base_identity": base,
                                  "parent_identity": population, "population_identity": population},
                     "definition_version": definition, "named_population": {"name": "Literal seven original items", "identity": population},
                     "snapshot": {"format": "bpic19.native-snapshot.v3", "artifacts": refs, "case_count": len(cases), "chunk_size": 500}})
    return rid


def association_query(target=("t1", "t2", "t3", "t4", "t5"), comparator=("c1", "c2"), criteria=("A", "B"), **settings):
    return {"policy_id": "bpic19.frozen_native_associations.v1",
            "target": {"name": "Target T", "selector": {"kind": "case_ids", "case_ids": list(target)}},
            "comparator": {"name": "Comparator C", "selector": {"kind": "case_ids", "case_ids": list(comparator)}},
            "criteria": list(criteria), "positive_threshold": 0, "pair_mode": "jointly_eligible", "pooled_sd": True,
            **{"min_support": 1, **settings}}


def associate(client, wid, rid, query, offset=0, limit=100):
    return client.post(ASSOCIATE, json=envelope("bpic19_association_request", "associate", 3, workspace_id=wid, run_id=rid, query=query,
                                                case_offset=offset, case_limit=limit))


def associated(client, wid, rid, **settings):
    reply = associate(client, wid, rid, association_query(**settings))
    assert reply.status_code == 200, reply.text
    return reply.json()


def members(client, wid, run_id, selection):
    reply = client.post(READ, json=envelope("bpic19_read_request", "members", 4, workspace_id=wid, run_id=run_id, case_offset=0, case_limit=100,
                                            case_filter={"association_set": selection}))
    assert reply.status_code == 200, reply.text
    return reply.json()["report"]["case_page"]["cases"]


def opened(client, workspace, source):
    wid, base = prepare(client, workspace, source)
    parent = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                           parent_case_ids=None, predicates=[])).json()
    return wid, base, parent


def test_t21_denominators_supports_and_unavailable_ratios(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base, parent = opened(client, workspace, original_source())
        rid = native_run(workspace, wid, base, parent["identity"])
        answer = associated(client, wid, rid)
        analysis = answer["report"]["association_analysis"]
        target = analysis["populations"]["target"]
        a, b = target["criteria"]["A"], target["criteria"]["B"]
        # 21-B01: total-case prevalence 2/5 and eligible firing 2/4 are separate denominators; t3's missing A is unavailable,
        # never a satisfied zero.
        assert (a["total_case_count"], a["eligible_case_count"], a["positive_case_count"], a["unavailable_case_count"]) == (5, 4, 2, 1)
        assert (a["total_case_prevalence"], a["eligible_firing_rate"], a["unavailable_case_ids"]) == (.4, .5, ["t3"])
        assert "t3" not in a["eligible_case_ids"] and b["unavailable_case_ids"] == ["t2"]
        # 21-B02: the unweighted eligible mean and sum are not the native view contribution or penalty mass.
        assert (a["eligible_mean_severity"], a["unweighted_severity_sum"], a["native_contribution_sum"]) == (.375, 1.5, 1.125)
        assert (b["unweighted_severity_sum"], b["native_contribution_sum"], target["native_penalty_mass"]) == (1.5, .75, 1.875)
        # 21-B03: every statistic keeps its recipe, support cutoff, formula, populations and their counts.
        assert (analysis["recipe_id"], analysis["minimum_support"]) == ("bpic19.frozen_native_associations.v1.jointly_eligible", 1)
        assert analysis["formulas"]["lift"] == "intersection * N / (left_positive * right_positive)"
        assert (target["name"], target["case_ids"], analysis["populations"]["comparator"]["case_ids"]) == ("Target T", ["t1", "t2", "t3", "t4", "t5"], ["c1", "c2"])
        pair = analysis["accepted_pairs"][0]
        assert (pair["jointly_eligible_case_ids"], pair["intersection_case_ids"], pair["union_case_ids"], pair["jaccard"], pair["lift"]) == \
               (["t1", "t4", "t5"], ["t1"], ["t1", "t4"], .5, 1.5)
        contrast = analysis["contrasts"][0]
        assert (contrast["target_eligible_count"], contrast["comparator_eligible_count"], contrast["target_total_count"], contrast["comparator_total_count"]) == (4, 2, 5, 2)
        assert contrast["mean_difference"] == .25 and contrast["total_prevalence_difference"] == pytest.approx(-.1)
        # 21-B04: unrelated metrics are not flagged; the interpretation names what is not inferred.
        assert pair["dependency"]["flag"] == "not_established"
        assert "no p-values, confidence intervals, independence, causality or savings" in analysis["interpretation"]
        # 21-AC04: support 2 suppresses the pair with its reason and exact intersection.
        suppressed = associated(client, wid, rid, min_support=2)["report"]["association_analysis"]
        assert suppressed["accepted_pairs"] == []
        row = suppressed["suppressed_pairs"][0]
        assert (row["suppression_reason"], row["intersection_case_ids"], row["support"]) == ("support_below_minimum", ["t1"], 1)
        # A jointly eligible pair that never fires has no lift or Jaccard: zero_support, not 0 or 1.
        quiet = associated(client, wid, rid, target=("t5", "c2"), comparator=("c1",), pooled_sd=False)["report"]["association_analysis"]
        zero = (quiet["accepted_pairs"] + quiet["suppressed_pairs"])[0]
        assert (zero["jointly_eligible_case_ids"], zero["support"]) == (["c2", "t5"], 0)
        assert (zero["jaccard"], zero["jaccard_reason"], zero["lift"], zero["lift_reason"]) == (None, "zero_support", None, "zero_support")
        # 21-AC06: by default no pooled magnitude is produced at all.
        assert quiet["contrasts"][0]["pooled_sample_sd_magnitude"] == {"value": None, "pooled_sample_sd": None, "reason": "not_requested"}


def test_t21_zero_pooled_variance_and_a_derived_ramp_are_labelled(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    values = {cid: (1 if cid.startswith("t") else 0, b) for cid, (_, b) in VALUES.items()}
    with TestClient(create_app()) as client:
        wid, base, parent = opened(client, workspace, original_source(values))
        # A count-like metric on A and its threshold ramp on the same A field, with an unrelated B.
        rid = native_run(workspace, wid, base, parent["identity"], [("A", "A", 0), ("A_ramp", "A", .5), ("B", "B", 0)],
                         {"A": .5, "A_ramp": .25, "B": .25})
        analysis = associated(client, wid, rid, criteria=("A", "A_ramp", "B"))["report"]["association_analysis"]
        # 21-AC06: mean difference 1 is available; pooled SD 0 makes the standardised magnitude unavailable, not 0.
        contrast = next(row for row in analysis["contrasts"] if row["criterion_id"] == "A")
        assert contrast["mean_difference"] == 1
        assert contrast["pooled_sample_sd_magnitude"] == {"value": None, "pooled_sample_sd": 0, "reason": "zero_pooled_variance"}
        # The ramp shares A's input: deterministic_derived with both features' lineage; A/B stays not_established.
        pairs = {(row["left"], row["right"]): row["dependency"] for row in analysis["accepted_pairs"] + analysis["suppressed_pairs"]}
        assert (pairs[("A", "A_ramp")]["flag"], pairs[("A", "A_ramp")]["left_attribute"], pairs[("A", "A_ramp")]["right_attribute"]) == ("deterministic_derived", "A", "A")
        assert pairs[("A", "A_ramp")]["interpretation"] == "Shared deterministic input is not evidence of an independent cause."
        assert pairs[("A", "B")]["flag"] == "not_established"


def test_t21_identities_refusals_and_complete_witnesses(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app()) as client:
        wid, base, parent = opened(client, workspace, original_source())
        rid = native_run(workspace, wid, base, parent["identity"])
        answer = associated(client, wid, rid)
        # 21-E05: order of IDs or criteria and the page are presentation; every setting is meaning.
        reordered = associate(client, wid, rid, association_query(target=("t5", "t4", "t3", "t2", "t1"), criteria=("B", "A")), offset=2, limit=2).json()
        assert (reordered["run_id"], reordered["definition_id"]) == (answer["run_id"], answer["definition_id"])
        variants = [associated(client, wid, rid, **change)["definition_id"] for change in
                    ({"min_support": 2}, {"pair_mode": "legacy_total_case"}, {"pooled_sd": False}, {"target": ("t1", "t2", "t3", "t4")}, {"comparator": ("c1",)})]
        assert len({answer["definition_id"], *variants}) == 6
        # 21-E02: each refused setting names its field and returns no association.
        for change, field in ((lambda q: q.update(criteria=["A", "Z"]), "query.criteria"),
                              (lambda q: q["target"]["selector"].update(case_ids=["t1", "zz"]), "query.target.selector.case_ids"),
                              (lambda q: q["target"].update(selector={"kind": "outside_target"}), "query.target.selector.kind"),
                              (lambda q: q["comparator"].update(selector={"kind": "group", "group_values": {"flow": "DF1"}}), "query.comparator.selector.group_values"),
                              (lambda q: q.update(min_support=0), "query.min_support")):
            bad = association_query()
            change(bad)
            refused = associate(client, wid, rid, bad)
            assert (refused.status_code, refused.json()["field"]) == (400, field), refused.text
            assert "report" not in refused.json()
        for selection, field in (({"population": "target", "state": "all", "pair": {"left": "A", "right": "Z", "set": "union"}}, "case_filter.association_set.pair"),
                                 ({"population": "target", "state": "positive", "criterion_id": "Z"}, "case_filter.association_set.criterion_id")):
            refused = client.post(READ, json=envelope("bpic19_read_request", "members", 4, workspace_id=wid, run_id=answer["run_id"],
                                                      case_offset=0, case_limit=100, case_filter={"association_set": selection}))
            assert (refused.status_code, refused.json()["field"]) == (400, field), refused.text
        # 21-AC07: the unavailable A member, the intersection and the comparator open as complete stored items with
        # their native criterion witnesses and every original record.
        missing = members(client, wid, answer["run_id"], {"population": "target", "criterion_id": "A", "state": "unavailable"})
        assert [case["case_id"] for case in missing] == ["t3"]
        witness = next(c for c in missing[0]["criteria"] if c["criterion_id"] == "A")
        assert (witness["deviation"], witness["reason"] != "evaluated") == (None, True)
        evidence = client.post("/api/investigations/case-evidence", json=envelope("imported_case_evidence_request",
            workspace_id=wid, identity=parent["identity"], case_id="t3")).json()
        assert sorted(record["row_id"] for record in evidence["records"]) == sorted(missing[0]["record_row_ids"])
        assert [case["case_id"] for case in members(client, wid, answer["run_id"], {"population": "target", "state": "all",
                "pair": {"left": "A", "right": "B", "set": "intersection"}})] == ["t1"]
        assert [case["case_id"] for case in members(client, wid, answer["run_id"], {"population": "comparator", "state": "all"})] == ["c1", "c2"]


def test_t21_kept_sets_and_saved_comparisons_survive_a_different_process(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"; workspace.mkdir()
    first, client = start_process(port)
    try:
        wid, base, parent = opened(client, workspace, original_source())
        rid = native_run(workspace, wid, base, parent["identity"])
        a = associated(client, wid, rid)
        # 21-AC07: Keep the unavailable A member t3 as a typed step tied to this association run.
        predicate = {"kind": "case_id_in", "case_ids": ["t3"], "negate": False}
        child = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid, identity=base,
                                                                              parent_case_ids=None, predicates=[predicate])).json()
        action = {"operation": "bpic19_score", "identity": parent["identity"], "definition_id": a["definition_id"],
                  "query": {"run_id": a["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50},
                  "selection_prefix_length": 0, "selection_keep": {"policy_id": "bpic19.association_set_keep.v1", "step_index": 0,
                      "group": {"kind": "association_set", "population": "target", "criterion_id": "A", "state": "unavailable"}}}

        def save(actions, notes, previous=None, selection=child, predicates=(predicate,)):
            return client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
                investigation_id=previous and previous["revision"]["investigation_id"],
                expected_revision_id=previous and previous["revision"]["saved_revision_id"],
                name="T21 associations", base_identity=base, selection_identity=selection["identity"],
                selection_recipe={"parent_case_ids": parent["parent"]["case_ids"], "predicates": list(predicates)},
                context_policy="incident.context.first_record_in_declared_order.v1", comparison=None, notes=notes,
                bookmarks=[], bpic19_pipeline={"schema_version": 1, "actions": actions}))

        # A Keep naming another set, or another policy, is refused before anything is written.
        for change, code in ((lambda k: k["group"].update(state="positive"), "selection_mismatch"),
                             (lambda k: k["group"].update(criterion_id="Z"), "invalid_parameter"),
                             (lambda k: k.update(policy_id="bpic19.interval_side_keep.v1"), "unsupported_policy")):
            bad = deepcopy(action)
            change(bad["selection_keep"])
            refused = save([bad], "Refused keep")
            assert refused.status_code >= 400 and refused.json()["code"] == code, refused.text
        saved_a = save([action], "Unavailable A kept")
        assert saved_a.status_code == 200, saved_a.text
        saved_a = saved_a.json()
        # 21-E07: run B (support 2) is saved on A only with A's current revision; an outdated revision is refused.
        b = associated(client, wid, rid, min_support=2)
        plain = {"operation": "bpic19_score", "identity": parent["identity"], "definition_id": b["definition_id"],
                 "query": {"run_id": b["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50}}
        saved_b = save([plain], "Support two", saved_a, parent, ())
        assert saved_b.status_code == 200, saved_b.text
        saved_b = saved_b.json()
        assert save([plain], "Written against revision A", saved_a, parent, ()).status_code == 409
        assert [o["output"]["run_id"] for o in saved_b["bpic19_outputs"]["outputs"]] == [b["run_id"]]
        # The export is a binary archive, read directly from the same public port.
        export = httpx.post(f"http://127.0.0.1:{port}/api/investigations/bpic19-export", json=envelope("bpic19_export_request",
                            workspace_id=wid, run_id=a["run_id"], case_offset=0, case_limit=100), timeout=60)
        assert export.status_code == 200
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert second.pid != first.pid
        assert fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace))).status_code == 200
        for saved, answer in ((saved_a, a), (saved_b, b)):
            reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
                workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
            assert reopened.status_code == 200, reopened.text
            assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
            # 21-AC08: populations, threshold, support cutoff, formulas, recipe mode and witnesses come back exactly.
            output = reopened.json()["bpic19_outputs"]["outputs"][0]["output"]
            assert output["report"]["association_analysis"] == answer["report"]["association_analysis"]
        assert reopened.json()["bpic19_outputs"]["outputs"][0]["output"]["report"]["association_analysis"]["minimum_support"] == 2
        kept = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved_a["revision"]["saved_revision_id"])).json()
        assert kept["revision"]["content"]["selection_recipe"]["predicates"] == [predicate]
        # The export's frozen recipe names the same query, memberships and counts as the reopened run.
        definition = fresh.post(READ, json=envelope("bpic19_read_request", "reread", 5, workspace_id=wid, run_id=a["run_id"],
                                                    case_offset=0, case_limit=100)).json()["definition"]
        recipe = manifest["definition_version"]["derived_recipe"]
        assert recipe == definition["derived_recipe"]
        assert (recipe["query"]["min_support"], recipe["query"]["pair_mode"], recipe["query"]["positive_threshold"]) == (1, "jointly_eligible", 0)
        assert (recipe["target_case_count"], recipe["comparator_case_count"]) == (5, 2)
        assert [case["case_id"] for case in members(fresh, wid, a["run_id"], {"population": "target", "criterion_id": "A", "state": "unavailable"})] == ["t3"]
    finally:
        second.terminate()
        second.wait(timeout=15)
