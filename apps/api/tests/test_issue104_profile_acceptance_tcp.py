"""#104 acceptance at public HTTP over the literal G_1/D1 grain source and its native22/prepared29 lineage.

Expected values are read from GRAIN_ROWS by hand, not from the profile under test: prepared column n+7 holds
native column n, so prepared 12/16/24/27 are the document, category, user and cumulative net worth fields.
"""

import json
import socket

from import_requests import envelope
from test_bpic19_category_lineage_tcp import PREPARED_HEADERS, PREPARED_ROLES
from test_bpic19_grain_lineage_tcp import ALL_IDS, grain_request, prepare_grain_pair, save_grain_profile
from test_bpic19_historical_acceptance_tcp import tcp  # noqa: F401
from test_bpic19_profile_http import ROUTE
from test_bpic19_pipeline_http import start_process

PROFILE_ROLES = {"item_category", "item_type", "goods_receipt", "gr_based_iv", "purchasing_document", "item", "source_case"}


def select(client, wid, identity, case_ids):
    selected = client.post("/api/investigations/select-cases", json=envelope("select_cases_request",
        workspace_id=wid, identity=identity, parent_case_ids=case_ids, predicates=[]))
    assert selected.status_code == 200, selected.text
    return selected.json()["identity"]


def profile_of(client, given):
    response = client.post(ROUTE, json=given)
    assert response.status_code == 200, response.text
    return response.json()["profile"]


def attribute(profile, index):
    return next(item for item in profile["attributes"] if item["column_index"] == index)


def keys_and_numbers(value, keys, numbers):
    if isinstance(value, dict):
        for key, item in value.items():
            keys.add(key)
            keys_and_numbers(item, keys, numbers)
    elif isinstance(value, list):
        for item in value:
            keys_and_numbers(item, keys, numbers)
    elif type(value) in (int, float):
        numbers.add(value)
    return keys, numbers


def case_ids_anywhere(profile):
    """Every item ID the profile names in its flows, unresolved categories, cross-checks and grain issues."""
    named = set()
    for group in profile["flows"] + profile["unresolved"] + profile["cross_checks"] + profile["grain"]["identity_issues"]:
        named.update(group.get("case_ids", []))
        named.update(group.get("example_case_ids", []))
    for example in profile["grain"]["mixed_flow_document_examples"]:
        named.update(example["case_ids"])
    return named


def test_ac08_event_varying_user_and_value_stay_raw_without_a_static_actor_or_case_spend(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_grain_pair(client, tmp_path / "workspace")
    given = grain_request(wid, native, prepared)
    given["identity"] = select(client, wid, prepared, ["G_1"])
    given["query"]["include_document_siblings"] = False
    profile = profile_of(client, given)
    assert profile["population"] == {"case_count": 1, "record_count": 2, "document_count": 0, "document_unknown_case_count": 1}
    # f13 and f14 are G_1's two original records, at source positions 4 and 5.
    for index, raw in [(24, ["user_1", "batch_2"]), (27, ["100", "200"])]:
        field = attribute(profile, index)
        assert field["column_name"] == PREPARED_HEADERS[index]
        assert (field["distinct_nonmissing_value_count"], field["invariant_case_count"],
                field["conflicting_case_count"], field["missing_case_count"]) == (2, 0, 1, 0)
        assert sorted((value["value"], value["case_count"], value["record_count"]) for value in field["values"]) == \
            sorted([(raw[0], 1, 1), (raw[1], 1, 1)])
        witness = next(item for item in field["conflicting_witnesses"] if item["case_id"] == "G_1")
        assert [(row["source_position"], row["value"]) for row in witness["rows"]] == [(4, raw[0]), (5, raw[1])]
    # Raw profiling admits no semantic role beyond the seven reviewed profile roles: no actor, amount or spend
    # role, and no case-level figure is made of 100, 200 or their sum.
    assert set(profile["definition"]["roles"]) == PROFILE_ROLES
    keys, numbers = keys_and_numbers(profile, set(), set())
    assert not keys & {"spend", "case_spend", "amount", "net_worth", "value_role", "resource", "actor"}
    assert not numbers & {100, 200, 300}


def test_ac10_two_item_parent_counts_only_its_items_and_reports_outside_siblings_only_when_asked(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_grain_pair(client, tmp_path / "workspace")
    given = grain_request(wid, native, prepared)
    given["identity"] = select(client, wid, prepared, ["D1_1", "D1_2"])
    answers = {}
    for requested in (False, True):
        given["query"]["include_document_siblings"] = requested
        answers[requested] = profile = profile_of(client, given)
        assert profile["population"] == {"case_count": 2, "record_count": 4, "document_count": 1, "document_unknown_case_count": 0}
        category = attribute(profile, 16)
        assert (category["invariant_case_count"], category["conflicting_case_count"], category["missing_case_count"]) == (2, 0, 0)
        assert profile["grain"]["mixed_flow_document_count"] == 1
        assert case_ids_anywhere(profile) <= {"D1_1", "D1_2"}
        assert {flow["flow_id"]: flow["case_ids"] for flow in profile["flows"] if flow["case_ids"]} == \
            {"after_gr": ["D1_1"], "before_gr": ["D1_2"]}
    assert answers[False]["grain"].get("outside_parent_siblings") is None
    outside = answers[True]["grain"]["outside_parent_siblings"]
    assert (outside["case_ids"], outside["case_count"], outside["record_count"], outside["document_count"]) == (["D1_3"], 1, 1, 1)
    # Asking for siblings is presentation: the definition is the same.
    assert answers[False]["definition_id"] == answers[True]["definition_id"]


def test_e02_profile_route_refuses_an_unsupported_schema_and_an_unknown_origin_with_their_fields(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_grain_pair(client, tmp_path / "workspace")
    given = grain_request(wid, native, prepared)
    newer = {**given, "schema_version": 2}
    refused = client.post(ROUTE, json=newer)
    assert refused.status_code == 422, refused.text
    assert (refused.json()["code"], refused.json()["field"]) == ("unsupported_schema", "schema_version")
    unknown = json.loads(json.dumps(given))
    unknown["query"]["category_lineage"]["origin_preparation_id"] = "preparation.v1:sha256:" + "0" * 64
    refused = client.post(ROUTE, json=unknown)
    assert refused.status_code == 409, refused.text
    assert refused.json()["code"] == "preparation_unavailable"
    assert refused.json()["field"] == "query.category_lineage.origin_preparation_id"
    # The refusals changed nothing: the reviewed request still answers.
    assert profile_of(client, given)["population"]["case_count"] == 5


def test_e05_removing_lineage_or_choosing_another_raw_value_is_a_new_definition(tcp, tmp_path):
    client, _ = tcp
    wid, native, prepared = prepare_grain_pair(client, tmp_path / "workspace")
    given = grain_request(wid, native, prepared)
    with_lineage = profile_of(client, given)
    without = json.loads(json.dumps(given))
    del without["query"]["category_lineage"]
    without_lineage = profile_of(client, without)
    assert without_lineage["definition_id"] != with_lineage["definition_id"]
    assert without_lineage["population"] == with_lineage["population"]
    chosen = {}
    for raw in ("user_1", "batch_2"):
        view = json.loads(json.dumps(given))
        view["query"]["attribute_view"] = {"column_index": 24, "offset": 0, "limit": 12, "select_value": True, "value": raw}
        chosen[raw] = profile_of(client, view)
    assert chosen["user_1"]["definition_id"] != chosen["batch_2"]["definition_id"]
    assert len({chosen["user_1"]["definition_id"], chosen["batch_2"]["definition_id"], with_lineage["definition_id"]}) == 3
    # D1_1, D1_2, D1_3 and G_1 have a user_1 record; only G_1 has batch_2.
    assert chosen["user_1"]["attribute_view"]["selection"]["case_count"] == 4
    assert chosen["batch_2"]["attribute_view"]["selection"]["case_count"] == 1


def test_ac12_g1_conflict_with_lineage_survives_save_and_a_different_process_exactly(tmp_path):
    with socket.socket() as reserving:
        reserving.bind(("127.0.0.1", 0))
        port = reserving.getsockname()[1]
    workspace = tmp_path / "workspace"
    first, client = start_process(port)
    try:
        wid, native, prepared = prepare_grain_pair(client, workspace)
        given = grain_request(wid, native, prepared)
        profile = profile_of(client, given)
        saved = save_grain_profile(client, wid, prepared, given, profile)
    finally:
        first.terminate()
        first.wait(timeout=15)
    assert first.returncode is not None
    second, fresh = start_process(port)
    try:
        assert first.pid != second.pid
        opened = fresh.post("/api/workspaces/open", json=envelope("open_workspace_request", path=str(workspace)))
        assert opened.status_code == 200, opened.text
        reopened = fresh.post("/api/investigations/reopen", json=envelope("reopen_investigation_request",
            workspace_id=wid, saved_revision_id=saved["revision"]["saved_revision_id"]))
        assert reopened.status_code == 200, reopened.text
        content = reopened.json()["revision"]["content"]
        assert reopened.json()["revision"] == saved["revision"]
        assert reopened.json()["bpic19_outputs"] == saved["bpic19_outputs"]
        assert content["selection_recipe"]["parent_case_ids"] == ALL_IDS
        action = content["bpic19_pipeline"]["actions"][0]
        assert action["query"]["roles"] == PREPARED_ROLES
        assert action["query"]["policy_id"] == "bpic19.all_raw_case_attributes.v1"
        assert action["query"]["category_lineage"]["origin_column_index"] == 9
        rerun = fresh.post(ROUTE, json=given)
        assert rerun.status_code == 200, rerun.text
        again = rerun.json()["profile"]
        assert again == profile
        assert again["definition"]["roles"]["item_category"] == 16
        lineage = again["definition"]["category_lineage"]
        assert (lineage["origin_column_index"], lineage["column_index"], lineage["verified_record_count"]) == (9, 16, 8)
        assert again["population"] == {"case_count": 5, "record_count": 8, "document_count": 2, "document_unknown_case_count": 1}
        assert next(group for group in again["grain"]["identity_issues"]
                    if group["state"] == "conflicting_document_or_item")["case_ids"] == ["G_1"]
        for index, values in [(12, ["G", "Other"]), (24, ["user_1", "batch_2"]), (27, ["100", "200"])]:
            field = attribute(again, index)
            assert field["column_name"] == PREPARED_HEADERS[index]
            witness = next(item for item in field["conflicting_witnesses"] if item["case_id"] == "G_1")
            assert [(row["source_position"], row["value"]) for row in witness["rows"]] == [(4, values[0]), (5, values[1])]
    finally:
        second.terminate()
        second.wait(timeout=15)
