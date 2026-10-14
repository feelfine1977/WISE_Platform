"""Two-process continuity of a saved score reference and its complete witnesses."""

from copy import deepcopy
import csv
import hashlib
import io

from test_import_acceptance import envelope, evidence
from test_saved_investigation_restart import (
    CONTEXT_POLICY,
    ROOT,
    cli_host,
    loopback_port,
    open_workspace,
    reopen,
    save,
)
from test_scoring_acceptance import (
    SCORE,
    VALIDATE,
    WITNESS,
    definition,
    ready,
    score,
    source_population,
    witness,
)
from test_selection_acceptance import contains, select

VALUES = {
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
MEASUREMENTS = {
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
SOURCE_POSITIONS = {
    "D3": [0, 1],
    "D4": [2, 3],
    "D5": [4, 5],
    "D6": [6, 7],
    "MISSING": [8],
    "NOOPEN": [9],
    "GAP": [10, 11, 12],
    "TIED": [13, 14],
    "REOPEN": [15, 16, 17, 18],
}
ENDPOINT_POSITIONS = {
    "D3": (0, 1),
    "D4": (2, 3),
    "D5": (4, 5),
    "D6": (6, 7),
    "MISSING": (8, None),
    "NOOPEN": (None, None),
    "GAP": (10, 12),
    "TIED": (14, 13),
    "REOPEN": (15, 16),
}
TRACE_FIELDS = (
    "columns",
    "records",
    "coverage",
    "mapped_row_ids",
    "omitted_activity_row_ids",
)
WITNESS_FIELDS = (
    "run_identity",
    "case",
    "trace",
    "method_trace_row_ids",
    "activation_candidate_row_ids",
    "response_candidate_row_ids",
    "endpoint_tie_policy",
)


def assert_literal_witness(answer, case_id, original_rows):
    verdict = answer["case"]
    assert verdict["case_id"] == case_id
    assert verdict["value"] == VALUES[case_id]
    assert verdict["in_scope"] is True
    reason = {
        "MISSING": "missing_response",
        "NOOPEN": "missing_activation",
    }.get(case_id, "evaluated")
    assert verdict["reason"] == reason
    measurement = verdict["measurement"]
    assert measurement["value"] == MEASUREMENTS[case_id]
    assert measurement["unit"] == "days" and measurement["censor_age"] is None
    assert measurement["status"] == ("observed" if reason == "evaluated" else reason)
    assert measurement["activation_known"] is (case_id != "NOOPEN")
    assert measurement["response_known"] is (case_id not in {"MISSING", "NOOPEN"})

    trace = answer["trace"]
    assert trace["kind"] == "imported_csv"
    records = trace["records"]
    positions = SOURCE_POSITIONS[case_id]
    assert [row["source_position"] for row in records] == positions
    assert [row["original_cells"] for row in records] == [
        original_rows[i] for i in positions
    ]
    row_ids = [row["row_id"] for row in records]
    assert len(set(row_ids)) == len(row_ids)
    by_position = {row["source_position"]: row["row_id"] for row in records}
    activation, response = ENDPOINT_POSITIONS[case_id]
    assert answer["activation_candidate_row_ids"] == (
        [] if activation is None else [by_position[activation]]
    )
    assert answer["response_candidate_row_ids"] == (
        [] if response is None else [by_position[response]]
    )
    assert (
        answer["endpoint_tie_policy"]
        == "matching_timestamp_candidates_in_declared_order.v1"
    )
    assert set(answer["method_trace_row_ids"]) <= set(row_ids)
    if case_id in {"GAP", "REOPEN", "TIED"}:
        assert answer["method_trace_row_ids"] == row_ids
    if case_id == "GAP":
        assert records[1]["activity"] is None
        assert records[1]["context"] == [{"column_index": 3, "value": None}]
        assert records[2]["context"] == [{"column_index": 3, "value": "Unknown"}]
        assert trace["omitted_activity_row_ids"] == [records[1]["row_id"]]
    return row_ids


def test_saved_score_reference_reopens_original_witnesses_in_a_fresh_cli_process(
    tmp_path,
):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    path = tmp_path / "Überprüfung scored workspace"
    path.mkdir()
    raw = (ROOT / "tests/fixtures/expectations/first-resolution.csv").read_bytes()
    original_rows = list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))[1:]
    assert len(original_rows) == 19
    port = loopback_port()

    with cli_host(tmp_path, 1, port) as (client, first):
        workspace = open_workspace(client, path, "scored-workspace-first")
        base = source_population(client, workspace, raw)
        assert (
            base["identity"]["source_id"]
            == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
        )
        assert base["population"] == {
            "case_ids": sorted(VALUES),
            "case_count": 9,
            "record_count": 19,
        }
        authored = definition(target=4, width=2, unit="days", missing_response="skip")
        version = ready(client, workspace, base, base, authored)
        run = score(client, workspace, base, base, version)
        assert {case["case_id"]: case["value"] for case in run["cases"]} == VALUES
        assert all(case["in_scope"] is True for case in run["cases"])
        assert run["calibration"]["population_fitted"] is False
        before_witnesses = {}
        row_ids = []
        for case_id in sorted(VALUES):
            before = witness(
                client, workspace, run, case_id, request_id=f"before-{case_id}"
            )
            row_ids.extend(assert_literal_witness(before, case_id, original_rows))
            complete = evidence(client, workspace, base, case_id)
            for field in TRACE_FIELDS:
                assert before["trace"][field] == complete[field]
            before_witnesses[case_id] = deepcopy(before)
        assert len(set(row_ids)) == len(row_ids) == 19

        # The saved question is narrower than its original, explicitly scored population.
        predicates = [contains("Opened")]
        selected = select(
            client, workspace, base, predicates, parent=sorted(VALUES), revision=2
        )
        assert selected["kept"] == {
            "case_ids": sorted(set(VALUES) - {"NOOPEN"}),
            "case_count": 8,
            "record_count": 18,
        }
        assert selected["removed"] == {
            "case_ids": ["NOOPEN"],
            "case_count": 1,
            "record_count": 1,
        }
        assert selected["unevaluable"]["case_count"] == 0
        reference = {
            "score_run_id": run["identity"]["run_id"],
            "scored_population_id": run["identity"]["scored_population_identity"][
                "population_id"
            ],
            "calibration_id": run["identity"]["calibration_id"],
        }
        assert reference["scored_population_id"] == base["identity"]["population_id"]
        assert reference["calibration_id"] == run["calibration"]["calibration_id"]
        assert (
            reference["scored_population_id"] != selected["identity"]["population_id"]
        )
        request = envelope(
            "save_investigation_request",
            "save-original-score-run",
            3,
            workspace_id=workspace["workspace_id"],
            investigation_id=None,
            expected_revision_id=None,
            name="Saved first-resolution results",
            base_identity=base["identity"],
            selection_identity=selected["identity"],
            selection_recipe={
                "parent_case_ids": sorted(VALUES),
                "predicates": predicates,
            },
            context_policy=CONTEXT_POLICY,
            comparison=None,
            notes="Synthetic only.\nKeep the original whole-population score run.",
            bookmarks=[
                {
                    "label": "Complete first-response witness",
                    "identity": selected["identity"],
                    "case_id": "REOPEN",
                    "row_ids": [],
                    "note": "The later resolution stays in the history.",
                },
                {
                    "label": "Missing activity record",
                    "identity": selected["identity"],
                    "case_id": "GAP",
                    "row_ids": [
                        before_witnesses["GAP"]["trace"]["records"][1]["row_id"]
                    ],
                    "note": "Preserve the raw gap and the literal Unknown context.",
                },
            ],
            score_run_ref=reference,
        )
        saved = save(client, request)["revision"]
        assert saved["content"] == {
            "format_version": 1,
            **{
                key: deepcopy(request[key])
                for key in (
                    "name",
                    "base_identity",
                    "selection_identity",
                    "selection_recipe",
                    "context_policy",
                    "comparison",
                    "notes",
                    "bookmarks",
                    "score_run_ref",
                )
            },
        }
    assert first.poll() is not None

    with cli_host(tmp_path, 2, port) as (client, second):
        assert second is not first
        routes = []

        def record_read_request(request):
            assert request.url.path not in {
                VALIDATE,
                SCORE,
            }, "Reading a saved run must not make a new scoring request."
            routes.append(request.url.path)

        client.event_hooks["request"].append(record_read_request)
        reopened_workspace = open_workspace(client, path, "scored-workspace-second")
        assert reopened_workspace["workspace_id"] == workspace["workspace_id"]
        assert base["source"] in reopened_workspace["sources"]
        assert {
            key: base["preparation"][key] for key in ("preparation_id", "source_id")
        } in reopened_workspace["preparations"]
        reopened = reopen(client, reopened_workspace, saved["saved_revision_id"])
        assert reopened["revision"] == saved
        assert reopened["revision"]["content"]["score_run_ref"] == reference
        assert reopened["restored_comparison_id"] is None
        for field in (
            "identity",
            "parent_identity",
            "parent",
            "kept",
            "removed",
            "unevaluable",
            "predicate_results",
        ):
            assert reopened["restored_selection"][field] == selected[field]

        # Read the original run before any second-process validation or scoring operation.
        # NOOPEN remains readable from that run even though the saved selection removed it.
        for case_id in sorted(VALUES):
            after = witness(
                client,
                reopened_workspace,
                run,
                case_id,
                request_id=f"after-{case_id}",
                revision=21,
            )
            assert_literal_witness(after, case_id, original_rows)
            for field in WITNESS_FIELDS:
                assert after[field] == before_witnesses[case_id][field]
            identity = after["run_identity"]
            assert identity["run_id"] == reference["score_run_id"]
            assert (
                identity["scored_population_identity"]["population_id"]
                == reference["scored_population_id"]
            )
            assert identity["calibration_id"] == reference["calibration_id"]
        assert routes[:2] == ["/api/workspaces/open", "/api/investigations/reopen"]
        assert routes.count(WITNESS) == 9
    assert second.poll() is not None
