"""Peak memory while reading a source, at the public inspection and preparation seams, on invented BPIC19-shaped rows.

Reading keeps no whole-file text: lines are decoded and parsed as they stream, so the memory above what a
preparation retains stays a small, size-independent amount per record.
"""
import gc
import io
import tracemalloc

import pytest

from bpic_shaped_literal import arguments, source
from wise_platform_analytics.csv_inspection import inspect_csv
from wise_platform_analytics.preparation import PreparationResult, prepare

ROWS = 12_000
PEAK_BYTES_PER_RECORD = 2_600


def measured(operation):
    gc.collect()
    tracemalloc.start()
    baseline = tracemalloc.get_traced_memory()[0]
    result = operation()
    gc.collect()
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return result, current - baseline, peak - baseline


def warm():
    inspect_csv(source(12))
    prepare(source(12), *arguments(), True)


def test_inspection_without_a_separator_hint_fits_the_peak_budget_per_record():
    warm()
    raw = source(ROWS)
    inspection, _, peak = measured(lambda: inspect_csv(raw))
    assert inspection["record_count"] == ROWS
    assert peak <= ROWS * PEAK_BYTES_PER_RECORD, (peak // ROWS, PEAK_BYTES_PER_RECORD)


def test_preparation_fits_the_peak_budget_per_record():
    warm()
    raw = source(ROWS)
    result, _, peak = measured(lambda: prepare(raw, *arguments(), True))
    assert isinstance(result, PreparationResult) and result.state == "ready"
    assert peak <= ROWS * PEAK_BYTES_PER_RECORD, (peak // ROWS, PEAK_BYTES_PER_RECORD)


def test_reading_above_retained_memory_does_not_grow_per_record_with_the_source():
    warm()
    above = {}
    for rows in (ROWS, 2 * ROWS):
        raw = source(rows)
        result, retained, peak = measured(lambda: prepare(raw, *arguments(), True))
        assert result.state == "ready"
        above[rows] = (peak - retained) / rows
        del result
    assert abs(above[2 * ROWS] - above[ROWS]) <= 0.1 * above[ROWS], above


class _Undecodable(bytes):
    """Source bytes that refuse to be decoded whole."""

    def decode(self, *args, **kwargs):
        raise AssertionError("the whole source was decoded into one string")


def test_reading_never_decodes_the_whole_source_or_buffers_it_as_text(monkeypatch):
    def no_text_buffer(*args, **kwargs):
        raise AssertionError("the source was wrapped in a whole-file text buffer")

    raw = _Undecodable(source(600))
    monkeypatch.setattr(io, "StringIO", no_text_buffer)
    assert inspect_csv(raw)["record_count"] == 600
    assert prepare(raw, *arguments(), True).state == "ready"
