"""Detection proposes readable source evidence without accepting interpretations."""

from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.mapping import ImportRefusal


def test_detects_cp1252_semicolon_and_preserves_spaced_headers_and_umlauts():
    raw = ' Vorgang ; Aktivität ; Zeitpunkt \nA;Prüfung;09.10.2026 08:00\n'.encode("cp1252")
    answer = inspect_csv(raw)
    assert answer["dialect_candidates"] == [{"encoding": "windows-1252", "delimiter": ";", "quotechar": '"', "header": "first_record"}]
    assert answer["columns"] == [{"index": 0, "name": " Vorgang "}, {"index": 1, "name": " Aktivität "}, {"index": 2, "name": " Zeitpunkt "}]
    assert answer["record_count"] == 1
    assert answer["sample_rows"][0]["cells"][1] == "Prüfung"
    assert "timestamp" in answer["role_suggestions"][2]["roles"]


def test_detects_bom_and_quoted_newline_as_one_record_and_explicit_hints_are_respected():
    raw = b'\xef\xbb\xbfID,Event,At\nA,"Called, then\nchecked",2026-10-09T08:00:00Z\n'
    answer = inspect_csv(raw)
    assert answer["dialect_candidates"][0]["encoding"] == "utf-8-sig"
    assert answer["record_count"] == 1
    assert answer["sample_rows"][0] == {"source_position": 0, "cells": ["A", "Called, then\nchecked", "2026-10-09T08:00:00Z"]}
    hinted = inspect_csv(b"ID|Event|At\nA|Seen|2026-10-09T08:00:00Z\n", {"encoding": "utf-8", "delimiter": "|"})
    assert hinted["dialect_candidates"][0]["delimiter"] == "|"


def test_malformed_rows_never_report_fabricated_empty_success_or_lossy_decoding():
    for raw, hints in [(b'ID,Event,At\nA,"unterminated,2026-10-09\n', {"delimiter": ","}), (b"ID,Event,At\nA,Seen\n", {"delimiter": ","}), (b"ID,Event,At\nA,Seen,\x81\n", {"encoding": "windows-1252", "delimiter": ","})]:
        answer = inspect_csv(raw, hints)
        assert answer["record_count"] is None
        assert answer["sample_rows"] == [] and answer["columns"] == []
        assert answer["unresolved"]


def test_unsupported_hints_and_nonbytes_inputs_are_explicit_refusals():
    for raw, hints in [("not bytes", None), (b"ID,Event,At\n", {"encoding": "latin-auto"}), (b"ID,Event,At\n", {"execute": "guess"})]:
        assert isinstance(inspect_csv(raw, hints), ImportRefusal)
