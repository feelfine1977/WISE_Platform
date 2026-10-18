"""Literal generic CSV histories qualify preparation, time and complete evidence."""

from copy import deepcopy
from dataclasses import FrozenInstanceError
import hashlib

import pytest

from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import PreparationResult, prepare
from wise_platform_analytics.prepared_operations import open_prepared_case, open_prepared_population


def choices(mode="wall", format_name="dmy_dot_minute"):
    result = {
        "order": {"id": "incident.order.declared_time_optional_sequence_source_position.v1", "parameters": {
            "primary": "usable_declared_time_ascending", "secondary": "mapped_sequence_or_source_position",
            "tie_breaker": "source_position_ascending", "unavailable_timestamp": "presentation_tail_source_position", "unavailable_timestamp_case_sequence": "unevaluable"}},
        "rows": {"id": "incident.rows.missing_id_outside_invalid_time_retained.v1", "parameters": {
            "missing_case_id": "outside_population_preserve_source", "unavailable_timestamp": "retain_case_raw_flag_order_unknown",
            "invalid_mapped_sequence": "block_preparation", "duplicate_candidates": "retain_all"}},
        "missing_values": {"id": "incident.missing.empty_mapped_activity_context.v1", "parameters": {"empty_activity_context": "missing", "literal_values": "preserve"}},
        "identifier": {"id": "incident.identifier.trim_outer_whitespace.v1", "parameters": {"normalization": "trim_outer_whitespace_preserve_raw"}},
        "activity_projection": {"id": "incident.activity.omit_missing_retain_raw_gaps.v1", "parameters": {"missing_activity": "omit_from_mapped_sequence", "raw_records": "retain_all", "gap_evidence": "omitted_row_ids"}},
        "parent": {"id": "incident.parent.all_identified_cases.v1", "parameters": {"eligibility": "nonempty_normalized_case_identifier"}},
    }
    if mode == "wall":
        result["time"] = {"id": "incident.time.wall_clock_as_recorded.v1", "parameters": {"format": format_name, "timezone": "none_as_recorded", "snapshot_cutoff_local": "2027-01-01T00:00:00"}}
    else:
        result["time"] = {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {"format": format_name,
            "timezone": {"mode": "from_values"} if mode == "recorded" else {"mode": "fixed_offset", "offset_minutes": 120}, "snapshot_cutoff_utc": "2027-01-01T00:00:00Z"}}
    return result


def dialect(encoding="utf-8", delimiter=";"):
    return {"encoding": encoding, "delimiter": delimiter, "quotechar": '"', "header": "first_record"}


def roles(sequence=None, context=()):
    return {"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": sequence, "context_columns": list(context)}


def ready(raw, *, mapping=None, policies=None, encoding="utf-8", delimiter=";", accept=True):
    result = prepare(raw, dialect(encoding, delimiter), mapping or roles(), policies or choices(), accept)
    assert isinstance(result, PreparationResult), result
    assert result.state == "ready", result.to_dict()
    assert result.preparation is not None
    return result.preparation


def test_windows_encoding_spaced_duplicate_headers_and_literal_values():
    raw = (' Ticket ; Event ; At ; Desk ; Desk \r\n'
           ' A-01 ;Prüfung;09.10.2026 08:00;0;False\r\n'
           'A-01;Übernahme;09.10.2026 09:00;;Unknown\r\n').encode("cp1252")
    prepared = ready(raw, encoding="windows-1252", mapping=roles(context=(3, 4)))
    assert prepared.source_id == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest() and not hasattr(prepared, "source")
    assert prepared.source_id == "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()
    assert prepared.columns == (" Ticket ", " Event ", " At ", " Desk ", " Desk ")
    assert list(prepared.histories) == ["A-01"]
    first, second = prepared.histories["A-01"]
    assert first.original_cells[0] == " A-01 "
    assert [value.value for value in first.context] == ["0", "False"]
    assert [value.value for value in second.context] == [None, "Unknown"]
    assert first.activity == "Prüfung"
    assert first.local_timestamp == "2026-10-09T08:00:00"
    assert first.utc_instant is None and first.instant_ns is None
    assert prepared.report["first_usable_utc_instant"] is None
    assert "daylight-saving" in prepared.report["assumptions"][-1]


def test_confirmed_offset_and_recorded_offset_create_real_utc_instants():
    raw = b"Ticket;Event;At\nA;Recorded;09.10.2026 08:00\n"
    offset = ready(raw, policies=choices("offset"))
    assert offset.histories["A"][0].utc_instant == "2026-10-09T06:00:00Z"
    assert offset.histories["A"][0].local_timestamp is None
    aware = ready(b"Ticket;Event;At\nA;Recorded;2026-10-09T08:00:00+02:00\n", policies=choices("recorded", "iso8601"))
    assert aware.histories["A"][0].utc_instant == "2026-10-09T06:00:00Z"
    assert aware.histories["A"][0].instant_ns == offset.histories["A"][0].instant_ns


def test_bom_quotes_embedded_separator_and_multiline_cells_preserve_record_positions():
    raw = b'\xef\xbb\xbf Case ID , Activity , Recorded at , Comment \r\nQ-01,"Customer, called",2026-10-09T08:00:00Z,"He said ""retry"", please."\r\nQ-01,"Hand-off\nreview",2026-10-09T08:05:00Z,Note\r\nQ-02,,2026-10-09T09:00:00Z,Unknown\r\n'
    prepared = ready(raw, encoding="utf-8-sig", delimiter=",", policies=choices("recorded", "iso8601"))
    assert prepared.columns[0] == " Case ID "
    assert [row.source_position for row in prepared.records] == [0, 1, 2]
    assert prepared.records[0].activity == "Customer, called"
    assert prepared.records[0].original_cells[3] == 'He said "retry", please.'
    assert prepared.records[1].activity == "Hand-off\nreview"
    answer = open_prepared_case(prepared, prepared.identity_dict(), "Q-02")
    assert answer["coverage"] == {"raw_record_count": 1, "mapped_record_count": 0, "omitted_activity_record_count": 1}
    assert answer["records"][0]["original_cells"] == ["Q-02", "", "2026-10-09T09:00:00Z", "Unknown"]
    assert answer["mapped_row_ids"] == []
    assert len(answer["omitted_activity_row_ids"]) == 1


def test_dotted_date_ambiguity_is_inspectable_and_explicit_choice_changes_identity():
    raw = b"Ticket;Event;At\nA;Observed;03.04.2026 09:10\n"
    inspection = inspect_csv(raw)
    assert isinstance(inspection, dict)
    matches = {item["format"]: item["parsed_count"] for item in inspection["role_suggestions"][2]["timestamp_matches"]}
    assert matches["dmy_dot_minute"] == matches["mdy_dot_minute"] == 1
    assert any("day/month" in text for text in inspection["unresolved"])
    dmy = ready(raw)
    mdy = ready(raw, policies=choices(format_name="mdy_dot_minute"))
    assert dmy.histories["A"][0].local_timestamp == "2026-04-03T09:10:00"
    assert mdy.histories["A"][0].local_timestamp == "2026-03-04T09:10:00"
    assert dmy.source_id == mdy.source_id
    assert dmy.preparation_id != mdy.preparation_id
    assert dmy.histories["A"][0].row_id == mdy.histories["A"][0].row_id


def test_optional_sequence_and_source_position_ties_use_one_declared_order():
    raw = b"Ticket;Event;At;Seq;Desk\nT-01;Reviewed;2026-10-09T10:00:00Z;3;West\nT-01;Recorded;2026-10-09T09:00:00Z;1;East\nT-01;Routed;2026-10-09T10:00:00Z;2;\nT-01;;2026-10-09T10:00:00Z;2;Unknown\nT-02;Observed;2026-10-09T11:00:00Z;1;West\n"
    prepared = ready(raw, mapping=roles(3, (4,)), policies=choices("recorded", "iso8601"))
    rows = prepared.histories["T-01"]
    assert [row.source_position for row in rows] == [1, 2, 3, 0]
    assert [row.activity for row in rows] == ["Recorded", "Routed", None, "Reviewed"]
    assert prepared.report["tied_timestamp_groups"] == 1
    assert prepared.report["tied_timestamp_record_count"] == 3
    no_sequence = ready(raw, mapping=roles(context=(4,)), policies=choices("recorded", "iso8601"))
    assert [row.source_position for row in no_sequence.histories["T-01"]] == [1, 0, 2, 3]
    assert no_sequence.sequence_evaluable("T-01") is True
    assert prepared.preparation_id != no_sequence.preparation_id


def test_unreadable_times_and_missing_ids_require_confirmation_and_preserve_all_source_rows():
    raw = b"Ticket,Event,At,Seq,Desk\nM-01,Recorded,2026-10-09T08:00:00Z,1,East\nM-01,Routed,2026-02-30T09:00:00Z,2,East\n,Observed,2026-10-09T09:00:00Z,1,East\n   ,Observed,2026-10-09T09:30:00Z,1,East\nM-02,Recorded,not-a-time,1,\nM-03,Observed,2026-10-09T11:00:00Z,1,Unknown\n"
    args = (raw, dialect(delimiter=","), roles(3, (4,)), choices("recorded", "iso8601"))
    pending = prepare(*args)
    assert pending.state == "needs_confirmation" and pending.preparation is None
    prepared = ready(raw, delimiter=",", mapping=roles(3, (4,)), policies=choices("recorded", "iso8601"))
    assert len(prepared.records) == 6
    population = open_prepared_population(prepared)
    assert population["population"] == {"case_ids": ["M-01", "M-02", "M-03"], "case_count": 3, "record_count": 4}
    assert population["unassigned_record_count"] == 2
    assert prepared.report["usable_timestamp_record_count"] == 4  # Source scope includes two unassigned rows.
    assert prepared.report["unavailable_timestamp_record_count"] == 2
    assert prepared.report["sequence_evaluable_case_count"] == 1
    assert prepared.report["sequence_unevaluable_case_count"] == 2
    assert [(row.source_position, row.case_id) for row in prepared.records if row.case_id is None] == [(2, None), (3, None)]
    assert prepared.sequence_evaluable("M-01") is False
    assert prepared.sequence_evaluable("M-02") is False
    assert prepared.sequence_evaluable("M-03") is True
    evidence = open_prepared_case(prepared, prepared.identity_dict(), "M-01")
    assert [row["source_position"] for row in evidence["records"]] == [0, 1]
    invalid = evidence["records"][1]
    assert invalid["timestamp_status"] == "invalid"
    assert invalid["utc_instant"] is None and invalid["local_timestamp"] is None
    assert invalid["original_cells"][2] == "2026-02-30T09:00:00Z"
    assert evidence["sequence_evaluable"] is False
    assert [issue["source_position"] for issue in prepared.report["issues"] if issue["code"] == "missing_case_id"] == [2, 3]


def test_evidence_presentation_tail_never_claims_complete_sequence_and_invalid_sequence_blocks():
    raw = b"Ticket;Event;At;Seq\nA;Unknown order;bad;1\nA;Recorded;2026-10-09T08:00:00Z;2\n"
    prepared = ready(raw, mapping=roles(3), policies=choices("recorded", "iso8601"))
    assert [row.source_position for row in prepared.histories["A"]] == [1, 0]
    assert prepared.sequence_evaluable("A") is False
    blocked = prepare(raw.replace(b";1\n", b";-1\n"), dialect(), roles(3), choices("recorded", "iso8601"), True)
    assert blocked.state == "blocked" and blocked.preparation is None
    assert any(issue["code"] == "invalid_sequence" and issue["severity"] == "blocking" for issue in blocked.report["issues"])


def test_duplicate_candidates_are_retained_and_all_incidents_have_no_synthetic_business_parent():
    raw = b"Ticket;Event;At\nX;Observed;09.10.2026 08:00\nX;Observed;09.10.2026 08:00\nY;Unrecognized label;09.10.2026 08:00\n"
    prepared = ready(raw)
    assert open_prepared_population(prepared)["population"] == {"case_ids": ["X", "Y"], "case_count": 2, "record_count": 3}
    assert prepared.report["duplicate_candidate_record_count"] == 1
    assert len(prepared.histories["X"]) == 2
    assert len({row.row_id for row in prepared.records}) == 3


def test_identity_replay_and_immutable_preparation_survive_caller_mutation():
    raw = b"Ticket;Event;At\nA;Observed;09.10.2026 08:00\n"
    options = choices()
    prepared = ready(raw, policies=options)
    assert ready(raw, policies=deepcopy(options)).identity_dict() == prepared.identity_dict()
    options["time"]["parameters"]["snapshot_cutoff_local"] = "2028-01-01T00:00:00"
    assert prepared.policies["time"]["parameters"]["snapshot_cutoff_local"] == "2027-01-01T00:00:00"
    with pytest.raises(TypeError):
        prepared.histories["A"] = ()
    with pytest.raises(TypeError):
        prepared.policies["time"]["id"] = "guess"
    with pytest.raises(FrozenInstanceError):
        prepared.records[0].activity = "changed"
    changed_bytes = ready(raw.replace(b"Observed", b"Other"))
    assert changed_bytes.source_id != prepared.source_id
    assert changed_bytes.population_id != prepared.population_id


@pytest.mark.parametrize("field", ["source_id", "preparation_id", "representation_id", "case_dictionary_id", "population_id", "implementation_version"])
def test_every_evidence_identity_field_is_checked(field):
    prepared = ready(b"Ticket;Event;At\nA;Observed;09.10.2026 08:00\n")
    changed = prepared.identity_dict()
    changed[field] += "changed"
    result = open_prepared_case(prepared, changed, "A")
    assert isinstance(result, ImportRefusal) and result.code == "identity_mismatch"
    unknown = open_prepared_case(prepared, prepared.identity_dict(), "missing")
    assert unknown.code == "case_not_found"


@pytest.mark.parametrize("source,mode,expected", [
    (b"A;Seen;2026-10-09T08:00:00\n", "recorded", "timezone_required"),
    (b"A;Seen;2026-10-09T08:00:00Z\nB;Seen;2026-10-09T09:00:00\n", "recorded", "mixed_timezone_values"),
    (b"A;Seen;2026-10-09T08:00:00Z\n", "wall", "mixed_timezone_values"),
    (b"A;Seen;2026-10-09T08:00:00Z\n", "offset", "mixed_timezone_values"),
])
def test_no_implicit_machine_timezone_or_mixed_domain(source, mode, expected):
    result = prepare(b"Ticket;Event;At\n" + source, dialect(), roles(), choices(mode, "iso8601"), True)
    assert isinstance(result, ImportRefusal) and result.code == expected


def test_cutoff_before_data_and_wrong_role_dialect_or_registered_parameter_refuse():
    raw = b"Ticket;Event;At\nA;Observed;09.10.2026 08:00\n"
    changed = choices()
    changed["time"]["parameters"]["snapshot_cutoff_local"] = "2026-01-01T00:00:00"
    assert prepare(raw, dialect(), roles(), changed, True).code == "cutoff_before_records"
    assert prepare(raw, dialect(), {**roles(), "case_column": True}, choices(), True).code == "invalid_mapping"
    assert prepare(raw, {**dialect(), "encoding": "replace-errors"}, roles(), choices(), True).code == "invalid_dialect"
    changed = choices()
    changed["parent"]["id"] = "incident.parent.all_service_s_and_has_opened.v1"
    assert prepare(raw, dialect(), roles(), changed, True).code == "unsupported_policy"
    changed = choices()
    changed["rows"]["parameters"]["duplicate_candidates"] = "drop"
    assert prepare(raw, dialect(), roles(), changed, True).code == "invalid_parameter"
    assert prepare(raw, dialect(), roles(), choices(), "true").code == "invalid_parameter"


def test_iana_and_bool_offset_are_denied_and_bad_cutoff_does_not_publish():
    raw = b"Ticket;Event;At\nA;Observed;09.10.2026 08:00\n"
    options = choices("offset")
    options["time"]["parameters"]["timezone"] = {"mode": "iana", "name": "Europe/Berlin"}
    assert prepare(raw, dialect(), roles(), options, True).code == "unsupported_timezone"
    options = choices("offset")
    options["time"]["parameters"]["timezone"]["offset_minutes"] = True
    assert prepare(raw, dialect(), roles(), options, True).code == "invalid_parameter"


def test_fractional_precision_beyond_six_digits_is_retained_unavailable_not_truncated():
    raw = b"Ticket;Event;At\nA;Observed;2026-10-09T08:00:00.1234567Z\n"
    result = prepare(raw, dialect(), roles(), choices("recorded", "iso8601"), False)
    assert result.state == "needs_confirmation" and result.preparation is None
    prepared = ready(raw, policies=choices("recorded", "iso8601"))
    row = prepared.histories["A"][0]
    assert row.timestamp_status == "invalid"
    assert row.utc_instant is None and row.local_timestamp is None and row.instant_ns is None
    assert row.original_cells[2] == "2026-10-09T08:00:00.1234567Z"
    assert prepared.sequence_evaluable("A") is False


@pytest.mark.parametrize("sequence", ["-1", "1.5", "True", "", "1e3"])
def test_mapped_sequence_never_rounds_or_coerces_noninteger_text(sequence):
    raw = ("Ticket;Event;At;Seq\nA;Observed;09.10.2026 08:00;" + sequence + "\n").encode()
    result = prepare(raw, dialect(), roles(3), choices(), True)
    assert result.state == "blocked" and result.preparation is None
    assert result.report["issues"][0]["code"] == "invalid_sequence"


@pytest.mark.parametrize("offset", ["+00:60", "+00:99", "-00:60", "-00:99", "+24:00", "-24:00"])
def test_malformed_recorded_offset_is_flagged_instead_of_normalized(offset):
    timestamp = "2026-10-09T10:00:00" + offset
    raw = ("Ticket;Event;At\nA;Observed;" + timestamp + "\n").encode()
    pending = prepare(raw, dialect(), roles(), choices("recorded", "iso8601"), False)
    assert pending.state == "needs_confirmation" and pending.preparation is None
    prepared = ready(raw, policies=choices("recorded", "iso8601"))
    row = prepared.histories["A"][0]
    assert row.timestamp_status == "invalid"
    assert row.utc_instant is None and row.local_timestamp is None
    assert row.original_cells[2] == timestamp
    assert prepared.sequence_evaluable("A") is False


def test_largest_safe_sequence_remains_exact_and_larger_values_block_publication():
    maximum = "9007199254740991"
    raw = ("Ticket;Event;At;Seq\nA;Observed;09.10.2026 08:00;" + maximum + "\n").encode()
    prepared = ready(raw, mapping=roles(3))
    assert prepared.histories["A"][0].source_sequence == 9007199254740991
    assert prepared.histories["A"][0].original_cells[3] == maximum
    for unsupported in ("9007199254740992", "9007199254740993", "9" * 100, "9" * 5000, "-1"):
        changed = raw.replace(maximum.encode(), unsupported.encode())
        blocked = prepare(changed, dialect(), roles(3), choices(), True)
        assert blocked.state == "blocked" and blocked.preparation is None
        assert blocked.report["issues"][0]["code"] == "invalid_sequence"
        assert "safe-integer range" in blocked.report["issues"][0]["message"]
    options = choices()
    options["time"]["parameters"]["snapshot_cutoff_local"] = "2027-01-01T00:00:00Z"
    assert prepare(raw, dialect(), roles(), options, True).code == "invalid_parameter"
