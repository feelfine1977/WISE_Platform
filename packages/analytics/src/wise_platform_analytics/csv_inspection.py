"""Strict CSV decoding with ordinal headers and evidence-backed suggestions."""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
import csv
import hashlib
import io

from .mapping import ImportRefusal, exact_object
from .time_formats import FORMATS, parse_format

ENCODINGS = ("utf-8", "utf-8-sig", "windows-1252")
DELIMITERS = (",", ";", "\t", "|")
_CODECS = {"utf-8": "utf-8", "utf-8-sig": "utf-8-sig", "windows-1252": "cp1252"}
FIELD_CHARACTER_LIMIT = 10_485_760
MAXIMUM_RAGGED_FRACTION = 0.05
# csv's limit is process-global. Set one supported limit at module load, never
# temporarily raise/restore it around individual concurrent requests.
csv.field_size_limit(FIELD_CHARACTER_LIMIT)


@dataclass(frozen=True, slots=True)
class SourceRecord:
    source_position: int
    physical_line_start: int
    physical_line_end: int
    cells: tuple[str, ...]
    original_text: str

    def excluded_dict(self, reason: str) -> dict[str, object]:
        return {"source_position": self.source_position, "physical_line_start": self.physical_line_start,
                "physical_line_end": self.physical_line_end, "cell_count": len(self.cells), "reason": reason,
                "original_cells": list(self.cells), "original_text": self.original_text}


_SHARING_PROBE_RECORDS = 4096


class _CellSharing:
    """Equal cell text in one column becomes one shared string, so a value repeated across a large source is held once.

    A column whose values are mostly distinct stops sharing at the next power-of-two record count, so its table
    never grows with the source. Sharing changes no cell's text or type, only how many copies are held."""

    __slots__ = ("tables", "seen")

    def __init__(self, width: int) -> None:
        self.tables: list[dict[str, str] | None] = [{} for _ in range(width)]
        self.seen = 0

    def cells(self, row: list[str]) -> tuple[str, ...]:
        tables = self.tables
        width = len(tables)
        shared = tuple(
            cell if index >= width or (table := tables[index]) is None else table.setdefault(cell, cell)
            for index, cell in enumerate(row))
        self.seen += 1
        seen = self.seen
        if seen >= _SHARING_PROBE_RECORDS and seen & (seen - 1) == 0:
            for index, table in enumerate(tables):
                if table is not None and len(table) * 2 > seen:
                    tables[index] = None
        return shared


@dataclass(frozen=True)
class CsvData:
    columns: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]
    records: tuple[SourceRecord, ...] = ()
    blank_record_count: int = 0
    ragged_record_count: int = 0


def source_id(raw: bytes) -> str:
    return "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()


def validate_dialect(value: object) -> dict[str, str] | ImportRefusal:
    refusal = exact_object(value, {"encoding", "delimiter", "quotechar", "header"}, "dialect")
    if refusal is not None:
        return refusal
    assert isinstance(value, Mapping)
    if value["encoding"] not in ENCODINGS or value["delimiter"] not in DELIMITERS or value["quotechar"] != '"' or value["header"] != "first_record":
        return ImportRefusal("invalid_dialect", "Only registered encodings, separators, double quotes and a first-record header are supported.", "dialect")
    return dict(value)


def read_csv(raw: bytes, dialect: Mapping[str, str], *, tolerant: bool = False) -> CsvData | ImportRefusal:
    try:
        text = raw.decode(_CODECS[dialect["encoding"]], errors="strict")
    except UnicodeDecodeError:
        return ImportRefusal("malformed_source", "The source cannot be decoded with the confirmed encoding.", "dialect.encoding")
    stream = io.StringIO(text, newline="")
    reader = csv.reader(stream, delimiter=dialect["delimiter"], quotechar='"', strict=True)
    try:
        header = next(reader, None)
        if not header:
            return ImportRefusal("malformed_source", "The source has no readable header record.", "source")
    except (csv.Error, UnicodeError) as error:
        return ImportRefusal("malformed_source", f"Header at physical lines 1..{max(reader.line_num, 1)} is unreadable: {error}.", "source")
    records = []
    sharing = _CellSharing(len(header))
    blanks = ragged = position = 0
    while True:
        offset, line_start = stream.tell(), reader.line_num + 1
        try:
            row = next(reader)
        except StopIteration:
            break
        except (csv.Error, UnicodeError) as error:
            return ImportRefusal("malformed_source", f"Source record {position}, physical lines {line_start}..{max(reader.line_num, line_start)} is unreadable: {error}. The field character limit is {FIELD_CHARACTER_LIMIT}; check quoting and separators.", "source")
        if not row and tolerant:
            blanks += 1
        else:
            if len(row) != len(header):
                if not tolerant:
                    return ImportRefusal("malformed_source", f"Source record {position}, physical lines {line_start}..{reader.line_num} has {len(row)} cells; expected {len(header)}. No row was discarded.", "source")
                ragged += 1
            records.append(SourceRecord(position, line_start, reader.line_num, sharing.cells(row), text[offset:stream.tell()]))
        position += 1
    # Compare integer supports exactly: one of twenty is accepted; one of nineteen is not.
    if tolerant and ragged * 20 > len(records):
        return ImportRefusal("malformed_source", f"{ragged} of {len(records)} nonblank source records are ragged, exceeding the supported 5% maximum. Confirm the separator and quoting or recover the export; no rows were repaired.", "source")
    return CsvData(tuple(header), tuple(record.cells for record in records), tuple(records), blanks, ragged)


def inspect_csv(raw: bytes, hints: Mapping[str, object] | None = None) -> dict[str, object] | ImportRefusal:
    if not isinstance(raw, bytes):
        return ImportRefusal("invalid_request", "The source must be unchanged CSV bytes.", "source")
    hints = {} if hints is None else hints
    if not isinstance(hints, Mapping) or set(hints) - {"encoding", "delimiter"}:
        return ImportRefusal("invalid_parameter", "Only encoding and delimiter hints are supported.", "hints")
    if ("encoding" in hints and hints["encoding"] not in ENCODINGS) or ("delimiter" in hints and hints["delimiter"] not in DELIMITERS):
        return ImportRefusal("invalid_dialect", "A dialect hint is unsupported.", "hints")
    if "encoding" in hints:
        encodings = [hints["encoding"]]
    elif raw.startswith(b"\xef\xbb\xbf"):
        encodings = ["utf-8-sig"]
    else:
        try:
            raw.decode("utf-8")
            encodings = ["utf-8"]
        except UnicodeDecodeError:
            encodings = ["windows-1252"]
    separators = [hints["delimiter"]] if "delimiter" in hints else list(DELIMITERS)
    candidates = []
    parsed = []
    failures = []
    for encoding in encodings:
        for separator in separators:
            dialect = {"encoding": encoding, "delimiter": separator, "quotechar": '"', "header": "first_record"}
            result = read_csv(raw, dialect, tolerant=True)
            if isinstance(result, CsvData) and (len(result.columns) > 1 or "delimiter" in hints):
                candidates.append(dialect)
                parsed.append(result)
            elif isinstance(result, ImportRefusal):
                failures.append(result.message)
    if not candidates:
        # Detection ambiguity or malformed CSV is represented without fabricated columns/counts.
        return {"source_id": source_id(raw), "dialect_candidates": [], "columns": [], "record_count": None,
                "sample_rows": [], "role_suggestions": [], "unresolved": ["No supported dialect yields consistent records; confirm encoding/separator or correct malformed quoting/cells.", *dict.fromkeys(failures)]}
    first = parsed[0]
    unresolved = ["Confirm the proposed encoding, separator and column roles."]
    if len(candidates) > 1:
        unresolved.append("Multiple dialects remain possible; confirm one before mapping.")
    if first.blank_record_count:
        unresolved.append(f"{first.blank_record_count} zero-cell blank records are skipped; source ordinals retain their gaps.")
    if first.ragged_record_count:
        unresolved.append(f"{first.ragged_record_count} ragged records must remain outside every population and require explicit row-issue confirmation.")
    suggestions = []
    for index, header in enumerate(first.columns):
        values = Counter(row[index] for row in first.rows if len(row) == len(first.columns) and row[index] != "")
        matches = []
        has_unzoned_time = False
        for name in FORMATS:
            parsed_count = 0
            for value, frequency in values.items():
                moment = parse_format(value, name)
                if moment is not None:
                    parsed_count += frequency
                    has_unzoned_time = has_unzoned_time or moment.tzinfo is None
            matches.append({"format": name, "parsed_count": parsed_count})
        matching_formats = [item["format"] for item in matches if item["parsed_count"] > 0]
        roles = ["context"]
        if values:
            roles.extend(["case_id", "activity"])
        if matching_formats:
            roles.append("timestamp")
        if values and all(value.isascii() and value.isdigit() for value in values):
            roles.append("source_sequence")
        if len(matching_formats) > 1:
            unresolved.append(f"Column {index} has multiple possible timestamp formats; choose day/month order explicitly.")
        if has_unzoned_time:
            unresolved.append(f"Column {index} has unzoned timestamps; explicitly choose recorded wall clock or fixed offset.")
        suggestions.append({"column_index": index, "roles": roles, "nonempty_count": sum(values.values()),
                            "distinct_nonempty_count": len(values), "timestamp_matches": matches})
    return {"source_id": source_id(raw), "dialect_candidates": candidates,
            "columns": [{"index": index, "name": name} for index, name in enumerate(first.columns)],
            "record_count": len(first.rows), "sample_rows": [{"source_position": record.source_position, "cells": list(record.cells)} for record in first.records[:10]],
            "blank_record_count": first.blank_record_count, "ragged_record_count": first.ragged_record_count,
            "role_suggestions": suggestions, "unresolved": unresolved}
