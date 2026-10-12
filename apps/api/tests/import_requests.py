"""Requests and checks shared by the tests of the import operations."""

import json
from copy import deepcopy
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "contracts" / "import.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())

# A semicolon source in Windows-1252 with day-first dotted times: two incidents, three records.
GERMAN = (
    "Vorgang;Aktivität;Zeitpunkt;Gruppe\r\n"
    "A-1;Eröffnet;09.10.2026 08:00;Büro\r\n"
    "A-1;Geschlossen;09.10.2026 09:30;\r\n"
    "B-2;Eröffnet;10.10.2026 07:15;Größe & Maß\r\n"
).encode("cp1252")
# A comma source in UTF-8 with recorded UTC instants; its second record has no incident id.
ORPHANED = (
    "Ticket,Activity,At\r\n"
    "X-1,Opened,2026-10-09T08:00:00Z\r\n"
    ",Opened,2026-10-09T09:00:00Z\r\n"
    "X-1,Closed,2026-10-09T10:00:00Z\r\n"
).encode("utf-8")

_ROLES = {
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


def envelope(message_type: str, request_id: str = "request-1", revision: int = 1, **fields) -> dict:
    return {"schema_version": 1, "message_type": message_type, "request_id": request_id,
            "query_revision": revision, **fields}


def policies(time_format: str = "dmy_dot_minute", offset: int | None = 120) -> dict:
    zone = {"mode": "from_values"} if offset is None else {"mode": "fixed_offset", "offset_minutes": offset}
    return {"time": {"id": "incident.time.explicit_format_timezone_utc.v1", "parameters": {
        "format": time_format, "timezone": zone, "snapshot_cutoff_utc": "2027-01-01T00:00:00Z"}}, **deepcopy(_ROLES)}


def german_confirmation(workspace_id: str, source_id: str, accept: bool = False) -> dict:
    return envelope(
        "confirm_mapping_request", "prepare-1", workspace_id=workspace_id, source_id=source_id,
        dialect={"encoding": "windows-1252", "delimiter": ";", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
                 "context_columns": [3]},
        policies=policies(), accept_report_issues=accept)


def orphaned_confirmation(workspace_id: str, source_id: str, accept: bool = False) -> dict:
    return envelope(
        "confirm_mapping_request", "prepare-2", workspace_id=workspace_id, source_id=source_id,
        dialect={"encoding": "utf-8", "delimiter": ",", "quotechar": '"', "header": "first_record"},
        mapping={"case_column": 0, "activity_column": 1, "timestamp_column": 2, "sequence_column": None,
                 "context_columns": []},
        policies=policies("iso8601", None), accept_report_issues=accept)
