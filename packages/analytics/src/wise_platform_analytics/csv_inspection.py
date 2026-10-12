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


@dataclass(frozen=True)
class CsvData:
    columns: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]


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


def read_csv(raw: bytes, dialect: Mapping[str, str]) -> CsvData | ImportRefusal:
    try:
        text = raw.decode(_CODECS[dialect["encoding"]], errors="strict")
    except UnicodeDecodeError:
        return ImportRefusal("malformed_source", "The source cannot be decoded with the confirmed encoding.", "dialect.encoding")
    try:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=dialect["delimiter"], quotechar='"', strict=True)
        header = next(reader, None)
        if not header:
            return ImportRefusal("malformed_source", "The source has no readable header record.", "source")
        rows = []
        for position, row in enumerate(reader):
            if len(row) != len(header):
                return ImportRefusal("malformed_source", f"Source record {position} has {len(row)} cells; expected {len(header)}. No row was discarded.", "source")
            rows.append(tuple(row))
        return CsvData(tuple(header), tuple(rows))
    except (csv.Error, UnicodeError):
        return ImportRefusal("malformed_source", "The confirmed format does not form readable, complete CSV records.", "source")


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
    for encoding in encodings:
        for separator in separators:
            dialect = {"encoding": encoding, "delimiter": separator, "quotechar": '"', "header": "first_record"}
            result = read_csv(raw, dialect)
            if isinstance(result, CsvData) and (len(result.columns) > 1 or "delimiter" in hints):
                candidates.append(dialect)
                parsed.append(result)
    if not candidates:
        # Detection ambiguity or malformed CSV is represented without fabricated columns/counts.
        return {"source_id": source_id(raw), "dialect_candidates": [], "columns": [], "record_count": None,
                "sample_rows": [], "role_suggestions": [], "unresolved": ["No supported dialect yields consistent records; confirm encoding/separator or correct malformed quoting/cells."]}
    first = parsed[0]
    unresolved = ["Confirm the proposed encoding, separator and column roles."]
    if len(candidates) > 1:
        unresolved.append("Multiple dialects remain possible; confirm one before mapping.")
    suggestions = []
    for index, header in enumerate(first.columns):
        values = Counter(row[index] for row in first.rows if row[index] != "")
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
            "record_count": len(first.rows), "sample_rows": [{"source_position": position, "cells": list(row)} for position, row in enumerate(first.rows[:10])],
            "role_suggestions": suggestions, "unresolved": unresolved}
