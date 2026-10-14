"""Supplied distinct starts, literal whole histories and strict HTTP identities."""

from copy import deepcopy
import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.app import create_app
from import_requests import envelope, policies, wall_policies

ROOT = Path(__file__).resolve().parents[3]
ROUTE = "/api/investigations/start-trend"
POLICY = "incident.start_trend.first_raw_declared_order_half_open.v1"
RAW = b"""case,activity,at,seq
A,Before,2026-10-01T00:00:00Z,1
B,Lower,2026-10-01T00:00:00.000001Z,1
B,Later,2026-10-05T00:00:00Z,2
C,,2026-10-01T00:00:00.000002Z,1
C,MappedLater,2026-10-02T00:00:00Z,2
D,Upper,2026-10-01T00:00:00.000003Z,1
E,UntimedFirst,,1
E,TimedLater,2026-10-04T00:00:00Z,2
F,LaterStart,2026-10-03T00:00:00Z,1
G,Tied,2026-10-01T00:00:00.000002Z,1
G,TiedAgain,2026-10-01T00:00:00.000002Z,2
,Orphan,2026-10-06T00:00:00Z,1
"""
EXPLICIT = {"policy_id": POLICY, "binning": {"kind": "explicit_edges", "timestamp_kind": "utc_instant",
    "edges": ["2026-10-01T00:00:00.000001Z", "2026-10-01T00:00:00.000003Z", "2026-10-03T00:00:00Z"]}}
PARENT_BINS = {"policy_id": POLICY, "binning": {"kind": "parent_observed_range", "max_bin_count": 2}}


def checked(response, request):
    assert response.status_code == 200, response.text
    answer = response.json()
    assert answer["request_id"] == request["request_id"]
    assert answer["query_revision"] == request["query_revision"]
    return answer


def opened(client, path, raw=RAW, wall=False, cutoff=None):
    path.mkdir()
    request = envelope("open_workspace_request", "open", path=str(path))
    workspace = checked(client.post("/api/workspaces/open", json=request), request)
    metadata = envelope("upload_source_metadata", "upload", workspace_id=workspace["workspace_id"], filename="start-trend.csv")
    if wall:
        raw = raw.replace(b"Z,", b",")
    uploaded = checked(client.put("/api/sources", params=metadata, content=raw,
        headers={"Content-Type": "application/octet-stream"}), metadata)
    chosen = wall_policies("iso8601", cutoff or "2026-10-07T00:00:00") if wall else policies(
        "iso8601", offset=None, tolerant=True, cutoff=cutoff or "2026-10-07T00:00:00Z")
    request = envelope("confirm_mapping_request", "prepare", workspace_id=workspace["workspace_id"],
        source_id=uploaded["source"]["source_id"], dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": 3, "context_columns": []},
        policies=chosen, accept_report_issues=True)
    prepared = checked(client.post("/api/preparations", json=request), request)
    assert prepared["state"] == "ready"
    request = envelope("open_population_request", "population", workspace_id=workspace["workspace_id"], preparation_id=prepared["preparation"]["preparation_id"])
    population = checked(client.post("/api/investigations/open-population", json=request), request)
    return workspace, population


def trend_request(workspace, identity, definition=EXPLICIT, revision=3):
    return envelope("start_trend_request", "trend", revision, workspace_id=workspace["workspace_id"],
        identity=deepcopy(identity), definition=deepcopy(definition))


def schema_checked(response, request):
    answer = checked(response, request)
    validator = Draft202012Validator(json.loads((ROOT / "contracts/start-trend.schema.json").read_text(encoding="utf-8")), format_checker=FormatChecker())
    validator.validate(request)
    validator.validate(answer)
    return answer


def test_exact_half_open_bins_count_raw_starts_and_retain_full_history(tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        request = trend_request(workspace, population["identity"])
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["message_type"] == "start_trend_answer"
        assert answer["definition"] == EXPLICIT
        assert answer["identity"] == answer["parent_identity"] == population["identity"]
        assert answer["grain"] == "distinct_incident_starts"
        assert answer["anchor_policy"] == "first_raw_record_in_declared_order_of_sequence_evaluable_case"
        assert answer["clock"] == {"timestamp_kind": "utc_instant", "snapshot_cutoff": "2026-10-07T00:00:00Z"}
        assert [item["parent_support"] for item in answer["bins"]] == [
            {"case_ids": ["B", "C", "G"], "case_count": 3, "record_count": 6},
            {"case_ids": ["D"], "case_count": 1, "record_count": 1},
        ]
        assert answer["before_range"]["parent_support"]["case_ids"] == ["A"]
        assert answer["after_range"]["parent_support"]["case_ids"] == ["F"]
        assert answer["unevaluable"]["parent_support"]["case_ids"] == ["E"]
        assert answer["parent_support"] == {"case_ids": list("ABCDEFG"), "case_count": 7, "record_count": 11}
        assert answer["source_time_range"]["latest_recorded_timestamp"] == "2026-10-06T00:00:00Z"
        assert answer["parent_time_range"]["latest_recorded_timestamp"] == "2026-10-05T00:00:00Z"
        for item in answer["bins"]:
            selection = envelope("select_cases_request", "select", 4, workspace_id=workspace["workspace_id"],
                identity=population["identity"], parent_case_ids=None, predicates=[{"kind": "case_start_in_window", "negate": False,
                "window": {"timestamp_kind": "utc_instant", "start_inclusive": item["start_inclusive"], "end_exclusive": item["end_exclusive"]}}])
            selected = checked(client.post("/api/investigations/select-cases", json=selection), selection)
            assert selected["kept"] == item["parent_support"]
            assert selected["unevaluable"]["case_ids"] == ["E"]
        evidence = envelope("imported_case_evidence_request", "evidence", 5, workspace_id=workspace["workspace_id"], identity=population["identity"], case_id="B")
        full = checked(client.post("/api/investigations/case-evidence", json=evidence), evidence)
        assert [record["utc_instant"] for record in full["records"]] == ["2026-10-01T00:00:00.000001Z", "2026-10-05T00:00:00Z"]


def test_parent_derived_bins_are_bounded_and_fixed_when_kept_is_refined(tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        request = trend_request(workspace, population["identity"], PARENT_BINS)
        baseline = schema_checked(client.post(ROUTE, json=request), request)
        assert baseline["edges"] == ["2026-10-01T00:00:00Z", "2026-10-03T00:00:00Z", "2026-10-05T00:00:00.000001Z"]
        assert baseline["bin_generation"] == {"kind": "parent_observed_range", "max_bin_count": 2,
            "upper_extension_microseconds": 1, "status": "available"}
        assert [item["parent_support"]["case_ids"] for item in baseline["bins"]] == [list("ABCDG"), ["F"]]
        selection = envelope("select_cases_request", "select", 4, workspace_id=workspace["workspace_id"],
            identity=population["identity"], parent_case_ids=None, predicates=[{"kind": "case_id_in", "case_ids": ["B"], "negate": False}])
        selected = checked(client.post("/api/investigations/select-cases", json=selection), selection)
        request = trend_request(workspace, selected["identity"], PARENT_BINS, revision=5)
        refined = schema_checked(client.post(ROUTE, json=request), request)
        assert refined["parent_identity"] == selected["parent_identity"]
        assert refined["edges"] == baseline["edges"]
        assert [item["parent_support"] for item in refined["bins"]] == [item["parent_support"] for item in baseline["bins"]]
        assert [item["kept_support"] for item in refined["bins"]] == [
            {"case_ids": ["B"], "case_count": 1, "record_count": 2}, {"case_ids": [], "case_count": 0, "record_count": 0}]
        assert refined["unevaluable"]["kept_support"]["case_ids"] == []


def test_unknown_chronology_remains_unevaluable_under_window_negation(tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        request = trend_request(workspace, population["identity"])
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["unevaluable"]["reason_supports"]["order_unknown"]["parent_support"]["case_ids"] == ["E"]
        assert answer["unevaluable"]["reason_supports"]["first_raw_timestamp_missing"]["parent_support"]["case_ids"] == []
        assert answer["unevaluable"]["reason_supports_are_nonadditive"] is True
        selection = envelope("select_cases_request", "negated", 4, workspace_id=workspace["workspace_id"],
            identity=population["identity"], parent_case_ids=None, predicates=[{"kind": "case_start_in_window", "negate": True,
                "window": {"timestamp_kind": "utc_instant", "start_inclusive": EXPLICIT["binning"]["edges"][0], "end_exclusive": EXPLICIT["binning"]["edges"][1]}}])
        negated = checked(client.post("/api/investigations/select-cases", json=selection), selection)
        assert negated["kept"]["case_ids"] == ["A", "D", "F"]
        assert negated["unevaluable"]["case_ids"] == ["E"]


def test_empty_untimed_and_tied_parents_have_explicit_support_without_date_invention(tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        selection = envelope("select_cases_request", "empty-parent", 4, workspace_id=workspace["workspace_id"],
            identity=population["identity"], parent_case_ids=[], predicates=[])
        empty = checked(client.post("/api/investigations/select-cases", json=selection), selection)
        request = trend_request(workspace, empty["identity"], PARENT_BINS)
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["bin_generation"]["status"] == "empty_parent"
        assert answer["parent_time_range"] is None and answer["edges"] == answer["bins"] == []
        assert answer["source_time_range"]["latest_recorded_timestamp"] == "2026-10-06T00:00:00Z"
        assert answer["parent_support"] == answer["kept_support"] == {"case_ids": [], "case_count": 0, "record_count": 0}
        raw = b"case,activity,at,seq\nU,Untimed,,1\nU,AlsoUntimed,,2\n"
        workspace, population = opened(client, tmp_path / "untimed", raw=raw)
        request = trend_request(workspace, population["identity"], PARENT_BINS)
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["bin_generation"]["status"] == "no_usable_parent_timestamps"
        assert answer["source_time_range"] is answer["parent_time_range"] is None
        assert answer["edges"] == answer["bins"] == []
        assert answer["clock"]["snapshot_cutoff"] == "2026-10-07T00:00:00Z"
        assert answer["available"]["parent_support"]["case_count"] == 0
        assert answer["unevaluable"]["parent_support"] == {"case_ids": ["U"], "case_count": 1, "record_count": 2}
        for reason in ("order_unknown", "first_raw_timestamp_missing"):
            assert answer["unevaluable"]["reason_supports"][reason]["parent_support"]["case_ids"] == ["U"]
        raw = b"case,activity,at,seq\nT,,2026-10-02T00:00:00.000007Z,1\nT,LaterLabel,2026-10-02T00:00:00.000007Z,2\n"
        workspace, population = opened(client, tmp_path / "tied", raw=raw)
        request = trend_request(workspace, population["identity"], {"policy_id": POLICY, "binning": {"kind": "parent_observed_range", "max_bin_count": 64}})
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["edges"] == ["2026-10-02T00:00:00.000007Z", "2026-10-02T00:00:00.000008Z"]
        assert answer["bins"][0]["parent_support"] == {"case_ids": ["T"], "case_count": 1, "record_count": 2}


def test_recorded_wall_clock_stays_naive_and_exact_policy_cutoff_is_unchanged(tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "wall", wall=True, cutoff="2026-10-07T00:00:00.000000")
        definition = deepcopy(EXPLICIT)
        definition["binning"]["timestamp_kind"] = "wall_clock"
        definition["binning"]["edges"] = [edge.removesuffix("Z") for edge in definition["binning"]["edges"]]
        request = trend_request(workspace, population["identity"], definition)
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["clock"] == {"timestamp_kind": "wall_clock", "snapshot_cutoff": "2026-10-07T00:00:00.000000"}
        assert answer["edges"] == definition["binning"]["edges"]
        assert answer["bins"][0]["parent_support"]["case_ids"] == ["B", "C", "G"]
        assert answer["parent_time_range"]["latest_recorded_timestamp"] == "2026-10-05T00:00:00"
        request = trend_request(workspace, population["identity"], PARENT_BINS)
        default = schema_checked(client.post(ROUTE, json=request), request)
        assert default["edges"] == ["2026-10-01T00:00:00", "2026-10-03T00:00:00", "2026-10-05T00:00:00.000001"]


@pytest.mark.parametrize("corruption", ["count", "records", "edge-clock", "bin-bound", "calendar", "overlap", "missing-u", "reason-outside-u", "generation"])
def test_producer_contract_refuses_corrupted_actual_http_support(corruption, tmp_path):
    # Complementary public producer-contract seam: these independent corruptions
    # are not browser or journey qualification and do not replace HTTP controls.
    from wise_platform_api.start_trend_boundary import checked_answer
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        request = trend_request(workspace, population["identity"])
        answer = schema_checked(client.post(ROUTE, json=request), request)
    if corruption == "count":
        answer["bins"][0]["parent_support"]["case_count"] = 2
    elif corruption == "records":
        answer["bins"][0]["parent_support"]["record_count"] = 5
    elif corruption == "edge-clock":
        answer["edges"][0] = "2026-10-01T00:00:00.000001"
    elif corruption == "bin-bound":
        answer["bins"][0]["end_exclusive"] = "2026-10-01T00:00:00.000002Z"
    elif corruption == "calendar":
        answer["source_time_range"]["earliest_recorded_timestamp"] = "2026-02-31T00:00:00Z"
    elif corruption == "overlap":
        answer["bins"][0]["parent_support"]["case_ids"][0] = "A"
    elif corruption == "missing-u":
        answer["unevaluable"]["parent_support"] = {"case_ids": [], "case_count": 0, "record_count": 0}
    elif corruption == "reason-outside-u":
        answer["unevaluable"]["reason_supports"]["order_unknown"]["parent_support"]["case_ids"] = ["F"]
    else:
        answer["bin_generation"]["upper_extension_microseconds"] = 1
    with pytest.raises(ValueError):
        checked_answer(answer)


def denied(response, code=None):
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    validator = Draft202012Validator(json.loads((ROOT / "contracts/start-trend.schema.json").read_text(encoding="utf-8")), format_checker=FormatChecker())
    validator.validate(answer)
    assert answer["message_type"] == "start_trend_refusal" and answer["operation"] == "start_trend"
    if code is not None:
        assert answer["code"] == code
    return answer


@pytest.mark.parametrize("mutation", ["null-definition", "extra-field", "unknown-binning", "unsupported-policy", "bool-count", "string-count", "zero-count", "large-count", "null-edges", "one-edge", "too-many-edges", "duplicate", "semantic-duplicate", "descending", "bad-calendar", "wrong-utc-form", "clock-mismatch", "bool-revision", "overflow-revision", "bool-schema", "schema-version", "unicode-version"])
def test_strict_requests_refuse_ambiguous_meaning_and_preserve_valid_answer(mutation, tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        baseline_request = trend_request(workspace, population["identity"])
        baseline = schema_checked(client.post(ROUTE, json=baseline_request), baseline_request)
        request = deepcopy(baseline_request)
        binning = request["definition"]["binning"]
        if mutation == "null-definition":
            request["definition"] = None
        elif mutation == "extra-field":
            request["infer_completion"] = True
        elif mutation == "unknown-binning":
            binning["kind"] = "event_volume"
        elif mutation == "unsupported-policy":
            request["definition"]["policy_id"] = "incident.event_volume.v1"
        elif mutation in {"bool-count", "string-count", "zero-count", "large-count"}:
            request["definition"] = deepcopy(PARENT_BINS)
            request["definition"]["binning"]["max_bin_count"] = {"bool-count": True, "string-count": "2", "zero-count": 0, "large-count": 65}[mutation]
        elif mutation == "null-edges":
            binning["edges"] = None
        elif mutation == "one-edge":
            binning["edges"] = binning["edges"][:1]
        elif mutation == "too-many-edges":
            binning["edges"] = binning["edges"] * 22
        elif mutation == "duplicate":
            binning["edges"][1] = binning["edges"][0]
        elif mutation == "semantic-duplicate":
            binning["edges"] = ["2026-10-01T00:00:00.1Z", "2026-10-01T00:00:00.100000Z"]
        elif mutation == "descending":
            binning["edges"] = list(reversed(binning["edges"]))
        elif mutation == "bad-calendar":
            binning["edges"][0] = "2026-02-31T00:00:00Z"
        elif mutation == "wrong-utc-form":
            binning["edges"][0] = "2026-10-01T00:00:00.000001+00:00"
        elif mutation == "clock-mismatch":
            binning["timestamp_kind"] = "wall_clock"
            binning["edges"] = [edge.removesuffix("Z") for edge in binning["edges"]]
        elif mutation == "bool-revision":
            request["query_revision"] = True
        elif mutation == "overflow-revision":
            request["query_revision"] = 9007199254740992
        elif mutation == "bool-schema":
            request["schema_version"] = True
        elif mutation == "schema-version":
            request["schema_version"] = 2
        else:
            request["identity"]["implementation_version"] = "١.٢.٣"
        refused = denied(client.post(ROUTE, json=request), "inconsistent_time_kind" if mutation == "clock-mismatch" else None)
        assert refused["request_id"] == request["request_id"]
        assert schema_checked(client.post(ROUTE, json=baseline_request), baseline_request) == baseline


@pytest.mark.parametrize("field", ["source_id", "preparation_id", "representation_id", "case_dictionary_id", "population_id", "implementation_version"])
def test_full_population_identity_is_checked_at_actual_route(field, tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        request = trend_request(workspace, population["identity"])
        request["identity"][field] = "9.9.9" if field == "implementation_version" else request["identity"][field].rsplit(":", 1)[0] + ":" + "0" * 64
        answer = denied(client.post(ROUTE, json=request))
        assert answer["code"] in {"identity_mismatch", "preparation_unavailable", "source_unavailable", "population_unavailable"}


def test_source_mutation_foreign_workspace_and_unheld_selection_are_refused(tmp_path):
    with TestClient(create_app()) as client:
        workspace, population = opened(client, tmp_path / "workspace")
        request = trend_request(workspace, population["identity"])
        schema_checked(client.post(ROUTE, json=request), request)
        stored = list(Path(workspace["path"]).rglob("*.csv"))
        assert len(stored) == 1
        original = stored[0].read_bytes()
        modified = original.replace(b"Before", b"Change", 1)
        assert len(modified) == len(original)
        stored[0].write_bytes(modified)
        try:
            denied(client.post(ROUTE, json=request), "source_unavailable")
        finally:
            stored[0].write_bytes(original)
        other = tmp_path / "other"
        other.mkdir()
        opening = envelope("open_workspace_request", "other", path=str(other))
        foreign = checked(client.post("/api/workspaces/open", json=opening), opening)
        denied(client.post(ROUTE, json=trend_request(foreign, population["identity"])), "preparation_unavailable")
        selection = envelope("select_cases_request", "select", 4, workspace_id=workspace["workspace_id"],
            identity=population["identity"], parent_case_ids=["A", "B"], predicates=[{"kind": "case_id_in", "case_ids": ["B"], "negate": False}])
        selected = checked(client.post("/api/investigations/select-cases", json=selection), selection)
        with TestClient(create_app()) as fresh:
            opening = envelope("open_workspace_request", "reopen", path=workspace["path"])
            checked(fresh.post("/api/workspaces/open", json=opening), opening)
            schema_checked(fresh.post(ROUTE, json=request), request)
            denied(fresh.post(ROUTE, json=trend_request(workspace, selected["identity"])), "population_unavailable")


def test_unsupported_half_open_upper_extension_refuses_instead_of_losing_last_start(tmp_path):
    with TestClient(create_app()) as client:
        raw = b"case,activity,at,seq\nMAX,Observed,9999-12-31T23:59:59.999999Z,1\n"
        workspace, population = opened(client, tmp_path / "workspace", raw=raw, cutoff="9999-12-31T23:59:59.999999Z")
        request = trend_request(workspace, population["identity"], PARENT_BINS)
        denied(client.post(ROUTE, json=request), "invalid_parameter")
        request = trend_request(workspace, population["identity"], {"policy_id": POLICY, "binning": {
            "kind": "explicit_edges", "timestamp_kind": "utc_instant", "edges": ["9999-12-31T23:59:59Z", "9999-12-31T23:59:59.999999Z"]}})
        answer = schema_checked(client.post(ROUTE, json=request), request)
        assert answer["bins"][0]["parent_support"]["case_ids"] == []
        assert answer["after_range"]["parent_support"]["case_ids"] == ["MAX"]
