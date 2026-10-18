"""Strict CSV decoding with ordinal headers and evidence-backed suggestions."""

from __future__ import annotations

from collections import Counter, deque
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
import codecs
import csv
import hashlib
import io
from pathlib import Path

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
    original_text: str | None
    """The record's exact physical text, kept only for a record the interpretation report can show as excluded."""

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


class SourceChanged(Exception):
    """A stored source file no longer holds the bytes of its identity, or cannot be read."""


@dataclass(frozen=True)
class SourceFile:
    """A stored source, read from its file as it is parsed instead of being held whole.

    Its digest is computed over exactly the bytes read. Reading it raises ``SourceChanged`` when they do not
    reproduce ``source_id``, so no answer is ever given for bytes other than the identified ones."""

    path: Path
    source_id: str


Source = bytes | SourceFile


def source_id(raw: Source) -> str:
    return raw.source_id if isinstance(raw, SourceFile) else "source.v1:sha256:" + hashlib.sha256(raw).hexdigest()


def validate_dialect(value: object) -> dict[str, str] | ImportRefusal:
    refusal = exact_object(value, {"encoding", "delimiter", "quotechar", "header"}, "dialect")
    if refusal is not None:
        return refusal
    assert isinstance(value, Mapping)
    if value["encoding"] not in ENCODINGS or value["delimiter"] not in DELIMITERS or value["quotechar"] != '"' or value["header"] != "first_record":
        return ImportRefusal("invalid_dialect", "Only registered encodings, separators, double quotes and a first-record header are supported.", "dialect")
    return dict(value)


_DECODE_CHUNK = 1 << 20


class _Refused(Exception):
    def __init__(self, refusal: ImportRefusal) -> None:
        self.refusal = refusal


def _undecodable() -> ImportRefusal:
    return ImportRefusal("malformed_source", "The source cannot be decoded with the confirmed encoding.", "dialect.encoding")


class _Digesting(io.RawIOBase):
    """A file whose bytes are hashed as they are read."""

    def __init__(self, handle) -> None:
        self.handle = handle
        self.digest = hashlib.sha256()

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:
        count = self.handle.readinto(buffer)
        if count:
            self.digest.update(memoryview(buffer)[:count])
        return count


@contextmanager
def _binary(raw: Source) -> Iterator[io.BufferedIOBase]:
    """The source as a binary stream. A file's digest covers every byte once: the bytes read while parsing and,
    when parsing stops early, the rest; a mismatch raises ``SourceChanged`` whatever the reading concluded."""
    if isinstance(raw, bytes):
        yield io.BytesIO(raw)
        return
    try:
        handle = raw.path.open("rb", buffering=0)
    except OSError as error:
        raise SourceChanged(raw.source_id) from error
    with handle:
        digesting = _Digesting(handle)
        try:
            yield io.BufferedReader(digesting, _DECODE_CHUNK)
        finally:
            rest = bytearray(_DECODE_CHUNK)
            while digesting.readinto(rest):
                pass
            if "source.v1:sha256:" + digesting.digest.hexdigest() != raw.source_id:
                raise SourceChanged(raw.source_id)


def _chunks(raw: Source) -> Iterator[bytes]:
    if isinstance(raw, bytes):
        view = memoryview(raw)
        for start in range(0, len(view), _DECODE_CHUNK):
            yield view[start:start + _DECODE_CHUNK]
        return
    with _binary(raw) as binary:
        while chunk := binary.read(_DECODE_CHUNK):
            yield chunk


def _starts_with_bom(raw: Source) -> bool:
    if isinstance(raw, bytes):
        return raw.startswith(codecs.BOM_UTF8)
    try:
        with raw.path.open("rb") as handle:
            return handle.read(len(codecs.BOM_UTF8)) == codecs.BOM_UTF8
    except OSError as error:
        raise SourceChanged(raw.source_id) from error


def _decodes(raw: Source, codec: str) -> bool:
    """Whether the whole source decodes, checked in chunks so that no whole-file text exists."""
    decoder = codecs.getincrementaldecoder(codec)("strict")
    try:
        for chunk in _chunks(raw):
            decoder.decode(chunk)
        decoder.decode(b"", final=True)
    except UnicodeDecodeError:
        return False
    return True


def _lines(binary: io.BufferedIOBase, codec: str) -> Iterator[str]:
    # Lines end at CR LF, CR or LF and keep their ending, exactly as a text buffer opened with newline="" splits them.
    return io.TextIOWrapper(binary, encoding=codec, errors="strict", newline="")


class _Taken:
    """A line iterator that remembers the physical lines of the record being read, so its text can be kept on demand."""

    __slots__ = ("lines", "taken")

    def __init__(self, lines: Iterator[str]) -> None:
        self.lines = lines
        self.taken: list[str] = []

    def __iter__(self) -> _Taken:
        return self

    def __next__(self) -> str:
        line = next(self.lines)
        self.taken.append(line)
        return line


_Record = tuple[int, int, int, list[str], str | None]


def _records(lines: Iterator[str], delimiter: str, tolerant: bool,
             keep_text: Callable[[list[str], int], bool]) -> Iterator[list[str] | _Record]:
    """Yield the header, then each nonblank record of one dialect, and return the blank and ragged counts.

    A structural defect raises ``_Refused``; an undecodable line raises ``UnicodeError`` from the line source."""
    taken = _Taken(lines)
    reader = csv.reader(taken, delimiter=delimiter, quotechar='"', strict=True)
    try:
        header = next(reader, None)
    except csv.Error as error:
        raise _Refused(ImportRefusal("malformed_source", f"Header at physical lines 1..{max(reader.line_num, 1)} is unreadable: {error}.", "source"))
    if not header:
        raise _Refused(ImportRefusal("malformed_source", "The source has no readable header record.", "source"))
    yield header
    width = len(header)
    blanks = ragged = position = count = 0
    while True:
        taken.taken = []
        line_start = reader.line_num + 1
        try:
            row = next(reader)
        except StopIteration:
            break
        except csv.Error as error:
            raise _Refused(ImportRefusal("malformed_source", f"Source record {position}, physical lines {line_start}..{max(reader.line_num, line_start)} is unreadable: {error}. The field character limit is {FIELD_CHARACTER_LIMIT}; check quoting and separators.", "source"))
        if not row and tolerant:
            blanks += 1
        else:
            if len(row) != width:
                if not tolerant:
                    raise _Refused(ImportRefusal("malformed_source", f"Source record {position}, physical lines {line_start}..{reader.line_num} has {len(row)} cells; expected {width}. No row was discarded.", "source"))
                ragged += 1
            yield position, line_start, reader.line_num, row, "".join(taken.taken) if keep_text(row, width) else None
            count += 1
        position += 1
    # Compare integer supports exactly: one of twenty is accepted; one of nineteen is not.
    if tolerant and ragged * 20 > count:
        raise _Refused(ImportRefusal("malformed_source", f"{ragged} of {count} nonblank source records are ragged, exceeding the supported 5% maximum. Confirm the separator and quoting or recover the export; no rows were repaired.", "source"))
    return blanks, ragged


def read_csv(raw: Source, dialect: Mapping[str, str], *, tolerant: bool = False, case_column: int | None = None) -> CsvData | ImportRefusal:
    """Read one dialect in a single streamed pass. An undecodable source is refused on its encoding before any structural defect.

    A record keeps its exact text only if it is ragged or, given ``case_column``, has a blank case identifier. A
    ``SourceFile`` whose bytes no longer match its identity raises ``SourceChanged``."""
    def keep_text(row: list[str], width: int) -> bool:
        return len(row) != width or (case_column is not None and case_column < width and not row[case_column].strip())

    codec = _CODECS[dialect["encoding"]]
    records = []
    with _binary(raw) as binary:
        try:
            reading = _records(_lines(binary, codec), dialect["delimiter"], tolerant, keep_text)
            header = next(reading)
            sharing = _CellSharing(len(header))
            while True:
                try:
                    position, line_start, line_end, row, text = next(reading)
                except StopIteration as stop:
                    blanks, ragged = stop.value
                    break
                records.append(SourceRecord(position, line_start, line_end, sharing.cells(row), text))
        except UnicodeError:
            return _undecodable()
        except _Refused as refused:
            return refused.refusal if _decodes(raw, codec) else _undecodable()
    return CsvData(tuple(header), tuple(record.cells for record in records), tuple(records), blanks, ragged)


class _SharedLines:
    """One pass over the decoded lines, read by several dialects at their own pace. Lines every reader has passed are released."""

    def __init__(self, lines: Iterator[str]) -> None:
        self.lines = lines
        self.buffer: deque[str] = deque()
        self.start = 0

    def line(self, index: int) -> str:
        while index - self.start >= len(self.buffer):
            self.buffer.append(next(self.lines))
        return self.buffer[index - self.start]

    def release(self, index: int) -> None:
        while self.start < index and self.buffer:
            self.buffer.popleft()
            self.start += 1


class _Cursor:
    __slots__ = ("shared", "index")

    def __init__(self, shared: _SharedLines) -> None:
        self.shared = shared
        self.index = 0

    def __iter__(self) -> _Cursor:
        return self

    def __next__(self) -> str:
        line = self.shared.line(self.index)
        self.index += 1
        return line


class _Candidate:
    """What inspection answers about one dialect, gathered record by record without keeping the records.

    A candidate that cannot become the answer still reads to the end, because its refusal is reported, but
    collects no values or samples."""

    def __init__(self, dialect: dict[str, str], shared: _SharedLines, collect: Callable[[list[str]], bool]) -> None:
        self.dialect = dialect
        self.cursor = _Cursor(shared)
        self.reading = _records(self.cursor, dialect["delimiter"], True, lambda row, width: False)
        self.collect = collect
        self.columns: tuple[str, ...] | None = None
        self.values: list[Counter] | None = None
        self.samples: list[dict[str, object]] = []
        self.record_count = self.blank_record_count = self.ragged_record_count = 0
        self.refusal: ImportRefusal | None = None
        self.finished = False

    def step(self) -> bool:
        """Read one more header or record; False once this dialect has finished or been refused."""
        try:
            item = next(self.reading)
        except StopIteration as stop:
            self.blank_record_count, self.ragged_record_count = stop.value
            self.finished = True
            return False
        except _Refused as refused:
            self.refusal = refused.refusal
            return False
        if self.columns is None:
            self.columns = tuple(item)
            if self.collect(item):
                self.values = [Counter() for _ in item]
            return True
        position, _, _, row, _ = item
        self.record_count += 1
        if self.values is not None:
            if len(self.samples) < 10:
                self.samples.append({"source_position": position, "cells": list(row)})
            if len(row) == len(self.columns):
                for counter, cell in zip(self.values, row):
                    if cell != "":
                        counter[cell] += 1
        return True


def _inspect_dialects(raw: Source, encoding: str, separators: list[str], collect: Callable[[list[str]], bool]) -> list[_Candidate]:
    """Evaluate every separator for one encoding in a single streamed pass over the source."""
    codec = _CODECS[encoding]
    with _binary(raw) as binary:
        shared = _SharedLines(_lines(binary, codec))
        candidates = [_Candidate({"encoding": encoding, "delimiter": separator, "quotechar": '"', "header": "first_record"}, shared, collect)
                      for separator in separators]
        active = list(candidates)
        try:
            while active:
                candidate = min(active, key=lambda each: each.cursor.index)
                if not candidate.step():
                    active.remove(candidate)
                shared.release(min((each.cursor.index for each in active), default=candidate.cursor.index))
        except UnicodeError:
            for candidate in candidates:
                if not candidate.finished:
                    candidate.refusal = _undecodable()
            return candidates
    if any(candidate.refusal is not None for candidate in candidates) and not _decodes(raw, codec):
        for candidate in candidates:
            if candidate.refusal is not None:
                candidate.refusal = _undecodable()
    return candidates


def inspect_csv(raw: Source, hints: Mapping[str, object] | None = None) -> dict[str, object] | ImportRefusal:
    """Propose dialects and roles for a source. A ``SourceFile`` whose bytes no longer match raises ``SourceChanged``."""
    if not isinstance(raw, (bytes, SourceFile)):
        return ImportRefusal("invalid_request", "The source must be unchanged CSV bytes.", "source")
    hints = {} if hints is None else hints
    if not isinstance(hints, Mapping) or set(hints) - {"encoding", "delimiter"}:
        return ImportRefusal("invalid_parameter", "Only encoding and delimiter hints are supported.", "hints")
    if ("encoding" in hints and hints["encoding"] not in ENCODINGS) or ("delimiter" in hints and hints["delimiter"] not in DELIMITERS):
        return ImportRefusal("invalid_dialect", "A dialect hint is unsupported.", "hints")
    if "encoding" in hints:
        encodings = [hints["encoding"]]
    elif _starts_with_bom(raw):
        encodings = ["utf-8-sig"]
    else:
        encodings = ["utf-8"] if _decodes(raw, "utf-8") else ["windows-1252"]
    separators = [hints["delimiter"]] if "delimiter" in hints else list(DELIMITERS)

    def answerable(header: list[str]) -> bool:
        return len(header) > 1 or "delimiter" in hints

    candidates = []
    parsed = []
    failures = []
    for encoding in encodings:
        for result in _inspect_dialects(raw, encoding, separators, answerable):
            if result.finished and answerable(list(result.columns)):
                candidates.append(result.dialect)
                parsed.append(result)
            elif result.refusal is not None:
                failures.append(result.refusal.message)
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
        values = first.values[index]
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
            "record_count": first.record_count, "sample_rows": first.samples,
            "blank_record_count": first.blank_record_count, "ragged_record_count": first.ragged_record_count,
            "role_suggestions": suggestions, "unresolved": unresolved}
