"""Real HTTP checks for explicitly tolerant CSV preparation."""
from test_import_acceptance import (
    checked, client, envelope, evidence, policies, population, refused, upload, workspace,
)


def request_for(workspace, source, accept=False, tolerant=True):
    selected = policies()
    if tolerant:
        selected["rows"]["id"] = "incident.rows.missing_id_outside_invalid_time_retained.v2"
        selected["rows"]["parameters"].update({
            "blank_records": "skip_count_preserve_source_ordinal",
            "ragged_records": "outside_population_preserve_raw",
            "maximum_ragged_fraction": 0.05,
            "field_character_limit": 10485760,
        })
    return envelope("confirm_mapping_request", workspace_id=workspace["workspace_id"],
        source_id=source["source_id"],
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2,
                 "sequence_column": None, "context_columns": []},
        policies=selected, accept_report_issues=accept)


def post_mapping(client, request):
    return client.post("/api/preparations", json=request)


def test_exact_five_percent_exclusions_preserve_raw_witness_and_ordinal(client, workspace):
    good = [f"A{i:02},Opened,2026-10-01T09:00:00Z\r\n" for i in range(1, 20)]
    raw_text = 'A99,"Opened\u0085\u000b",2026-10-01T09:00:00Z,"extra\r\ncell"\r\n'
    raw = ("id,activity,time\r\n\r\n" + good[0] + "\r\n" + raw_text + "".join(good[1:])).encode()
    source = upload(client, workspace, raw)
    request = request_for(workspace, source)
    pending = checked(post_mapping(client, request), "interpretation_answer", request)
    assert pending["state"] == "needs_confirmation"
    report = pending["report"]
    assert (report["raw_record_count"], report["identified_record_count"], report["unassigned_record_count"]) == (20, 19, 1)
    assert (report["blank_record_count"], report["ragged_record_count"], report["case_count"]) == (2, 1, 19)
    assert report["excluded_source_records"] == [{
        "source_position": 3, "physical_line_start": 5, "physical_line_end": 6,
        "cell_count": 4, "reason": "ragged_record",
        "original_cells": ["A99", "Opened\u0085\u000b", "2026-10-01T09:00:00Z", "extra\r\ncell"],
        "original_text": raw_text,
    }]
    request["accept_report_issues"] = True
    ready = checked(post_mapping(client, request), "interpretation_answer", request)
    assert ready["state"] == "ready"
    assert ready["report"] == report
    answer = population(client, workspace, ready)
    assert {row["case_id"] for row in answer["cases"]} == {f"A{i:02}" for i in range(1, 20)}
    history = evidence(client, workspace, answer, "A01")
    assert [row["source_position"] for row in history["records"]] == [1]


def test_above_five_percent_refuses_instead_of_associating_ragged_rows(client, workspace):
    raw = ("id,activity,time\n" + "A,Opened,2026-10-01T09:00:00Z\n" * 18 + "A,extra\n").encode()
    source = upload(client, workspace, raw)
    request = request_for(workspace, source, accept=True)
    answer = refused(post_mapping(client, request), "confirm_mapping", {"malformed_source", "invalid_parameter"}, request)
    assert "5" in answer["message"] or "fraction" in answer["message"].lower()


def test_v1_stays_strict_after_v2_exists(client, workspace):
    source = upload(client, workspace, b"id,activity,time\n\nA,Opened,2026-10-01T09:00:00Z\n")
    request = request_for(workspace, source, accept=True, tolerant=False)
    refused(post_mapping(client, request), "confirm_mapping", {"malformed_source", "invalid_parameter"}, request)


def test_long_quoted_cell_survives_without_the_previous_small_csv_limit(client, workspace):
    activity = "Long " + "x" * 200000 + "\r\nend"
    source = upload(client, workspace, ('id,activity,time\r\nA,"' + activity + '",2026-10-01T09:00:00Z\r\n').encode())
    request = request_for(workspace, source, accept=True)
    ready = checked(post_mapping(client, request), "interpretation_answer", request)
    assert ready["state"] == "ready"
    answer = population(client, workspace, ready)
    history = evidence(client, workspace, answer, "A")
    assert len(history["records"]) == 1
    assert history["records"][0]["original_cells"][1] == activity
