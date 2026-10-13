"""Parent-fixed grouping, cached time reducers and raw projection eligibility."""

from dataclasses import replace
from pathlib import Path
import importlib

import pytest

from wise_platform_analytics.case_profiles import case_list_projection
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import prepare
from wise_platform_analytics.rule_groups import rule_groups, validate_rule_groups_query
from test_csv_preparation_core import choices, dialect

MODULE = importlib.import_module("wise_platform_analytics.rule_groups")
ROOT = Path(__file__).resolve().parents[3]
RAW = (ROOT / "tests/fixtures/rule-groups/rule-groups-nine-case.csv").read_bytes()


def prepared(raw=RAW, wall=False):
    policy = choices("wall" if wall else "recorded", "iso8601")
    policy["time"]["parameters"][
        "snapshot_cutoff_local" if wall else "snapshot_cutoff_utc"
    ] = "2026-10-02T00:00:00" + ("" if wall else "Z")
    result = prepare(
        raw,
        dialect("utf-8", ","),
        {
            "case_column": 0,
            "activity_column": 1,
            "timestamp_column": 2,
            "sequence_column": 3,
            "context_columns": [4],
        },
        policy,
        True,
    )
    assert result.state == "ready"
    return result.preparation


def query(rule=None, offset=0, limit=50):
    return {
        "rule": rule
        or {
            "kind": "shared_reference",
            "column_index": 4,
            "minimum_parent_case_count": 2,
        },
        "distribution_edges_hours": [0, 1, 3, 6],
        "offset": offset,
        "limit": limit,
    }


def test_each_parent_time_summary_and_measure_baseline_are_reduced_once(monkeypatch):
    p = prepared()
    times, baselines, kept = [], [], []
    summary = MODULE.case_time_summary
    baseline = MODULE.case_distribution_baseline
    reducer = MODULE.case_distribution_for_kept

    def counted_summary(prep, cid):
        times.append(cid)
        return summary(prep, cid)

    def counted_baseline(summaries, parent, chosen, clock):
        baselines.append(chosen["measure"])
        return baseline(summaries, parent, chosen, clock)

    def counted_kept(summaries, members, base):
        kept.append((base["measure"], members))
        return reducer(summaries, members, base)

    monkeypatch.setattr(MODULE, "case_time_summary", counted_summary)
    monkeypatch.setattr(MODULE, "case_distribution_baseline", counted_baseline)
    monkeypatch.setattr(MODULE, "case_distribution_for_kept", counted_kept)
    result = rule_groups(
        p,
        list("ADEF"),
        list("ABCDEFGHI"),
        p.identity_dict(),
        query(offset=1, limit=1),
    )
    assert times == list("ABCDEFGHI")
    assert baselines == ["observed_span_hours", "maximum_adjacent_raw_gap_hours"]
    assert kept == [
        ("observed_span_hours", ("A",)),
        ("maximum_adjacent_raw_gap_hours", ("A",)),
    ]
    assert result["group_count"] == 5 and result["next_offset"] == 2
    assert result["parent_coverage"]["membership_incidence"]["case_count"] == 13
    assert result["groups"][0]["population"]["cases"]["case_ids"] == ["A"]


def test_group_distributions_match_whole_parent_case_list_without_changing_its_answers():
    p = prepared()
    result = rule_groups(p, list("ADEF"), list("ABCDEFGHI"), p.identity_dict(), query())
    for group in result["groups"]:
        ids = group["population"]["cases"]["case_ids"]
        for name, measure in [
            ("span", "observed_span_hours"),
            ("gap", "maximum_adjacent_raw_gap_hours"),
        ]:
            listed = case_list_projection(
                p,
                ids,
                list("ABCDEFGHI"),
                {
                    "search_text": None,
                    "sort": {"field": "case_id", "direction": "ascending"},
                    "offset": 0,
                    "limit": 200,
                    "distribution": {"measure": measure, "edges_hours": [0, 1, 3, 6]},
                },
            )
            assert group[name + "_distribution"] == listed["distribution"]


@pytest.mark.parametrize(
    "rule",
    [
        {"kind": "first_raw_activity"},
        {"kind": "last_raw_activity"},
        {"kind": "exact_mapped_sequence"},
        {"kind": "activity_presence", "activity": "Review"},
        {"kind": "raw_record_count_bands", "edges": [0, 2, 3]},
        {"kind": "shared_reference", "column_index": 4, "minimum_parent_case_count": 2},
    ],
)
def test_empty_parent_is_explicit_and_has_no_invented_support(rule):
    p = prepared()
    result = rule_groups(p, [], [], p.identity_dict(), query(rule))
    assert result["parent_coverage"] == result["population_coverage"]
    assert result["parent_coverage"]["total"] == {
        "case_count": 0,
        "record_count": 0,
        "omitted_activity_record_count": 0,
    }
    assert result["parent_coverage"]["unevaluable"]["case_ids"] == []
    for group in result["groups"]:
        assert group["parent"]["share"] is group["population"]["share"] is None
        assert group["exemplars"]["reason"] == "empty_current_group"
        assert group["span_distribution"]["parent_case_count"] == 0


def test_unknown_declared_order_does_not_replace_raw_presence_or_reference_membership():
    p = prepared()

    class Unordered:
        histories = p.histories
        policies = p.policies
        mapping = p.mapping

        def sequence_evaluable(self, cid):
            return False

        def identity_dict(self):
            return p.identity_dict()

    u = Unordered()
    result = rule_groups(
        u,
        ["A"],
        ["A"],
        p.identity_dict(),
        query({"kind": "activity_presence", "activity": "Review"}),
    )
    assert result["population_coverage"]["eligible"]["case_count"] == 1
    present = next(g for g in result["groups"] if g["key"]["present"])
    assert present["population"]["cases"]["case_ids"] == ["A"]
    assert present["exemplars"]["reason"] == "no_evaluable_case"
    boundaries = rule_groups(
        u, ["A"], ["A"], p.identity_dict(), query({"kind": "first_raw_activity"})
    )
    assert boundaries["groups"] == [] and boundaries["population_coverage"][
        "unevaluable"
    ]["case_ids"] == ["A"]


@pytest.mark.parametrize("clock", ["time", "order", "activity_projection"])
def test_unsupported_prepared_policies_are_refused(clock):
    p = prepared()
    policies = {name: dict(value) for name, value in p.policies.items()}
    policies[clock] = {"id": "unavailable-policy", "parameters": {}}
    bad = replace(p, policies=policies)
    assert (
        rule_groups(bad, ["A"], ["A"], p.identity_dict(), query()).code
        == "unsupported_policy"
    )


def test_foreign_parent_identity_unknown_duplicates_and_outside_members_are_refused():
    p = prepared()
    for current, parent, identity, code in [
        (["B"], ["A"], p.identity_dict(), "identity_mismatch"),
        (["A"], ["A", "A"], p.identity_dict(), "invalid_parent"),
        (["Z"], ["A"], p.identity_dict(), "unknown_case"),
        (
            ["A"],
            ["A"],
            {**p.identity_dict(), "source_id": "foreign"},
            "identity_mismatch",
        ),
    ]:
        result = rule_groups(p, current, parent, identity, query())
        assert isinstance(result, ImportRefusal) and result.code == code


@pytest.mark.parametrize(
    "edges",
    [
        [0, float("inf")],
        [0, float("nan")],
        [0, 10**400],
        [0, False],
        [0, -1],
        [0, 0],
        [1],
        [],
        list(range(33)),
    ],
)
def test_finite_increasing_edges_are_required_in_the_pure_query(edges):
    q = query()
    q["distribution_edges_hours"] = edges
    assert validate_rule_groups_query(q).code == "invalid_parameter"
