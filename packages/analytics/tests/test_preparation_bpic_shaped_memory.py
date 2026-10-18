"""Per-record retained memory at the public preparation seam, on invented BPIC19-shaped rows.

The full prepared BPIC19 representation has 1,595,923 records. At the budget below one preparation
stays under about 2 GiB retained, so the native and prepared origins can be held together in the service.
The source bytes exist before measurement starts, so the budget excludes them.
"""
import gc
import tracemalloc

from bpic_shaped_literal import HEADER, arguments, cells, source
from wise_platform_analytics.preparation import PreparationResult, prepare

ROWS = 12_000
RETAINED_BYTES_PER_RECORD = 1_300


def retained(raw):
    gc.collect()
    tracemalloc.start()
    baseline = tracemalloc.get_traced_memory()[0]
    result = prepare(raw, *arguments(), True)
    gc.collect()
    current = tracemalloc.get_traced_memory()[0]
    tracemalloc.stop()
    return result, current - baseline


def test_bpic_shaped_preparation_fits_the_retained_budget_per_record():
    prepare(source(12), *arguments(), True)
    result, held = retained(source(ROWS))
    assert isinstance(result, PreparationResult) and result.state == "ready"
    assert held <= ROWS * RETAINED_BYTES_PER_RECORD, (held // ROWS, RETAINED_BYTES_PER_RECORD)


def test_shared_values_keep_every_record_exact():
    prepared = prepare(source(600), *arguments(), True).preparation
    assert prepared.source == source(600)
    for position, record in enumerate(prepared.records):
        expected = cells(position)
        assert record.original_cells == tuple(expected)
        assert all(type(cell) is str for cell in record.original_cells)
        assert [value.to_dict() for value in record.context] == [
            {"column_index": index, "value": expected[index] or None} for index in range(3, len(HEADER))]
        assert [record.context_value(index) for index in range(len(HEADER))] == [
            None, None, None, *(expected[index] or None for index in range(3, len(HEADER)))]
        assert record.local_timestamp == expected[2]
        assert record.time_value is not None and record.time_value.isoformat() == expected[2]
