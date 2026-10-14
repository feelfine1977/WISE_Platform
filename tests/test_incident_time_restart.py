"""Selected full-history time evidence survives genuine server process restarts."""

from copy import deepcopy

from test_incident_time_contracts import FIXTURES, ROOT, read
from test_import_acceptance import evidence, population, prepare, upload
from test_selection_acceptance import select
from test_explorer_core_http import save_request
from test_saved_investigation_restart import cli_host, loopback_port, open_workspace, reopen, save


def imported_population(client, workspace, kind):
    source = upload(client, workspace, (FIXTURES / f"{kind}.csv").read_bytes(), f"{kind}.csv")
    request = read(f"{kind}-prepare-request.json")
    request["workspace_id"] = workspace["workspace_id"]
    assert source["source_id"] == request["source_id"]
    return population(client, workspace, prepare(client, request))


def durable_bytes(path):
    return {file.relative_to(path): file.read_bytes() for file in path.rglob("*") if file.is_file()}


def test_saved_selected_histories_reopen_on_both_clocks_before_fresh_selection(tmp_path):
    assert not tmp_path.resolve().is_relative_to(ROOT)
    port = loopback_port()
    kept_ids = ["A", "AllUnlabelled", "Bounds", "D", "HugeEqual", "HugeUnequal", "Micro2500", "Missing",
                "RawFirstUnlabelled", "TwoTieGroups"]
    predicates = [{"kind": "case_id_in", "case_ids": kept_ids, "negate": False}]
    before = {}
    with cli_host(tmp_path, "time-first", port) as (client, first):
        for kind in ("utc_instant", "wall_clock"):
            path = tmp_path / ("Übergabe " + kind)
            path.mkdir()
            workspace = open_workspace(client, path, "open-" + kind)
            base = imported_population(client, workspace, kind)
            selected = select(client, workspace, base, predicates)
            assert selected["kept"] == {"case_ids": kept_ids, "case_count": 10, "record_count": 26}
            traces = {case_id: evidence(client, workspace, selected, case_id) for case_id in kept_ids}
            for case_id, trace in traces.items():
                assert trace["incident_time"] == read(f"positive/{kind}-{case_id}.json")["incident_time"]
            request = save_request(workspace, base, selected, predicates)
            request["bookmarks"] = [{"label": "Complete raw history", "identity": selected["identity"],
                                     "case_id": "A", "row_ids": [], "note": "Preserve every record."},
                                    {"label": "Unlabelled adjacency", "identity": selected["identity"],
                                     "case_id": "A", "row_ids": [traces["A"]["records"][1]["row_id"]], "note": "Raw time witness."}]
            saved = save(client, request)
            durable = durable_bytes(path)
            assert evidence(client, workspace, selected, "A")["incident_time"] == traces["A"]["incident_time"]
            assert durable_bytes(path) == durable
            before[kind] = {"path": path, "workspace": workspace, "base": base, "selected": selected,
                            "traces": traces, "saved": saved, "durable": durable}
    assert first.poll() is not None
    with cli_host(tmp_path, "time-second", port) as (client, second):
        assert first.pid != second.pid
        for kind, old in before.items():
            workspace = open_workspace(client, old["path"], "reopen-" + kind)
            assert workspace["workspace_id"] == old["workspace"]["workspace_id"]
            restored = reopen(client, workspace, old["saved"]["revision"]["saved_revision_id"])
            assert restored["revision"] == old["saved"]["revision"]
            for field in ("identity", "parent_identity", "parent", "kept", "removed", "unevaluable", "predicate_results"):
                assert restored["restored_selection"][field] == old["selected"][field]
            selection = {"identity": restored["restored_selection"]["identity"], "query_revision": restored["query_revision"]}
            # Registry restoration must work before any fresh selection or population query.
            for case_id in kept_ids:
                after = evidence(client, workspace, selection, case_id)
                expected = deepcopy(old["traces"][case_id])
                expected["query_revision"] = restored["query_revision"]
                assert after == expected
            assert durable_bytes(old["path"]) == old["durable"]
    assert second.poll() is not None
