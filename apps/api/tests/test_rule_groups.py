"""Literal memberships and complete histories through the rule-group HTTP boundary."""

from pathlib import Path
from copy import deepcopy
import json
import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from wise_platform_api.app import create_app
from import_requests import envelope, policies

ROOT = Path(__file__).resolve().parents[3]
HERE = ROOT / "tests/fixtures/rule-groups"
ORACLE = json.loads((HERE / "rule-groups-oracle.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(
    json.loads(
        (ROOT / "contracts/rule-groups.schema.json").read_text(encoding="utf-8")
    ),
    format_checker=FormatChecker(),
)
ROUTE = "/api/investigations/rule-groups"


@pytest.fixture
def reading(tmp_path):
    with TestClient(create_app()) as c:
        p = tmp_path / "workspace"
        p.mkdir()
        workspace_path = p
        r = envelope("open_workspace_request", path=str(p))
        w = c.post("/api/workspaces/open", json=r)
        assert w.status_code == 200
        wid = w.json()["workspace_id"]
        r = envelope(
            "upload_source_metadata",
            workspace_id=wid,
            filename="rule-groups-nine-case.csv",
        )
        s = c.put(
            "/api/sources",
            params=r,
            content=(HERE / "rule-groups-nine-case.csv").read_bytes(),
            headers={"Content-Type": "application/octet-stream"},
        )
        assert s.status_code == 200
        r = envelope(
            "confirm_mapping_request",
            workspace_id=wid,
            source_id=s.json()["source"]["source_id"],
            dialect={
                "encoding": "utf-8",
                "delimiter": ",",
                "quotechar": '"',
                "header": "first_record",
            },
            mapping={
                "case_column": 0,
                "activity_column": 1,
                "timestamp_column": 2,
                "sequence_column": 3,
                "context_columns": [4],
            },
            policies=policies("iso8601", None, True, "2026-10-02T00:00:00Z"),
            accept_report_issues=True,
        )
        p = c.post("/api/preparations", json=r)
        assert p.status_code == 200 and p.json()["state"] == "ready"
        r = envelope(
            "open_population_request",
            workspace_id=wid,
            preparation_id=p.json()["preparation"]["preparation_id"],
        )
        b = c.post("/api/investigations/open-population", json=r)
        assert b.status_code == 200
        assert b.json()["population"] == {
            "case_ids": list("ABCDEFGHI"),
            "case_count": 9,
            "record_count": 18,
        }
        base = b.json()
        r = envelope(
            "select_cases_request",
            workspace_id=wid,
            identity=base["identity"],
            parent_case_ids=None,
            predicates=[],
        )
        selected = c.post("/api/investigations/select-cases", json=r)
        assert selected.status_code == 200
        yield c, wid, base, selected.json(), workspace_path


def request(wid, selected, kind, revision=2, offset=0, limit=50, edges=None):
    return envelope(
        "rule_groups_request",
        "rule-groups-" + str(revision),
        revision,
        workspace_id=wid,
        identity=selected["identity"],
        query={
            "rule": deepcopy(ORACLE["rules"].get(kind, {"kind": kind})),
            "distribution_edges_hours": edges or [0, 1, 3, 6],
            "offset": offset,
            "limit": limit,
        },
    )


def answered(c, r):
    VALIDATOR.validate(r)
    response = c.post(ROUTE, json=r)
    assert response.status_code == 200, response.text
    b = response.json()
    VALIDATOR.validate(b)
    assert (
        b["request_id"] == r["request_id"]
        and b["query_revision"] == r["query_revision"]
    )
    assert b["identity"] == r["identity"] and b["query"] == r["query"]
    assert b["workspace_id"] == r["workspace_id"]
    return b


def keyed(groups):
    return {
        json.dumps(g["key"], sort_keys=True, separators=(",", ":")): g for g in groups
    }


@pytest.mark.parametrize("kind", list(ORACLE["groups"]), ids=list(ORACLE["groups"]))
def test_literal_rule_memberships_parent_distributions_and_exemplars(reading, kind):
    c, wid, base, selected, workspace_path = reading
    b = answered(c, request(wid, selected, kind))
    assert b["parent_identity"] == selected["parent_identity"]
    assert b["group_count"] == len(ORACLE["groups"][kind]) and b["next_offset"] is None
    got = keyed(b["groups"])
    assert set(got) == set(keyed(ORACLE["groups"][kind]))
    for literal in ORACLE["groups"][kind]:
        g = got[json.dumps(literal["key"], sort_keys=True, separators=(",", ":"))]
        assert g["population"]["cases"]["case_ids"] == literal["ids"]
        count = sum(ORACLE["case_facts"][cid]["records"] for cid in literal["ids"])
        assert g["population"]["cases"]["record_count"] == count
        assert g["parent"]["cases"] == {
            "case_count": len(literal["ids"]),
            "record_count": count,
            "omitted_activity_record_count": sum(
                cid in ("D", "F") for cid in literal["ids"]
            ),
        }
        for name, measure in [
            ("span", "observed_span_hours"),
            ("gap", "maximum_adjacent_raw_gap_hours"),
        ]:
            d = g[name + "_distribution"]
            assert d["measure"] == measure and d["parent_case_count"] == 9
            assert [x["parent_case_count"] for x in d["bins"]] == ORACLE[
                "parent_" + name + "_bins"
            ]
            assert [x["kept_case_count"] for x in d["bins"]] == literal[name + "_bins"]
            assert d["unavailable"]["kept_order_unknown_case_count"] == literal.get(
                "order_U", 0
            )
            assert d["unavailable"]["kept_fewer_than_two_records_case_count"] == (
                literal.get("gap_U_fewer2", 0) if name == "gap" else 0
            )
        assert (
            g["exemplars"]["shortest"]["case_id"] == literal["shortest"]
            and g["exemplars"]["longest"]["case_id"] == literal["longest"]
        )
    if kind == "shared_reference":
        cov = b["parent_coverage"]
        assert cov["assigned"] == {
            "case_count": 8,
            "record_count": 17,
            "omitted_activity_record_count": 2,
        }
        assert cov["unassigned"]["case_ids"] == ["I"]
        assert cov["membership_incidence"] == {
            "case_count": 13,
            "record_count": 28,
            "omitted_activity_record_count": 3,
        }
        assert (
            b["shared_reference_coverage"]["parent_missing_reference_record_count"] == 3
        )


def test_paging_current_filter_and_bins_do_not_redefine_catalogue_and_keep_fixed_ids(
    reading,
):
    c, wid, base, selected, workspace_path = reading
    full = answered(c, request(wid, selected, "first_raw_activity"))
    r = envelope(
        "select_cases_request",
        "subset",
        3,
        workspace_id=wid,
        identity=base["identity"],
        parent_case_ids=None,
        predicates=[
            {"kind": "case_id_in", "case_ids": ["A", "D", "E", "F"], "negate": False}
        ],
    )
    filtered = c.post("/api/investigations/select-cases", json=r)
    assert filtered.status_code == 200
    filtered = filtered.json()
    current = answered(c, request(wid, filtered, "first_raw_activity", 4))
    assert current["parent_identity"] == full["parent_identity"]
    assert [g["id"] for g in current["groups"]] == [g["id"] for g in full["groups"]]
    missing = next(
        g for g in current["groups"] if g["key"]["kind"] == "missing_activity"
    )
    assert missing["population"]["cases"]["case_ids"] == ["D", "F"]
    zero = next(g for g in current["groups"] if g["key"].get("activity") == "End")
    assert zero["population"]["cases"] == {
        "case_ids": [],
        "case_count": 0,
        "record_count": 0,
        "omitted_activity_record_count": 0,
    }
    assert zero["exemplars"]["reason"] == "empty_current_group"
    page = answered(
        c,
        request(
            wid, filtered, "first_raw_activity", 5, offset=1, limit=1, edges=[0, 1, 12]
        ),
    )
    assert page["group_count"] == full["group_count"]
    assert page["groups"][0]["id"] == current["groups"][1]["id"]
    assert page["parent_coverage"] == current["parent_coverage"]
    apply = envelope(
        "select_cases_request",
        "apply-reviewed-IDs",
        6,
        workspace_id=wid,
        identity=base["identity"],
        parent_case_ids=list("ABCDEFGHI"),
        predicates=[
            {
                "kind": "case_id_in",
                "case_ids": missing["population"]["cases"]["case_ids"],
                "negate": False,
            }
        ],
    )
    kept = c.post("/api/investigations/select-cases", json=apply)
    assert kept.status_code == 200
    kept = kept.json()
    assert kept["kept"] == {"case_ids": ["D", "F"], "case_count": 2, "record_count": 3}
    for cid in ("D", "F"):
        r = envelope(
            "imported_case_evidence_request",
            "complete-" + cid,
            7,
            workspace_id=wid,
            identity=kept["identity"],
            case_id=cid,
        )
        e = c.post("/api/investigations/case-evidence", json=r)
        assert e.status_code == 200
        assert len(e.json()["records"]) == ORACLE["case_facts"][cid]["records"]
        assert [row["source_position"] for row in e.json()["records"]] == {
            "D": [8, 9],
            "F": [12],
        }[cid]


def test_rule_preview_has_no_workspace_publication_and_unknown_context_refuses(reading):
    c, wid, base, selected, workspace_path = reading
    # open_workspace lists authoritative persisted sources/preparations; not a local request-copy assertion.
    before = c.post(
        "/api/workspaces/open",
        json=envelope("open_workspace_request", "before", 8, path=str(workspace_path)),
    )
    assert before.status_code == 200
    before = before.json()
    answered(c, request(wid, selected, "shared_reference", 9))
    after = c.post(
        "/api/workspaces/open",
        json=envelope("open_workspace_request", "after", 10, path=str(workspace_path)),
    )
    assert after.status_code == 200
    after = after.json()
    assert after["workspace_id"] == before["workspace_id"] == wid
    assert (
        after["sources"] == before["sources"]
        and after["preparations"] == before["preparations"]
    )
    r = request(wid, selected, "shared_reference")
    r["query"]["rule"]["column_index"] = 3
    response = c.post(ROUTE, json=r)
    assert response.status_code in (400, 422)
    body = response.json()
    VALIDATOR.validate(body)
    assert (
        body["message_type"] == "rule_groups_refusal"
        and body["code"] == "unmapped_context_column"
    )


def selected_population(reading, ids, parent=None):
    c, wid, base, _, _ = reading
    r = envelope(
        "select_cases_request",
        "fixed-selection",
        11,
        workspace_id=wid,
        identity=base["identity"],
        parent_case_ids=parent,
        predicates=[{"kind": "case_id_in", "case_ids": ids, "negate": False}],
    )
    response = c.post("/api/investigations/select-cases", json=r)
    assert response.status_code == 200, response.text
    return response.json()


def denied(response, code=None):
    assert 400 <= response.status_code < 500, response.text
    body = response.json()
    VALIDATOR.validate(body)
    assert body["message_type"] == "rule_groups_refusal"
    assert body["operation"] == "rule_groups"
    if code is not None:
        assert body["code"] == code
    return body


def test_all_coverage_and_current_measures_are_independent_of_catalogue_page(reading):
    c, wid, _, selected, _ = reading
    total = {"case_count": 9, "record_count": 18, "omitted_activity_record_count": 2}
    ordered = {"case_count": 8, "record_count": 16, "omitted_activity_record_count": 2}
    for kind in ORACLE["groups"]:
        b = answered(c, request(wid, selected, kind))
        assert [g["key"] for g in b["groups"]] == [
            g["key"] for g in ORACLE["groups"][kind]
        ]
        assert b["population_coverage"] == b["parent_coverage"]
        cov = b["parent_coverage"]
        assert cov["total"] == total
        ordered_rule = kind in (
            "first_raw_activity",
            "last_raw_activity",
            "exact_mapped_sequence",
        )
        assert cov["eligible"] == (ordered if ordered_rule else total)
        assert cov["unevaluable"] == {
            "case_ids": ["E"] if ordered_rule else [],
            "case_count": int(ordered_rule),
            "record_count": 2 if ordered_rule else 0,
            "omitted_activity_record_count": 0,
        }
        if kind != "shared_reference":
            assert cov["assigned"] == cov["eligible"] == cov["membership_incidence"]
            assert cov["unassigned"] == {
                "case_ids": [],
                "case_count": 0,
                "record_count": 0,
                "omitted_activity_record_count": 0,
            }
        for g in b["groups"]:
            assert g["population"]["denominator"] == cov["eligible"]["case_count"]
            assert (
                g["population"]["share"]
                == len(g["population"]["cases"]["case_ids"])
                / cov["eligible"]["case_count"]
            )
            for name in ("span", "gap"):
                d = g[name + "_distribution"]
                assert (
                    d["parent_available_case_count"]
                    + d["unavailable"]["parent_case_count"]
                    == 9
                )
                assert (
                    d["kept_available_case_count"] + d["unavailable"]["kept_case_count"]
                    == g["population"]["cases"]["case_count"]
                )
                assert (
                    sum(x["kept_case_count"] for x in d["bins"])
                    == d["kept_available_case_count"]
                )
                assert d["unavailable"]["parent_order_unknown_case_count"] == 1
                assert d["unavailable"]["parent_fewer_than_two_records_case_count"] == (
                    2 if name == "gap" else 0
                )
        page = answered(c, request(wid, selected, kind, offset=1, limit=1))
        assert page["groups"] == b["groups"][1:2]
        assert page["next_offset"] == (2 if len(b["groups"]) > 2 else None)
        assert page["parent_coverage"] == cov
        assert answered(c, request(wid, selected, kind, offset=999))["groups"] == []


def test_named_current_reference_overlap_and_narrowed_parent_threshold(reading):
    c, wid, _, _, _ = reading
    current = selected_population(reading, ["A", "D", "E", "F"])
    b = answered(c, request(wid, current, "shared_reference"))
    assert [g["population"]["cases"]["case_ids"] for g in b["groups"]] == [
        ["A", "E"],
        ["A"],
        ["D"],
        ["D", "E"],
        ["F"],
    ]
    assert b["population_coverage"]["membership_incidence"] == {
        "case_count": 7,
        "record_count": 15,
        "omitted_activity_record_count": 3,
    }
    assert b["population_coverage"]["assigned"] == {
        "case_count": 4,
        "record_count": 8,
        "omitted_activity_record_count": 2,
    }
    assert b["shared_reference_coverage"] == {
        "column_index": 4,
        "parent_distinct_nonmissing_value_count": 6,
        "parent_suppressed_nonmissing_value_count": 2,
        "parent_missing_reference_record_count": 3,
        "population_missing_reference_record_count": 1,
    }
    narrow = selected_population(
        reading, ["A", "D", "E", "F"], parent=["A", "D", "E", "F"]
    )
    small = answered(c, request(wid, narrow, "shared_reference"))
    assert small["parent_identity"] == narrow["parent_identity"] != b["parent_identity"]
    assert [g["key"].get("value") for g in small["groups"]] == ["R1", "R3", None]
    assert [g["population"]["cases"]["case_ids"] for g in small["groups"]] == [
        ["A", "E"],
        ["D", "E"],
        ["D"],
    ]
    assert small["parent_coverage"]["unassigned"] == {
        "case_ids": ["F"],
        "case_count": 1,
        "record_count": 1,
        "omitted_activity_record_count": 1,
    }
    assert small["parent_coverage"]["membership_incidence"] == {
        "case_count": 5,
        "record_count": 11,
        "omitted_activity_record_count": 2,
    }
    for group in small["groups"]:
        assert [x["parent_case_count"] for x in group["span_distribution"]["bins"]] == [
            1,
            0,
            2,
            0,
        ]
        assert [x["parent_case_count"] for x in group["gap_distribution"]["bins"]] == [
            0,
            0,
            2,
            0,
        ]
    assert set(g["id"] for g in small["groups"]).isdisjoint(
        g["id"] for g in b["groups"]
    )


def test_exact_parent_and_rule_identity_change_groups_even_for_equal_memberships(
    reading,
):
    c, wid, base, selected, _ = reading
    raw_parent = answered(c, request(wid, base, "first_raw_activity"))
    frozen = answered(c, request(wid, selected, "first_raw_activity"))
    assert raw_parent["parent_identity"] != frozen["parent_identity"]
    assert [g["key"] for g in raw_parent["groups"]] == [
        g["key"] for g in frozen["groups"]
    ]
    assert set(g["id"] for g in raw_parent["groups"]).isdisjoint(
        g["id"] for g in frozen["groups"]
    )
    first = frozen["groups"][0]
    last = next(
        g
        for g in answered(c, request(wid, selected, "last_raw_activity"))["groups"]
        if g["key"] == first["key"]
    )
    assert first["id"] != last["id"]
    r = request(wid, selected, "shared_reference")
    two = answered(c, r)
    r["query"]["rule"]["minimum_parent_case_count"] = 3
    three = answered(c, r)
    assert set(g["id"] for g in two["groups"]).isdisjoint(
        g["id"] for g in three["groups"]
    )
    assert (
        answered(
            c,
            request(
                wid,
                selected,
                "first_raw_activity",
                revision=12,
                edges=[0.0, 1.5, 3, 10],
            ),
        )["groups"][0]["id"]
        == first["id"]
    )


@pytest.mark.parametrize(
    "field",
    [
        "source_id",
        "preparation_id",
        "representation_id",
        "case_dictionary_id",
        "population_id",
        "implementation_version",
    ],
)
def test_full_identity_guards_leave_valid_reading_available(reading, field):
    c, wid, _, selected, _ = reading
    r = request(wid, selected, "first_raw_activity")
    r["identity"] = deepcopy(r["identity"])
    r["identity"][field] = (
        "9.9.9"
        if field == "implementation_version"
        else r["identity"][field].rsplit(":", 1)[0] + ":" + "0" * 64
    )
    b = denied(c.post(ROUTE, json=r))
    assert b["code"] in {
        "identity_mismatch",
        "preparation_unavailable",
        "population_unavailable",
        "source_unavailable",
    }
    assert (
        b["request_id"] == r["request_id"]
        and b["query_revision"] == r["query_revision"]
    )
    assert (
        answered(c, request(wid, selected, "first_raw_activity"))["parent_coverage"][
            "total"
        ]["case_count"]
        == 9
    )


@pytest.mark.parametrize(
    "change",
    [
        "unknown-rule",
        "empty-activity",
        "extra-rule",
        "missing-rule",
        "extra-query",
        "parent-field",
        "condition-field",
        "duplicate-edges",
        "descending-edges",
        "nonzero-edges",
        "empty-edges",
        "bool-edge",
        "many-edges",
        "duplicate-count-edges",
        "descending-count-edges",
        "nonzero-count-edges",
        "bool-count-edge",
        "unsafe-count-edge",
        "bool-column",
        "unsafe-column",
        "small-reference-threshold",
        "bool-offset",
        "unsafe-offset",
        "zero-limit",
        "large-limit",
        "bool-revision",
        "unsafe-revision",
        "bool-schema",
        "unknown-schema",
        "unicode-version",
        "unknown-workspace",
        "missing-identity",
        "invalid-request-id",
    ],
)
def test_strict_request_guards(reading, change):
    c, wid, _, selected, _ = reading
    r = request(wid, selected, "first_raw_activity")
    r["identity"] = deepcopy(r["identity"])
    q = r["query"]
    if change == "unknown-rule":
        q["rule"] = {"kind": "fitted_cluster"}
    elif change == "empty-activity":
        q["rule"] = {"kind": "activity_presence", "activity": ""}
    elif change == "extra-rule":
        q["rule"]["negate"] = False
    elif change == "missing-rule":
        del q["rule"]
    elif change == "extra-query":
        q["invented"] = 1
    elif change == "parent-field":
        r["parent_case_ids"] = ["A"]
    elif change == "condition-field":
        q["rule"]["condition"] = {"kind": "contains_activity", "activity": "Start"}
    elif change in {
        "duplicate-edges",
        "descending-edges",
        "nonzero-edges",
        "empty-edges",
        "bool-edge",
        "many-edges",
    }:
        q["distribution_edges_hours"] = {
            "duplicate-edges": [0, 1, 1],
            "descending-edges": [0, 3, 1],
            "nonzero-edges": [1],
            "empty-edges": [],
            "bool-edge": [0, True],
            "many-edges": list(range(33)),
        }[change]
    elif "count-edge" in change:
        q["rule"] = {
            "kind": "raw_record_count_bands",
            "edges": {
                "duplicate-count-edges": [0, 2, 2],
                "descending-count-edges": [0, 3, 2],
                "nonzero-count-edges": [1],
                "bool-count-edge": [0, True],
                "unsafe-count-edge": [0, 9007199254740992],
            }[change],
        }
    elif change in {"bool-column", "unsafe-column", "small-reference-threshold"}:
        q["rule"] = {
            "kind": "shared_reference",
            "column_index": 4,
            "minimum_parent_case_count": 2,
        }
        if change == "small-reference-threshold":
            q["rule"]["minimum_parent_case_count"] = 1
        else:
            q["rule"]["column_index"] = (
                True if change == "bool-column" else 9007199254740992
            )
    elif change in {"bool-offset", "unsafe-offset"}:
        q["offset"] = True if change == "bool-offset" else 9007199254740992
    elif change in {"zero-limit", "large-limit"}:
        q["limit"] = 0 if change == "zero-limit" else 51
    elif change in {"bool-revision", "unsafe-revision"}:
        r["query_revision"] = True if change == "bool-revision" else 9007199254740992
    elif change in {"bool-schema", "unknown-schema"}:
        r["schema_version"] = True if change == "bool-schema" else 2
    elif change == "unicode-version":
        r["identity"]["implementation_version"] = "١.٢.٣"
    elif change == "unknown-workspace":
        r["workspace_id"] = "workspace.v1:absent-workspace"
    elif change == "missing-identity":
        del r["identity"]["case_dictionary_id"]
    else:
        r["request_id"] = "invalid request"
    denied(c.post(ROUTE, json=r))


@pytest.mark.parametrize("lexical", ["1e400", "NaN", "Infinity", "-Infinity"])
def test_nonfinite_json_is_refused_before_computation(reading, lexical):
    c, wid, _, selected, _ = reading
    r = request(wid, selected, "first_raw_activity")
    raw = json.dumps(r).replace("[0, 1, 3, 6]", "[0, " + lexical + "]")
    denied(
        c.post(
            ROUTE,
            content=raw.encode("utf-8"),
            headers={"Content-Type": "application/json"},
        ),
        "invalid_request",
    )


def test_invalid_unicode_and_nonobject_bodies_are_typed_refusals(reading):
    c, _, _, _, _ = reading
    for raw in (b"[]", b"null", b'{"activity":"\\ud800"}', b"\xff"):
        body = denied(
            c.post(ROUTE, content=raw, headers={"Content-Type": "application/json"}),
            "invalid_request",
        )
        assert body["request_id"] is None and body["query_revision"] is None


def test_only_current_unknown_order_and_empty_current_group_exemplars(reading):
    c, wid, _, _, _ = reading
    selected = selected_population(reading, ["E"])
    b = answered(c, request(wid, selected, "activity_presence"))
    absent, present = b["groups"]
    assert absent["exemplars"] == {
        "status": "unavailable",
        "reason": "empty_current_group",
        "shortest": None,
        "longest": None,
    }
    assert present["population"]["cases"]["case_ids"] == ["E"]
    assert present["exemplars"] == {
        "status": "unavailable",
        "reason": "no_evaluable_case",
        "shortest": None,
        "longest": None,
    }
    boundaries = answered(c, request(wid, selected, "first_raw_activity"))
    assert boundaries["population_coverage"]["eligible"]["case_count"] == 0
    assert all(g["population"]["share"] is None for g in boundaries["groups"])
    assert boundaries["population_coverage"]["unevaluable"]["case_ids"] == ["E"]


def another_preparation(c, wid, raw, chosen=None):
    r = envelope(
        "upload_source_metadata",
        "new-source",
        workspace_id=wid,
        filename="synthetic-history.csv",
    )
    uploaded = c.put(
        "/api/sources",
        params=r,
        content=raw,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert uploaded.status_code == 200, uploaded.text
    r = envelope(
        "confirm_mapping_request",
        "new-preparation",
        workspace_id=wid,
        source_id=uploaded.json()["source"]["source_id"],
        dialect={
            "encoding": "utf-8",
            "delimiter": ",",
            "quotechar": '"',
            "header": "first_record",
        },
        mapping={
            "case_column": 0,
            "activity_column": 1,
            "timestamp_column": 2,
            "sequence_column": 3,
            "context_columns": [4],
        },
        policies=chosen or policies("iso8601", None, True, "2026-10-02T00:00:00Z"),
        accept_report_issues=True,
    )
    prepared = c.post("/api/preparations", json=r)
    assert (
        prepared.status_code == 200 and prepared.json()["state"] == "ready"
    ), prepared.text
    r = envelope(
        "open_population_request",
        "new-population",
        workspace_id=wid,
        preparation_id=prepared.json()["preparation"]["preparation_id"],
    )
    opened = c.post("/api/investigations/open-population", json=r)
    assert opened.status_code == 200, opened.text
    return opened.json()


def test_preview_repeats_do_not_register_populations_or_write_workspace(
    reading, monkeypatch
):
    c, wid, _, selected, path = reading
    registry = c.app.state.selections
    before_registry = dict(registry._selections)
    before_files = {
        p.relative_to(path).as_posix(): p.read_bytes()
        for p in path.rglob("*")
        if p.is_file()
    }

    def no_registration(*args, **kwargs):
        pytest.fail("A read operation attempted to register a population")

    monkeypatch.setattr(registry, "keep", no_registration)
    for kind in ORACLE["groups"]:
        r = request(wid, selected, kind)
        assert answered(c, r) == answered(c, r)
    assert dict(registry._selections) == before_registry
    assert {
        p.relative_to(path).as_posix(): p.read_bytes()
        for p in path.rglob("*")
        if p.is_file()
    } == before_files


def test_exact_source_and_preparation_change_group_ids_without_changing_keys(reading):
    c, wid, base, _, _ = reading
    first = answered(c, request(wid, base, "first_raw_activity"))
    raw = (HERE / "rule-groups-nine-case.csv").read_bytes()
    replacement = another_preparation(c, wid, raw.replace(b"R4", b"R6"))
    changed = answered(c, request(wid, replacement, "first_raw_activity"))
    assert [g["key"] for g in changed["groups"]] == [g["key"] for g in first["groups"]]
    assert replacement["identity"]["source_id"] != base["identity"]["source_id"]
    assert set(g["id"] for g in first["groups"]).isdisjoint(
        g["id"] for g in changed["groups"]
    )
    interpretation = another_preparation(
        c, wid, raw, policies("iso8601", None, True, "2026-10-03T00:00:00Z")
    )
    reread = answered(c, request(wid, interpretation, "first_raw_activity"))
    assert interpretation["identity"]["source_id"] == base["identity"]["source_id"]
    assert (
        interpretation["identity"]["preparation_id"]
        != base["identity"]["preparation_id"]
    )
    assert set(g["id"] for g in first["groups"]).isdisjoint(
        g["id"] for g in reread["groups"]
    )


def test_stored_source_tampering_is_refused_and_restoration_is_exact(reading):
    c, wid, _, selected, path = reading
    original = answered(c, request(wid, selected, "shared_reference"))
    sources = list(path.rglob("*.csv"))
    assert len(sources) == 1
    source = sources[0]
    raw = source.read_bytes()
    source.write_bytes(raw.replace(b"R4", b"R6"))
    try:
        denied(
            c.post(ROUTE, json=request(wid, selected, "shared_reference")),
            "source_unavailable",
        )
    finally:
        source.write_bytes(raw)
    assert answered(c, request(wid, selected, "shared_reference")) == original


def test_fresh_application_reads_base_and_refuses_unregistered_selection(reading):
    _, wid, base, selected, path = reading
    with TestClient(create_app()) as fresh:
        response = fresh.post(
            "/api/workspaces/open",
            json=envelope("open_workspace_request", path=str(path)),
        )
        assert response.status_code == 200 and response.json()["workspace_id"] == wid
        assert (
            answered(fresh, request(wid, base, "exact_mapped_sequence"))[
                "parent_identity"
            ]
            == base["identity"]
        )
        denied(
            fresh.post(ROUTE, json=request(wid, selected, "exact_mapped_sequence")),
            "population_unavailable",
        )


def test_repeated_activity_labels_and_raw_omissions_match_actual_variants(reading):
    c, wid, _, _, _ = reading
    raw = (
        b"case,activity,time,sequence,reference\n"
        b"J,Start,2026-10-01T00:00:00Z,1,R\n"
        b"J,Review,2026-10-01T01:00:00Z,2,R\n"
        b"J,Review,2026-10-01T02:00:00Z,3,R\n"
        b"J,,2026-10-01T03:00:00Z,4,\n"
        b"J,End,2026-10-01T04:00:00Z,5,R\n"
    )
    base = another_preparation(c, wid, raw)
    b = answered(c, request(wid, base, "exact_mapped_sequence"))
    assert b["group_count"] == 1
    g = b["groups"][0]
    assert g["key"]["activities"] == ["Start", "Review", "Review", "End"]
    assert g["population"]["cases"] == {
        "case_ids": ["J"],
        "case_count": 1,
        "record_count": 5,
        "omitted_activity_record_count": 1,
    }
    r = envelope(
        "variants_request",
        "actual-variant",
        workspace_id=wid,
        identity=base["identity"],
    )
    variants = c.post("/api/investigations/variants", json=r)
    assert variants.status_code == 200, variants.text
    v = variants.json()["variants"]["variants"][0]
    assert (
        v["activities"] == g["key"]["activities"] and v["id"] == g["key"]["variant_id"]
    )
    assert g["gap_distribution"]["bins"][1]["kept_case_count"] == 1


def test_wall_clock_and_empty_parent_are_preserved_by_http_boundary(reading):
    c, wid, _, _, _ = reading
    chosen = policies("iso8601", None, True, "2026-10-02T00:00:00Z")
    chosen["time"] = {
        "id": "incident.time.wall_clock_as_recorded.v1",
        "parameters": {
            "format": "iso8601",
            "timezone": "none_as_recorded",
            "snapshot_cutoff_local": "2026-10-02T00:00:00",
        },
    }
    wall = another_preparation(
        c,
        wid,
        (HERE / "rule-groups-nine-case.csv").read_bytes().replace(b"Z,", b","),
        chosen,
    )
    b = answered(c, request(wid, wall, "first_raw_activity", edges=[0.0, 1.25, 3, 6]))
    assert b["timestamp_kind"] == "wall_clock"
    assert all(
        g["span_distribution"]["timestamp_kind"]
        == g["gap_distribution"]["timestamp_kind"]
        == "wall_clock"
        for g in b["groups"]
    )
    r = envelope(
        "select_cases_request",
        "empty-parent",
        workspace_id=wid,
        identity=wall["identity"],
        parent_case_ids=[],
        predicates=[],
    )
    response = c.post("/api/investigations/select-cases", json=r)
    assert response.status_code == 200, response.text
    empty = answered(c, request(wid, response.json(), "activity_presence"))
    assert empty["parent_identity"] == response.json()["parent_identity"]
    assert (
        empty["parent_coverage"]["total"]["case_count"]
        == empty["population_coverage"]["total"]["case_count"]
        == 0
    )
    assert all(
        g["parent"]["share"] is g["population"]["share"] is None
        for g in empty["groups"]
    )
