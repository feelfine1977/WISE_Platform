"""Streamed reading keeps record boundaries, physical lines, excluded text and refusal order exact."""
from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.mapping import ImportRefusal
from wise_platform_analytics.preparation import PreparationResult, prepare
from test_csv_preparation_core import choices, dialect, roles
from test_csv_tolerant_rows_v2 import v2_choices

CHUNK = 8192


def straddling(shift):
    """A CR LF pair placed around the first 8,192-character decode chunk boundary, then two excluded records.

    Twenty ordinary records keep the one ragged record within the 5% tolerance."""
    head = "Case;Event;At;Note\r\n"
    long = "A;Step;09.10.2026 08:00;" + "y" * (CHUNK - len(head) - 26 - shift) + "\r\n"
    ragged = "A;Extra;09.10.2026 09:00;Extra;Unquoted\r\n"
    blank = '  ;Last;09.10.2026 09:01;"one\r\ntwo"\r\n'
    ordinary = "".join(f"A;Next{index};09.10.2026 08:{30 + index};z\r\n" for index in range(20))
    return (head + long + ordinary + ragged + blank).encode(), ragged, blank


def test_line_endings_across_decode_chunks_keep_physical_lines_and_excluded_text():
    for shift in range(-3, 4):
        raw, ragged, blank = straddling(shift)
        result = prepare(raw, dialect(), roles(context=(3,)), v2_choices(), True)
        assert isinstance(result, PreparationResult) and result.state == "ready", shift
        assert [record.original_cells[1] for record in result.preparation.records] == [
            "Step", *(f"Next{index}" for index in range(20)), "Extra", "Last"]
        assert result.to_dict()["report"]["excluded_source_records"] == [
            {"source_position": 21, "physical_line_start": 23, "physical_line_end": 23, "cell_count": 5, "reason": "ragged_record",
             "original_cells": ragged.rstrip("\r\n").split(";"), "original_text": ragged},
            {"source_position": 22, "physical_line_start": 24, "physical_line_end": 25, "cell_count": 4, "reason": "missing_case_id",
             "original_cells": ["  ", "Last", "09.10.2026 09:01", "one\r\ntwo"], "original_text": blank},
        ], shift


def test_an_undecodable_source_is_refused_on_its_encoding_before_a_structural_defect():
    raw = b'Case,Event,At\r\nA,"bad"x,09.10.2026 08:00\r\n' + b"B,Ok,09.10.2026 08:01\r\n" * 3000 + b"C,\xff,09.10.2026 08:02\r\n"
    refused = prepare(raw, dialect(delimiter=","), roles(), choices(), True)
    assert isinstance(refused, ImportRefusal)
    assert (refused.code, refused.field) == ("malformed_source", "dialect.encoding")
    inspected = inspect_csv(raw, {"encoding": "utf-8", "delimiter": ","})
    assert inspected["dialect_candidates"] == []
    assert "The source cannot be decoded with the confirmed encoding." in inspected["unresolved"]
