"""Literal-fixture scenarios for tools/qualify_literal_browser.py.

Each scenario imports a ticket's independently written literal source and saves its reviewed pipeline over
public HTTP, reusing that ticket's HTTP test helpers. It returns the saved investigation's name, the save
answer and texts the built browser must show after reopening it; every text is a value written in the
ticket's HTTP test from the literal rows, not read from the answer.
"""

from __future__ import annotations

from pathlib import Path


def save(client, wid: str, base: dict, parent_case_ids: list[str] | None, name: str, actions: list[dict], predicates=(), claims=()) -> dict:
    """Save the actions on the selected population that the built browser reopens."""
    from import_requests import envelope
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
        identity=base, parent_case_ids=parent_case_ids, predicates=list(predicates))).json()
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
        investigation_id=None, expected_revision_id=None, name=name, base_identity=base, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": list(predicates)},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
        notes="Synthetic literal qualified in the built browser", bookmarks=[],
        bpic19_pipeline={"schema_version": 1, "actions": [action(selected["identity"]) for action in actions],
                         **({"literature_claims": list(claims)} if claims else {})}))
    assert saved.status_code == 200, saved.text
    return saved.json()


def selection(client, wid: str, base: dict, parent_case_ids: list[str] | None) -> dict:
    from import_requests import envelope
    return client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
        identity=base, parent_case_ids=parent_case_ids, predicates=[])).json()["identity"]


def issue104(client, workspace: Path) -> dict:
    from test_bpic19_grain_lineage_tcp import ALL_IDS, grain_request, prepare_grain_pair
    from test_bpic19_profile_http import ROUTE
    workspace.rmdir()
    wid, native, prepared = prepare_grain_pair(client, workspace)
    given = grain_request(wid, native, prepared)
    given["identity"] = selection(client, wid, prepared, ALL_IDS)
    profile = client.post(ROUTE, json=given).json()["profile"]
    saved = save(client, wid, prepared, ALL_IDS, "Synthetic G_1 grain lineage", [lambda identity: {
        "operation": "bpic19_profile", "identity": identity, "query": given["query"], "definition_id": profile["definition_id"],
        "selection_prefix_length": 0}])
    return {"name": "Synthetic G_1 grain lineage", "saved": saved, "texts": [
        "5 PO items", "8 original records", "2 purchasing documents", "Items without a verified purchasing document: 1",
        "Verified Item Category correspondence", "8 original records checked across the entire source",
        "Conflicting original rows: G_1", "1 documents contain items in several flows"]}


def profiled(client, module, workspace: Path, parent_case_ids=None) -> tuple:
    """Import a measures-shaped literal and review its profile on the selected population."""
    from import_requests import envelope
    from literal_profile_columns import PROFILE_ROLES
    wid, base = module.prepare_source(client, workspace, module.LITERAL)
    identity = selection(client, wid, base, parent_case_ids)
    query = {"roles": PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    action = lambda current: {"operation": "bpic19_profile", "identity": current, "query": query,
                              "definition_id": profile["definition_id"], "selection_prefix_length": 0}
    return wid, base, identity, action


def measures_action(given: dict, answer: dict):
    return lambda current: {"operation": "bpic19_measures", "identity": current, "query": given["query"],
                            "definition_id": answer["definition_id"], "selection_prefix_length": 0}


def issue107(client, workspace: Path) -> dict:
    import test_issue107_activity_measures_tcp as literal
    wid, base, identity, profile = profiled(client, literal, workspace)
    given, answer = literal.measured(client, wid, identity)
    saved = save(client, wid, base, None, "T05 activity measures", [profile, measures_action(given, answer)])
    return {"name": "T05 activity measures", "saved": saved, "texts": [
        "6 PO items · 15 original records", "Reviewed selector: Record Invoice Receipt",
        "Presence-positive share: 50", "complete parent denominator 6", "Item D · ", "Item F · "]}


def issue108(client, workspace: Path) -> dict:
    import test_issue108_completion_cohorts_tcp as literal
    from import_requests import envelope
    wid, base, identity, profile = profiled(client, literal, workspace)
    given, answer = literal.cohorts(client, wid, identity)
    action = lambda current: {"operation": "bpic19_cohorts", "identity": current, "query": given["query"],
                              "definition_id": answer["definition_id"], "selection_prefix_length": 0}
    saved = save(client, wid, base, None, "T06 completion cohorts", [profile, action])
    return {"name": "T06 completion cohorts", "saved": saved, "texts": [
        "5 PO items · 16 original records", "3 PO items · 12 original records", "1 PO items · 2 original records",
        "missing_recorded_milestone:Clear Invoice", "missing_activity_label", "required_recorded_milestones_present"]}


def issue109(client, workspace: Path) -> dict:
    import test_issue109_interval_endpoints_tcp as literal
    wid, base, identity, profile = profiled(client, literal, workspace)
    given = literal.comparison_request(wid, identity)
    answer = literal.compared(client, given)
    action = lambda current: {"operation": "bpic19_interval_comparison", "identity": current, "query": given["query"],
                              "definition_id": answer["definition_id"], "selection_prefix_length": 0}
    saved = save(client, wid, base, None, "T07 interval endpoints", [profile, action])
    return {"name": "T07 interval endpoints", "saved": saved, "texts": [
        "Current parent: 6 complete items / 16 original records", "Outside both sides: 1 items",
        "Endpoint sets: Record Invoice Receipt → Clear Invoice", "reversed interval: 1", "minimum outside admissible range: 1",
        "Interval item A · 1 days", "Interval item T · 3 days", "Interval item Z · 0 days"]}


def issue110(client, workspace: Path) -> dict:
    import test_issue110_resource_proxies_tcp as literal
    wid, base, identity, profile = profiled(client, literal, workspace)
    given, answer, _ = literal.measured(client, wid, identity)
    saved = save(client, wid, base, None, "T08 resource proxies", [profile, measures_action(given, answer)])
    return {"name": "T08 resource proxies", "saved": saved, "texts": [
        "10 PO items · 33 original records", "Resource attribution by item", "batch-only", "unknown-containing",
        "unavailable · incomplete resource attribution"]}


def issue111(client, workspace: Path) -> dict:
    import test_issue111_item_values_tcp as literal
    wid, base, identity, profile = profiled(client, literal, workspace)
    given, answer, _ = literal.measured(client, wid, identity)
    saved = save(client, wid, base, None, "T09 item values", [profile, measures_action(given, answer)])
    return {"name": "T09 item values", "saved": saved, "texts": [
        "11 PO items · 13 original records", "Reviewed fixed value bands · tied values stay together", "Declared amount unit: EUR"]}


def scored_scenario(client, workspace: Path, literal, family: str, name: str, raw: bytes | None = None, **settings) -> dict:
    """Review the scoring literal's profile and score it with one criteria family, both on the selected population."""
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.literal() if raw is None else raw)
    identity = selection(client, wid, base, None)
    roles = {"item_category": 3, "item_type": 6, "goods_receipt": 4, "gr_based_iv": 5, "purchasing_document": 1, "item": 2, "source_case": 0}
    query = {"roles": roles, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    request = literal.given(wid, base, criteria_family=family, **settings)
    request["named_population"] = {"name": name + " literal items", "identity": identity}
    scored = client.post("/api/investigations/bpic19-score", json=request).json()
    return save(client, wid, base, None, name, [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_score", "identity": current, "definition_id": scored["definition_id"],
                         "query": {"run_id": scored["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50},
                         "selection_prefix_length": 0}])


def issue112(client, workspace: Path) -> dict:
    import test_issue112_completion_norm_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion", "T10 completion norm")
    # Criterion rows read: id, total, out of scope, scope unknown, in-scope unavailable, eligible.
    return {"name": "T10 completion norm", "saved": saved, "texts": [
        "4 of 6 items scored · mean score 0.916667 · mean evidence coverage 1", "Partial profile: 3 of 10 criteria admitted.",
        "3 criteria compiled for Balanced", "activities: Record Invoice Receipt; operator: witnessed binary presenceDF1, DF2, two_way",
        "C0161104", "C0261104", "C0362103"]}


def issue113(client, workspace: Path) -> dict:
    import test_issue113_timing_norm_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion_timing", "T11 timing norm")
    # Scores by hand: K30 1, K60 .9, K90 .8, M .75, E 1, V .8, B 1, R 1, G 1 (mean 11/12); coverage M .8, R .8 and
    # G .6 (its 2016 receipt and invoice minima are outside the gate), others 1 (mean 8.2/9). Criterion rows read:
    # id, total, out of scope, scope unknown, in-scope unavailable, eligible, positive.
    return {"name": "T11 timing norm", "saved": saved, "texts": [
        "9 of 9 items scored · mean score 0.916667 · mean evidence coverage 0.911111", "Partial profile: 5 of 10 criteria admitted.",
        "5 criteria compiled for Balanced", "C02900091", "C04900362", "C05910171"]}


def issue114(client, workspace: Path) -> dict:
    import test_issue114_rework_effort_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion_rework_effort", "T12 rework and effort")
    # Criterion rows by hand (id, total, out of scope, scope unknown, in-scope unavailable, eligible, positive):
    # C06 cancellation in X1, X2, F, K; N unavailable. C08 repeated receipts in Z2, Z4; K, N unavailable.
    # C09 more than five user events in Y3, Z4, U10, U15, D7, F. C10 more than two users in D3, D7, F.
    return {"name": "T12 rework and effort", "saved": saved, "texts": [
        "19 of 19 items scored", "Partial profile: 8 of 10 criteria admitted.", "8 criteria compiled for Balanced",
        "C0619001184", "C0819002172", "C0919000196", "C1019000193"]}


def issue115(client, workspace: Path) -> dict:
    import test_issue115_group_priority_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion_timing", "T13 group priority", literal.AC02,
                            group_by=["company"], min_cases=2)
    # By hand: scores .9, .95, 1 and one unscored Consignment item; G has 2 items, mean .925 and PI 2 × (.95 − .925).
    return {"name": "T13 group priority", "saved": saved, "texts": [
        "3 of 4 items scored · mean score 0.95 · mean evidence coverage 1", "Business group priorities · 1 shown of 1",
        "G20.92520.050.050.95", "Inspect members of G", "A PI of 0 means the group's mean is at or above that reference; it is not compliance"]}


def issue116(client, workspace: Path) -> dict:
    import test_issue116_signed_drivers_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion_timing", "T14 signed drivers", literal.DRIVERS,
                            group_by=["company"], min_cases=1)
    # By hand: G (90, 60 days) mean .85, PI 2 × (.8625 − .85) = .025 from Completion −.125 and Timing +.15;
    # H (30 days, never cleared) mean .875, PI 0 from Completion +.125 and Timing −.15.
    return {"name": "T14 signed drivers", "saved": saved, "texts": [
        "4 of 4 items scored · mean score 0.8625", "G20.8520.0250.0250.8625", "H20.875200",
        "G-0.0625-0.125-0.125", "0.0750.150.15", "0.06250.1250.125", "-0.075-0.15-0.15",
        "Timing exemplarsW60 · all-evaluable median 75 days · evaluated support 2 · positive candidates 2."]}


def issue117(client, workspace: Path) -> dict:
    import test_issue117_ranking_settings_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion_timing", "T15 ranking settings", literal.RANKING,
                            group_by=["company"], min_cases=1)
    # By hand (see the HTTP test): gamma 0 ranks S (.148) before L (.112); gamma 20 ranks L (.018667) before S
    # (.007048); mean penalty puts S first (.2), total penalty L first (.32). Rows: group, count, then values.
    head = "companyn casesmean penaltypenalty massmean scoreglobal meanPIstable PI"
    return {"name": "T15 ranking settings", "saved": saved, "texts": [
        "10 of 10 items scored · mean score 0.948",
        "PI gamma 0" + head + "S1UnavailableUnavailable0.80.9480.1480.148L4UnavailableUnavailable0.920.9480.1120.112",
        "PI gamma 20" + head + "L4UnavailableUnavailable0.920.9480.1120.018667S1UnavailableUnavailable0.80.9480.1480.007048",
        "mean penalty" + head + "S10.20.2", "total penalty" + head + "L40.080.32",
        "Empty unions have unavailable overlap."]}


def issue118(client, workspace: Path) -> dict:
    import test_issue118_document_priority_tcp as literal
    saved = scored_scenario(client, workspace, literal, "completion_timing", "T16 document priority", literal.DOCUMENTS,
                            group_by=["document"], min_cases=1)
    # By hand: D1 two scored of three members (.8, .9 and unscored U), PI .075; D2 .85, PI .0375; D3 1, PI 0.
    # Rows: document, scored, members, unscored, mean, volume, PI, stable PI, positive PI share.
    return {"name": "T16 document priority", "saved": saved, "texts": [
        "4 of 5 items scored · mean score 0.8875", "Purchasing document priorities · 3 shown of 3 · scored items per document",
        "D12310.8520.0750.0750.666667", "D21100.8510.03750.03750.333333", "D311011000",
        "A PI of 0 means the group's mean is at or above that reference; it is not compliance"]}


def issue129(client, workspace: Path) -> dict:
    import test_issue129_exposure_priority_tcp as literal
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.SOURCE)
    identity = literal.subset(client, wid, base, ["S1", "S2"])
    roles = {"item_category": 3, "item_type": 6, "goods_receipt": 4, "gr_based_iv": 5, "purchasing_document": 1, "item": 2, "source_case": 0}
    query = {"roles": roles, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    scored = literal.exposure(client, wid, base, identity, "creation_unique_value").json()
    saved = save(client, wid, base, None, "T27 exposure priority", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 1},
        lambda current: {"operation": "bpic19_score", "identity": current, "definition_id": scored["definition_id"],
                         "query": {"run_id": scored["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50},
                         "selection_prefix_length": 1}], [{"kind": "case_id_in", "case_ids": ["S1", "S2"], "negate": False}])
    # By hand: S1 meets all three completion checks (1), S2 has only its creation (0); D4's creation exposure is
    # 10 + 20 = 30. Document row: document, scored, members, unscored, mean, volume, PI, stable PI, share.
    return {"name": "T27 exposure priority", "saved": saved, "texts": [
        "2 of 2 items scored · mean score 0.5", "Purchasing document priorities · 1 shown of 1 · scored items per document",
        "D42200.53000Unavailable", "This stored run uses generic source value units."]}


def issue119(client, workspace: Path) -> dict:
    import test_issue119_variants_signature_tcp as literal
    wid, base, identity, profile = profiled(client, literal, workspace)
    given, answer, _ = literal.measured(client, wid, identity, representation_policy="exact")
    saved = save(client, wid, base, None, "T17 variants and signature", [profile, measures_action(given, answer)])
    # Rows: recorded path, items, records. The signature merges L's loop and T's repeat into A → B.
    return {"name": "T17 variants and signature", "saved": saved, "texts": [
        "5 PO items · 14 original records", "preserves all 14 original records. 2 items have unavailable representations.",
        "Exact baseline3 groups", "A → B → B → A14", "A → B → B13", "A → X → B13", "First-occurrence signature2 groups", "A → B27"]}


def issue120(client, workspace: Path) -> dict:
    import test_issue120_ordinal_episodes_tcp as literal
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.RAW)
    identity = selection(client, wid, base, None)
    query = {"roles": literal.PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    given = literal.request(wid, identity, literal.ORDINAL, limit=100)
    answer = client.post(literal.ROUTE, json=given).json()
    saved = save(client, wid, base, None, "T18 ordinal episodes", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_ordinal", "identity": current, "query": given["query"], "definition_id": answer["definition_id"],
                         "selection_prefix_length": 0}])
    # By hand. Cohorts (state, items, records): evaluated R, Z, V, M, K 5/19; matched R, Z, K 3/14; reversed V 1/3;
    # unmatched M 1/2; unknown A 1/2. Stage 1→2 lags per episode 1, 1, 0, 1, 1 (V reversed): 5 available, 1 not,
    # mean .8, median 1, one zero; per item R 1, Z 0, K 1, M 1: mean .75. Stage 2→3 per episode 2, 2, 2, 2, 3 (M none):
    # mean 2.2; per item R 2, Z 2, K 2, V 3: mean 2.25.
    return {"name": "T18 ordinal episodes", "saved": saved, "texts": [
        "evaluated519", "observation matched314", "observation reversed13", "observation unmatched12", "unknown12",
        "stage 1 to 2 / per episode5 / 10.811", "stage 1 to 2 / per item mean4 / 20.7511",
        "stage 2 to 3 / per episode5 / 12.220", "stage 2 to 3 / per item mean4 / 22.2520"]}


def issue121(client, workspace: Path) -> dict:
    import test_issue121_fifo_matches_tcp as literal
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.RAW)
    identity = selection(client, wid, base, None)
    query = {"roles": literal.PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    given = literal.comparison_request(client, wid, identity)
    compared = client.post(literal.COMPARE, json=given).json()
    saved = save(client, wid, base, None, "T19 FIFO and ordinal", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_operator_comparison", "identity": current, "query": given["query"],
                         "definition_id": compared["definition_id"], "selection_prefix_length": 0}])
    # By hand. Ordinal (eventID kth): P two reversed cycles and an unmatched third clearing, Q and K matched, W unknown
    # (IR time missing); 15 endpoint events; stage 1→2 lags 1, 1, 0, 1 (mean .75); stage 2→3 only Q 1 and K 2 (mean 1.5).
    # FIFO (timestamp): P two matched triples and c0 unmatched, Q and K matched, W unknown chronology; 12 endpoint events;
    # stage 1→2 1, 1, 0, 1 (mean .75); stage 2→3 1, 1, 1, 2 (mean 1.25), per item P 1, Q 1, K 2 (mean 1.333333).
    return {"name": "T19 FIFO and ordinal", "saved": saved, "texts": [
        "Ordinal4 / 17evaluated 4matched 2 · reversed 2 · unmatched 1 · unknown 11150.75 (4 available, 2 not) / 0.666667 (3 items)1.5 (2 available, 4 not) / 1.5 (2 items)",
        "FIFO4 / 17evaluated 3 · unknown 1matched 41120.75 (4 available, 0 not) / 0.666667 (3 items)1.25 (4 available, 0 not) / 1.333333 (3 items)",
        "A smaller mean under one recipe describes different matched support; it is not a proven process improvement."]}


def issue122(client, workspace: Path) -> dict:
    import test_issue122_cancellation_links_tcp as literal
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.RAW)
    identity = selection(client, wid, base, None)
    query = {"roles": literal.PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    given = literal.request(wid, identity, literal.CANCELLATION, limit=100)
    answer = client.post(literal.ROUTE, json=given).json()
    saved = save(client, wid, base, None, "T20 cancellation links", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_cancellation", "identity": current, "query": given["query"], "definition_id": answer["definition_id"],
                         "selection_prefix_length": 0}])
    # By hand (amounts ignored, consuming, strict predecessor, ties refused). Observations: C, Z, M and D's first
    # cancellation matched; T ambiguous (two equally latest receipts); N and D's second cancellation unmatched.
    # Item cohorts (items, records): evaluated 6/14; matched C, Z, M, D 4/10; ambiguous T 1/3; unmatched N, D 2/4.
    # Every link spans one day: per episode 4 available, 3 not; per item C, Z, M, D 4 available, T and N not.
    return {"name": "T20 cancellation links", "saved": saved, "texts": [
        "6 complete PO items · 14 original records · 7 inferred observations · Latest preceding cancellation links.",
        "evaluated614", "observation ambiguous13", "observation matched410", "observation unmatched24",
        "receipt to cancellation / per episode4 / 3110", "receipt to cancellation / per item mean4 / 2110",
        "Monetary totals remain separate; every clearing record is retained. A clearing-window deletion policy is unavailable until a separate selector, window and tie rule are declared; no financial-breach verdict is inferred."]}


def issue128(client, workspace: Path) -> dict:
    import test_issue128_quantified_rules_tcp as literal
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.RAW)
    identity = selection(client, wid, base, None)
    query = {"roles": literal.PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    given = literal.request(wid, identity, literal.RULE, limit=100)
    answer = client.post(literal.ROUTE, json=given).json()
    saved = save(client, wid, base, None, "T26 quantified rule", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_rule", "identity": current, "query": given["query"], "definition_id": answer["definition_id"],
                         "selection_prefix_length": 0}])
    # By hand (eventual response A→B, every, reuse, equal time allowed). Items (records): evaluated E, M, P 3/7;
    # not activated N 1/2; unknown U 1/2. Occurrences: matched M's a1→b1 and E's a→b (items M, E 2/5); unmatched M's a2
    # and P's a (items M, P 2/5); unknown U's a (1/2). Truth: E true, M and P false, U unknown. Lags 1 and 0 days:
    # 2 available, 3 not, mean and median .5, one zero; per item M 1, E 0.
    return {"name": "T26 quantified rule", "saved": saved, "texts": [
        "5 complete PO items · 11 original records · 5 inferred observations · Quantified recorded-event rules.",
        "evaluated37", "not activated12", "observation matched25", "observation unknown12", "observation unmatched25",
        "truth false25", "truth true12", "truth unknown12",
        "relation lag / per episode2 / 30.50.51", "relation lag / per item mean2 / 30.50.51",
        "Item M · evaluated · rule false · 3 original records", "Item N · not activated · 2 original records",
        "Item U · unknown · rule unknown · 2 original records"]}


def issue123(client, workspace: Path) -> dict:
    import test_issue123_associations_tcp as literal
    from import_requests import envelope
    wid, base, parent = literal.opened(client, workspace, literal.original_source())
    identity = parent["identity"]
    query = {"roles": literal.PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    associated = literal.associated(client, wid, literal.native_run(workspace, wid, base, identity, roles=literal.VIEW_ROLES))
    saved = save(client, wid, base, None, "T21 criterion associations", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_score", "identity": current, "definition_id": associated["definition_id"],
                         "query": {"run_id": associated["run_id"], "case_offset": 0, "case_limit": 50, "group_offset": 0, "group_limit": 50},
                         "selection_prefix_length": 0}])
    # By hand from A=[.5,0,NA,1,0], B=[1,NA,.5,0,0] (target t1..t5) and A=[.25,0], B=[0,0] (comparator), weights A .75, B .25
    # renormalised over available criteria: penalties .625, 0, .5, .75, 0 (mass 1.875, mean .375); comparator .1875, 0.
    # Rows read: total, eligible, fired, unavailable, prevalence, eligible firing, mean, positive mean, sum, native
    # contribution, raw mean / median. Pooled SD (ddof 1): A sqrt((.6875+.03125)/4)=.423896, d .25/.423896=.58977;
    # B sqrt(.6875/4)=.414578, d .375/.414578=.904534. Pair on jointly eligible t1, t4, t5: support 1, Jaccard 1/2, lift 1.5.
    return {"name": "T21 criterion associations", "saved": saved, "texts": [
        "Pair recipe: bpic19.frozen_native_associations.v1.jointly_eligible. Minimum support 1.",
        "no p-values, confidence intervals, independence, causality or savings are inferred",
        "Target: Target T5 original items · 5 scored · native mean penalty 0.375 · native penalty mass 1.875.",
        "A54210.40.50.3750.751.51.1250.375 / 0.25 / normalized_fixture_measurement",
        "B54210.40.50.3750.751.50.750.375 / 0.25 / normalized_fixture_measurement",
        "Comparator: Comparator C2 original items · 2 scored · native mean penalty 0.09375 · native penalty mass 0.1875.",
        "A22100.50.50.1250.250.250.18750.125 / 0.125 / normalized_fixture_measurement",
        "A0.250-0.14 / 20.25 / normalized_fixture_measurement0.58976782available",
        "B0.3750.50.44 / 20.375 / normalized_fixture_measurement0.90453403available",
        "A / B310.51.5acceptednot_established · A / B"]}


def issue124(client, workspace: Path) -> dict:
    import test_issue124_waiting_occupancy_tcp as literal
    from import_requests import envelope
    wid, base = literal.prepare(client, workspace, literal.RAW)
    identity = selection(client, wid, base, None)
    query = {"roles": literal.PROFILE_ROLES, "profile_columns": None, "policy_id": "bpic19.all_raw_case_attributes.v1"}
    profile = client.post("/api/investigations/bpic19-profile", json=envelope("bpic19_profile_request", workspace_id=wid,
        identity=identity, query=query)).json()["profile"]
    given = literal.request(wid, identity, literal.CENSORED, limit=100)
    answer = client.post(literal.ROUTE, json=given).json()
    saved = save(client, wid, base, None, "T22 waiting occupancy", [
        lambda current: {"operation": "bpic19_profile", "identity": current, "query": query, "definition_id": profile["definition_id"],
                         "selection_prefix_length": 0},
        lambda current: {"operation": "bpic19_waiting", "identity": current, "query": given["query"], "definition_id": answer["definition_id"],
                         "selection_prefix_length": 0}])
    # By hand (first A to first B, right censored at the trusted day-6 horizon): A [0,2), B [2,4), C [1,3), D zero at day 2,
    # E open [1,6); F's response has no time (unknown), G is reversed. Cohorts (items/records): evaluated A-E 5/11,
    # matched A, B, C 3/8, censored E 1/1, zero D, reversed G and unknown F 1/2 each; peak A, C, E 3/7 (with A's and C's
    # Change Price). Durations 2, 2, 2, 0, 5: mean 2.2, median 2. Segments 1, 3, 3, 2, 1 over [0,1), [1,2), [2,3), [3,4),
    # [4,6): 11 item-days over 6 days, mean 1.8333, lower median 1 (count 1 holds 3 of 6 days).
    return {"name": "T22 waiting occupancy", "saved": saved, "texts": [
        "7 complete PO items · 15 original records · 7 inferred observations · Waiting intervals and occupancy.",
        "evaluated511", "observation censored11", "observation matched38", "observation reversed12", "observation unknown12",
        "observation zero12", "earliest peak occupancy37", "waiting duration / per episode5 / 22.221",
        "Right-censored occupancy over [2018-01-01T00:00:00, 2018-01-07T00:00:00) on the source's wall-clock clock: items with a known absent response stay open until the trusted horizon; an unknown response time stays unknown. This reads a finite snapshot, not the live queue.",
        "Cutoff receipt: horizon end 2018-01-07T00:00:00 · provenance Independent literal source snapshot; reviewed day6 observation cutoff · preparation trusted cutoff 2018-01-21T00:00:00 · outside the horizon: refused. Neither reading is an overdue or breach judgement: no obligation or due date is supplied.",
        "5 available intervals · 4 positive · 1 zero. Peak 3 PO items at [2018-01-02T00:00:00, 2018-01-03T00:00:00).",
        "11 item-days over 6 horizon days · duration-weighted mean 1.8333 items · lower median 1 items.",
        "2018-01-01T00:00:002018-01-02T00:00:0012018-01-02T00:00:002018-01-03T00:00:0032018-01-03T00:00:002018-01-04T00:00:0032018-01-04T00:00:002018-01-05T00:00:0022018-01-05T00:00:002018-01-07T00:00:001",
        "Item E · evaluated · 1 original records", "Item F · unknown · 2 original records", "Item G · reversed · 2 original records"]}


def issue125(client, workspace: Path) -> dict:
    import test_issue125_frozen_pipeline_tcp as literal
    wid, base, selected, query, profile = literal.frozen(client, workspace)
    run = literal.score(client, wid, base, selected)
    steps = literal.actions(selected, query, profile, run)
    claim = {**literal.CLAIM, "compared_run_id": run["run_id"]}
    saved = save(client, wid, base, None, "T23 frozen pipeline", [lambda current, step=step: step for step in steps],
                 predicates=[literal.KEEP_A], claims=[claim])
    # By hand: parent [A, B], kept [A]; A has all three Completion milestones, so 1 of 1 item scores 1 with coverage 1.
    return {"name": "T23 frozen pipeline", "saved": saved, "texts": [
        "1 of 1 items scored · mean score 1 · mean evidence coverage 1", "3 criteria compiled for Balanced"],
        "export_json": [
            (["scope", "source", "source_id"], base["source_id"]), (["scope", "preparation_id"], base["preparation_id"]),
            (["scope", "grain"], "complete PO item: one purchasing document item with its whole original event history"),
            (["scope", "parent", "case_ids"], ["A", "B"]), (["scope", "selected", "case_ids"], ["A"]),
            (["scope", "selected", "record_count"], 4), (["scope", "time_policy"], "incident.time.explicit_format_timezone_utc.v1"),
            (["scope", "time_parameters", "snapshot_cutoff_utc"], "2027-01-01T00:00:00Z"),
            (["revision", "content", "base_identity", "source_id"], base["source_id"]),
            (["revision", "content", "bpic19_pipeline", "actions", 0, "definition_id"], profile["definition_id"]),
            (["revision", "content", "bpic19_pipeline", "actions", 1, "query", "run_id"], run["run_id"]),
            (["manifest", "outputs", 1, "output", "run_id"], run["run_id"]),
            (["manifest", "outputs", 1, "output", "report", "case_page", "cases", 0, "case_id"], "A"),
            (["manifest", "literature_claims", 0, "claim_level"], "reported_not_rerun")],
        "report_texts": [
            "Frozen scope supplied by the service for this revision", "| Parent item IDs | A, B |", "| Selected item IDs | A |",
            "| Selected items / records | 1 / 4 |", "| Time policy snapshot\\_cutoff\\_utc | 2027-01-01T00:00:00Z |", base["source_id"], base["preparation_id"], profile["definition_id"], run["definition_id"],
            "Native run " + run["run_id"], "| Grain | complete PO item: one purchasing document item with its whole original event history |",
            "WISE\\_12\\_10\\_2026.pdf, PDF page 26, Table 4", "reported\\_not\\_rerun"]}


SCENARIOS = {"issue125": issue125, "issue124": issue124, "issue123": issue123, "issue128": issue128, "issue122": issue122, "issue112": issue112, "issue119": issue119, "issue120": issue120, "issue121": issue121, "issue115": issue115, "issue116": issue116, "issue117": issue117, "issue118": issue118, "issue129": issue129, "issue113": issue113, "issue114": issue114, "issue104": issue104, "issue107": issue107, "issue108": issue108, "issue109": issue109,
             "issue110": issue110, "issue111": issue111}
