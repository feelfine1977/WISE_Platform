"""Immutable interpreted CSV snapshots and complete, explicitly ordered cases."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
import hashlib
import json
import re
from types import MappingProxyType

from .csv_inspection import Source, SourceFile, SourceRecord, read_csv, source_id, validate_dialect
from .mapping import ImportRefusal, ROWS_V2_ID, freeze_json, plain_json, validate_mapping, validate_policies
from .time_formats import TimeInterpretation, iso_local, iso_utc, parse_format, validate_time_policy
from .version import IMPLEMENTATION_VERSION

PARSER_VERSION = "incident.generic_csv.v1"
_SEQUENCE = re.compile(r"[0-9]+")
MAX_SAFE_SEQUENCE = 9_007_199_254_740_991


def content_identity(prefix: str, parts: Mapping[str, object]) -> str:
    encoded = json.dumps(plain_json(parts), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
    return prefix + ".v1:sha256:" + hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True, slots=True)
class ContextValue:
    column_index: int
    value: str | None

    def to_dict(self) -> dict[str, object]:
        return {"column_index": self.column_index, "value": self.value}


@dataclass(frozen=True, slots=True)
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
    context_columns: tuple[int, ...]
    """The mapped context columns, one tuple shared by every record of a preparation; ``context`` reads their cells."""
    original_cells: tuple[str, ...]
    time_value: datetime | None = field(repr=False)

    @property
    def context(self) -> tuple[ContextValue, ...]:
        cells = self.original_cells
        return tuple(ContextValue(index, cells[index] or None) for index in self.context_columns)

    def context_value(self, column_index: int) -> str | None:
        """One mapped context value without building wrappers; None for an empty cell or an unmapped column."""
        return self.original_cells[column_index] or None if column_index in self.context_columns else None

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
    """A prepared source. It holds its records, not the source bytes; those stay in the workspace under ``source_id``."""

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


@dataclass(frozen=True)
class SourceReading:
    """One parse of a source under the choices that shape its records.

    A cutoff proposal and the confirmations that follow it reuse it whatever their cutoff, context columns and
    acceptance; identities, the report and the cutoff check still come from each confirmation's own choices. A
    ready preparation holds these same records, not a copy."""

    key: str
    columns: tuple[str, ...]
    records: tuple[PreparedRecord, ...]
    excluded: Mapping[int, SourceRecord] = field(repr=False)
    """The source records the report can show as excluded: ragged, or without a case identifier."""
    blank_record_count: int
    ragged_record_count: int
    issues: tuple[dict[str, object], ...] = field(repr=False)


def _reading_key(sid: str, dialect: Mapping[str, object], mapping: Mapping[str, object], policies: Mapping[str, object]) -> str:
    time = policies["time"]
    shaping = {"source_id": sid, "dialect": dialect,
               "columns": {name: mapping.get(name) for name in ("case_column", "activity_column", "timestamp_column", "sequence_column")},
               "policies": {name: value for name, value in policies.items() if name != "time"},
               "time": {"id": time["id"], "parameters": {name: value for name, value in time["parameters"].items() if not name.startswith("snapshot_cutoff")}}}
    return json.dumps(plain_json(shaping), sort_keys=True, separators=(",", ":"))


def read_for_preparation(raw: Source, dialect: Mapping[str, object], mapping: Mapping[str, object], policies: Mapping[str, object],
                         reuse: SourceReading | None = None) -> SourceReading | ImportRefusal:
    """Parse a source for preparation, or return ``reuse`` when it was read under the same shaping choices."""
    found = _read(raw, dialect, mapping, policies, reuse)
    return found if isinstance(found, ImportRefusal) else found[0]


def _read(raw: Source, dialect: Mapping[str, object], mapping: Mapping[str, object], policies: Mapping[str, object],
          reuse: SourceReading | None) -> tuple[SourceReading, dict, dict, dict, TimeInterpretation] | ImportRefusal:
    if not isinstance(raw, (bytes, SourceFile)):
        return ImportRefusal("invalid_request", "The source must be unchanged CSV bytes.", "source")
    checked_dialect = validate_dialect(dialect)
    if isinstance(checked_dialect, ImportRefusal):
        return checked_dialect
    checked_policies = validate_policies(policies)
    if isinstance(checked_policies, ImportRefusal):
        return checked_policies
    sid = source_id(raw)
    if reuse is not None and isinstance(mapping, Mapping) and reuse.key == _reading_key(sid, checked_dialect, mapping, checked_policies):
        # The same bytes read under the same choices give the same records, so only this request's own choices are checked.
        checked_mapping = validate_mapping(mapping, len(reuse.columns))
        if isinstance(checked_mapping, ImportRefusal):
            return checked_mapping
        clock = validate_time_policy(checked_policies["time"])
        if isinstance(clock, ImportRefusal):
            return clock
        return reuse, checked_dialect, checked_mapping, checked_policies, clock
    # Excluded records show their exact text, so the reader keeps it for records whose case cell is blank.
    case_column = mapping.get("case_column") if isinstance(mapping, Mapping) else None
    data = read_csv(raw, checked_dialect, tolerant=checked_policies["rows"]["id"] == ROWS_V2_ID,
                    case_column=case_column if type(case_column) is int and case_column >= 0 else None)
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
    # A large source repeats its timestamps heavily, and a parsed time is immutable: each distinct text is parsed
    # once, checked for zone awareness, then replaced by its shared interpretation on first use below. The table
    # lives only for this reading.
    width = len(data.columns)
    parsed_times: dict[str, datetime | None | tuple[datetime | None, str | None, str | None]] = {}
    for cells in data.rows:
        if len(cells) == width and (text := cells[timestamp_column]) not in parsed_times:
            parsed_times[text] = parse_format(text, clock.format_name)
    awareness = {moment.tzinfo is not None for moment in parsed_times.values() if moment is not None}
    if len(awareness) > 1:
        return ImportRefusal("mixed_timezone_values", "The selected timestamp column mixes zoned and unzoned values.", "mapping.timestamp_column")
    records = []
    issues = []
    excluded = {}
    context_columns = tuple(checked_mapping["context_columns"])
    case_column, activity_column = checked_mapping["case_column"], checked_mapping["activity_column"]
    sequence_column = checked_mapping["sequence_column"]
    for source_record in data.records:
        position, cells = source_record.source_position, source_record.cells
        if len(cells) != width:
            issues.append(_issue(position, None, None, "ragged_record", "confirmation",
                                 f"This source record has {len(cells)} cells; expected {width}. Keep its exact raw text outside every case population; no fields were padded or associated."))
            excluded[position] = source_record
            records.append(PreparedRecord(
                row_id=content_identity("row", {"format_version": 1, "source_id": sid, "source_position": position}),
                source_position=position, case_id=None, source_sequence=None, activity=None, timestamp_kind=clock.kind,
                utc_instant=None, local_timestamp=None, timestamp_status="invalid", context_columns=(), original_cells=cells, time_value=None))
            continue
        case = cells[case_column].strip() or None
        if case is not None and len(case) > 256:
            return ImportRefusal("malformed_source", f"Source record {position} has an incident identifier exceeding the supported 256 characters.", "mapping.case_column")
        activity = cells[activity_column] or None
        time_text = cells[timestamp_column]
        known = parsed_times[time_text]
        if not isinstance(known, tuple):
            moment = clock.interpret(known)
            if isinstance(moment, ImportRefusal):
                return moment
            known = parsed_times[time_text] = (
                moment,
                iso_utc(moment) if moment is not None and clock.kind == "utc_instant" else None,
                iso_local(moment) if moment is not None and clock.kind == "wall_clock" else None)
        moment, utc_text, local_text = known
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
            excluded[position] = source_record
        if status != "usable":
            issues.append(_issue(position, timestamp_column, case, "missing_timestamp" if status == "missing" else "invalid_timestamp",
                                 "confirmation", "This row's time is unavailable; retain raw evidence and mark the incident's sequence unevaluable."))
        if activity is None:
            issues.append(_issue(position, activity_column, case, "missing_activity", "warning", "The missing label is omitted only from the mapped sequence; its source row remains."))
        records.append(PreparedRecord(
            row_id=content_identity("row", {"format_version": 1, "source_id": sid, "source_position": position}),
            source_position=position, case_id=case, source_sequence=sequence, activity=activity, timestamp_kind=clock.kind,
            utc_instant=utc_text, local_timestamp=local_text, timestamp_status=status,
            context_columns=context_columns,
            original_cells=cells, time_value=moment))
    reading = SourceReading(_reading_key(sid, checked_dialect, checked_mapping, checked_policies), data.columns, tuple(records),
                            MappingProxyType(excluded), data.blank_record_count, data.ragged_record_count, tuple(issues))
    return reading, checked_dialect, checked_mapping, checked_policies, clock


def prepare(raw: Source, dialect: Mapping[str, object], mapping: Mapping[str, object], policies: Mapping[str, object],
            accept_report_issues: bool = False, *, reading: SourceReading | None = None) -> PreparationResult | ImportRefusal:
    """Confirm an interpretation; row issues need acknowledgment before publication.

    A ``reading`` from an earlier proposal or confirmation of the same source is reused when its shaping choices match."""
    if not isinstance(raw, (bytes, SourceFile)):
        return ImportRefusal("invalid_request", "The source must be unchanged CSV bytes.", "source")
    if type(accept_report_issues) is not bool:
        return ImportRefusal("invalid_parameter", "Row-issue confirmation must be a Boolean.", "accept_report_issues")
    found = _read(raw, dialect, mapping, policies, reading)
    if isinstance(found, ImportRefusal):
        return found
    reading, checked_dialect, checked_mapping, checked_policies, clock = found
    sid = source_id(raw)
    context_columns = tuple(checked_mapping["context_columns"])
    records = tuple(row if row.case_id is None or row.context_columns == context_columns else replace(row, context_columns=context_columns)
                    for row in reading.records)
    usable = [row.time_value for row in records if row.time_value is not None]
    if usable and max(usable) > clock.cutoff:
        return ImportRefusal("cutoff_before_records", "The declared cutoff precedes a usable source record.", "policies.time.parameters")
    del usable
    grouped: dict[str, list[PreparedRecord]] = {}
    for row in records:
        if row.case_id is not None:
            grouped.setdefault(row.case_id, []).append(row)
    histories = {case: tuple(sorted(rows, key=record_order)) for case, rows in sorted(grouped.items())}
    del grouped
    from .interpretation import interpretation_report
    report = interpretation_report(reading, records, histories, checked_mapping, clock)
    if any(issue["severity"] == "blocking" for issue in report["issues"]):
        return PreparationResult("blocked", sid, None, report)
    if report["issues"] and not accept_report_issues:
        return PreparationResult("needs_confirmation", sid, None, report)
    pid = content_identity("preparation", {"format_version": 1, "source_id": sid, "parser_version": PARSER_VERSION,
        "dialect": checked_dialect, "mapping": checked_mapping, "policies": checked_policies, "implementation_version": IMPLEMENTATION_VERSION})
    rid = content_identity("representation", {"format_version": 1, "preparation_id": pid, "activity_projection": checked_policies["activity_projection"]})
    did = content_identity("case-dictionary", {"format_version": 1, "preparation_id": pid, "case_ids": sorted(histories)})
    popid = content_identity("population", {"format_version": 1, "representation_id": rid, "case_dictionary_id": did, "case_ids": sorted(histories)})
    prepared = PreparedData(sid, pid, rid, did, popid, IMPLEMENTATION_VERSION, reading.columns, records, histories,
                            checked_dialect, checked_mapping, checked_policies, report)
    return PreparationResult("ready", sid, prepared, report)


def _issue(position: int, column: int | None, case_id: str | None, code: str, severity: str, message: str) -> dict[str, object]:
    return {"source_position": position, "column_index": column, "case_id": case_id,
            "code": code, "severity": severity, "message": message}
