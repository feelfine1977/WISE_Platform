"""Real local CSV HTTP acceptance; literal inputs are independent of product logic."""
from copy import deepcopy
import csv
import hashlib
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
import pytest

from wise_platform_api.app import create_app


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "imports"
SCHEMA = json.loads((ROOT / "contracts" / "import.schema.json").read_text(encoding="utf-8"))
LITERALS = json.loads((FIXTURES / "literal-expected-interpretations.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
UTC_CUTOFF = "2027-01-01T00:00:00Z"
LOCAL_CUTOFF = "2027-01-01T00:00:00"

# Literal source/population/timestamp supports; B5 timed support includes unassigned rows.
SUPPORTS = {
    "B1": (4, 4, 0, 4, 0, 2, 2, 0, 4, 0),
    "B2": (4, 4, 0, 4, 0, 2, 2, 0, 3, 1),
    "B3": (3, 3, 0, 3, 0, 2, 2, 0, 3, 0),
    "B4": (5, 5, 0, 5, 0, 2, 2, 0, 4, 1),
    "B5": (6, 4, 2, 4, 2, 3, 1, 2, 4, 0),
}
REPORT_FIELDS = (
    "raw_record_count", "identified_record_count", "unassigned_record_count",
    "usable_timestamp_record_count", "unavailable_timestamp_record_count", "case_count",
    "sequence_evaluable_case_count", "sequence_unevaluable_case_count",
    "mapped_activity_record_count", "omitted_activity_record_count",
)


def envelope(message_type, request_id="request-1", revision=1, **fields):
    return {"schema_version": 1, "message_type": message_type, "request_id": request_id,
            "query_revision": revision, **fields}


def checked(response, message_type, request=None):
    assert 200 <= response.status_code < 300, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == message_type
    if request is not None:
        assert answer["request_id"] == request["request_id"]
        assert answer["query_revision"] == request["query_revision"]
        if "workspace_id" in request:
            assert answer["workspace_id"] == request["workspace_id"]
    return answer


def refused(response, operation, codes, request=None):
    assert 400 <= response.status_code < 500, response.text
    answer = response.json()
    VALIDATOR.validate(answer)
    assert answer["message_type"] == "import_refusal"
    assert answer["operation"] == operation
    assert answer["code"] in ({codes} if isinstance(codes, str) else set(codes))
    assert answer["message"].strip()
    if request is not None:
        assert answer["request_id"] == request["request_id"]
        if type(request["query_revision"]) is int and request["query_revision"] >= 1:
            assert answer["query_revision"] == request["query_revision"]
    return answer


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as active:
        yield active


@pytest.fixture
def workspace(client, tmp_path):
    path = tmp_path / "Überprüfung Workspace"
    path.mkdir()
    request = envelope("open_workspace_request", path=str(path))
    VALIDATOR.validate(request)
    answer = checked(client.post("/api/workspaces/open", json=request), "workspace_answer", request)
    assert Path(answer["path"]).resolve() == path.resolve()
    assert answer["writable"] is True
    assert answer["sources"] == [] and answer["preparations"] == []
    return answer


def upload_metadata(workspace, filename, request_id="upload-1", revision=1):
    return envelope("upload_source_metadata", request_id, revision,
                    workspace_id=workspace["workspace_id"], filename=filename)


def upload(client, workspace, raw, filename="synthetic.csv", request_id="upload-1", revision=1):
    metadata = upload_metadata(workspace, filename, request_id, revision)
    assert set(metadata) == {"schema_version", "message_type", "request_id", "query_revision", "workspace_id", "filename"}
    VALIDATOR.validate(metadata)
    answer = checked(client.put("/api/sources", params=metadata, content=raw,
                               headers={"Content-Type": "application/octet-stream"}), "source_answer", metadata)
    assert answer["source"] == {"source_id": "source.v1:sha256:" + hashlib.sha256(raw).hexdigest(),
                                "filename": filename, "byte_count": len(raw)}
    return answer["source"]


def read_input(name):
    literal = LITERALS["fixtures"][name]
    raw = (FIXTURES / literal["file"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == LITERALS["file_sha256"][literal["file"]]
    encoding = {"windows-1252": "cp1252", "utf-8 with BOM": "utf-8-sig", "utf-8": "utf-8"}[literal["encoding"]]
    records = list(csv.reader(io.StringIO(raw.decode(encoding), newline=""), delimiter=literal["delimiter"]))
    assert records[0] == literal["raw_headers"]
    return literal, raw, records[1:]


def policies(time_format="iso8601", offset=None, wall=False):
    time = ({"id": "incident.time.wall_clock_as_recorded.v1", "parameters": {
        "format": time_format, "timezone": "none_as_recorded", "snapshot_cutoff_local": LOCAL_CUTOFF}}
        if wall else {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {
            "format": time_format, "timezone": {"mode": "from_values"} if offset is None else {
                "mode": "fixed_offset", "offset_minutes": offset}, "snapshot_cutoff_utc": UTC_CUTOFF}})
    return {
        "time": time,
        "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {
            "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
            "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position",
            "unavailable_timestamp_case_sequence": "unevaluable"}},
        "rows": {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": {
            "missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
            "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}},
        "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1", "parameters": {
            "empty_activity_context": "missing", "literal_values": "preserve"}},
        "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1", "parameters": {
            "normalization": "trim_outer_whitespace_preserve_raw"}},
        "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {
            "missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
        "parent": {"id": "incident.parent.all_identified_cases.v1", "parameters": {
            "eligibility": "nonempty_normalized_case_identifier"}},
    }


def mapping_request(workspace, source, name="B2", accept=True, wall=False):
    literal = LITERALS["fixtures"][name]
    positions = literal["mapping_positions"]
    time_format = "dmy_dot_minute" if name in ("B1", "B3") else "iso8601"
    request = envelope("confirm_mapping_request", "prepare-1", workspace_id=workspace["workspace_id"],
        source_id=source["source_id"], dialect={"encoding": {"utf-8 with BOM": "utf-8-sig", "windows-1252": "windows-1252", "utf-8": "utf-8"}[literal["encoding"]],
            "delimiter": literal["delimiter"], "quotechar": '"', "header": "first_record"},
        mapping={"case_column": positions["incident"], "activity_column": positions["activity"], "timestamp_column": positions["timestamp"],
                 "sequence_column": positions["sequence"], "context_columns": positions["context"]},
        policies=policies(time_format, 120 if name == "B1" else 0 if name == "B3" else None, wall),
        accept_report_issues=accept)
    VALIDATOR.validate(request)
    return request


def prepare(client, request, state="ready"):
    VALIDATOR.validate(request)
    answer = checked(client.post("/api/preparations", json=request), "interpretation_answer", request)
    assert answer["source_id"] == request["source_id"]
    assert answer["state"] == state
    if state == "ready":
        assert answer["preparation"]["source_id"] == request["source_id"]
        for field in ("dialect", "mapping", "policies"):
            assert answer["preparation"][field] == request[field]
    else:
        assert answer["preparation"] is None
    return answer


def population(client, workspace, interpretation, revision=1):
    request = envelope("open_population_request", "population-1", revision, workspace_id=workspace["workspace_id"],
                       preparation_id=interpretation["preparation"]["preparation_id"])
    VALIDATOR.validate(request)
    answer = checked(client.post("/api/investigations/open-population", json=request), "imported_population_answer", request)
    assert answer["preparation"] == interpretation["preparation"]
    assert answer["identity"]["preparation_id"] == request["preparation_id"]
    assert answer["identity"]["source_id"] == interpretation["source_id"] == answer["source"]["source_id"]
    return answer


def evidence_request(workspace, answer, case_id):
    return envelope("imported_case_evidence_request", "evidence-1", answer["query_revision"],
                    workspace_id=workspace["workspace_id"], identity=deepcopy(answer["identity"]), case_id=case_id)


def evidence(client, workspace, answer, case_id):
    request = evidence_request(workspace, answer, case_id)
    VALIDATOR.validate(request)
    result = checked(client.post("/api/investigations/case-evidence", json=request), "imported_case_evidence_answer", request)
    assert result["identity"] == answer["identity"] and result["case_id"] == case_id
    return result


@pytest.mark.parametrize("name", ["B1", "B2", "B3", "B4", "B5"])
def test_real_import_population_and_complete_evidence_match_literal_inputs(client, workspace, name):
    literal, raw, original = read_input(name)
    source = upload(client, workspace, raw, literal["file"])
    inspect_request = envelope("inspect_csv_request", "inspect-1", workspace_id=workspace["workspace_id"], source_id=source["source_id"],
        hints={"encoding": {"utf-8 with BOM": "utf-8-sig", "windows-1252": "windows-1252", "utf-8": "utf-8"}[literal["encoding"]], "delimiter": literal["delimiter"]})
    inspection = checked(client.post("/api/sources/inspect", json=inspect_request), "csv_inspection_answer", inspect_request)
    assert inspection["source_id"] == source["source_id"]
    assert inspection["columns"] == [{"index": index, "name": header} for index, header in enumerate(literal["raw_headers"])]
    assert inspection["record_count"] == SUPPORTS[name][0]
    assert inspection["sample_rows"], "Inspection must supply actual readable source samples."
    for sample in inspection["sample_rows"]:
        assert sample["cells"] == original[sample["source_position"]]
    interpretation = prepare(client, mapping_request(workspace, source, name))
    report = interpretation["report"]
    assert tuple(report[field] for field in REPORT_FIELDS) == SUPPORTS[name]
    answer = population(client, workspace, interpretation)
    ids = literal.get("case_ids", literal.get("population_case_ids"))
    assert answer["population"] == {"case_ids": ids, "case_count": SUPPORTS[name][5], "record_count": SUPPORTS[name][1]}
    assert answer["unassigned_record_count"] == SUPPORTS[name][2]
    assert answer["coverage"] == {"raw_record_count": SUPPORTS[name][1], "mapped_record_count": SUPPORTS[name][8], "omitted_activity_record_count": SUPPORTS[name][9]}
    assert [case["case_id"] for case in answer["cases"]] == ids
    order = literal.get("ordered_record_ordinals", literal.get("evidence_ordered_record_ordinals"))
    for case_id in ids:
        result = evidence(client, workspace, answer, case_id)
        # The descriptive oracle uses one-based data ordinals; the API uses zero-based positions.
        positions = [ordinal - 1 for ordinal in order[case_id]]
        assert [record["source_position"] for record in result["records"]] == positions
        assert [record["original_cells"] for record in result["records"]] == [original[position] for position in positions]
        assert result["columns"] == inspection["columns"]
        assert result["sequence_evaluable"] is (literal.get("ordering_complete_by_case", {}).get(case_id, True))
        row_ids = [record["row_id"] for record in result["records"]]
        assert len(set(row_ids)) == len(row_ids)
        assert evidence(client, workspace, answer, case_id)["records"] == result["records"]
        mapped = [record["row_id"] for record in result["records"] if record["activity"] is not None]
        omitted = [record["row_id"] for record in result["records"] if record["activity"] is None]
        assert result["mapped_row_ids"] == mapped and result["omitted_activity_row_ids"] == omitted
        assert result["coverage"] == {"raw_record_count": len(positions), "mapped_record_count": len(mapped), "omitted_activity_record_count": len(omitted)}
        for record in result["records"]:
            position = record["source_position"]
            assert record["activity"] == (original[position][1] or None)
            assert record["context"] == [{"column_index": index, "value": original[position][index] or None} for index in literal["mapping_positions"]["context"]]
            assert record["timestamp_kind"] == "utc_instant" and record["local_timestamp"] is None
            invalid = name == "B5" and position in (1, 4)
            assert record["timestamp_status"] == ("invalid" if invalid else "usable")
            if invalid:
                assert record["utc_instant"] is None
            elif name in ("B1", "B2"):
                assert record["utc_instant"] == literal["normalized_utc_by_record"][position]
            elif name == "B3":
                assert record["utc_instant"] == literal["chosen_day_first"]["normalized_utc_by_record"][position]
            else:
                assert record["utc_instant"] == original[position][2]
    assert (FIXTURES / literal["file"]).read_bytes() == raw


def test_bom_quotes_and_umlauts_survive_inspection_without_dialect_hints(client, workspace):
    for name, encoding in [("B1", "windows-1252"), ("B2", "utf-8-sig")]:
        literal, raw, rows = read_input(name)
        source = upload(client, workspace, raw, literal["file"])
        request = envelope("inspect_csv_request", "inspect-auto", workspace_id=workspace["workspace_id"], source_id=source["source_id"])
        result = checked(client.post("/api/sources/inspect", json=request), "csv_inspection_answer", request)
        assert {"encoding": encoding, "delimiter": literal["delimiter"], "quotechar": '"', "header": "first_record"} in result["dialect_candidates"]
        assert result["columns"] == [{"index": index, "name": header} for index, header in enumerate(literal["raw_headers"])]
        assert result["record_count"] == 4
        samples = {row["source_position"]: row["cells"] for row in result["sample_rows"]}
        assert samples[1] == rows[1]


def test_unavailable_times_need_confirmation_then_remain_raw_and_sequence_unevaluable(client, workspace):
    literal, raw, _ = read_input("B5")
    source = upload(client, workspace, raw, literal["file"])
    request = mapping_request(workspace, source, "B5", accept=False)
    pending = prepare(client, request, "needs_confirmation")
    expected_issues = {(1, 2, "M-01", "invalid_timestamp"), (2, 0, None, "missing_case_id"),
                       (3, 0, None, "missing_case_id"), (4, 2, "M-02", "invalid_timestamp")}
    assert {(issue["source_position"], issue["column_index"], issue["case_id"], issue["code"]) for issue in pending["report"]["issues"]} >= expected_issues
    request["accept_report_issues"] = True
    confirmed = prepare(client, request)
    assert tuple(confirmed["report"][field] for field in REPORT_FIELDS) == SUPPORTS["B5"]
    assert {item["activity"]: (item["record_count"], item["case_count"]) for item in confirmed["report"]["activities"]} == {"Recorded": (2, 2), "Routed": (1, 1), "Observed": (1, 1)}
    cases = population(client, workspace, confirmed)["cases"]
    assert {case["case_id"]: case["sequence_evaluable"] for case in cases} == {"M-01": False, "M-02": False, "M-03": True}


def test_wall_clock_is_explicit_and_does_not_become_a_utc_instant(client, workspace):
    literal, raw, _ = read_input("B1")
    source = upload(client, workspace, raw, literal["file"])
    wall = prepare(client, mapping_request(workspace, source, "B1", wall=True))
    report = wall["report"]
    assert report["timestamp_kind"] == "wall_clock"
    assert (report["first_usable_local_timestamp"], report["last_usable_local_timestamp"]) == ("2026-10-09T08:00:00", "2026-10-11T12:15:00")
    assert report["first_usable_utc_instant"] is report["last_usable_utc_instant"] is report["snapshot_cutoff_utc"] is None
    assert report["snapshot_cutoff_local"] == LOCAL_CUTOFF
    answer = population(client, workspace, wall)
    records = evidence(client, workspace, answer, "AR-01")["records"]
    assert [record["local_timestamp"] for record in records] == ["2026-10-09T08:00:00", "2026-10-09T08:30:00", "2026-10-09T10:00:00"]
    assert all(record["timestamp_kind"] == "wall_clock" and record["utc_instant"] is None for record in records)
    utc = prepare(client, mapping_request(workspace, source, "B1"))
    assert utc["preparation"]["source_id"] == wall["source_id"]
    assert utc["preparation"]["preparation_id"] != wall["preparation"]["preparation_id"]
    assert population(client, workspace, utc)["identity"]["representation_id"] != answer["identity"]["representation_id"]


def test_ambiguous_slash_dates_require_explicit_format_and_offset(client, workspace):
    raw = b"Ticket;Activity;At\r\nD-01;Observed;03/04/2026 09:10\r\nD-01;Routed;04/05/2026 09:10\r\nD-02;Observed;11/12/2026 09:10\r\n"
    source = upload(client, workspace, raw, "ambiguous.csv")
    request = envelope("inspect_csv_request", "inspect-ambiguous", workspace_id=workspace["workspace_id"], source_id=source["source_id"], hints={"encoding": "utf-8", "delimiter": ";"})
    inspected = checked(client.post("/api/sources/inspect", json=request), "csv_inspection_answer", request)
    timestamp = next(item for item in inspected["role_suggestions"] if item["column_index"] == 2)
    assert {(item["format"], item["parsed_count"]) for item in timestamp["timestamp_matches"]} >= {("dmy_slash_minute", 3), ("mdy_slash_minute", 3)}
    assert inspected["unresolved"]
    request = mapping_request(workspace, source, "B3")
    results = []
    for format_name, expected in [("dmy_slash_minute", ["2026-04-03T09:10:00Z", "2026-05-04T09:10:00Z"]),
                                  ("mdy_slash_minute", ["2026-03-04T09:10:00Z", "2026-04-05T09:10:00Z"])]:
        request["policies"]["time"] = policies(format_name, 0)["time"]
        prepared = prepare(client, request)
        result = population(client, workspace, prepared)
        assert [row["utc_instant"] for row in evidence(client, workspace, result, "D-01")["records"]] == expected
        results.append(result)
    assert results[0]["identity"]["source_id"] == results[1]["identity"]["source_id"]
    assert results[0]["identity"]["preparation_id"] != results[1]["identity"]["preparation_id"]
    request["policies"]["time"] = policies("dmy_slash_minute")["time"]
    refused(client.post("/api/preparations", json=request), "confirm_mapping", "timezone_required", request)


def test_missing_sequence_uses_source_position_for_equal_times(client, workspace):
    literal, raw, _ = read_input("B4")
    source = upload(client, workspace, raw, literal["file"])
    request = mapping_request(workspace, source, "B4")
    request["mapping"]["sequence_column"] = None
    answer = population(client, workspace, prepare(client, request))
    rows = evidence(client, workspace, answer, "T-01")["records"]
    assert [row["source_position"] for row in rows] == [1, 0, 2, 3]
    assert all(row["source_sequence"] is None for row in rows)
    assert rows[2]["context"] == [{"column_index": 4, "value": None}]
    assert rows[3]["context"] == [{"column_index": 4, "value": "Unknown"}]


def test_dotted_dates_preserve_both_explicit_day_month_interpretations(client, workspace):
    literal, raw, _ = read_input("B3")
    source = upload(client, workspace, raw, literal["file"])
    request = mapping_request(workspace, source, "B3")
    answers = []
    for format_name, oracle_key in [("dmy_dot_minute", "chosen_day_first"),
                                   ("mdy_dot_minute", "chosen_month_first")]:
        request["policies"]["time"] = policies(format_name, 0)["time"]
        result = population(client, workspace, prepare(client, request))
        for case_id in result["population"]["case_ids"]:
            for row in evidence(client, workspace, result, case_id)["records"]:
                assert row["utc_instant"] == literal[oracle_key]["normalized_utc_by_record"][row["source_position"]]
        answers.append(result)
    assert answers[0]["identity"]["source_id"] == answers[1]["identity"]["source_id"]
    assert answers[0]["identity"]["preparation_id"] != answers[1]["identity"]["preparation_id"]


def test_german_seconds_and_fractional_seconds_preserve_exact_instants_and_cells(client, workspace):
    raw = ("Ticket;Activity;At;Desk\r\nS-01;Erfasst;15.08.2026 12:09:00.123456;Büro Nord\r\n"
           "S-01;Prüfung;15.08.2026 12:09:01;Büro Süd\r\n").encode("cp1252")
    source = upload(client, workspace, raw, "seconds.csv")
    inspected = checked(client.post("/api/sources/inspect", json=envelope("inspect_csv_request", workspace_id=workspace["workspace_id"], source_id=source["source_id"])), "csv_inspection_answer")
    assert any(role["column_index"] == 2 and {"format": "dmy_dot_second", "parsed_count": 2} in role["timestamp_matches"] for role in inspected["role_suggestions"])
    request = mapping_request(workspace, source, "B3")
    request["dialect"]["encoding"] = "windows-1252"
    request["mapping"]["context_columns"] = [3]
    request["policies"]["time"] = policies("dmy_dot_second", 120)["time"]
    answer = population(client, workspace, prepare(client, request))
    rows = evidence(client, workspace, answer, "S-01")["records"]
    assert [row["utc_instant"] for row in rows] == ["2026-08-15T10:09:00.123456Z", "2026-08-15T10:09:01Z"]
    assert rows[0]["original_cells"] == ["S-01", "Erfasst", "15.08.2026 12:09:00.123456", "Büro Nord"]
    assert rows[1]["activity"] == "Prüfung"


def test_twelve_hour_midnight_and_noon_use_the_declared_format(client, workspace):
    raw = b"Ticket;Activity;At\r\nC;Recorded;10/12/2026 12:05:00 AM\r\nC;Completed;10/12/2026 12:05:00 PM\r\n"
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3")
    request["policies"]["time"] = policies("mdy_slash_12h_second", 0)["time"]
    answer = population(client, workspace, prepare(client, request))
    assert [row["utc_instant"] for row in evidence(client, workspace, answer, "C")["records"]] == ["2026-10-12T00:05:00Z", "2026-10-12T12:05:00Z"]


def test_literal_zero_false_and_whitespace_identifiers_preserve_original_cells(client, workspace):
    raw = b"Ticket;Activity;At;Context\r\n 0 ;False;2026-10-09T08:00:00Z;0\r\nFalse;0;2026-10-09T09:00:00Z;False\r\n"
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3")
    request["mapping"]["context_columns"] = [3]
    request["policies"]["time"] = policies()["time"]
    answer = population(client, workspace, prepare(client, request))
    assert answer["population"] == {"case_ids": ["0", "False"], "case_count": 2, "record_count": 2}
    zero = evidence(client, workspace, answer, "0")["records"][0]
    false = evidence(client, workspace, answer, "False")["records"][0]
    assert zero["original_cells"] == [" 0 ", "False", "2026-10-09T08:00:00Z", "0"]
    assert zero["activity"] == "False" and zero["context"] == [{"column_index": 3, "value": "0"}]
    assert false["activity"] == "0" and false["context"] == [{"column_index": 3, "value": "False"}]


def test_missing_and_invalid_times_remain_distinct_complete_evidence(client, workspace):
    raw = b"Ticket;Activity;At\r\nX;Recorded;2026-10-09T08:00:00Z\r\nX;Changed;\r\nX;Reviewed;not-a-time\r\n"
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3")
    request["policies"]["time"] = policies()["time"]
    answer = population(client, workspace, prepare(client, request))
    result = evidence(client, workspace, answer, "X")
    assert result["sequence_evaluable"] is False
    assert [row["source_position"] for row in result["records"]] == [0, 1, 2]
    assert [row["timestamp_status"] for row in result["records"]] == ["usable", "missing", "invalid"]
    assert all(row["utc_instant"] is None and row["local_timestamp"] is None for row in result["records"][1:])


def test_malformed_mapped_sequence_blocks_even_with_issue_acceptance(client, workspace):
    raw = b"Ticket;Activity;At;Seq\r\nX;Recorded;2026-10-09T08:00:00Z;1\r\nX;Changed;2026-10-09T09:00:00Z;many\r\n"
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3")
    request["mapping"]["sequence_column"] = 3
    request["policies"]["time"] = policies()["time"]
    blocked = prepare(client, request, "blocked")
    assert any(issue["code"] == "invalid_sequence" and issue["severity"] == "blocking" and issue["source_position"] == 1 for issue in blocked["report"]["issues"])


def test_sequence_precision_survives_browser_json_numbers_or_blocks_publication(client, workspace):
    for value, state in [("9007199254740991", "ready"), ("9007199254740992", "blocked"),
                         ("9007199254740993", "blocked")]:
        raw = ("Ticket;Activity;At;Seq\r\nX;Recorded;2026-10-09T08:00:00Z;" + value + "\r\n").encode()
        source = upload(client, workspace, raw)
        request = mapping_request(workspace, source, "B3")
        request["mapping"]["sequence_column"] = 3
        request["policies"]["time"] = policies()["time"]
        result = prepare(client, request, state)
        if state == "blocked":
            assert any(issue["code"] == "invalid_sequence" and issue["severity"] == "blocking" for issue in result["report"]["issues"])
        else:
            answer = population(client, workspace, result)
            row = evidence(client, workspace, answer, "X")["records"][0]
            assert row["source_sequence"] == 9007199254740991
            assert row["original_cells"][-1] == value


def test_confirmed_source_and_mapping_reopen_in_a_fresh_application(tmp_path):
    path = tmp_path / "persistent external workspace"
    path.mkdir()
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as first:
        workspace_request = envelope("open_workspace_request", path=str(path))
        workspace = checked(first.post("/api/workspaces/open", json=workspace_request), "workspace_answer", workspace_request)
        literal, raw, _ = read_input("B2")
        source = upload(first, workspace, raw, "Überprüfung source.csv")
        request = mapping_request(workspace, source, "B2")
        interpretation = prepare(first, request)
        initial = population(first, workspace, interpretation)
        record_ids = [row["row_id"] for row in evidence(first, workspace, initial, "Q-01")["records"]]
        request["request_id"], request["query_revision"] = "prepare-repeat", 7
        assert prepare(first, request)["preparation"] == interpretation["preparation"]
        assert upload(first, workspace, raw, "Überprüfung source.csv", "upload-repeat", 7) == source
    # A new app instance establishes source/mapping continuity, not a new-process receipt.
    with TestClient(create_app(static_dir=tmp_path / "unbuilt")) as second:
        reopened = checked(second.post("/api/workspaces/open", json=workspace_request), "workspace_answer", workspace_request)
        assert reopened["workspace_id"] == workspace["workspace_id"]
        assert source in reopened["sources"]
        assert {"preparation_id": interpretation["preparation"]["preparation_id"], "source_id": source["source_id"]} in reopened["preparations"]
        result = population(second, reopened, interpretation, revision=8)
        assert result["identity"] == initial["identity"]
        assert [row["row_id"] for row in evidence(second, reopened, result, "Q-01")["records"]] == record_ids


@pytest.mark.parametrize("bad_revision", [True, "one", "1.5"])
def test_raw_byte_upload_rejects_noninteger_query_metadata(client, workspace, bad_revision):
    metadata = upload_metadata(workspace, "synthetic.csv")
    metadata["query_revision"] = bad_revision
    refused(client.put("/api/sources", params=metadata, content=b"x", headers={"Content-Type": "application/octet-stream"}),
            "upload_source", {"invalid_request", "invalid_parameter"})


@pytest.mark.parametrize("mutation, code", [("mapping", "invalid_mapping"), ("policy", "unsupported_policy"), ("schema", "unsupported_schema")])
def test_invalid_mapping_policy_or_schema_refuses_instead_of_defaulting(client, workspace, mutation, code):
    literal, raw, _ = read_input("B2")
    source = upload(client, workspace, raw, literal["file"])
    request = mapping_request(workspace, source, "B2")
    if mutation == "mapping":
        request["mapping"]["case_column"] = 999
    elif mutation == "policy":
        request["policies"]["parent"]["id"] = "incident.parent.all_identified_cases.v2"
    else:
        request["schema_version"] = 2
    refused(client.post("/api/preparations", json=request), "confirm_mapping", code, request)


def test_unknown_workspace_source_and_preparation_do_not_return_empty_success(client, workspace):
    missing_source = "source.v1:sha256:" + "0" * 64
    inspect = envelope("inspect_csv_request", workspace_id=workspace["workspace_id"], source_id=missing_source)
    refused(client.post("/api/sources/inspect", json=inspect), "inspect_csv", "source_unavailable", inspect)
    inspect["workspace_id"] = "workspace.v1:unknown123"
    refused(client.post("/api/sources/inspect", json=inspect), "inspect_csv", "workspace_unavailable", inspect)
    request = envelope("open_population_request", workspace_id=workspace["workspace_id"], preparation_id="preparation.v1:sha256:" + "0" * 64)
    refused(client.post("/api/investigations/open-population", json=request), "open_population", "preparation_unavailable", request)


def test_case_evidence_refuses_missing_case_and_mismatched_identity(client, workspace):
    literal, raw, _ = read_input("B2")
    source = upload(client, workspace, raw, literal["file"])
    result = population(client, workspace, prepare(client, mapping_request(workspace, source, "B2")))
    request = evidence_request(workspace, result, "not-present")
    refused(client.post("/api/investigations/case-evidence", json=request), "case_evidence", "case_not_found", request)
    request["case_id"] = "Q-01"
    request["identity"]["source_id"] = "source.v1:sha256:" + "0" * 64
    refused(client.post("/api/investigations/case-evidence", json=request), "case_evidence", "identity_mismatch", request)


def test_mixed_zoned_and_unzoned_values_refuse_before_preparation_publication(client, workspace):
    raw = b"Ticket;Activity;At\r\nX;Recorded;2026-10-09T08:00:00Z\r\nX;Changed;2026-10-09T09:00:00\r\n"
    source = upload(client, workspace, raw)
    request = mapping_request(workspace, source, "B3")
    request["policies"]["time"] = policies()["time"]
    refused(client.post("/api/preparations", json=request), "confirm_mapping", "mixed_timezone_values", request)


def test_cutoff_before_usable_records_refuses_instead_of_trimming_history(client, workspace):
    literal, raw, _ = read_input("B2")
    source = upload(client, workspace, raw, literal["file"])
    request = mapping_request(workspace, source, "B2")
    request["policies"]["time"]["parameters"]["snapshot_cutoff_utc"] = "2026-10-01T00:00:00Z"
    refused(client.post("/api/preparations", json=request), "confirm_mapping", "cutoff_before_records", request)


def test_raw_byte_upload_refuses_extra_metadata_keys(client, workspace):
    metadata = upload_metadata(workspace, "synthetic.csv")
    metadata["silent_default"] = "allowed"
    refused(client.put("/api/sources", params=metadata, content=b"x", headers={"Content-Type": "application/octet-stream"}),
            "upload_source", "invalid_request")
