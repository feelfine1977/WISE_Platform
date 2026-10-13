"""Malformed stored numbers are unavailable artifacts, never a fresh computation."""

import json

import pytest

from test_saved_result_integrity import corrupt_d5
from test_score_run_read import kept_run, kept_bytes, no_method_execution, read_request, refused


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_stored_run_is_a_typed_unavailable_artifact(kept_run, monkeypatch, invalid):
    state = kept_run
    path, _ = corrupt_d5(state["folder"], state["run"])
    stored = json.loads(path.read_text())
    record = stored.get("record", stored)
    next(case for case in record["cases"] if case["case_id"] == "D5")["value"] = invalid
    path.write_text(json.dumps(stored, allow_nan=True), encoding="utf8")
    protected = kept_bytes(state["folder"])
    before = len(state["evaluated"].calls)
    request = read_request(state["workspace"], state["run"]["identity"]["run_id"], "read-malformed-number", 71)
    with no_method_execution(monkeypatch):
        refused(state["client"], request, "run_unavailable")
    assert kept_bytes(state["folder"]) == protected
    assert len(state["evaluated"].calls) == before
