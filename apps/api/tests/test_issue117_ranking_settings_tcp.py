"""#117 ranking settings compared on one frozen evaluation with the packed Method.

Expected values are written from the rows below by hand, with the timing family (score 1 − C04 deviation / 5,
deviation (days − 30) / 60): S has one item at 90 days (.8); L four items at 54 days (.92 each); R five items at
30 days (1). The all-scored reference is (.8 + 4 × .92 + 5) / 10 = .948. With gamma 0, PI is n × gap: S
1 × .148 = .148, L 4 × .028 = .112. With gamma 20 the gap shrinks by n / (n + 20): S .148 / 21 ≈ .00705,
L 4 × (4 / 24) × .028 ≈ .01867, so L ranks first while the same groups stay listed.
"""

from datetime import date, timedelta

from fastapi.testclient import TestClient
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope
from test_bpic19_scoring_http import VALIDATOR, given, prepare, read
from test_issue116_signed_drivers_tcp import item, literal

RANKING = literal(item("S1", "S", 90), *(item(f"L{index}", "L", 54) for index in range(1, 5)), *(item(f"R{index}", "R", 30) for index in range(1, 6)))
PERFECT = literal(*(item(f"P{index}", "P", 30) for index in range(1, 4)))
SETTINGS = {"criteria_family": "completion_timing", "group_by": ["company"], "min_cases": 1}


def scored(client, wid, identity, **settings):
    reply = client.post("/api/investigations/bpic19-score", json=given(wid, identity, **{**SETTINGS, **settings}))
    assert reply.status_code == 200, reply.text
    VALIDATOR.validate(reply.json())
    return reply.json()


def order(rows):
    return [row["company"] for row in rows]


def test_t15_gamma_changes_first_rank_not_membership_on_frozen_scores(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, RANKING)
        answer = scored(client, wid, identity)
        assert answer["report"]["mean_score"] == pytest.approx(.948)
        policies = answer["report"]["ranking_comparisons"]["group_policies"]
        gamma0, gamma20 = policies["PI_gamma_0"], policies["PI_gamma_20"]
        # 15-B02: same groups, a different first rank.
        assert set(order(gamma0)) == set(order(gamma20)) == {"S", "L", "R"}
        assert order(gamma0)[:2] == ["S", "L"] and order(gamma20)[:2] == ["L", "S"]
        assert {row["company"]: row["stable_PI"] for row in gamma0} == pytest.approx({"S": .148, "L": .112, "R": 0})
        assert {row["company"]: row["stable_PI"] for row in gamma20}["L"] == pytest.approx(4 * 4 / 24 * .028)
        assert {row["company"]: row["stable_PI"] for row in gamma20}["S"] == pytest.approx(.148 / 21)
        # Mean penalty puts S first (.2 against .08); total penalty puts L first (.32 against .2).
        assert order(policies["mean_penalty"])[:2] == ["S", "L"] and order(policies["total_penalty"])[:2] == ["L", "S"]
        # 15-B03: gamma is a ranking policy on the same frozen scores; it is not an interval.
        shrunk = scored(client, wid, identity, gamma=20)
        assert shrunk["definition_id"] != answer["definition_id"] and shrunk["run_id"] != answer["run_id"]
        assert [case["score"] for case in shrunk["report"]["case_page"]["cases"]] == [case["score"] for case in answer["report"]["case_page"]["cases"]]
        assert shrunk["report"]["mean_score"] == answer["report"]["mean_score"]
        assert "interval" not in str(sorted(shrunk["report"]["groups"][0]))
        comparisons = answer["report"]["ranking_comparisons"]
        assert (comparisons["top_group_limit"], comparisons["top_document_limit"]) == (10, 20)
        assert comparisons["tie_policy"] == "native descending priority, descending scored count, ascending grouping keys with missing last"


def test_t15_stored_subset_keeps_parent_identities_and_a_new_assessment_is_its_own_run(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, RANKING)
        parent = scored(client, wid, identity)
        # T15-AC07: inspecting L's stored scores reads the parent run and its reference.
        stored = client.post("/api/investigations/bpic19-read", json=read(wid, parent["run_id"], case_filter={"group_values": {"company": "L"}})).json()
        assert (stored["run_id"], stored["definition_id"], stored["report"]["mean_score"]) == (parent["run_id"], parent["definition_id"], pytest.approx(.948))
        assert {case["case_id"] for case in stored["report"]["case_page"]["cases"]} == {"L1", "L2", "L3", "L4"}
        # Assessing L on its own is a new run whose reference is L's own mean.
        subset = client.post("/api/investigations/select-cases", json=envelope("select_cases_request", workspace_id=wid,
            identity=identity, parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": ["L1", "L2", "L3", "L4"], "negate": False}])).json()
        request = given(wid, identity, **SETTINGS)
        request["named_population"] = {"name": "L only", "identity": subset["identity"]}
        reassessed = client.post("/api/investigations/bpic19-score", json=request).json()
        # The recipe is unchanged, so the definition is the same; the run records the new population and reference.
        assert reassessed["run_id"] != parent["run_id"] and reassessed["definition_id"] == parent["definition_id"]
        assert (reassessed["report"]["population_case_count"], reassessed["report"]["mean_score"]) == (4, pytest.approx(.92))


def test_t15_no_common_support_is_unavailable_not_an_overlap(tmp_path):
    workspace = tmp_path / "workspace"; workspace.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as client:
        wid, identity = prepare(client, workspace, PERFECT)
        answer = scored(client, wid, identity)
        # Every item meets every check, so no view has a positive-priority document to compare.
        overlaps = answer["report"]["ranking_comparisons"]["document_overlaps"]
        assert overlaps and all((entry["union_count"], entry["jaccard"], entry["reason"]) == (0, None, "zero_union") for entry in overlaps)
