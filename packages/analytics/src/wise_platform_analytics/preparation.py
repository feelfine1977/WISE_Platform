"""Immutable interpreted CSV snapshots and complete, explicitly ordered cases."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import re
from types import MappingProxyType

from .csv_inspection import CsvData, read_csv, source_id, validate_dialect
from .mapping import ImportRefusal, ROWS_V2_ID, freeze_json, plain_json, validate_mapping, validate_policies
from .time_formats import TimeInterpretation, iso_local, iso_utc, parse_format, validate_time_policy
from .version import IMPLEMENTATION_VERSION

PARSER_VERSION = "incident.generic_csv.v1"
_SEQUENCE = re.compile(r"[0-9]+")
MAX_SAFE_SEQUENCE = 9_007_199_254_740_991


def content_identity(prefix: str, parts: Mapping[str, object]) -> str:
    encoded = json.dumps(plain_json(parts), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return prefix + ".v1:sha256:" + hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class ContextValue:
    column_index: int
    value: str | None

    def to_dict(self) -> dict[str, object]:
        return {"column_index": self.column_index, "value": self.value}


@dataclass(frozen=True)
class PreparedRecord:
    row_id: str
    source_position: int
    case_id: str | None
    source_sequence: int | None
    activity: str | None
    timestamp_kind: str
    utc_instant: str | None
    local_timestamp: str | None
    timestamp_status: str
    context: tuple[ContextValue, ...]
    original_cells: tuple[str, ...]
    time_value: datetime | None = field(repr=False)

    @property
    def sequence(self) -> int | None:
        return self.source_sequence

    @property
    def instant_ns(self) -> int | None:
        if self.timestamp_kind != "utc_instant" or self.time_value is None:
            return None
        elapsed = self.time_value - datetime(1970, 1, 1, tzinfo=timezone.utc)
        return (elapsed.days * 86400 + elapsed.seconds) * 1_000_000_000 + elapsed.microseconds * 1000

    def to_dict(self) -> dict[str, object]:
        return {"row_id": self.row_id, "source_position": self.source_position, "source_sequence": self.source_sequence,
                "activity": self.activity, "timestamp_kind": self.timestamp_kind, "utc_instant": self.utc_instant,
                "local_timestamp": self.local_timestamp, "timestamp_status": self.timestamp_status,
                "context": [value.to_dict() for value in self.context], "original_cells": list(self.original_cells)}


@dataclass(frozen=True)
class PreparedData:
    source: bytes = field(repr=False)
    source_id: str
    preparation_id: str
    representation_id: str
    case_dictionary_id: str
    population_id: str
    implementation_version: str
    columns: tuple[str, ...]
    records: tuple[PreparedRecord, ...]
    histories: Mapping[str, tuple[PreparedRecord, ...]] = field(repr=False)
    dialect: Mapping[str, object]
    mapping: Mapping[str, object]
    policies: Mapping[str, object]
    report: Mapping[str, object] = field(repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "histories", MappingProxyType({key: tuple(rows) for key, rows in self.histories.items()}))
        for name in ("dialect", "mapping", "policies", "report"):
            object.__setattr__(self, name, freeze_json(getattr(self, name)))

    def sequence_evaluable(self, case_id: str) -> bool:
        return all(row.timestamp_status == "usable" for row in self.histories[case_id])

    def identity_dict(self) -> dict[str, object]:
        return {"source_id": self.source_id, "preparation_id": self.preparation_id, "representation_id": self.representation_id,
                "case_dictionary_id": self.case_dictionary_id, "population_id": self.population_id,
                "implementation_version": self.implementation_version}

    def descriptor(self) -> dict[str, object]:
        return {"preparation_id": self.preparation_id, "source_id": self.source_id,
                "dialect": plain_json(self.dialect), "mapping": plain_json(self.mapping), "policies": plain_json(self.policies)}


@dataclass(frozen=True)
class PreparationResult:
    state: str
    source_id: str
    preparation: PreparedData | None
    report: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "report", freeze_json(self.report))

    def to_dict(self) -> dict[str, object]:
        return {"source_id": self.source_id, "state": self.state,
                "preparation": None if self.preparation is None else self.preparation.descriptor(), "report": plain_json(self.report)}


def record_order(row: PreparedRecord) -> tuple[object, ...]:
    if row.time_value is None:
        return (1, row.source_position)
    return (0, row.time_value, row.source_sequence if row.source_sequence is not None else row.source_position, row.source_position)


def prepare(raw: bytes, dialect: Mapping[str, object], mapping: Mapping[str, object], policies: Mapping[str, object],
            accept_report_issues: bool = False) -> PreparationResult | ImportRefusal:
    """Confirm an interpretation; row issues need acknowledgment before publication."""
    if not isinstance(raw, bytes):
        return ImportRefusal("invalid_request", "The source must be unchanged CSV bytes.", "source")
    if type(accept_report_issues) is not bool:
        return ImportRefusal("invalid_parameter", "Row-issue confirmation must be a Boolean.", "accept_report_issues")
    checked_dialect = validate_dialect(dialect)
    if isinstance(checked_dialect, ImportRefusal):
        return checked_dialect
    checked_policies = validate_policies(policies)
    if isinstance(checked_policies, ImportRefusal):
        return checked_policies
    data = read_csv(raw, checked_dialect, tolerant=checked_policies["rows"]["id"] == ROWS_V2_ID)
    if isinstance(data, ImportRefusal):
        return data
    checked_mapping = validate_mapping(mapping, len(data.columns))
    if isinstance(checked_mapping, ImportRefusal):
        return checked_mapping
    if not data.rows:
        return ImportRefusal("malformed_source", "The CSV contains no event-history records.", "source")
    clock = validate_time_policy(checked_policies["time"])
    if isinstance(clock, ImportRefusal):
        return clock
    assert isinstance(clock, TimeInterpretation)
    timestamp_column = checked_mapping["timestamp_column"]
    awareness = {moment.tzinfo is not None for cells in data.rows if len(cells) == len(data.columns)
                 if (moment := parse_format(cells[timestamp_column], clock.format_name)) is not None}
    if len(awareness) > 1:
        return ImportRefusal("mixed_timezone_values", "The selected timestamp column mixes zoned and unzoned values.", "mapping.timestamp_column")
    records = []
    issues = []
    sid = source_id(raw)
    case_column, activity_column = checked_mapping["case_column"], checked_mapping["activity_column"]
    sequence_column = checked_mapping["sequence_column"]
    for source_record in data.records:
        position, cells = source_record.source_position, source_record.cells
        if len(cells) != len(data.columns):
            issues.append(_issue(position, None, None, "ragged_record", "confirmation",
                                 f"This source record has {len(cells)} cells; expected {len(data.columns)}. Keep its exact raw text outside every case population; no fields were padded or associated."))
            records.append(PreparedRecord(
                row_id=content_identity("row", {"format_version": 1, "source_id": sid, "source_position": position}),
                source_position=position, case_id=None, source_sequence=None, activity=None, timestamp_kind=clock.kind,
                utc_instant=None, local_timestamp=None, timestamp_status="invalid", context=(), original_cells=cells, time_value=None))
            continue
        case = cells[case_column].strip() or None
        if case is not None and len(case) > 256:
            return ImportRefusal("malformed_source", f"Source record {position} has an incident identifier exceeding the supported 256 characters.", "mapping.case_column")
        activity = cells[activity_column] or None
        time_text = cells[timestamp_column]
        moment = clock.parse(time_text)
        if isinstance(moment, ImportRefusal):
            return moment
        status = "usable" if moment is not None else "missing" if time_text == "" else "invalid"
        sequence = None
        if sequence_column is not None:
            sequence_text = cells[sequence_column]
            if _SEQUENCE.fullmatch(sequence_text) is not None:
                try:
                    sequence = int(sequence_text)
                except ValueError:
                    pass
                if sequence is not None and sequence > MAX_SAFE_SEQUENCE:
                    sequence = None
            if sequence is None:
                issues.append(_issue(position, sequence_column, case, "invalid_sequence", "blocking", "The mapped sequence is outside the supported safe-integer range 0..9007199254740991, or is not integer text; it was not guessed."))
        if case is None:
            issues.append(_issue(position, case_column, None, "missing_case_id", "confirmation", "This original row has no incident identifier and remains outside every case population."))
        if status != "usable":
            issues.append(_issue(position, timestamp_column, case, "missing_timestamp" if status == "missing" else "invalid_timestamp",
                                 "confirmation", "This row's time is unavailable; retain raw evidence and mark the incident's sequence unevaluable."))
        if activity is None:
            issues.append(_issue(position, activity_column, case, "missing_activity", "warning", "The missing label is omitted only from the mapped sequence; its source row remains."))
        records.append(PreparedRecord(
            row_id=content_identity("row", {"format_version": 1, "source_id": sid, "source_position": position}),
            source_position=position, case_id=case, source_sequence=sequence, activity=activity, timestamp_kind=clock.kind,
            utc_instant=iso_utc(moment) if moment is not None and clock.kind == "utc_instant" else None,
            local_timestamp=iso_local(moment) if moment is not None and clock.kind == "wall_clock" else None,
            timestamp_status=status, context=tuple(ContextValue(index, cells[index] or None) for index in checked_mapping["context_columns"]),
            original_cells=cells, time_value=moment))
    usable = [row.time_value for row in records if row.time_value is not None]
    if usable and max(usable) > clock.cutoff:
        return ImportRefusal("cutoff_before_records", "The declared cutoff precedes a usable source record.", "policies.time.parameters")
    grouped: dict[str, list[PreparedRecord]] = {}
    for row in records:
        if row.case_id is not None:
            grouped.setdefault(row.case_id, []).append(row)
    histories = {case: tuple(sorted(rows, key=record_order)) for case, rows in sorted(grouped.items())}
    from .interpretation import interpretation_report
    report = interpretation_report(data, tuple(records), histories, checked_mapping, clock, issues)
    if any(issue["severity"] == "blocking" for issue in report["issues"]):
        return PreparationResult("blocked", sid, None, report)
    if report["issues"] and not accept_report_issues:
        return PreparationResult("needs_confirmation", sid, None, report)
    pid = content_identity("preparation", {"format_version": 1, "source_id": sid, "parser_version": PARSER_VERSION,
        "dialect": checked_dialect, "mapping": checked_mapping, "policies": checked_policies, "implementation_version": IMPLEMENTATION_VERSION})
    rid = content_identity("representation", {"format_version": 1, "preparation_id": pid, "activity_projection": checked_policies["activity_projection"]})
    did = content_identity("case-dictionary", {"format_version": 1, "preparation_id": pid, "case_ids": sorted(histories)})
    popid = content_identity("population", {"format_version": 1, "representation_id": rid, "case_dictionary_id": did, "case_ids": sorted(histories)})
    prepared = PreparedData(raw, sid, pid, rid, did, popid, IMPLEMENTATION_VERSION, data.columns, tuple(records), histories,
                            checked_dialect, checked_mapping, checked_policies, report)
    return PreparationResult("ready", sid, prepared, report)


def _issue(position: int, column: int | None, case_id: str | None, code: str, severity: str, message: str) -> dict[str, object]:
    return {"source_position": position, "column_index": column, "case_id": case_id,
            "code": code, "severity": severity, "message": message}
