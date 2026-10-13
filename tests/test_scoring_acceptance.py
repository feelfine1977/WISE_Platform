"""Actual scoring HTTP acceptance; synthetic literal goldens, no receipt replay."""

from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass, field
from copy import deepcopy
import json

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise.family import family
from wise.families import lag

from test_import_acceptance import (
    ROOT,
    client,
    envelope,
    evidence,
    policies,
    population,
    prepare,
    upload,
    workspace,
)
from test_selection_acceptance import select

SCHEMA = json.loads((ROOT / "contracts/scoring.schema.json").read_text())
CHECKER = FormatChecker()
assert "date-time" in CHECKER.checkers
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=CHECKER)
EXAMPLES = json.loads(
    (ROOT / "tests/fixtures/expectations/contract-examples.json").read_text()
)
VALIDATE = "/api/expectations/validate"
SCORE = "/api/expectations/score"
WITNESS = "/api/expectations/case-witness"
CUTOFF = "2026-10-09T00:00:00Z"


@dataclass(frozen=True)
class MethodEvaluationCall:
    case_ids: tuple[str, ...]
    record_count: int


@dataclass
class MethodEvaluationProbe:
    calls: list[MethodEvaluationCall] = field(default_factory=list)

    def assert_single_evaluation_since(self, before, case_ids, record_count):
        observed = self.calls[before:]
        assert len(observed) == 1, observed
        assert Counter(observed[0].case_ids) == Counter(case_ids), observed
        assert observed[0].record_count == record_count, observed


@contextmanager
def observe_real_lag_evaluations():
    """Record the real registered lag family, preserving its actual Evaluation result.

    Public evaluate and score aliases resolve this same Family at call time. The
    installed library's descriptor is frozen; the test temporarily swaps only
    its callback, restores it in finally, and never re-registers or reorders it.
    """
    registered = family("lag")
    original = registered.evaluate
    module_original = lag.evaluate
    assert (
        original is module_original
    ), "Recheck the instrumentation seam for this Method artifact."
    probe = MethodEvaluationProbe()

    def delegated(constraint, log):
        probe.calls.append(
            MethodEvaluationCall(
                tuple(str(case) for case in log.case_ids), len(log.events)
            )
        )
        return original(constraint, log)

    object.__setattr__(registered, "evaluate", delegated)
    lag.evaluate = delegated
    try:
        yield probe
    finally:
        lag.evaluate = module_original
        object.__setattr__(registered, "evaluate", original)


def definition(**changes):
    # Only authored meaning is used; sample identities/answers are never reused.
    d = deepcopy(EXAMPLES["validate-expectation.request"]["definition"])
    d.update(changes)
    return d


def source_population(client, workspace, raw=None, cutoff=CUTOFF, delimiter=","):
    raw = (
        (ROOT / "tests/fixtures/expectations/first-resolution.csv").read_bytes()
        if raw is None
        else raw
    )
    source = upload(client, workspace, raw)
    p = policies()
    p["time"]["parameters"]["snapshot_cutoff_utc"] = cutoff
    req = envelope(
        "confirm_mapping_request",
        workspace_id=workspace["workspace_id"],
        source_id=source["source_id"],
        dialect={
            "encoding": "utf-8",
            "delimiter": delimiter,
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
        policies=p,
        accept_report_issues=True,
    )
    return population(client, workspace, prepare(client, req))


def named(receipt, name="Synthetic named population"):
    return {"name": name, "identity": deepcopy(receipt["identity"])}


def validate_request(
    workspace, base, population_receipt, d, request_id="validate-http-1", revision=1
):
    return envelope(
        "validate_expectation_request",
        request_id,
        revision,
        workspace_id=workspace["workspace_id"],
        base_identity=deepcopy(base["identity"]),
        named_population=named(population_receipt),
        definition=deepcopy(d),
    )


def checked(response, req, kind):
    assert 200 <= response.status_code < 300, response.text
    a = response.json()
    VALIDATOR.validate(a)
    assert a["message_type"] == kind
    for field in ("request_id", "query_revision", "workspace_id"):
        assert a[field] == req[field]
    return a


def ready(client, workspace, base, population_receipt, d):
    req = validate_request(workspace, base, population_receipt, d)
    VALIDATOR.validate(req)
    a = checked(client.post(VALIDATE, json=req), req, "expectation_validation_answer")
    assert a["state"] == "ready" and a["blockers"] == []
    assert all(
        a["readiness"][k] is True
        for k in (
            "supported_definition",
            "preparation_gate_passed",
            "method_check_passed",
        )
    )
    dv = a["definition_version"]
    assert dv["definition"] == d
    assert dv["source_binding"] == {
        k: v for k, v in base["identity"].items() if k != "population_id"
    }
    assert dv["method_artifact"] == a["readiness"]["method_artifact"]
    assert (
        dv["method_artifact"]["distribution"] == "wise-pm"
        and dv["method_artifact"]["eligible_release"] is False
    )
    assert a["readiness"]["release_gate_pending"] is True
    assert (
        dv["compilation"]["compiled_constraint_count"] == 1
        and dv["compilation"]["omitted_constraint_count"] == 0
    )
    params = dv["norm"]["document"]["constraints"][0]["params"]
    assert params["activation"] == "first" and params["response"] == "first_after"
    assert params["unit"] == ("D" if d["unit"] == "days" else "h")
    assert (
        params["delta"] == d["target"]
        and params["width"] == d["width"]
        and params["missing_b"] == d["missing_response"]
    )
    return dv


def score_request(
    workspace, base, population_receipt, dv, request_id="score-http-1", revision=1
):
    return envelope(
        "score_expectation_request",
        request_id,
        revision,
        workspace_id=workspace["workspace_id"],
        base_identity=deepcopy(base["identity"]),
        named_population=named(population_receipt),
        definition_version_id=dv["definition_version_id"],
    )


def score(
    client,
    workspace,
    base,
    population_receipt,
    dv,
    request_id="score-http-1",
    revision=1,
):
    req = score_request(workspace, base, population_receipt, dv, request_id, revision)
    VALIDATOR.validate(req)
    run = checked(client.post(SCORE, json=req), req, "score_run_answer")["run"]
    assert run["identity"]["base_identity"] == base["identity"]
    assert (
        run["identity"]["scored_population_identity"] == population_receipt["identity"]
    )
    assert run["identity"]["definition_version_id"] == dv["definition_version_id"]
    assert run["identity"]["norm_version_id"] == dv["norm"]["norm_version_id"]
    assert run["identity"]["norm_fingerprint"] == dv["norm"]["norm_fingerprint"]
    assert run["definition_version"] == dv
    assert run["identity"]["method_artifact"] == dv["method_artifact"]
    assert run["named_population"]["identity"] == population_receipt["identity"]
    expected_population = (
        population_receipt["population"]
        if "population" in population_receipt
        else population_receipt["kept"]
    )
    assert run["population"] == expected_population
    assert run["identity"]["calibration_id"] == run["calibration"]["calibration_id"]
    assert (
        run["calibration"]["scored_population_id"]
        == population_receipt["identity"]["population_id"]
    )
    for field in ("target", "width", "unit"):
        assert run["calibration"][field] == dv["definition"][field]
    assert (
        run["calibration"]["population_fitted"] is False
        and run["calibration"]["method_calibrations"] == {}
    )
    assert (
        len(run["cases"])
        == len({c["case_id"] for c in run["cases"]})
        == run["population"]["case_count"]
    )
    assert {c["case_id"] for c in run["cases"]} == set(expected_population["case_ids"])
    return run


def witness(client, workspace, run, case_id, request_id="witness-http-1", revision=1):
    req = envelope(
        "score_case_witness_request",
        request_id,
        revision,
        workspace_id=workspace["workspace_id"],
        run_id=run["identity"]["run_id"],
        case_id=case_id,
    )
    VALIDATOR.validate(req)
    a = checked(client.post(WITNESS, json=req), req, "score_case_witness_answer")
    assert a["run_identity"] == run["identity"]
    assert a["case"] == next(c for c in run["cases"] if c["case_id"] == case_id)
    return a


def denied_before_ready(
    response, req, code, field=None, case_ids=(), allow_unknown_metadata=False
):
    assert (
        200 <= response.status_code < 300 or 400 <= response.status_code < 500
    ), response.text
    a = response.json()
    VALIDATOR.validate(a)
    for key in ("request_id", "query_revision", "workspace_id"):
        assert a[key] == req[key] or (allow_unknown_metadata and a[key] is None)
    if a["message_type"] == "expectation_validation_answer":
        assert a["state"] == "blocked" and a["definition_version"] is None
        candidates = a["blockers"]
    else:
        assert (
            a["message_type"] == "scoring_refusal"
            and a["operation"] == "validate_expectation"
        )
        candidates = [a]
    issue = next(i for i in candidates if i["code"] == code)
    assert issue["case_ids"] == list(case_ids) and issue["case_count"] == len(case_ids)
    if field is not None:
        assert issue["field"] == field
    assert issue["message"].strip()
    return issue


@pytest.mark.parametrize(("target", "width"), [(4, 2), (4.0, 2.0)])
def test_real_method_four_day_goldens_numeric_forms_and_exact_support(
    client, workspace, target, width
):
    base = source_population(client, workspace)
    d = definition(target=target, width=width)
    dv = ready(client, workspace, base, base, d)
    run = score(client, workspace, base, base, dv)
    assert run["population"] == {
        "case_ids": [
            "D3",
            "D4",
            "D5",
            "D6",
            "GAP",
            "MISSING",
            "NOOPEN",
            "REOPEN",
            "TIED",
        ],
        "case_count": 9,
        "record_count": 19,
    }
    cases = {c["case_id"]: c for c in run["cases"]}
    assert {i: cases[i]["value"] for i in cases} == {
        "D3": 0,
        "D4": 0,
        "D5": 0.5,
        "D6": 1,
        "GAP": 0.5,
        "MISSING": None,
        "NOOPEN": None,
        "REOPEN": 0,
        "TIED": 0,
    }
    assert {i: cases[i]["measurement"]["value"] for i in cases} == {
        "D3": 3,
        "D4": 4,
        "D5": 5,
        "D6": 6,
        "GAP": 5,
        "MISSING": None,
        "NOOPEN": None,
        "REOPEN": 3,
        "TIED": 0,
    }
    assert all(c["in_scope"] is True for c in cases.values())
    counts = {k: v for k, v in run["support"].items() if k != "method_reason_counts"}
    assert counts == {
        "scored_case_count": 9,
        "in_scope_case_count": 9,
        "out_of_scope_case_count": 0,
        "scope_unknown_case_count": 0,
        "numeric_value_case_count": 7,
        "unavailable_value_case_count": 2,
        "affected_case_count": 3,
        "zero_value_case_count": 4,
        "observed_interval_case_count": 7,
        "activation_known_case_count": 8,
        "response_known_case_count": 7,
        "missing_activation_case_count": 1,
        "missing_response_case_count": 1,
        "censored_case_count": 0,
    }
    assert {
        x["reason"]: x["case_count"] for x in run["support"]["method_reason_counts"]
    } == {"evaluated": 7, "missing_activation": 1, "missing_response": 1}
    assert run["identity"]["clock"] == {
        "timestamp_kind": "utc_instant",
        "duration_meaning": "elapsed_utc",
        "observation_start_utc": "2026-10-01T00:00:00Z",
        "snapshot_cutoff_utc": CUTOFF,
        "observation_start_local": None,
        "snapshot_cutoff_local": None,
    }
    assert (
        score(client, workspace, base, base, dv, request_id="repeat-2", revision=2)
        == run
    )


@pytest.mark.parametrize(("width", "five_hour_value"), [(0, 1), (2, 0.5)])
def test_actual_method_hours_preserve_exact_four_hour_equality(
    client, workspace, width, five_hour_value
):
    raw = (ROOT / "tests/fixtures/incidents/exact-four-hour.csv").read_bytes()
    source = upload(client, workspace, raw, "exact-four-hour.csv")
    p = policies()
    p["time"]["parameters"]["snapshot_cutoff_utc"] = "2026-10-02T00:00:00Z"
    request = envelope(
        "confirm_mapping_request",
        workspace_id=workspace["workspace_id"],
        source_id=source["source_id"],
        dialect={
            "encoding": "utf-8",
            "delimiter": ",",
            "quotechar": '"',
            "header": "first_record",
        },
        mapping={
            "case_column": 0,
            "activity_column": 3,
            "timestamp_column": 4,
            "sequence_column": 2,
            "context_columns": [5, 6],
        },
        policies=p,
        accept_report_issues=True,
    )
    base = population(client, workspace, prepare(client, request))
    dv = ready(
        client, workspace, base, base, definition(target=4, width=width, unit="hours")
    )
    run = score(client, workspace, base, base, dv)
    assert run["population"] == {
        "case_ids": ["BOUNDARY3", "BOUNDARY4", "BOUNDARY5", "BOUNDARYMISSING"],
        "case_count": 4,
        "record_count": 7,
    }
    cases = {case["case_id"]: case for case in run["cases"]}
    assert {key: case["measurement"]["value"] for key, case in cases.items()} == {
        "BOUNDARY3": 3,
        "BOUNDARY4": 4,
        "BOUNDARY5": 5,
        "BOUNDARYMISSING": None,
    }
    assert {key: case["value"] for key, case in cases.items()} == {
        "BOUNDARY3": 0,
        "BOUNDARY4": 0,
        "BOUNDARY5": five_hour_value,
        "BOUNDARYMISSING": None,
    }
    assert all(case["measurement"]["unit"] == "hours" for case in cases.values())
    assert run["support"]["numeric_value_case_count"] == 3
    assert run["support"]["unavailable_value_case_count"] == 1
    assert run["support"]["affected_case_count"] == 1
    assert witness(client, workspace, run, "BOUNDARY4")["case"] == cases["BOUNDARY4"]


def test_gap_reopen_and_same_instant_witnesses_keep_complete_raw_rows(
    client, workspace
):
    base = source_population(client, workspace)
    dv = ready(client, workspace, base, base, definition())
    run = score(client, workspace, base, base, dv)
    for case_id in ("GAP", "REOPEN", "TIED"):
        source = evidence(client, workspace, base, case_id)
        w = witness(client, workspace, run, case_id)
        assert w["trace"]["kind"] == "imported_csv"
        for key in (
            "columns",
            "records",
            "coverage",
            "mapped_row_ids",
            "omitted_activity_row_ids",
        ):
            assert w["trace"][key] == source[key]
        assert w["method_trace_row_ids"] == [r["row_id"] for r in source["records"]]
        assert (
            w["endpoint_tie_policy"]
            == "matching_timestamp_candidates_in_declared_order.v1"
        )
    gap = witness(client, workspace, run, "GAP")
    rows = gap["trace"]["records"]
    assert [r["source_position"] for r in rows] == [10, 11, 12]
    assert [r["activity"] for r in rows] == ["Opened", None, "Resolved"]
    assert gap["activation_candidate_row_ids"] == [rows[0]["row_id"]] and gap[
        "response_candidate_row_ids"
    ] == [rows[2]["row_id"]]
    assert rows[1]["original_cells"] == ["GAP", "", "2026-10-02T00:00:00Z", ""]
    assert rows[2]["context"] == [{"column_index": 3, "value": "Unknown"}]
    tied = witness(client, workspace, run, "TIED")
    rows = tied["trace"]["records"]
    assert [r["activity"] for r in rows] == ["Resolved", "Opened"] and tied["case"][
        "measurement"
    ]["value"] == 0
    assert tied["activation_candidate_row_ids"] == [rows[1]["row_id"]] and tied[
        "response_candidate_row_ids"
    ] == [rows[0]["row_id"]]
    reopened = witness(client, workspace, run, "REOPEN")
    rows = reopened["trace"]["records"]
    assert len(rows) == 4 and reopened["case"]["measurement"]["value"] == 3
    assert reopened["response_candidate_row_ids"] == [rows[1]["row_id"]]


def test_every_matching_tied_candidate_is_disclosed_in_declared_order(
    client, workspace
):
    raw = b"Case,Activity,At,Desk\nT,Resolved,2026-10-01T00:00:00Z,Known\nT,Opened,2026-10-01T00:00:00Z,Known\nT,Resolved,2026-10-01T00:00:00Z,Known\nT,Opened,2026-10-01T00:00:00Z,Known\n"
    base = source_population(client, workspace, raw)
    dv = ready(client, workspace, base, base, definition())
    run = score(client, workspace, base, base, dv)
    w = witness(client, workspace, run, "T")
    rows = w["trace"]["records"]
    assert (
        len(rows) == 4
        and w["case"]["value"] == 0
        and w["case"]["measurement"]["value"] == 0
    )
    assert w["activation_candidate_row_ids"] == [rows[1]["row_id"], rows[3]["row_id"]]
    assert w["response_candidate_row_ids"] == [rows[0]["row_id"], rows[2]["row_id"]]


@pytest.mark.parametrize(
    ("policy", "value", "reason"),
    [
        ("skip", None, "missing_response"),
        ("violate", 1, "evaluated"),
        ("censor", 1, "censored"),
    ],
)
def test_missing_response_policy_never_fabricates_measurement_or_response_row(
    client, workspace, policy, value, reason
):
    base = source_population(client, workspace)
    dv = ready(client, workspace, base, base, definition(missing_response=policy))
    run = score(client, workspace, base, base, dv)
    missing = witness(client, workspace, run, "MISSING")
    c = missing["case"]
    m = c["measurement"]
    assert c["value"] == value and c["reason"] == reason and c["in_scope"] is True
    assert m == {
        "status": "missing_response",
        "value": None,
        "unit": "days",
        "activation_known": True,
        "response_known": False,
        "censor_age": 8 if policy == "censor" else None,
    }
    assert [r["activity"] for r in missing["trace"]["records"]] == [
        "Opened"
    ] and missing["response_candidate_row_ids"] == []
    noopen = witness(client, workspace, run, "NOOPEN")
    assert (
        noopen["case"]["value"] is None
        and noopen["case"]["reason"] == "missing_activation"
    )
    assert (
        noopen["activation_candidate_row_ids"]
        == noopen["response_candidate_row_ids"]
        == []
    )
    assert noopen["case"]["measurement"]["status"] == "missing_activation"
    assert (
        run["support"]["observed_interval_case_count"] == 7
        and run["support"]["response_known_case_count"] == 7
    )
    assert run["support"]["numeric_value_case_count"] == (7 if policy == "skip" else 8)
    assert run["support"]["affected_case_count"] == (3 if policy == "skip" else 4)
    assert run["support"]["censored_case_count"] == (1 if policy == "censor" else 0)


def test_graded_censor_uses_declared_cutoff_but_observed_interval_remains_null(
    client, workspace
):
    raw = b"Case,Activity,At,Desk\nM,Opened,2026-10-01T00:00:00Z,Known\nQ,Opened,2026-10-01T00:00:00Z,Known\nQ,Resolved,2026-10-04T00:00:00Z,Known\n"
    base = source_population(client, workspace, raw, cutoff="2026-10-06T00:00:00Z")
    dv = ready(client, workspace, base, base, definition(missing_response="censor"))
    run = score(client, workspace, base, base, dv)
    w = witness(client, workspace, run, "M")
    assert (
        w["case"]["value"] == 0.5
        and w["case"]["measurement"]["value"] is None
        and w["case"]["measurement"]["censor_age"] == 5
    )
    assert w["response_candidate_row_ids"] == [] and len(w["trace"]["records"]) == 1


def test_unevaluable_population_refuses_before_method_then_explicit_qualified_population_scores(
    client, workspace, monkeypatch
):
    import wise

    original_check = wise.Norm.check
    method_checks = []

    def actual_check(norm, log, *args, **kwargs):
        method_checks.append(tuple(str(case_id) for case_id in log.case_ids))
        return original_check(norm, log, *args, **kwargs)

    monkeypatch.setattr(wise.Norm, "check", actual_check)
    raw = b"Case,Activity,At,Desk\nU,Opened,bad-time,Known\nU,Opened,2026-10-01T00:00:00Z,Known\nU,Resolved,2026-10-06T00:00:00Z,Known\nQ,Opened,2026-10-01T00:00:00Z,Known\nQ,Resolved,2026-10-04T00:00:00Z,Known\n"
    base = source_population(client, workspace, raw)
    d = definition()
    req = validate_request(workspace, base, base, d)
    before_refusal = len(method_checks)
    issue = denied_before_ready(
        client.post(VALIDATE, json=req), req, "unevaluable_sequence", case_ids=["U"]
    )
    assert (
        len(method_checks) == before_refusal
    ), "Preparation refusal must precede public Method.check."
    assert set(issue["recovery_actions"]) & {
        "inspect_quality",
        "choose_qualified_named_population",
    }
    qualified = select(client, workspace, base, [], parent=["Q"])
    dv = ready(client, workspace, base, qualified, d)
    assert (
        len(method_checks) > before_refusal
    ), "Ready must delegate to the actual public Method.check."
    req = score_request(workspace, base, base, dv)
    before_refusal = len(method_checks)
    response = client.post(SCORE, json=req)
    assert 400 <= response.status_code < 500, response.text
    assert (
        len(method_checks) == before_refusal
    ), "Score refusal must precede public Method.check."
    a = response.json()
    VALIDATOR.validate(a)
    assert (
        a["message_type"] == "scoring_refusal"
        and a["operation"] == "score_expectation"
        and a["code"] == "unevaluable_sequence"
    )
    assert a["case_ids"] == ["U"] and a["case_count"] == 1
    run = score(client, workspace, base, qualified, dv)
    assert run["population"] == {"case_ids": ["Q"], "case_count": 1, "record_count": 2}
    assert (
        len(run["cases"]) == 1
        and run["cases"][0]["case_id"] == "Q"
        and run["cases"][0]["value"] == 0
    )


def test_selection_reads_original_run_values_and_explicit_subset_run_keeps_fixed_calibration(
    client, workspace
):
    with observe_real_lag_evaluations() as method:
        base = source_population(client, workspace)
        dv = ready(client, workspace, base, base, definition())
        # Readiness may perform supported checks; count scoring separately.
        before_full = len(method.calls)
        full = score(client, workspace, base, base, dv)
        method.assert_single_evaluation_since(
            before_full,
            ["D3", "D4", "D5", "D6", "GAP", "MISSING", "NOOPEN", "REOPEN", "TIED"],
            19,
        )
        reads_start = list(method.calls)
        subset = select(client, workspace, base, [], parent=["D5", "GAP"])
        assert (
            method.calls == reads_start
        ), "Descriptive selection must not evaluate an expectation again."
        for case_id in ("D5", "GAP"):
            old = witness(
                client,
                workspace,
                full,
                case_id,
                request_id="original-after-selection",
                revision=2,
            )
            assert old["case"]["value"] == 0.5
            assert old["run_identity"] == full["identity"]
            assert (
                old["run_identity"]["calibration_id"]
                == full["calibration"]["calibration_id"]
            )
            assert (
                method.calls == reads_start
            ), "Reading a named score run must reuse its actual evaluated result."

        before_new = len(method.calls)
        new = score(
            client,
            workspace,
            base,
            subset,
            dv,
            request_id="explicit-new-population",
            revision=3,
        )
        method.assert_single_evaluation_since(before_new, ["D5", "GAP"], 5)
        assert new["population"] == {
            "case_ids": ["D5", "GAP"],
            "case_count": 2,
            "record_count": 5,
        }
        assert new["identity"]["run_id"] != full["identity"]["run_id"]
        assert new["identity"]["scored_population_identity"] == subset["identity"]
        assert (
            new["identity"]["scored_population_identity"]
            != full["identity"]["scored_population_identity"]
        )
        assert new["identity"]["base_identity"] == full["identity"]["base_identity"]
        assert (
            new["calibration"]["calibration_id"]
            == full["calibration"]["calibration_id"]
        )
        assert new["calibration"]["population_fitted"] is False
        assert new["calibration"]["method_calibrations"] == {}
        assert [c["value"] for c in new["cases"]] == [0.5, 0.5]

        reads_after_new = list(method.calls)
        for case_id, value in (("D5", 0.5), ("D3", 0)):
            original = witness(client, workspace, full, case_id)
            assert (
                original["run_identity"] == full["identity"]
                and original["case"]["value"] == value
            )
            assert (
                method.calls == reads_after_new
            ), "The original run remains available, including outside the new subset."
        # Repeating an explicit SCORE is intentional scoring; the existing identity
        # assertion remains. Any evaluation it performs must use only this subset.
        before_repeat = len(method.calls)
        assert (
            score(
                client,
                workspace,
                base,
                subset,
                dv,
                request_id="subset-repeat",
                revision=4,
            )
            == new
        )
        for call in method.calls[before_repeat:]:
            assert (
                Counter(call.case_ids) == Counter(["D5", "GAP"])
                and call.record_count == 5
            )
        before_last_read = list(method.calls)
        assert (
            witness(client, workspace, full, "D3")["run_identity"] == full["identity"]
        )
        assert method.calls == before_last_read


@pytest.mark.parametrize(
    ("target", "width", "field"),
    [
        (1e308, 0, "definition.target"),
        (4, 1e308, "definition.width"),
        (1e308, 1e308, "definition.target"),
    ],
)
def test_finite_unrepresentable_censor_tolerance_blocks_validation_before_ready(
    client, workspace, target, width, field
):
    base = source_population(client, workspace)
    d = definition(target=target, width=width, missing_response="censor")
    # Tolerance construction is unconditional, even with no missing responses in this population.
    qualified = select(client, workspace, base, [], parent=["D3", "D4"])
    req = validate_request(workspace, base, qualified, d)
    VALIDATOR.validate(req)
    issue = denied_before_ready(
        client.post(VALIDATE, json=req), req, "invalid_parameter", field=field
    )
    assert "edit_definition" in issue["recovery_actions"]
    assert any(
        s in issue["message"].lower()
        for s in ("duration", "tolerance", "represent", "overflow")
    )


@pytest.mark.parametrize("token", ["1e400", "NaN"])
def test_raw_nonfinite_target_refuses_without_publishing_ready_definition(
    client, workspace, token
):
    base = source_population(client, workspace)
    req = validate_request(workspace, base, base, definition())
    wire = deepcopy(req)
    wire["definition"]["target"] = "__RAW_NONFINITE_TARGET__"
    body = json.dumps(wire, separators=(",", ":")).replace(
        '"__RAW_NONFINITE_TARGET__"', token
    )
    assert f'"target":{token},' in body
    response = client.post(
        VALIDATE, content=body.encode(), headers={"Content-Type": "application/json"}
    )
    assert 400 <= response.status_code < 500, response.text
    a = response.json()
    VALIDATOR.validate(a)
    assert (
        a["message_type"] == "scoring_refusal"
        and a["operation"] == "validate_expectation"
    )
    assert a["code"] in {"invalid_parameter", "invalid_request"}
    if a["code"] == "invalid_parameter":
        assert (
            a["field"] == "definition.target"
            and "edit_definition" in a["recovery_actions"]
        )
    assert a["request_id"] in {None, req["request_id"]}


def test_draft_definition_may_validate_but_cannot_create_a_score_run(client, workspace):
    base = source_population(client, workspace)
    dv = ready(client, workspace, base, base, definition(review_state="draft"))
    req = score_request(workspace, base, base, dv)
    response = client.post(SCORE, json=req)
    assert 400 <= response.status_code < 500, response.text
    a = response.json()
    VALIDATOR.validate(a)
    assert (
        a["message_type"] == "scoring_refusal" and a["operation"] == "score_expectation"
    )
    assert (
        a["code"] == "definition_not_reviewed"
        and "review_definition" in a["recovery_actions"]
    )
