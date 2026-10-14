"""Comparison cohort identity and boundary checks through actual HTTP."""

from copy import deepcopy

from test_comparison_acceptance import (
    checked,
    comparison_request,
    explicit_groups,
    periods_definition,
    source_population,
)
from test_import_acceptance import (
    client,
    envelope,
    evidence,
    evidence_request,
    policies,
    population,
    prepare,
    refused as refused_import,
    upload,
    workspace,
)
from test_selection_acceptance import custom_population, opening, select

GROUPS = "/api/investigations/compare-groups"
PERIODS = "/api/investigations/compare-periods"


def reject_cohort_case(client, workspace, base, identity, case):
    request = evidence_request(workspace, {**base, "identity": identity}, case)
    refused_import(
        client.post("/api/investigations/case-evidence", json=request),
        "case_evidence",
        {"case_not_found"},
        request,
    )


def test_named_cohort_registry_evidence_and_exact_parent_id_before_selection_helpers(
    client, workspace
):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, explicit_groups())
    answer = checked(
        client.post(GROUPS, json=request), request, "group_comparison_answer"
    )
    # Do not use select() before these calls: it would register the identities itself.
    target = {**base, "identity": answer["target"]["identity"]}
    reference = {**base, "identity": answer["reference"]["identity"]}
    assert [
        r["activity"] for r in evidence(client, workspace, target, "G05")["records"]
    ] == ["Opened", "Resolved"]
    assert [
        r["activity"] for r in evidence(client, workspace, reference, "G03")["records"]
    ] == ["Opened", "Resolved"]
    reject_cohort_case(client, workspace, base, target["identity"], "G03")
    reject_cohort_case(client, workspace, base, reference["identity"], "G05")
    assert answer["parent_identity"] == select(client, workspace, base, [])["identity"]
    assert (
        target["identity"]
        == select(client, workspace, base, [], parent=["G01", "G02", "G05", "G08"])[
            "identity"
        ]
    )
    assert (
        reference["identity"]
        == select(client, workspace, base, [], parent=["G02", "G03", "G04", "G06"])[
            "identity"
        ]
    )


def test_period_boundaries_use_actual_case_start_equality_and_complete_histories(
    client, workspace
):
    base = source_population(client, workspace)
    definition = periods_definition()
    definition["target"]["window"].update(
        start_inclusive="2026-10-01T08:00:00Z", end_exclusive="2026-10-01T09:00:00Z"
    )
    definition["reference"]["window"].update(
        start_inclusive="2026-10-01T09:00:00Z", end_exclusive="2026-10-02T08:00:00Z"
    )
    request = comparison_request(workspace, base, definition, periods=True)
    answer = checked(
        client.post(PERIODS, json=request), request, "period_comparison_answer"
    )
    assert answer["target"]["included"] == {
        "case_ids": ["G01"],
        "case_count": 1,
        "record_count": 2,
    }
    assert answer["reference"]["included"] == {
        "case_ids": ["G02"],
        "case_count": 1,
        "record_count": 3,
    }
    assert answer["pair_support"]["neither"] == {
        "case_ids": ["G03", "G04", "G05", "G06", "G07", "G08"],
        "case_count": 6,
        "record_count": 13,
    }
    # G01's response after its end remains visible; starts at each inclusive edge remain inside.
    cohort = {**base, "identity": answer["target"]["identity"]}
    assert [
        r["utc_instant"] for r in evidence(client, workspace, cohort, "G01")["records"]
    ] == ["2026-10-01T08:00:00Z", "2026-10-01T11:00:00Z"]


def test_empty_reference_keeps_parent_inventory_and_unavailable_denominator(
    client, workspace
):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, explicit_groups(["G01"], []))
    answer = checked(
        client.post(GROUPS, json=request), request, "group_comparison_answer"
    )
    assert answer["reference"]["included"] == {
        "case_ids": [],
        "case_count": 0,
        "record_count": 0,
    }
    categories = {c["value"]: c for c in answer["context_profile"]["categories"]}
    assert len(answer["context_profile"]["categories"]) == 4
    assert set(categories) == {None, "CRM", "ERP", "Unknown"}
    for c in categories.values():
        assert c["reference"] == {
            "case_count": 0,
            "denominator": 0,
            "share": {"status": "unavailable", "reason": "empty_profile_denominator"},
        }
        assert c["difference_percentage_points"] == {
            "status": "unavailable",
            "reason": "empty_reference_profile",
        }
        assert c["concentration_ratio"] == {
            "status": "unavailable",
            "reason": "empty_reference_profile",
        }
    assert categories["ERP"]["target"] == {
        "case_count": 1,
        "denominator": 1,
        "share": {"status": "available", "value": 1},
    }
    assert categories["CRM"]["target"]["share"] == {"status": "available", "value": 0}


def test_explicit_empty_parent_is_not_all_current_and_empty_cohort_denies_evidence(
    client, workspace
):
    base = source_population(client, workspace)
    request = comparison_request(workspace, base, explicit_groups([], []))
    request["parent_case_ids"] = []
    answer = checked(
        client.post(GROUPS, json=request), request, "group_comparison_answer"
    )
    empty = {"case_ids": [], "case_count": 0, "record_count": 0}
    assert answer["parent"] == empty
    for role in ("target", "reference"):
        assert (
            answer[role]["included"]
            == answer[role]["excluded"]
            == answer[role]["unevaluable"]
            == empty
        )
    assert all(s == empty for s in answer["pair_support"].values())
    profile = answer["context_profile"]
    assert profile["categories"] == [] and profile["parent_fixed"] == {
        "status": "unavailable",
        "value": None,
        "reason": "empty_parent",
    }
    reject_cohort_case(client, workspace, base, answer["target"]["identity"], "G01")
    assert (
        answer["parent_identity"]
        == select(client, workspace, base, [], parent=[])["identity"]
    )


def test_predicate_named_groups_use_literal_natural_oracle_and_common_parent(
    client, workspace
):
    base = source_population(client, workspace)
    definition = {
        "mode": "two_named_groups",
        "target": {
            "name": "Opening ERP",
            "definition": {"kind": "predicates", "predicates": [opening(4, "ERP")]},
        },
        "reference": {
            "name": "Opening High",
            "definition": {"kind": "predicates", "predicates": [opening(5, "High")]},
        },
    }
    request = comparison_request(workspace, base, definition)
    answer = checked(
        client.post(GROUPS, json=request), request, "group_comparison_answer"
    )
    assert answer["target"]["included"] == {
        "case_ids": ["G01", "G02", "G05"],
        "case_count": 3,
        "record_count": 7,
    }
    assert answer["reference"]["included"] == {
        "case_ids": ["G01", "G02", "G04", "G08"],
        "case_count": 4,
        "record_count": 10,
    }
    assert answer["pair_support"]["overlap"] == {
        "case_ids": ["G01", "G02"],
        "case_count": 2,
        "record_count": 5,
    }
    assert answer["pair_support"]["neither"] == {
        "case_ids": ["G03", "G06", "G07"],
        "case_count": 3,
        "record_count": 6,
    }
    # Separate fully evaluable fixed parent; no group may be replaced with its complement.
    fixed = comparison_request(workspace, base, explicit_groups(["G01"], ["G02"]))
    fixed["parent_case_ids"] = ["G02", "G01"]
    f = checked(client.post(GROUPS, json=fixed), fixed, "group_comparison_answer")
    assert f["parent"] == {
        "case_ids": ["G01", "G02"],
        "case_count": 2,
        "record_count": 5,
    }
    assert f["context_profile"]["parent_fixed"] == {
        "status": "fixed",
        "value": "ERP",
        "reason": None,
    }
    assert len(f["context_profile"]["categories"]) == 1
    assert (
        f["parent_identity"]
        == select(client, workspace, base, [], parent=["G01", "G02"])["identity"]
    )


def test_partition_never_turns_unknown_order_into_reference_and_profiles_exclude_u(
    client, workspace
):
    raw = b"Case;Activity;At;Group\nA;Observed;2026-10-09T08:00:00Z;\nA;Updated;2026-10-09T09:00:00Z;Later\nB;Observed;2026-10-09T08:00:00Z;Unknown\nU;Observed;2026-10-09T08:00:00Z;Unknown\nU;Updated;bad-time;Unknown\n"
    base = custom_population(client, workspace, raw, context=True)
    named = {
        "mode": "two_named_groups",
        "target": {
            "name": "All",
            "definition": {"kind": "explicit_case_ids", "case_ids": ["A", "B", "U"]},
        },
        "reference": {
            "name": "Known Unknown",
            "definition": {"kind": "predicates", "predicates": [opening(3, "Unknown")]},
        },
    }
    req = comparison_request(workspace, base, named, context=3)
    a = checked(client.post(GROUPS, json=req), req, "group_comparison_answer")
    assert a["target"]["included"] == {
        "case_ids": ["A", "B", "U"],
        "case_count": 3,
        "record_count": 5,
    }
    assert a["pair_support"]["unevaluable"] == {
        "case_ids": ["U"],
        "case_count": 1,
        "record_count": 2,
    }
    profile = a["context_profile"]
    categories = {c["value"]: c for c in profile["categories"]}
    assert profile["target_evaluable"] == {
        "case_ids": ["A", "B"],
        "case_count": 2,
        "record_count": 3,
    }
    assert profile["target_unevaluable"] == {
        "case_ids": ["U"],
        "case_count": 1,
        "record_count": 2,
    }
    assert categories[None]["target"] == {
        "case_count": 1,
        "denominator": 2,
        "share": {"status": "available", "value": 0.5},
    }
    assert categories["Unknown"]["target"] == {
        "case_count": 1,
        "denominator": 2,
        "share": {"status": "available", "value": 0.5},
    }
    partition = {
        "mode": "selection_partition",
        "target_name": "Kept",
        "reference_name": "Removed",
        "predicates": [opening(3, "Unknown")],
        "target_side": "kept",
    }
    req = comparison_request(workspace, base, partition, context=3)
    p = checked(client.post(GROUPS, json=req), req, "group_comparison_answer")
    assert p["target"]["included"] == {
        "case_ids": ["B"],
        "case_count": 1,
        "record_count": 1,
    }
    assert p["reference"]["included"] == {
        "case_ids": ["A"],
        "case_count": 1,
        "record_count": 2,
    }
    assert (
        p["target"]["unevaluable"]
        == p["reference"]["unevaluable"]
        == {"case_ids": ["U"], "case_count": 1, "record_count": 2}
    )
    assert (
        p["pair_support"]["overlap"]["case_ids"]
        == p["pair_support"]["neither"]["case_ids"]
        == []
    )
    opposite = deepcopy(req)
    opposite["definition"]["target_side"] = "removed"
    swapped = checked(
        client.post(GROUPS, json=opposite), opposite, "group_comparison_answer"
    )
    assert (
        swapped["target"]["included"] == p["reference"]["included"]
        and swapped["reference"]["included"] == p["target"]["included"]
    )
    assert swapped["comparison_id"] != p["comparison_id"]


def test_real_wall_period_has_no_utc_fabrication_or_default_endpoint(client, workspace):
    raw = b"Case;Activity;At;Group\nA;Observed;2026-10-09T08:00:00;Known\nA;Updated;2026-10-09T09:00:00;Known\nB;Observed;2026-10-10T11:00:00;Known\n"
    source = upload(client, workspace, raw)
    chosen = policies(wall=True)
    chosen["time"]["parameters"]["snapshot_cutoff_local"] = "2026-10-10T12:00:00"
    prep = envelope(
        "confirm_mapping_request",
        workspace_id=workspace["workspace_id"],
        source_id=source["source_id"],
        dialect={
            "encoding": "utf-8",
            "delimiter": ";",
            "quotechar": '"',
            "header": "first_record",
        },
        mapping={
            "case_column": 0,
            "activity_column": 1,
            "timestamp_column": 2,
            "sequence_column": None,
            "context_columns": [3],
        },
        policies=chosen,
        accept_report_issues=True,
    )
    base = population(client, workspace, prepare(client, prep))
    definition = periods_definition()
    definition["endpoint_activity"] = None
    definition["target"]["window"].update(
        timestamp_kind="wall_clock",
        start_inclusive="2026-10-09T08:00:00",
        end_exclusive="2026-10-10T11:00:00",
    )
    definition["reference"]["window"].update(
        timestamp_kind="wall_clock",
        start_inclusive="2026-10-10T11:00:00",
        end_exclusive="2026-10-11T00:00:00",
    )
    req = comparison_request(workspace, base, definition, periods=True, context=3)
    a = checked(client.post(PERIODS, json=req), req, "period_comparison_answer")
    assert a["target"]["included"] == {
        "case_ids": ["A"],
        "case_count": 1,
        "record_count": 2,
    }
    assert a["reference"]["included"] == {
        "case_ids": ["B"],
        "case_count": 1,
        "record_count": 1,
    }
    clock = a["followup_clock"]
    assert (
        clock["timestamp_kind"] == "wall_clock"
        and clock["duration_clock"] == "recorded_wall_clock_hours"
    )
    assert clock["clock_limitation"].strip()
    assert clock["snapshot_cutoff"] == {
        "timestamp_kind": "wall_clock",
        "utc_instant": None,
        "local_timestamp": "2026-10-10T12:00:00",
    }
    assert (
        a["target"]["endpoint_coverage"] is None
        and a["reference"]["endpoint_coverage"] is None
    )
    assert a["reference"]["exposure"]["inadequate"]["case_ids"] == ["B"]
    for role in ("target", "reference"):
        for exposure in a[role]["exposure"]["cases"]:
            assert exposure["case_start"]["utc_instant"] is None and not exposure[
                "case_start"
            ]["local_timestamp"].endswith("Z")
