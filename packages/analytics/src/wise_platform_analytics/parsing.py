"""Reading an event-history source into records, or refusing it.

The source is the bytes of a CSV file: UTF-8, optionally starting with a byte
order mark, with ``\\n`` or ``\\r\\n`` line ends and standard double-quote
quoting. The first row names the columns; every later row is one recorded
event of an incident.

Rules of this parser version:

* The seven required columns are found by exact name, in any order. Further
  columns are kept as raw cells. A column named twice or not named is refused.
* A cell with no characters is a missing value (``None``). Every other cell is
  kept exactly as written; nothing is trimmed, and text such as ``Unknown`` is
  an ordinary value. This is the fixed missing-value policy
  ``MISSING_VALUE_POLICY``.
* ``incident_id``, ``source_sequence`` and ``timestamp_utc`` must have a value.
* ``timestamp_utc`` has the form ``2026-01-31T09:30:00Z`` with an optional
  fraction of one to nine digits. The ``Z`` is required: a time without it, or
  with another offset, is refused rather than guessed.
* ``source_sequence`` is a whole number of at most eighteen digits, optionally
  negative.
* Every row with cells is one record. Rows are never merged, dropped or
  reordered here: two identical rows are two records.
* A line with no cells at all carries no record. It is skipped and does not
  count towards the position of later records.
* Broken quoting, and a cell longer than the standard CSV reader accepts, are
  refused.

Anything else is refused with the reason, the 1-based line of the source and,
for a data row, its 1-based position among the data rows. The first offending
row in source order is the one reported.
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from .refusals import DetailValue, Refusal, RefusalCode

PARSER_VERSION = "incident.event_history_csv.v1"
MISSING_VALUE_POLICY = "incident.missing_value.empty_cell_only.v1"

INCIDENT_ID = "incident_id"
SOURCE_EVENT_ID = "source_event_id"
SOURCE_SEQUENCE = "source_sequence"
ACTIVITY = "activity"
TIMESTAMP_UTC = "timestamp_utc"
SERVICE = "service"
ASSIGNMENT_GROUP = "assignment_group"

REQUIRED_COLUMNS: tuple[str, ...] = (
    INCIDENT_ID,
    SOURCE_EVENT_ID,
    SOURCE_SEQUENCE,
    ACTIVITY,
    TIMESTAMP_UTC,
    SERVICE,
    ASSIGNMENT_GROUP,
)

_BYTE_ORDER_MARK = "﻿"
_NANOSECONDS_PER_SECOND = 1_000_000_000
_EPOCH = datetime(1970, 1, 1)
_TIMESTAMP = re.compile(
    r"(?P<year>[0-9]{4})-(?P<month>[0-9]{2})-(?P<day>[0-9]{2})"
    r"T(?P<hour>[0-9]{2}):(?P<minute>[0-9]{2}):(?P<second>[0-9]{2})"
    r"(?:\.(?P<fraction>[0-9]{1,9}))?Z"
)
_SEQUENCE = re.compile(r"-?[0-9]{1,18}")
_SHOWN_LENGTH = 60


@dataclass(frozen=True)
class SourceRecord:
    """One data row: its place in the source, its raw cells and its parsed keys."""

    position: int
    """1-based position among the data rows of the source."""
    line: int
    """1-based line of the source on which the row starts."""
    cells: tuple[str | None, ...]
    """Original cell text in column order; ``None`` for an empty cell."""
    incident_id: str
    source_event_id: str | None
    activity: str | None
    instant_ns: int
    """The timestamp as whole nanoseconds since 1970-01-01T00:00:00Z."""
    sequence: int


@dataclass(frozen=True)
class ParsedSource:
    """The columns of a source and its records in source order."""

    columns: tuple[str, ...]
    records: tuple[SourceRecord, ...]


def parse_instant(text: str) -> int | None:
    """Return the nanoseconds since the epoch for a UTC timestamp, or ``None``."""
    match = _TIMESTAMP.fullmatch(text)
    if match is None:
        return None
    try:
        moment = datetime(
            int(match["year"]),
            int(match["month"]),
            int(match["day"]),
            int(match["hour"]),
            int(match["minute"]),
            int(match["second"]),
        )
    except ValueError:
        return None
    elapsed = moment - _EPOCH
    seconds = elapsed.days * 86_400 + elapsed.seconds
    fraction = (match["fraction"] or "").ljust(9, "0")
    return seconds * _NANOSECONDS_PER_SECOND + int(fraction)


def parse_sequence(text: str) -> int | None:
    """Return the whole number written in ``text``, or ``None``."""
    if _SEQUENCE.fullmatch(text) is None:
        return None
    return int(text)


def parse_source(source: bytes) -> ParsedSource | Refusal:
    """Read every record of an event-history source, or say why it is malformed."""
    try:
        text = source.decode("utf-8")
    except UnicodeDecodeError as error:
        line = source.count(b"\n", 0, error.start) + 1
        return _malformed(
            "not_utf8",
            f"The source is not UTF-8 text: line {line} holds bytes that cannot be decoded "
            f"(byte offset {error.start}).",
            line=line,
            byte_offset=error.start,
        )
    if text.startswith(_BYTE_ORDER_MARK):
        text = text[len(_BYTE_ORDER_MARK) :]

    rows = _rows_with_cells(csv.reader(io.StringIO(text, newline=""), strict=True))
    columns: tuple[str, ...] | None = None
    records: list[SourceRecord] = []
    try:
        header = next(rows, None)
        if header is None:
            return _malformed("missing_header", "The source has no header row.")
        header_line, names = header
        refusal = _check_header(names, header_line)
        if refusal is not None:
            return refusal
        columns = tuple(names)
        index = {name: columns.index(name) for name in REQUIRED_COLUMNS}
        for line, row in rows:
            record = _read_record(row, line, len(records) + 1, columns, index)
            if isinstance(record, Refusal):
                return record
            records.append(record)
    except _UnreadableRow as unreadable:
        return _malformed(
            "invalid_csv",
            f"The row starting at line {unreadable.line} is not well-formed CSV: "
            f"{unreadable.reason}.",
            line=unreadable.line,
            source_position=None if columns is None else len(records) + 1,
        )
    if not records:
        return _malformed("no_data_rows", "The source has a header but no data rows.")
    return ParsedSource(columns=columns, records=tuple(records))


class _RowReader(Protocol):
    """The part of the standard CSV reader used here."""

    @property
    def line_num(self) -> int: ...

    def __next__(self) -> list[str]: ...


class _UnreadableRow(Exception):
    """A row the CSV reader cannot split into cells."""

    def __init__(self, line: int, reason: str) -> None:
        super().__init__(line, reason)
        self.line = line
        self.reason = reason


def _rows_with_cells(reader: _RowReader) -> Iterator[tuple[int, list[str]]]:
    """Yield each row that has cells, with the line on which it starts."""
    while True:
        line = reader.line_num + 1
        try:
            row = next(reader)
        except StopIteration:
            return
        except csv.Error as error:
            raise _UnreadableRow(line, str(error)) from error
        if row:
            yield line, row


def _check_header(names: list[str], line: int) -> Refusal | None:
    for column in REQUIRED_COLUMNS:
        if column not in names:
            return _malformed(
                "missing_column",
                f"The header (line {line}) has no {column!r} column.",
                line=line,
                column=column,
            )
    if "" in names:
        return _malformed(
            "unnamed_column",
            f"The header (line {line}) has a column without a name.",
            line=line,
        )
    counts = Counter(names)
    for name in names:
        if counts[name] > 1:
            return _malformed(
                "duplicate_column",
                f"The header (line {line}) names the column {name!r} more than once.",
                line=line,
                column=name,
            )
    return None


def _read_record(
    row: list[str],
    line: int,
    position: int,
    columns: tuple[str, ...],
    index: Mapping[str, int],
) -> SourceRecord | Refusal:
    where = f"Data row {position} (line {line})"
    if len(row) != len(columns):
        return _malformed(
            "wrong_cell_count",
            f"{where} has {len(row)} cells; the header names {len(columns)} columns.",
            line=line,
            source_position=position,
            expected=len(columns),
            actual=len(row),
        )
    cells = tuple(cell if cell != "" else None for cell in row)

    incident_id = cells[index[INCIDENT_ID]]
    if incident_id is None:
        return _malformed(
            "empty_incident_id",
            f"{where} has an empty {INCIDENT_ID}.",
            line=line,
            source_position=position,
            column=INCIDENT_ID,
        )

    sequence_text = cells[index[SOURCE_SEQUENCE]]
    sequence = None if sequence_text is None else parse_sequence(sequence_text)
    if sequence is None:
        return _malformed(
            "unparsable_sequence",
            f"{where} has a {SOURCE_SEQUENCE} that cannot be read: {_shown(sequence_text)}. "
            "Expected a whole number of at most eighteen digits.",
            line=line,
            source_position=position,
            column=SOURCE_SEQUENCE,
            value=sequence_text,
        )

    timestamp_text = cells[index[TIMESTAMP_UTC]]
    instant_ns = None if timestamp_text is None else parse_instant(timestamp_text)
    if instant_ns is None:
        return _malformed(
            "unparsable_timestamp",
            f"{where} has a {TIMESTAMP_UTC} that cannot be read: {_shown(timestamp_text)}. "
            "Expected the form 2026-01-31T09:30:00Z, optionally with fractional seconds.",
            line=line,
            source_position=position,
            column=TIMESTAMP_UTC,
            value=timestamp_text,
        )

    return SourceRecord(
        position=position,
        line=line,
        cells=cells,
        incident_id=incident_id,
        source_event_id=cells[index[SOURCE_EVENT_ID]],
        activity=cells[index[ACTIVITY]],
        instant_ns=instant_ns,
        sequence=sequence,
    )


def _shown(value: str | None) -> str:
    """Render an offending cell for a message, shortened when it is long."""
    if value is None:
        return "an empty cell"
    if len(value) > _SHOWN_LENGTH:
        return repr(value[:_SHOWN_LENGTH]) + "..."
    return repr(value)


def _malformed(
    reason: str,
    message: str,
    *,
    line: int | None = None,
    source_position: int | None = None,
    **more: DetailValue,
) -> Refusal:
    detail: dict[str, DetailValue] = {
        "reason": reason,
        "line": line,
        "source_position": source_position,
    }
    detail.update(more)
    return Refusal(RefusalCode.MALFORMED_SOURCE, message, detail)
