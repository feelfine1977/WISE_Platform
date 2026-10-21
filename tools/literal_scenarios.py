"""Literal-fixture scenarios for tools/qualify_literal_browser.py.

Each scenario imports a ticket's independently written literal source and saves its reviewed pipeline over
public HTTP, reusing that ticket's HTTP test helpers. It returns the saved investigation's name, the save
answer and texts the built browser must show after reopening it; every text is a value written in the
ticket's HTTP test from the literal rows, not read from the answer.
"""

from __future__ import annotations

from pathlib import Path


def save(client, wid: str, base: dict, parent_case_ids: list[str] | None, name: str, actions: list[dict], predicates=()) -> dict:
    """Save the actions on the selected population that the built browser reopens."""
    from import_requests import envelope
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
        identity=base, parent_case_ids=parent_case_ids, predicates=list(predicates))).json()
    saved = client.post("/api/investigations/save", json=envelope("save_investigation_request", workspace_id=wid,
        investigation_id=None, expected_revision_id=None, name=name, base_identity=base, selection_identity=selected["identity"],
        selection_recipe={"parent_case_ids": selected["parent"]["case_ids"], "predicates": list(predicates)},
        context_policy="incident.context.first_record_in_declared_order.v1", comparison=None,
        notes="Synthetic literal qualified in the built browser", bookmarks=[],
        bpic19_pipeline={"schema_version": 1, "actions": [action(selected["identity"]) for action in actions]}))
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


SCENARIOS = {"issue112": issue112, "issue115": issue115, "issue113": issue113, "issue114": issue114, "issue104": issue104, "issue107": issue107, "issue108": issue108, "issue109": issue109,
             "issue110": issue110, "issue111": issue111}
